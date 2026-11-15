GitHub: #10
Status: resolved
Type: task
Blocked by: 2, 6

# 10: 提议卡片与撤销

**What to build:** 提议卡片：模型一次想改多条时走 `propose_findings`（一次最多 8 项），会话末尾聚合一张卡，逐项勾选、可展开依据、可"拒绝并说明"；接受后落库并在会话留一条可撤销摘要，撤销落 Correction 而不删除。拒绝后模型必须同轮给出下一步（换方案/追问/撤回并说明）。

**Blocked by:** #2, #6

**Status:** resolved

- [x] 一轮返回 3 条判定时只出现一张卡，而不是三张
- [x] 每项可单独勾选/取消，低置信度默认不勾，可展开看依据
- [x] "全部接受"与"接受选中"结果一致且幂等
- [x] "拒绝并说明"可输入理由，理由作为证据入库且不产生 Finding
- [x] 一次超过 8 项时被拒，模型被告知分轮
- [x] 撤销后该条不再出现在档案投影里，历史可查

## 交付记录（#10）

- `domain/proposal.rs`（卡与项、阈值 60、1–8 项校验）、`store/proposals.rs`（开卡 / 待审查询 / 接受 / 拒绝一项 / 撤销，各自单事务）、`domain::tool::ProposeArgs`、`llm::agent` 的 `propose` 分支。
- `api::Proposals`：`accept(conversation, proposal, selected)`、`reject(conversation, proposal, index, reason)`（写库后**关库**再发起新一轮，redb 一个文件同时只容一个写句柄）、`undo(proposal, reason)`。
- 会话详情多带 `pending_proposal` 与 `accepted_proposals`；界面是一张卡（逐项勾选、低置信度标出来、展开四段依据、接受选中 / 逐项拒绝并说明 / 已应用摘要 + 撤销）。
- 测试：`cargo test` 175 项、`nsh test` 186 项；新增 `Proposals.test.tsx` 覆盖「一轮 3 项一张卡」「低置信度默认不勾」「接受→已应用→撤销回到待确认」「拒绝→证据 + 自动发起下一轮」。
- schema 版本 9 → 10。

## 实施要点（已确认，等 #9、#8 落地后开工）

- **第四个工具** `propose_findings(items[])`，schema 与另外三个同格式；规则在 `domain/tool.rs`：1–8 项、每项四段齐、已有 `Pending` 提议时**拒绝**并回错误（Q13）。
- **提议挂在会话上**，不进 `Message`：`proposals` 表 + `ConversationDetailView.pending_proposal` / `accepted`（Q7）。
- **接受** = 逐项 `record_with_evidence`，单事务；"全部接受"与"接受选中"同一条路径，幂等。**拒绝** = 落 `rejection` 证据、不产生 Finding，然后把"我拒绝了第 N 项（理由：…）"作为**真实用户消息**落库并自动发起新一轮（Q11a），多项拒绝合并成一条消息。
- **撤销整批**一次（一条理由，逐项 `Retract`），卡回到 `Pending` 可重新勾选接受（Q19，跟随 `design/contract.md` §6.2）。
- **低置信度阈值 60** 写进 `domain` 常量，测试引用它而不是魔法数字（Q12）。
- schema 版本 9 → 10。

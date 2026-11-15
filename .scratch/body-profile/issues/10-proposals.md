GitHub: #10
Status: ready-for-agent
Type: task
Blocked by: 2, 6

# 10: 提议卡片与撤销

**What to build:** 提议卡片：模型一次想改多条时走 `propose_findings`（一次最多 8 项），会话末尾聚合一张卡，逐项勾选、可展开依据、可"拒绝并说明"；接受后落库并在会话留一条可撤销摘要，撤销落 Correction 而不删除。拒绝后模型必须同轮给出下一步（换方案/追问/撤回并说明）。

**Blocked by:** #2, #6

**Status:** ready-for-agent

- [ ] 一轮返回 3 条判定时只出现一张卡，而不是三张
- [ ] 每项可单独勾选/取消，低置信度默认不勾，可展开看依据
- [ ] "全部接受"与"接受选中"结果一致且幂等
- [ ] "拒绝并说明"可输入理由，理由作为证据入库且不产生 Finding
- [ ] 一次超过 8 项时被拒，模型被告知分轮
- [ ] 撤销后该条不再出现在档案投影里，历史可查

## 实施要点（已确认，等 #9、#8 落地后开工）

- **第四个工具** `propose_findings(items[])`，schema 与另外三个同格式；规则在 `domain/tool.rs`：1–8 项、每项四段齐、已有 `Pending` 提议时**拒绝**并回错误（Q13）。
- **提议挂在会话上**，不进 `Message`：`proposals` 表 + `ConversationDetailView.pending_proposal` / `accepted`（Q7）。
- **接受** = 逐项 `record_with_evidence`，单事务；"全部接受"与"接受选中"同一条路径，幂等。**拒绝** = 落 `rejection` 证据、不产生 Finding，然后把"我拒绝了第 N 项（理由：…）"作为**真实用户消息**落库并自动发起新一轮（Q11a），多项拒绝合并成一条消息。
- **撤销整批**一次（一条理由，逐项 `Retract`），卡回到 `Pending` 可重新勾选接受（Q19，跟随 `design/contract.md` §6.2）。
- **低置信度阈值 60** 写进 `domain` 常量，测试引用它而不是魔法数字（Q12）。
- schema 版本 9 → 10。

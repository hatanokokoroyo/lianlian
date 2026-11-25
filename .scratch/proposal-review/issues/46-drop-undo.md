GitHub: #46
Status: ready-for-agent
Type: task
Blocked by: 45

# 46 · 提议审核 · 撤掉撤销并收敛文档

**What to build:** 已处理的卡收成一行摘要、点开只读回看；删掉撤销的整条路径与旧的逐项状态读法；把交互契约、README、词表对齐到新语义。

- [ ] 已处理的卡默认显示一行摘要「已写进 N 项，不要 M 项 · 展开看当时的选择」，点开只读查看 ✓/✗、编号、理由与依据。
- [ ] `Proposals.undo`、`Store::undo_proposal`、卡上的撤销入口、`AcceptedProposal` 组件删除。
- [ ] `has_pending_items` 与「接受部分后继续审剩余项」的读法删除；状态只剩 Pending → Accepted / Dismissed。
- [ ] `design/contract.md` §5 表格与 §6.2 状态机图改成新语义（待审 → 已处理，一次提交一轮）。
- [ ] `README.md` 的「接受后留可撤销摘要」改成「提交即定案，已处理的卡收起可回看」。
- [ ] `GLOSSARY.md`：「档案更新提议」补「审核在对话时间线内，一次提交就是一次决定」；「更正」补「界面不再提供撤销入口，更正由对话触发」。
- [ ] `Retract` 与 `correct_finding` 不变，更正仍然可用。

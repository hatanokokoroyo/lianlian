GitHub: #6
Status: resolved
Type: task
Blocked by: 2, 3

# 06: 会话与消息持久化

**What to build:** 会话列表与消息存储：新建、续聊、归档、删除会话，消息持久化。此时还没有模型，用假回复驱动，把"会话作为一种人类可读的时间线与日志归属单位"这个模型先立起来。

**Blocked by:** #2, #3

**Status:** resolved

- [x] 可新建会话、进入旧会话续聊、归档、删除
- [x] 消息按序持久化，重开 app 后仍在
- [x] 归档的会话从默认列表消失但可被找回
- [x] 删除会话只删消息正文（日志与照片的保留语义由 08 之后的工单验证）
- [x] 长消息列表可滚动且不卡顿

## Comments

- 2026-11-15：`domain::conversation`（会话 / 消息 / 角色，标题取自第一条用户消息）+
  `store::conversations`（`conversations` / `messages` 两张表，库版本 6）。本地列表把未归档与
  已归档分开，归档折叠在底部可展开找回；删除会话连同它的消息正文一起删，依据日志与照片不在
  这两张表里，保留语义留给 #8 之后验证。消息列表用 `List`（虚拟滚动、`initialScrollAtEnd`）。
  回复仍是占位假回复（`llm::fake`），#7 换成模型网关。测试：Rust（排序 / 归档 / 删除 / 重开）+
  `Conversations.test.tsx`（新建、续聊、归档、取消归档、删除、重开仍在）。

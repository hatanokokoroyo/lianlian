GitHub: #9
Status: resolved
Type: task
Blocked by: 6

# 09: 工具层与硬规则

**What to build:** 工具层：`search_evidence`、`record_finding`、`correct_finding` 三个工具接上模型，并与领域层打通。**硬规则由工具层强制**：未先对该部位 `search_evidence` 就调写入，一律拒绝并回错误让模型重试。

**Blocked by:** #6

**Status:** resolved

- [x] 模型能调起三个工具并拿到结构化结果
- [x] 写入一条 Finding 会同时落一条四段式依据日志（用户说法要点/验证方案与反馈/推理/不确定之处），缺段则拒绝
- [x] 未先查询该部位就写入 → 被拒且错误信息足以让模型自助纠正
- [x] `search_evidence` 支持按部位/轴/时间/关键词过滤，`limit` 上限 20 且不可绕过
- [x] 以上用假客户端驱动一次完整工具往返即可测，不联网

## 实施要点（#9 交付时写下）

- **依据日志**：`src/domain/evidence.rs` + `src/store/evidence.rs`，一张 `evidence` 表；`kind ∈ {record, resolve, retract, rejection}`；四段对前三种必填（`rejection` 只要求理由）；判定与日志走 `record_with_evidence` / `retract_with_evidence` 的**单事务**。
- **硬规则**：`src/domain/tool.rs` 的 `TurnSearches`，**本轮内**记账；指名 `site` 的检索即算查过（档案里还没有记录也算，否则第一条永远写不进去）。`limit` 夹在 1–20。
- **工具循环**：`src/llm/agent.rs`（`run_turn` + `StoreHost`），失败以 `function_call_output` 的 JSON（`code`/`message`/`hint`）回给模型；轮次上限默认 6、可配 1–128（`Settings::save_rounds` + 设置页 `tool-rounds`），到上限停并留可见说明，不留半对 `function_call`。
- **历史持久化（Q2 的决策）**：`messages` 表的值从 `Message` 换成 `Entry { id, conversation, at, item: StoredItem }`，消息与工具往返同类存储；`append_turn` 整轮单事务，界面只投影消息。`arguments` / `output` 存字符串原文，保证前缀可重建。
- **装配**：`assemble` 吃 `&[Entry]`；超长裁剪**按整轮**（`assemble_with_turns`），避免拆散 `function_call` 与其 `output`。
- **语料重录（未经网络）**：`tests/corpus/deepseek-first-request.json` 由装配函数确定性重建（`REGEN_CORPUS=1 cargo test regenerate`），回复语料仍是录制件。
- **测试**：`cargo test` 148 项 + `nsh test` 155 项全绿；工具往返、未查先写被拒后自助纠正、轮次上限、`limit` 钳制、按整轮裁剪都有断言。
- schema 版本 7 → 8（按约定丢表重建）。

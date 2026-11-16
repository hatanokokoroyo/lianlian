GitHub: #12
Status: resolved
Type: task
Blocked by: 8, 9

# 12: 计划生成、版本与复查日

**What to build:** 计划生成：模型依据档案与训练条件调用 `generate_plan` 产出版本化计划（频次规则、动作清单、每个动作对应的 Finding、复查日默认 4 周）；训练条件不齐时模型必须先追问而不是编。

**Blocked by:** #8, #9

**Status:** resolved

- [x] 生成一份计划后档案页可见，每个动作能点回它对应的 Finding
- [x] 同一时刻只有一个生效计划；重新生成即新版本，旧版本只读可查
- [x] 训练条件不齐时 agent 追问而不是产出计划
- [x] 复查日到期后今日页顶部出现提示
- [x] 计划落库前后都能读到完整结构（不含 UI）

## Comments

**2026-11-15 交付（agent）**

- 领域层 `domain::plan`：`Frequency`（per-week / every-n-days）、`Exercise`（组数、次数或秒数、
  挂一条判定）、复查日默认 4 周（`DEFAULT_REVIEW_WEEKS`）；`ready_to_plan` 把「训练条件不齐」
  成套报成 `TrainingIncomplete`，工具层据此拒绝并让模型去追问。
- 存储 `store::plans`：全部版本 + `meta.active_plan_id` 生效指针，同一事务写入；旧版本内容
  不随新版本变化（store 测试钉住）。
- 第五个工具 `generate_plan`：参数是频次、动作清单、`review_in_weeks`（1–12，默认 4）；
  训练条件不齐回 `training_incomplete`，动作挂的判定不存在回 `unknown_finding`。
- 装配：状态块新增「生效计划：第 N 版 · 每周 3 次 · 复查 YYYY-MM-DD」与逐条动作；系统提示
  补排计划的要求。工具集从 4 个变 5 个，`tests/corpus/deepseek-first-request.json` 已重录。
- 界面：档案页新增计划卡（频次、动作处方、来自哪条判定、历史版本只读列表、复查日提示），
  动作「看判定」直接展开该部位并打开时间线；今日页顶部在复查日到期时提示重新评估。
- 测试：领域表驱动（频次边界、动作取值范围、缺训练条件）、store（版本、生效唯一、判定不存在）、
  工具往返（先查后排、拒绝→追问）、`Plan.test.tsx` 竖切（对话排计划 → 档案页可见 → 点回判定 →
  版本列表 → 复查日提示）。

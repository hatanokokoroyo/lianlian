GitHub: #15
Status: resolved
Type: task
Blocked by: 12

# 15: 推迟、跳过与跨天结算

**What to build:** 推迟、跳过与跨天结算：整天推迟到下一个空档训练日（可手动指定），单动作可跳过；过了自然日 00:00 仍未完成的训练日自动落为"未完成"。

**Blocked by:** #12

**Status:** resolved

- [x] 整天推迟后原日变为空档、目标日接管动作快照
- [x] 推迟目标日已有训练时给出明确提示而不是静默叠加
- [x] 跳过单个动作不影响整天打卡，跳过记录可查
- [x] 跨天后未打卡自动变为"未完成"，且当天仍可补勾（补勾后转为已完成）
- [x] 结算逻辑为纯函数并有跨时区边界的单测（用本地时间断言）

## Comments

- 2026-11-16：已交付 `d581f4b`。`domain::day` 增加 `skipped` 与纯函数 `settle(day, today)`
  （本地自然日边界）；`store::days` 提供 `skip_exercise` / `settle_before` / `next_open`；
  `Today.load/toggle/skip/postpone` 读之前先结算，`Today.postpone` 落到下一个空档日或指定日，
  目标日已有训练时返回明确错误。今日页新增跳过弹层与可编辑目标日的推迟弹层，跳过行有独立样式，
  进度按「完成 + 跳过」计。测试：Rust domain/store 单测，以及 `Today.test.tsx` 的跳过与整天推迟用例。

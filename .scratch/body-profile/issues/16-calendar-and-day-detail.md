GitHub: #16
Status: resolved
Type: task
Blocked by: 13

# 16: 月历与日详情

**What to build:** 月历与日详情：五种格子（已完成/计划中/已推迟/未完成/休息日）用**形状 + 颜色**双编码，点某天进入日详情只读回看当时的动作快照与勾选情况。

**Blocked by:** #13

**Status:** resolved

- [x] 月历正确区分五种状态，不只靠颜色（形状也可区分）
- [x] 今天有独立标记；未来日期只显示"计划中"
- [x] 点任意一天进入日详情，显示当时的动作快照与每项勾选状态
- [x] 月切换流畅，跨月数据正确
- [x] 日详情不可编辑当天的历史动作（改期与勾选各有入口）

## Comments

- 2026-11-16：已交付 `d8a60b7`。`domain::day::calendar_cell` 是覆盖已完成/计划中/已推迟/未完成/
  休息日的纯函数，原日被推迟后靠目标的 `postponed_from` 仍标「已推迟」；`Days.range` 先结算，
  `Days.day(today, date)` 返回只读快照。新 `screens/calendar.tsx` 铺周一开头的 35/42 格，
  今天整格描边、五种形状 + 颜色双编码、图例、前后月切换、只读日详情，跨天漏掉的训练日可补勾。
  `App.tsx` 的月历占位已替换为真实屏。测试：Rust `calendar_cell` / `calendar_cells`，
  以及 `Calendar.test.tsx` 三个用例（状态与日详情、跨天补勾、推迟原日与目标日）。

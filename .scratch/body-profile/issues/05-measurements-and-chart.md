GitHub: #5
Status: resolved
Type: task
Blocked by: 1, 2

# 05: 测量与折线图

**What to build:** 身高/体重的**测量**序列：每次记录留一条带时间的值，档案页用折线图展示变动，单条测量可删除。这是唯一允许用户单条删除的数据（ADR-0003 的例外）。

**Blocked by:** #1, #2

**Status:** resolved

- [x] 每次记录身高或体重都新增一条测量，不覆盖旧值
- [x] 折线图按时间画出变动；只有一个点时也能读
- [x] 单条测量可删除，删除后折线图立即重画
- [x] 基本属性里显示的"当前体重"始终来自最新一条测量
- [x] 无测量时图表位显示引导而不是空白坐标轴

## Comments

- 2026-11-15：`Basics` 去掉 `height_cm` / `weight_kg`，改为 `domain::measurement` 的只追加序列
  （`store::measurements`，库版本 5）。`Profile.saveBasics` 在数值与最新一条不同时追加测量；
  `Measurements.record/delete/load` 是测量页的入口。折线图用 `nsh/base/plot` 的 `Line` + `Dot`
  （不手画路径），单点也能读；空态给引导。测试在 Rust（序列、删除、当前值来源）与
  `Measurements.test.tsx`（真实库、折线重画、删到空）。

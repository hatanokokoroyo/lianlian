GitHub: #26
Status: ready-for-agent
Type: task

# 计划锚点用 UTC 日期，凌晨排计划会从昨天开始

**What to build:** 计划生成时用设备本地的今天作为训练日展开锚点，不要在 `ensure_days` 里用 `Date::from_ms(plan.at)` 推 UTC 日期。

- [ ] 在本地日期与 UTC 日期不同的时间创建计划，今天就是计划的第一个训练日。
- [ ] 旧计划的展开结果不因本次修复改变。
- [ ] 上述 5 个 `nsh test` 用例在任何本地时间段都稳定通过。
- [ ] `cargo test` / `nsh check` / `nsh test` 通过。

## 原因

- JS 把所有「今天」按设备本地日期传进 Rust（`todayIso()`），例如 `2026-11-17`。
- 计划生成时只存 `at` 时间戳；展开训练日时用 `Date::from_ms(plan.at)` 取锚点，而 `from_ms` 是 **UTC 断界**（`src/domain/day.rs`）。
- 本地 00:00–08:00（UTC+8）之间，`from_ms(now)` 会落到前一天，计划从昨天开始展开；`Today.load(本地今天)` 因此把今天判成休息日。

## 证据

- 复现命令：`nsh test Today.test.tsx --filter "跳过一项"`（2026-11-17 03:36 CST，base `d7fa82b` 同样失败）
- 屏幕：`今天休息` / `下一次训练是 11月18日`
- 相关代码：`src/store/days.rs` 的 `Date::from_ms(plan.at)`；`src/domain/day.rs` 的 `from_ms` 注释。

## Comments

- 2026-11-17：体验审计时发现并单独建单；未并入 UX 修复（#25），避免把时区语义改动混进布局改动。

GitHub: #2
Status: ready-for-agent
Type: task

# 02: 混合骨架跑通（Rust + TSX + 原生模块，Android）

**What to build:** 把 Rust crate、TSX 屏与 native module 三者接起来，在 Android 模拟器上跑出一屏"由 TSX 渲染、数据来自 Rust"的界面，证明混合形态可行。这是 ADR-0002 的可行性验证：若某一步在 Android 上不通，本工单的产出就是结论 + 退回纯 TSX + `Storage` 的方案，而不是硬啃。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `nsh run --target android` 在模拟器上启动，显示一屏 TSX 界面
- [ ] TSX 经由自动生成的类型调用一个 Rust 函数并显示其返回值
- [ ] `nsh check` 通过；生成的类型目录不入库
- [ ] crate 能编译并打开一个 redb 数据库文件（证明第三方纯 Rust 依赖在 Android 上可编译）
- [ ] 仓库有 README 记录所需的 SDK/NDK 版本与从零复现的步骤
- [ ] 若任一步在 Android 上不可行，写下结论与 ADR-0002 的备选方案

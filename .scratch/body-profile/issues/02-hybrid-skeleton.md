GitHub: #2
Status: resolved
Type: task
# 混合骨架跑通（Rust + TSX + 原生模块，Android）

**What to build:** 把 Rust crate、TSX 屏与 native module 三者接起来，在 Android 上跑出一屏"由 TSX 渲染、数据来自 Rust"的界面，证明混合形态可行。这是 ADR-0002 的可行性验证：若某一步在 Android 上不通，本工单的产出就是结论 + 退回纯 TSX + `Storage` 的方案，而不是硬啃。

**结论：可行**（真机 Redmi 2510DRK44C / Android 17 / arm64-v8a；本机无 emulator，故不在模拟器上验）。三个 ABI 都编过，redb 在设备上真开库、真读写。

**Blocked by:** None (can start immediately)

- [x] `nsh run --target android` 启动，显示一屏 TSX 界面（真机）
- [x] TSX 经由自动生成的类型调用一个 Rust 函数并显示其返回值
- [x] `nsh check` 通过；生成的类型目录不入库
- [x] crate 能编译并打开一个 redb 数据库文件（证明第三方纯 Rust 依赖在 Android 上可编译）
- [x] 仓库有 README 记录所需的 SDK/NDK 版本与从零复现的步骤
- [x] 若任一步在 Android 上不可行，写下结论与 ADR-0002 的备选方案 —— 不适用：可行，不需要备选路径

## Comments

### hatanokokoroyo · 2026-11-15T13:42:50Z

骨架跑通了，结论：**混合形态可行，不需要走 ADR-0002 的备选路径**（纯 TSX + `Storage`）。

跑的是**真机**而不是模拟器（Redmi 2510DRK44C / Android 17 / arm64-v8a，本机没装 emulator），验收项逐条对照：

- `nsh run --target android` 起得来；宿主 `NSHDev` 装上后 App 常驻，改 TSX 热更新（实测 4ms 生效）、改 Rust 重编重启。
- TSX 经自动生成的类型调用 Rust：`App.tsx` → `lianlian/native`（`nsh.json` `"rust": "."`，`--template mixed`）→ `src/api.rs`。
- `nsh check` 通过；`.nsh/`（生成的声明与运行器）与 `target/` 不入库。
- crate 能编并且**真的打开 redb 文件**：三个 ABI（x86_64 / arm64-v8a / armeabi-v7a）都编过，跑在设备上的是
  `/data/data/com.longbridge.nsh.host/files/nsh/com.lianlian.app/lianlian.redb`；首次播种、之后读回，今日页的
  「蚌式开合 / 死虫式 / 臀桥 / 单腿臀桥」就是从库里读出来的，不是写死的。
- README 记了 SDK/NDK/adb/Rust 目标版本、从零复现步骤，以及四个真机坑（WSL mirrored 下 adb 归属、5038 残留
  daemon 独占 USB、`.nsh/android` 残留导致 `Directory not empty`、Rust 同步 fn 在引擎线程撞「no reactive runtime」）。

顺带钉住两条后面会反复用到的东西：

1. **testID 能落到 Android 的 resource id**（`id=exercise-clamshell`），uiautomator / `android-nsh-mcp` 直接可点，
   后续 UI 自动化不必截图对像素。
2. **改 Rust 后手机上可能还跑旧 lib**（宿主按 build 号缓存解包的 native lib）：`nsh.json` 的 `build` 要跟着加，
   或 `adb shell pm clear com.longbridge.nsh.host`。

提交：`c9c5915`（骨架）+ `f4fccb9`（清单顺序取序号、值格式版本）。

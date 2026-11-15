# 练练

一个纯本地（无后端）的 Android 应用：通过与 agent 的对话与照片建立结构化的身体档案，据此生成锻炼计划，并按日打卡。模型调用由用户自带的 key 直连。

- 产品与领域词汇：`GLOSSARY.md`
- 需求与工单：`.scratch/body-profile/spec.md`、`.scratch/body-profile/issues/`（镜像自 GitHub Issues）
- 决策：`docs/adr/0001`–`0006`
- 视觉契约（实现只认它）：`design/contract.md`

## 现状

骨架期。目前只跑通了一条竖切链路，用来钉死 ADR-0002 的形态（工单 #2）：

```
App.tsx（TSX 屏：今日页） → lianlian/native（自动生成的类型） → src/api.rs → src/store.rs → redb 单文件
```

今日页的动作清单不是写死的：它由 Rust 侧打开 redb 库、首次运行播种、再读回来交给 TSX。勾选目前只在内存里，落库与日状态机是 #14；档案、对话、计划、模型网关都还没开始。

```
App.tsx            今日页（TSX + Tailwind 类 + design/contract.md 的 token）
App.test.tsx       今日页的 headless 测试（nsh test）
src/lib.rs         crate 的 UI 集合：注册对 TSX 暴露的 module
src/api.rs         对 TSX 暴露的类型与入口（JsObject → native.d.ts）
src/store.rs       redb 建库、播种、读回（另有 cargo 单测）
nsh.json           app 元信息 + 设计 token（shadcn cssVars 形式）
design/            OpenDesign 工作区：9 屏原型 + 视觉契约
docs/              ADR、agent 工作流、skill 中文译本
```

## 从零复现

Rust + TSX 混合形态由 [NSH](https://nsh.dev) 承载。以下版本是本机跑通的那一套，新机器照抄即可：

| 组件 | 版本 |
|---|---|
| `nsh` | 0.5.0（`curl -fsSL https://nsh.dev/install.sh \| sh`）|
| rustc / cargo | 1.97.1（`edition = "2024"`，需 1.85+）|
| Android SDK platform-tools | 37.0.1（`adb` 走 PATH）|
| Android SDK build-tools | 35.0.1 |
| Android SDK platform | android-35 |
| Android NDK | 30.0.16248370 |
| Rust → Android target | `aarch64-linux-android`、`x86_64-linux-android`、`armv7-linux-androideabi`、`i686-linux-android` |
| 设备 | Redmi 2510DRK44C，Android 17 / API 37，arm64-v8a（`user` 版）|

一次性准备：

```sh
# Rust 侧交叉编译目标（nsh 会为三种 ARM/x86 ABI 各编一次）
rustup target add aarch64-linux-android x86_64-linux-android armv7-linux-androideabi i686-linux-android

# Android SDK / NDK
sdkmanager "ndk;30.0.16248370" "build-tools;35.0.1" "platforms;android-35"
```

nsh 需要 `ANDROID_HOME`、`adb` 和 NDK 里的 libclang（quickjs 的 bindgen）。环境变量一次性写进 shell：

```sh
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
export LIBCLANG_PATH="$ANDROID_HOME/ndk/30.0.16248370/toolchains/llvm/prebuilt/linux-x86_64/lib"
```

日常命令：

```sh
nsh run --target android    # 装/更新 NSHDev 宿主并跑起来，改 TSX 热更新、改 Rust 重启
nsh check                   # cargo check + 用生成的声明类型检查 App.tsx
nsh test                    # cargo test + App.test.tsx（headless，不需要设备）
nsh run                     # 本机 Linux 宿主，最快的界面迭代
```

首次 `nsh run --target android` 会编译 Rust 依赖并给设备装 NSHDev 宿主，几分钟；之后是秒级。

## 踩过的坑（WSL2 + 真机）

- **adb 归属**：WSL 用 mirrored 网络，`adb` 复用 **Windows** 上跑的 adb server，本机 `~/.wslconfig` 是 `networkingMode=mirrored`。设备由 Windows 侧 daemon 持有，WSL 不设任何变量就能看到设备。
- **`adb devices` 空但手机确实连着**：先杀干净多余的 daemon。真机上遇到过 Windows adb 起在 5038、独占 USB 设备，5037 的 daemon 于是一直空；`adb -P 5038 kill-server` 后 5037 立即正常。
- **`Directory not empty (os error 39)`**：上一次 `nsh run` 被 Ctrl-C 打断会留下 `.nsh/android/NshDev.apk-work/`，下一次装宿主时命名冲突。删掉 `.nsh/android` 再来。
- **`no reactive runtime: signals are used on the engine thread`**：Rust 的普通 `fn`（不带 `cx`、非 `async`）跑在引擎线程，那里没有响应式运行时，读 `data_dir()` 之类的服务会 panic。要碰平台服务就写成 `async fn`（任务里跑）或在 TSX 侧用 `resource()` 消费。
- **`nsh.test` 的 headless 宿主不给 app 私有目录**（`data_dir()` 为 `None`），所以 `store` 在没有私有目录时落到系统临时目录，库行为在测试里是真的。

## 约定

- 词表未出现的术语不要写进代码标识符；命名以 `GLOSSARY.md` 为准。
- 屏幕的视觉只用 `design/contract.md` §2 的 token 名与 §7 的 testID，不抄原型 HTML。
- `.nsh/`（生成的类型与运行器）与 `target/` 不入库。

# 练练

一个纯本地（无后端）的 Android 应用：通过与 agent 的对话与照片建立结构化的身体档案，据此生成锻炼计划，并按日打卡。模型调用由用户自带的 key 直连。

- 产品与领域词汇：`GLOSSARY.md`
- 需求与工单：`.scratch/body-profile/spec.md`、`.scratch/body-profile/issues/`（镜像自 GitHub Issues）
- 决策：`docs/adr/0001`–`0006`
- 视觉契约（实现只认它）：`design/contract.md`

## 现状

骨架期，两条竖切已完成：

```
App.tsx（TSX 屏：今日页） → lianlian/native（自动生成的类型） → src/api.rs → src/store → redb 单文件
```

- **#2 形态**：今天动作清单不是写死的，由 Rust 打开 redb、首次播种、读回交给 TSX；勾选目前只在内存里，
  落库与日状态机是 #14。
- **#3 领域层**：解剖学部位词表（119 条部位 + 23 个肌群）、五轴枚举、Finding 只追加与撤回、
  投影与聚合（肌群取最差值、骨骼集合子项优先于父项）。档案页/工具层会用到它，界面还没接。
- **#4 冷启动**：首启引导三步（基本属性 → 训练条件 → 首次评估）；档案页可随时改基本属性与
  训练条件；训练条件缺项时今日页提示「计划前需要先补训练条件」，齐全时提示「可以开始首次评估」。
  月历屏还是占位（#16）。
- **#5 测量**：身高与体重是**测量**（带时间戳的只追加序列），不再是基本属性里的两个可编辑字段。
  档案页的「当前身高/体重」永远取最新一条测量；测量页用 `Plot` 画折线（只有一个点也看得见），
  单条可删（全库唯一允许单条删除的数据）。
- **#6 会话**：会话列表（新建 / 续聊 / 归档折叠 / 删除）与会话正文。消息按序落库，长列表用
  `List` 虚拟滚动；删除只清消息正文（依据日志与照片的保留语义由 #8 之后接上）。
- **#7 模型网关**：设置页填 DeepSeek key（只存本机，打码显示），直连 `api.deepseek.com/responses`
  （无状态、多轮自拼、非流式）。装配顺序按 ADR-0006：系统提示 → 本会话历史 → 状态块
  （基本属性 + 最近测量 + 档案投影 + 训练条件 + 未结提议）→ 本轮消息；同一状态两次装配字节一致。
  错误按出路分三类：可重试（断网/超时/429/5xx，只给重试）、配置（key/额度，直接去设置）、
  请求（超长等，自动裁掉最旧一半历史重发一次，说明记在会话上、重开仍可见）。失败时一条消息都不落库，
  输入框里的文字不丢（草稿按会话缓存在界面模块里）。
  真实响应语料在 `tests/corpus/`（请求 + 响应），测试全离线（`open` 的 `network` 桩）。

```
App.tsx            应用外壳：读档案 → 引导 / 四个 Tab
screens/           今日、引导、档案、测量、对话列表/聊天、设置（TSX）
ui/                共用零件（卡片/胶囊/按钮/输入）与表单草稿
App.test.tsx       冷启动主干与重开持久的 headless 测试（nsh test）
src/lib.rs         crate 的 UI 集合：注册对 TSX 暴露的 module
src/api.rs         对 TSX 暴露的类型与入口（JsObject → native.d.ts，`Profile` / `Measurements` /
                   `Conversations` / `Settings` 模块）
src/anatomy/       解剖学词表：mod.rs 放类型与规则，sites.rs 是生成的内容
src/domain/        五轴取值、Finding/Retract、投影与聚合、测量、会话（纯函数、零 IO）
src/llm/           装配（prompt.rs，纯函数）+ DeepSeek 网关（deepseek.rs，错误分类）
src/store/         redb：mod.rs 开库与版本、profile.rs 基本属性/训练条件、findings.rs 判定与撤回、
                   measurements.rs 测量序列、conversations.rs 会话与消息、settings.rs API key
scripts/gen-anatomy.py   从词表 markdown 生成 src/anatomy/sites.rs
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
- **改了 Rust，手机上却还是旧行为**：dev server 有时判定「没变化」而不重装宿主，手机上跑的还是旧 native lib（加 `nsh.json` 的 `build` 也不一定让它重装）。可靠做法是 `adb shell pm clear com.longbridge.nsh.host` 后重开一次 dev server，等日志出现 `installed the Android development host`。代价是 app 私有目录里的库文件也被清掉——开发期无所谓。
- **`nsh.json` 故意不声明 `capabilities`**：一旦声明，没列出的能力（webview、picker、clipboard……）会一并被关掉；
  不声明时自有 app 保留不受限的 HTTP/取图等能力，而文件系统、裸 socket 仍然要显式声明。接照片（#8）前别加。
- **库里的值格式变了**：库结构与值格式的版本写在 `meta` 表的 `schema_version`（当前 8）；版本对不上时 `store` 丢表重建（骨架期不做迁移，改表就要 +1）。
- **`nsh.test` 的 headless 宿主不给 app 私有目录**（`data_dir()` 为 `None`），所以 `store` 在没有私有目录时落到系统临时目录，库行为在测试里是真的。
- **`nsh test` 的多个测试文件共用一个进程，也就共用一个临时库**。每个测试文件用 `beforeAll(freshDatabase)`
  （`test-helpers.ts`）在各文件开头调 `Testing.reset()`，所以文件之间互不影响，文件内仍共享（「重开 app 数据还在」
  才验得了）。`Testing` 是测试入口，不是产品功能；「清空本地数据」属于后续工单的重操作。

## 约定

- 词表未出现的术语不要写进代码标识符；命名以 `GLOSSARY.md` 为准。
- 改词表只能改 `.scratch/body-profile/anatomy-sites.md`，然后 `python3 scripts/gen-anatomy.py`（提交前
  `--check` 验证），不要手改 `src/anatomy/sites.rs`。
- 屏幕的视觉只用 `design/contract.md` §2 的 token 名与 §7 的 testID，不抄原型 HTML。
- `.nsh/`（生成的类型与运行器）与 `target/` 不入库。

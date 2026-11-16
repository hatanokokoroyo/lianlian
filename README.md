# 练练

一个纯本地（无后端）的 Android 应用：通过与 agent 的对话与照片建立结构化的身体档案，据此生成锻炼计划，并按日打卡。模型调用由用户自带的 key 直连。

- 产品与领域词汇：`GLOSSARY.md`
- 需求与工单：`.scratch/body-profile/spec.md`、`.scratch/body-profile/issues/`（镜像自 GitHub Issues）
- 决策：`docs/adr/0001`–`0006`
- 视觉契约（实现只认它）：`design/contract.md`

## 现状

骨架期，以下竖切已完成：

```
App.tsx（TSX 屏：今日页） → lianlian/native（自动生成的类型） → src/api.rs → src/store → redb 单文件
```

- **#2 形态**：今天动作清单不是写死的，由 Rust 打开 redb、首次播种、读回交给 TSX；勾选目前只在内存里，
  落库与日状态机是 #14。
- **#3 领域层**：解剖学部位词表（119 条部位 + 23 个肌群）、五轴枚举、Finding 只追加与撤回、
  投影与聚合（肌群取最差值、骨骼集合子项优先于父项）。档案页/工具层会用到它，界面还没接。
- **#4 冷启动**：首启引导三步（基本属性 → 训练条件 → 首次评估）；档案页可随时改基本属性与
  训练条件；训练条件缺项时今日页提示「计划前需要先补训练条件」，齐全时提示「可以开始首次评估」。
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
- **#8 照片**：系统选择器取图 → 落 app 私有目录（长边 ≤2048，只有一份 JPEG）→ 当轮随消息发给模型 →
  会话里显示缩略图可点开。照片不作依据，随会话一起删（ADR-0005 修订）。
- **#9 工具层**：`search_evidence` / `record_finding` / `correct_finding` / `propose_findings` 四个工具接上模型；
  「未先对该部位 `search_evidence` 就写入」由 Rust 工具层拒绝，不靠提示词自觉。工具失败一律作为
  `function_call_output` 回给模型；一轮的往返上限可配 1–128。
- **#10 提议卡片**：一轮想改多条时走 `propose_findings`（1–8 项），会话末尾一张卡逐项勾选、可展开依据、
  可拒绝并说明（拒绝落证据并自动发起下一轮）；接受后留可撤销摘要，撤销追加 Correction 不删历史。
- **#11 档案页**：按区域（肌肉看首要肌群、骨骼看区域）分组、可折叠，左右分开，每行五轴（未测虚线）；
  展开看四段依据与时间线（倒序，每条判定带自己的依据、标明写入/解决/撤回），可「标记已解决」
  （追加正常判定）与「判定有误」（撤回，必须写理由，时间线上任何一条都能撤）；肌群聚合显示成员的
  最差值并指名最差那条来自哪个部位。词表外的部位不会出现。
- **#12 计划**：`generate_plan` 按档案与训练条件排出**版本化**计划（频次规则 + 动作清单 + 复查日，默认四周），
  同一时刻只有一个生效计划，再生成就是新版本、旧版本只读可查；每个动作挂一条判定，档案页的计划卡
  点「看判定」直接展开那个部位的时间线；训练条件不齐时工具直接拒绝（让 agent 追问，不编方案）；
  复查日到期后今日页顶部提示重新评估。
- **#13 训练日**：计划的频次规则由 `domain::day` 展开成具体日期（每周 N 次按周一至周日的固定
  作息铺开，1–3 次不连排、4 次起一定有一对相邻——七天一循环里最多 3 个互不相邻的位置；
  「每 N 天一次」从计划生效日算起），展开时 day 存动作**快照**
  （名字、处方、判定、部位），改计划只影响之后新展开的天；单日可整天推迟到别的日期，原日回到
  休息日且不会被再次展开；`Days.range` 供月历查询（#16）。
- **#14 今日页与打卡**：打开就是今天的动作清单（完成度环 + `1/4 项` + 日状态），逐项勾选、即时落库
  （杀掉进程重开进度仍在），全部勾完落为「已完成」并给出打卡反馈，当天取消勾选退回「计划中」；
  今天休息时说明下一次训练是哪天，没有计划时引导去补训练条件或去对话排计划。
- **#15 推迟、跳过与跨天结算**：整天推迟到下一个空档训练日（也可手动指定），目标日已有训练时明确拒绝；
  单个动作可跳过且不挡打卡（跳过记录留在当天）；过了本地自然日 00:00 仍未完成自动落为「未完成」，
  当天仍可补勾、补完转为「已完成」。结算逻辑是纯函数，`Days.range` / `Today.load` 读之前先结算。
- **#16 月历与日详情**：月历按周一开头铺 35/42 格，已完成/计划中/已推迟/未完成/休息日五种状态
  形状 + 颜色双编码（实心点 / 空心环 / 「推迟」 / 「×」 / 无标记），今天整格描边；点任意一天进入
  只读日详情，看当时的动作快照与勾选；跨天漏掉的训练日另开「补勾」入口，改期仍在今日页。
- **#17 容量仪表与归档**：档案页显示本地数据总量、数据库与照片目录占用，以及每张表的大小与占比；
  归档只影响列表，不碰档案数据；删除会话只释放消息与照片，依据日志保留，重开后在会话搜索结果里
  仍标「来源会话已删除」。
- **#18 会话长度阈值**：发送前估算装配后的输入长度（非 ASCII 约 1 字 1 token、ASCII 约 4 字符
  1 token、每张照片按 1000 估），≥20 万在会话上提示开新会话，≥50 万直接拒绝并引导新开
  （新会话第一轮就带完整档案投影）；原有的「请求超限 → 裁掉最旧一半历史重发一次」兜底保留，
  两条说明按「轮次上限 > 裁剪 > 长度提醒」的优先级只留最具体的一条。

```
App.tsx            应用外壳：读档案 → 引导 / 四个 Tab；每个 Tab 用自己的 NavStack，
                   Android 返回键沿栈回退，非今日 Tab 的根部先回今日再退出
screens/           今日、月历/日详情、引导、档案（含 findings.tsx 的档案条目）、测量、对话列表/聊天、设置（TSX）
ui/                共用零件（卡片/胶囊/按钮/输入）、表单草稿与日期格式（dates.ts）
*.test.tsx         headless 测试：App（冷启动主干）、Findings（档案页）、Plan（计划）、Today（打卡）、
                   Calendar（月历/日详情）、Storage（容量/归档）、Chat/Conversations/Photos/Proposals/
                   Measurements（各自工单）、Navigation（系统返回栈），全部跑在 `api` 这一个接缝下
src/lib.rs         crate 的 UI 集合：注册对 TSX 暴露的 module
src/api.rs         对 TSX 暴露的类型与入口（JsObject → native.d.ts，`Profile` / `Measurements` /
                   `Findings` / `Conversations` / `Photos` / `Proposals` / `Plans` / `Days` / `Today` /
                   `Storage` / `Settings` 模块）
src/anatomy/       解剖学词表：mod.rs 放类型与规则，sites.rs 是生成的内容
src/domain/        五轴取值、Finding/Retract、投影与聚合、档案页读模型（profile_page.rs）、测量、会话、
                   计划（plan.rs）、训练日与日状态机（day.rs，含日期运算）——纯函数、零 IO
src/llm/           装配（prompt.rs，纯函数）+ DeepSeek 网关（deepseek.rs，错误分类）
src/store/         redb：mod.rs 开库与版本、profile.rs 基本属性/训练条件、findings.rs 判定与撤回、
                   measurements.rs 测量序列、conversations.rs 会话与消息、plans.rs 计划与版本、
                   days.rs 训练日与动作快照、settings.rs API key
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

## 发版与更新

只在人主动下令时发版：推送代码不会触发构建，也不会打包。

```sh
scripts/release-android.sh "修好了打卡日期边界"   # 触发云端构建，等它跑完
scripts/release-android.sh --dry-run "验证流水线" # 只构建，不建 Release
```

- 版本号只有一个真源：`nsh.json` 的 `version`。发版前先提升它；tag `v<version>` 已存在时构建会拒绝。
- 构建号（`versionCode`）用 CI 的运行序号自动递增，不需要手改 `build`。
- 工作流产出正式签名的 APK，并在同一个 Release 里挂 `latest.json` 与 `.sig`：
  应用启动时读它，比对版本、校验签名，发现有新版就在今日页顶部提示。
- 安卓不允许应用静默安装：点「去下载」只会打开 APK 直链，下载后由系统安装器弹窗确认，
  首次还需要在浏览器里允许「安装未知应用」。

发版需要的仓库 Secret（一次性配置，值不在仓库里）：

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_B64` | 正式签名 keystore 的 base64 |
| `ANDROID_KEYSTORE_PASSWORD` | 该 keystore 的密码 |
| `NSH_UPDATE_KEY` | 更新清单签名私钥（`nsh keygen` 的 `.secret`）的 base64 |

keystore 必须离线备份：丢了以后，已装的应用无法再覆盖升级。应用配置里 `updater.publicKey`
是更新清单公钥，改了它等于让老版本不再信任新清单。

本地验证更新提示时，可以把 `updater` 临时指向本机回环地址的清单；安卓默认禁止明文 HTTP，
这种临时构建需要 `android.usesCleartextTraffic`，验证完不要提交。

想手工验一份清单的签名（发布后抽查、或换机器核对）：

```sh
gh release download v0.2.0 -p 'latest.json*' -D /tmp/mf
python3 - <<'PY'
import base64
raw = base64.b64decode("nsh.json 里 updater.publicKey 的值")
der = bytes.fromhex("302a300506032b6570032100") + raw          # Ed25519 SubjectPublicKeyInfo
open("/tmp/pub.pem", "w").write("-----BEGIN PUBLIC KEY-----\n" + base64.encodebytes(der).decode() + "-----END PUBLIC KEY-----\n")
open("/tmp/framed.bin", "wb").write(b"nsh-updater-manifest\0" + open("/tmp/mf/latest.json", "rb").read())
PY
openssl pkeyutl -verify -pubin -inkey /tmp/pub.pem -rawin -in /tmp/framed.bin -sigfile /tmp/mf/sig.bin
```

签名盖的不是文件字节本身，而是 `nsh-updater-manifest\0` 前缀加清单内容（`nsh-updater` 的 `CONTEXT`，
防止同一把钥匙签过的别的东西被挪用）。`.sig` 是 base64，验之前要先解码成 `/tmp/mf/sig.bin`。

## 踩过的坑（WSL2 + 真机）

- **`nsh test` 的模块替身只有第一次 `open` 生效**：同一个测试入口在一次运行里只构建一次，
  `open(..., { modules })` 换掉的导出不会带进第二次 `open`。要测「重开以后」的行为，一个文件只开一次应用，
  用真实的库状态（例如设置表）造出前置条件。
- **组件自己 `return null` 不会移除已渲染的视图**：组件体只跑一次，条件判断要在调用方的 JSX 里做
  （`{cond() ? <X/> : null}`），那里才是会跟着信号重跑的绑定。
- **`nsh update-manifest` 不接受 `.apk`**：它只认桌面那套 `<name>-<version>-<os>-<arch>.tar.gz|.zip`。
  安卓只用到「去哪里下载」，所以不传归档、只传 `--link android=<url>` 即可，清单里就是
  `platforms.android.url`，签名照常由 `--key` 产出。
- **`nsh package` 调 `apksigner` 需要 Java**：非交互 shell 里没设 `JAVA_HOME` 会报
  `Unable to locate a Java Runtime`，Rust 已经编好却卡在签名这一步。
- **清单走本机回环地址时安卓会拦**：默认禁止明文 HTTP，本地验证要临时给
  `android.usesCleartextTraffic` 并 `adb reverse` 端口，验证完还原。
- **bash 里变量后面紧跟中文标点会被吞进变量名**：`echo "已发布 v$version：…"` 在 UTF-8 环境下
  把全角冒号算进变量名，报 `version：: unbound variable`。用 `${version}` 括起来。

- **adb 归属**：WSL 用 mirrored 网络，`adb` 复用 **Windows** 上跑的 adb server，本机 `~/.wslconfig` 是 `networkingMode=mirrored`。设备由 Windows 侧 daemon 持有，WSL 不设任何变量就能看到设备。
- **`adb devices` 空但手机确实连着**：先杀干净多余的 daemon。真机上遇到过 Windows adb 起在 5038、独占 USB 设备，5037 的 daemon 于是一直空；`adb -P 5038 kill-server` 后 5037 立即正常。
- **两边抢 5037（mirrored 网络）**：WSL 里一跑 `adb` 就占住 127.0.0.1:5037，Windows 侧的 adb server 于是绑不上、`adb.exe start-server` 报 `could not read ok from ADB Server`，设备在 Windows 也看不见。做法是让 Windows 的 adb 换个端口起、WSL 去连它：
  ```sh
  "/mnt/c/Users/<你>/AppData/Local/Android/Sdk/platform-tools/adb.exe" -P 5039 start-server
  export ADB_SERVER_SOCKET=tcp:127.0.0.1:5039   # 当前 shell 里所有 adb / nsh run --target android 都用它
  ```
  换完之后 `adb devices` 与 `nsh run --target android` 都正常；不要在 WSL 里另起 `adb start-server`，会把 5039 那条路堵回去。
- **`Directory not empty (os error 39)`**：上一次 `nsh run` 被 Ctrl-C 打断会留下 `.nsh/android/NshDev.apk-work/`，下一次装宿主时命名冲突。删掉 `.nsh/android` 再来。
- **`no reactive runtime: signals are used on the engine thread`**：Rust 的普通 `fn`（不带 `cx`、非 `async`）跑在引擎线程，那里没有响应式运行时，读 `data_dir()` 之类的服务会 panic。要碰平台服务就写成 `async fn`（任务里跑）或在 TSX 侧用 `resource()` 消费。
- **改了 Rust，手机上却还是旧行为**：dev server 有时判定「没变化」而不重装宿主，手机上跑的还是旧 native lib（加 `nsh.json` 的 `build` 也不一定让它重装）。可靠做法是 `adb shell pm clear com.longbridge.nsh.host` 后重开一次 dev server，等日志出现 `installed the Android development host`。代价是 app 私有目录里的库文件也被清掉——开发期无所谓。
- **`nsh.json` 故意不声明 `capabilities`**：一旦声明，没列出的能力（webview、picker、clipboard……）会一并被关掉；
  不声明时自有 app 保留不受限的 HTTP/取图等能力，而文件系统、裸 socket 仍然要显式声明。接照片（#8）前别加。
- **`nsh package --target android` 要系统装 libclang**：它要重新编译 nsh 运行时（含 quickjs），
  `bindgen` 需要 `libclang.so`；没装时报 `Unable to find libclang`。`sudo apt install libclang-dev`
  之后 `LIBCLANG_PATH=/usr/lib/llvm-18/lib nsh package --target android -o dist`（NDK 里那份 libclang
  是给 Android 交叉编译的，别指给 host bindgen 用）。
- **库里的值格式变了**：库结构与值格式的版本写在 `meta` 表的 `schema_version`（当前 13）；版本对不上时 `store` 丢表重建（骨架期不做迁移，改表就要 +1）。
- **`nsh.test` 的 headless 宿主不给 app 私有目录**（`data_dir()` 在引擎线程上还会直接 panic），所以 `store::app_dir()` 在没有私有目录时落到系统临时目录，库与照片在测试里都是真的；照片目录跟着它走（`store::app_dir()/photos`），不要在 `cargo test` 里调 `photos_dir()`——它照样会 panic，测试里把目录当参数传进去。
- **`nsh test` 的多个测试文件共用一个进程，也就共用一个临时库**。每个测试文件用 `beforeAll(freshDatabase)`
  （`test-helpers.ts`）在各文件开头调 `Testing.reset()`，所以文件之间互不影响，文件内仍共享（「重开 app 数据还在」
  才验得了）。`Testing` 是测试入口，不是产品功能；「清空本地数据」属于后续工单的重操作。

## 约定

- 词表未出现的术语不要写进代码标识符；命名以 `GLOSSARY.md` 为准。
- 改词表只能改 `.scratch/body-profile/anatomy-sites.md`，然后 `python3 scripts/gen-anatomy.py`（提交前
  `--check` 验证），不要手改 `src/anatomy/sites.rs`。
- 屏幕的视觉只用 `design/contract.md` §2 的 token 名与 §7 的 testID，不抄原型 HTML。
- `.nsh/`（生成的类型与运行器）与 `target/` 不入库。

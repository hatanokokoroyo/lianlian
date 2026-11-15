# Rust + TSX 混合形态，数据存在 redb

应用由 Rust crate 与 TSX 屏组成：Rust 拥有领域模型、存储、模型网关与图片文件，TSX 只做屏与交互，通过 `#[native_module]` 生成的类型化接口调用 Rust。持久化用纯 Rust 的嵌入式库 redb，照片以文件形式存在 app 私有目录。

**背景**：NSH 的 TSX 沙箱在 Android 上没有 `fs`（`fs/promises` 返回 `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`），唯一的持久化是 `Storage`——一个 `storage.json`，**引擎写死的 5 MB 上限**，值只能是字符串。5 MB 装得下文字（约 500 万字），装不下照片（一张 2048px JPEG 200–400 KB）。

**为什么不用纯 TSX**：照片取证是产品主线（对话评估要带图），纯 TSX 意味着照片永不落盘，且 5 MB 是所有数据的硬顶——聊天、档案、计划共用一个额度。更贵的代价还在后面：档案是 append-only 时间序列 + 日历区间查询，塞进一个 JSON 字符串后每次都要全量加载。

**为什么不用 SQLite**：`rusqlite` 需要 NDK 交叉编译 C 代码；redb 是纯 Rust、单文件、支持事务与 key 范围扫描，正好匹配 Finding 时间序列与日历区间这两种查询形状。真遇到 redb 在 Android 上的问题时再换 SQLite，接口不变。

**代价**（接受）：Rust 侧任何改动都要重编 + 重启（无热更新）；工程骨架比纯 TSX 重（Cargo crate、类型生成、两个注册表）；`Image` 无法直接加载移动端本地文件，照片要靠 Rust 读字节喂 `ImageSrc`。
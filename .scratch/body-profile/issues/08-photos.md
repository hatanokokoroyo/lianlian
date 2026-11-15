GitHub: #8
Status: resolved
Type: task
Blocked by: 5

# 08: 照片链路

**What to build:** 照片链路：从系统相册选择器取图（`picker` 能力）→ 落 app 私有目录（原图长边 2048 + 缩略图）→ 当轮随消息发给模型 → 会话里显示缩略图可点开。

**Blocked by:** #5

**Status:** resolved

- [x] 可选图（相册选择器，不需要相册权限），取消不留垃圾
- [x] 图片落私有目录并可再次显示，重开 app 后仍在
- [x] 当轮请求里带的是缩放后的图，不是原图
- [x] 会话里照片可点开看大图
- [x] 图片过大时被自动缩到上限并提示
- [x] 删除会话后照片文件**一起删除**（ADR-0005 修订：照片不是依据，没有留的理由）

## 交付记录

- `domain/photo.rs`（`Photo` + `was_scaled`）、`photos/mod.rs`（base64 / data URL / 落盘读写）、`store/photos.rs`（`photos` 表 + `reserve_photo_id` + 按会话删行）、`api::Photos`（`pick` 走 `pick_images`，`data` 给 `Image` 的 `src`）。
- 用户消息带 `photos: [id]`；装配时**只有当轮**带 `input_image`，历史轮是 `[用户发了一张照片]`。系统提示加一句「照片只在这一轮可见，不是已留存的依据」。
- 删除会话：照片行与文件一起删；依据日志照旧保留。
- 测试：`cargo test` 164 项、`nsh test` 173 项（新增 `Photos.test.tsx`：选图→发送→请求里是 `input_image`→会话里可点开→重开仍在→取消不留垃圾；以及「只发照片也能发」「历史轮不重发原图」）。
- schema 版本 8 → 9。

## 实施要点（已确认）

- **一次一张**：`nsh_core::prelude::pick_images(PickRequest { limit: 1, max_dimension: 2048, quality: 0.85, format: Compatible })`。缩放与 HEIC→JPEG 由**系统选择器**完成，Rust 侧不引入 image crate。
- **一份文件**：`data_dir()/photos/{id}.jpg`，**不生成缩略图**；会话里显示时由 Rust 把字节交给 TSX 建 blob URL，`Image` 按显示尺寸解码（`design/contract.md` §4 的既有约定）。
- **不通话就发图**：只有当轮新照片进请求（`input_image` + base64 data URL）；历史轮的照片装配成一行占位文本 `[用户发了一张照片]`（确定性，前缀仍稳定）。
- **照片不是证据**：依据日志与 `search_evidence` 都不带照片本体或引用（ADR-0005 修订）；系统提示里写明"照片只在本轮可见，不要当成已留存的依据"。
- **删除会话连照片一起删**（Q17）：验收项据此改写为"删除会话后照片文件也消失"。
- 取消选择 → 什么都不落（文件与库行都不写）；"过大被缩到上限并提示"用"返回尺寸长边 == 2048"作代理判断（平台不报原尺寸）。
- schema 版本 8 → 9。

GitHub: #8
Status: ready-for-agent
Type: task
Blocked by: 5

# 08: 照片链路

**What to build:** 照片链路：从系统相册选择器取图（`picker` 能力）→ 落 app 私有目录（原图长边 2048 + 缩略图）→ 当轮随消息发给模型 → 会话里显示缩略图可点开。

**Blocked by:** #5

**Status:** ready-for-agent

- [ ] 可选图（相册选择器，不需要相册权限），取消不留垃圾
- [ ] 图片落私有目录并可再次显示，重开 app 后仍在
- [ ] 当轮请求里带的是缩放后的图，不是原图
- [ ] 会话里照片可点开看大图
- [ ] 图片过大时被自动缩到上限并提示
- [ ] 删除会话后照片文件仍保留（与 ADR-0005 一致）

## 实施要点（已确认，等 #9 落地后开工）

- **一次一张**：`nsh_core::prelude::pick_images(PickRequest { limit: 1, max_dimension: 2048, quality: 0.85, format: Compatible })`。缩放与 HEIC→JPEG 由**系统选择器**完成，Rust 侧不引入 image crate。
- **一份文件**：`data_dir()/photos/{id}.jpg`，**不生成缩略图**；会话里显示时由 Rust 把字节交给 TSX 建 blob URL，`Image` 按显示尺寸解码（`design/contract.md` §4 的既有约定）。
- **不通话就发图**：只有当轮新照片进请求（`input_image` + base64 data URL）；历史轮的照片装配成一行占位文本 `[用户发了一张照片]`（确定性，前缀仍稳定）。
- **照片不是证据**：依据日志与 `search_evidence` 都不带照片本体或引用（ADR-0005 修订）；系统提示里写明"照片只在本轮可见，不要当成已留存的依据"。
- **删除会话连照片一起删**（Q17）：验收项据此改写为"删除会话后照片文件也消失"。
- 取消选择 → 什么都不落（文件与库行都不写）；"过大被缩到上限并提示"用"返回尺寸长边 == 2048"作代理判断（平台不报原尺寸）。
- schema 版本 8 → 9。

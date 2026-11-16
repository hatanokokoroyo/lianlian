GitHub: #21
Status: ready-for-agent
Type: task
Blocked by: 20

# 21: 手动触发的签名 APK 构建

**What to build:** 我在本地敲一条命令，GitHub 在云端编译出正式签名的安卓 APK。推送代码不会触发构建；
只有我主动下令才会。产物挂到 Release 上，另有一份临时 artifact 便于排错。带一个「只构建、不发布」的开关，
用来在第一次配置流水线时验证，而不在 Release 上留下废包。

**Blocked by:** 20（没有签名身份就产不出可覆盖安装的包）

**Status:** ready-for-agent

- [ ] 只有手动触发这一种入口，`push` 不会启动构建
- [ ] 一条本地命令完成「触发 → 等待 → 下载产物」，参数是更新说明
- [ ] 「只构建不发布」模式下只产出 artifact，不创建 Release
- [ ] 正常模式下 Release 的 tag 是 `v<version>`，版本取自应用配置；tag 已存在时构建失败并提示先改版本
- [ ] 构建号自动递增，不依赖人工维护
- [ ] 产出的 APK 用正式 keystore 签名，能装进手机并覆盖同签名的旧包
- [ ] 构建失败时，日志能定位到具体阶段（依赖、编译、签名、上传）
- [ ] 重复触发同一版本时不会静默覆盖已有 Release

## Comments

2026-11-17：`.github/workflows/android-apk.yml` 与 `scripts/release-android.sh` 已写好：
手动触发、tag 冲突即失败、运行序号当构建号、artifact + Release 双产物、`--dry-run` 只出 artifact。
本地已按同样的命令签出可安装的 APK 并验证签名。**还差**：云端跑一次（需要 Secret、提交与推送）。

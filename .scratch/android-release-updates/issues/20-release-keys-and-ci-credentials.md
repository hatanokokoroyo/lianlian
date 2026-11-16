GitHub: #20
Status: ready-for-human
Type: task

# 20: 发布密钥与 CI 凭据准备

**What to build:** 让云端构建具备签出一个可安装、可覆盖升级的正式包的资格。这是一次性的、不可逆的准备工作：
签名身份一旦发出去就不能再换。

**Blocked by:** 无（可以立刻开始）

**Status:** ready-for-human

- [x] 生成正式签名 keystore，别名与密码确定并记录下来
- [x] 生成更新清单的 Ed25519 密钥对，私钥留在本机、公钥写进应用配置
- [x] keystore 与更新私钥以 base64 形式存进仓库 Secret，密码单独存一个 Secret
- [ ] keystore 有仓库之外的离线备份，恢复方式写在一处人和 agent 都能找到的地方
- [x] 用刚配好的凭据在本地签出一个包，确认能安装、能覆盖安装同一签名的旧包

## Comments

2026-11-17：keystore 与更新密钥已生成在 `~/.lianlian-keys/`（keystore 别名 `lianlian`，密码在同目录
`keystore-password.txt`，权限 600），并已用它对本地包签名成功。**还差**：离线备份，以及把三者写进仓库
Secret（`gh` 在这台机器上没有登录，任何 API 调用都做不了）。

2026-11-17（同日补）：`gh` 已登录，三个 Secret 都配好了——`ANDROID_KEYSTORE_B64`（PKCS12 的 base64）、
`ANDROID_KEYSTORE_PASSWORD`、`NSH_UPDATE_KEY`（Ed25519 私钥的 base64）。云端已用它们签出 `v0.2.0`，
并在模拟器上覆盖安装了同签名的 0.1.0；证书 SHA-256 `3ee180714bc0891f6fbb83270b20ab9f8394b839da6d4699b5a9d2fdffd8c913`。
**仍差**：keystore 与更新私钥在仓库之外的离线备份（U 盘 / 密码管理器）。这一步只能由人做，agent 不代劳。

GitHub: #22
Status: ready-for-agent
Type: task
Blocked by: 20, 21

# 22: 更新清单与更新来源配置

**What to build:** 每次发版时，Release 上除了 APK 还有一份签名过的更新清单，说明这次是哪个版本、改了什么、
安卓用户该去哪里下载。应用配置指向本仓库的 Release 并信任清单的签名，所以打包后的应用能判断「有 0.2.0」，
而不需要自己解析仓库页面。

**Blocked by:** 20、21

**Status:** ready-for-agent

- [ ] Release 资产里同时有 APK、`latest.json` 和清单签名文件
- [ ] 清单里的版本号与 tag、APK 的版本号三者一致
- [ ] 清单里的应用 id 是本应用的 id
- [ ] 清单里的下载链接指向本次 Release 的 APK，且是 HTTPS 直链
- [ ] 应用配置声明了更新来源与清单公钥
- [ ] 清单签名能被公钥验证通过；改动任一字节能被拒绝
- [ ] 清单里带有本次的更新说明，供界面展示

## Comments

2026-11-17：实测 `nsh update-manifest` 不接受 `.apk`，正确写法是不传归档、只传 `--link android=<APK 直链>`；
产出的清单就是 `id / version / notes / platforms.android.url`，签名文件是 `latest.json.sig`。
用本机回环地址把清单和签名喂给打包好的应用，应用确实请求了两份文件并接受了签名。
**还差**：真实的 GitHub Release 上跑一次。

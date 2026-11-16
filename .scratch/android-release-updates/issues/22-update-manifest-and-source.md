GitHub: #22
Status: resolved
Type: task
Blocked by: 20, 21

# 22: 更新清单与更新来源配置

**What to build:** 每次发版时，Release 上除了 APK 还有一份签名过的更新清单，说明这次是哪个版本、改了什么、
安卓用户该去哪里下载。应用配置指向本仓库的 Release 并信任清单的签名，所以打包后的应用能判断「有 0.2.0」，
而不需要自己解析仓库页面。

**Blocked by:** 20、21

**Status:** resolved

- [x] Release 资产里同时有 APK、`latest.json` 和清单签名文件
- [x] 清单里的版本号与 tag、APK 的版本号三者一致
- [x] 清单里的应用 id 是本应用的 id
- [x] 清单里的下载链接指向本次 Release 的 APK，且是 HTTPS 直链
- [x] 应用配置声明了更新来源与清单公钥
- [x] 清单签名能被公钥验证通过；改动任一字节能被拒绝
- [x] 清单里带有本次的更新说明，供界面展示

## Comments

2026-11-17：实测 `nsh update-manifest` 不接受 `.apk`，正确写法是不传归档、只传 `--link android=<APK 直链>`；
产出的清单就是 `id / version / notes / platforms.android.url`，签名文件是 `latest.json.sig`。
用本机回环地址把清单和签名喂给打包好的应用，应用确实请求了两份文件并接受了签名。
**还差**：真实的 GitHub Release 上跑一次。

2026-11-17 交付记录：真实 Release `v0.2.0` 的清单是

```json
{"id":"com.lianlian.app","version":"0.2.0","notes":"第一个可自动更新的版本\n",
 "platforms":{"android":{"url":"https://github.com/hatanokokoroyo/lianlian/releases/download/v0.2.0/lianlian-0.2.0-android.apk"}}}
```

tag、清单版本、APK 的 `versionName` 三者都是 0.2.0；链接是 HTTPS 直链。签名用 `nsh.json` 里的公钥单独验过：
签名不是直接盖在文件字节上，而是盖在 `"nsh-updater-manifest\0" + 清单` 上（`nsh-updater` 里的
`CONTEXT` 前缀，用来防止同一把钥匙签的别的东西挪过来复用）。照这个前缀验，原始清单通过；把 `0.2.0`
改成 `0.9.0` 后拒绝。应用侧（正式签名 0.1.0）启动后确实读到了这份清单。

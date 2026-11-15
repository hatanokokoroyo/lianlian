# design/ — 原型与视觉契约（OpenDesign 工作区）

这个目录是 **OpenDesign 项目的根**（以"导入文件夹"方式导入，OD 原地读写，不拷贝）。
它同时是 git 里的普通目录：**版本真源是 git，不是 OD**。

## 约定

- 一屏一个文件：`screens/<screen-name>.html`；`index.html` 只做导航/总览。
- 样式只用 Tailwind 4 工具类，颜色只用 shadcn token 名（`bg-background`、`text-muted-foreground`、`bg-primary`、`border-border`、`rounded-(--radius)`…），对应 `nsh.json` 的 `"theme"`。
- 每个可交互元素写 `data-testid`（kebab-case 语义命名，如 `login-submit`）——它是将来 NSH `testID` 的对位物。
- 视口只做 360×800 / 390×844 / 430×932 三档，不允许横向滚动。
- 不要提交 OD 的 `.file-versions/`（已 gitignore）。

## 谁在写

- agent 经 MCP `mcp__opendesign__write_file` 写屏，`get_project` 取 `previewUrl` 给人在浏览器看。
- 人在 <http://localhost:7456/projects/> 里看/批注；agent 按批注改同一文件，每轮一个 commit。

## 别把这里当实现起点

定稿后只取两样东西进实现：**定型屏的 HTML（视觉基准）** + **`contract.md`（视觉契约：token 表 / 屏清单 / 组件映射 / 状态矩阵 / testID）**。
OD 自带的 `DESIGN-HANDOFF.md` / `DESIGN-MANIFEST.json` 是 web 中心的，不覆盖 NSH 的约束，按需参考、不要照抄。

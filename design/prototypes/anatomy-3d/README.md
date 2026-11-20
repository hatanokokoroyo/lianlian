# 3D 解剖 viewer（throwaway spike）

独立可用的移动优先 3D 解剖原型，用来验证 Z-Anatomy 两档 GLB 的加载、
`BatchedMesh` 合批、拾取、左右分色、层级预设与隔离。**不修改 App**，也没有
接入档案页。

模型：79 块肌肉 + 31 个有网格的骨骼部位，311 个节点；映射表 119 个 site，
其中 110 个在 GLB 里有几何（9 个骨性定位点只有坐标，不在这两个 GLB 里）。
版权与署名见文末。

## 运行

从仓库根目录起 HTTP 服务（不要用 `file://`，Draco worker 与 GLB 都需要 HTTP）：

```sh
cd /path/to/lianlian
python3 -m http.server 8765 --bind 127.0.0.1
```

打开：

```text
http://127.0.0.1:8765/design/prototypes/anatomy-3d/
```

默认加载视觉档（`raw`）。桌面上 viewer 居中，宽度上限 760 px；手机为全屏。

## App 内 spike（Android）

viewer 已经通过 NSH WebView 接进 App，入口在「档案」页右上角：

```sh
nsh run --target android
# 档案 → 3D 解剖 spike
```

- Rust 侧 `src/anatomy3d.rs` 用 `127.0.0.1:0` 起 loopback HTTP 服务，把 viewer、
  Three.js、Draco、映射表与两档 GLB 用 `include_bytes!` 编进二进制。
- TSX 侧 `screens/anatomy3d.tsx` 全屏 WebView；进入时收起底部 Tab，返回走
  `nav.pop()`。
- `nsh.json` 的 `android.usesCleartextTraffic: true` 只为访问 127.0.0.1 的
  loopback 服务；0.4.0 spike 暂时保留，生产前应换成仅放行 127.0.0.1 的
  network security config，或 HTTPS/自定义 scheme。
- 模拟器实测（Android 15 / WebView 124 / SwiftShader）：
  - `cap3000`：加载约 803 ms，743,912 面，3 draw calls，`WEBGL_multi_draw` 有；
  - 深层预设：2 draw calls，507,356 渲染面；隔离多裂肌：1 draw call、14,420 面、6 个可见对象；
  - 自转：全身约 2 fps、深层约 3 fps。SwiftShader 是软件渲染，这个数字不代表真机；
  - 新 WebView renderer 的 PSS 约 107 MB，整体增量约 100 MB（debug 构建）。
- 真机帧率、发热与内存仍需在目标 Android 设备上复测；模拟器不能替代。

## 截图

- `screenshots/back-all.png`：背视全身，左右分色
- `screenshots/back-glute-selected.png`：点选臀大肌（双侧高亮）
- `screenshots/front-deep-tva.png`：深层预设 + 腹横肌高亮，浅层淡出
- `screenshots/back-deep-multifidus.png`：深层预设 + 多裂肌高亮
- `screenshots/front-spin.png`：自转模式与 avg/min fps
- `screenshots/app-front.png`：App 内 WebView，正视角
- `screenshots/app-back-glute.png`：App 内点选臀大肌
- `screenshots/app-deep-tva.png`：App 内深层 + 腹横肌
- `screenshots/app-isolate-multifidus.png`：App 内隔离多裂肌（1 draw call）

## 交互

- 拖动旋转，滚轮/双指缩放；极角限制在约 22°–158°，防止钻到头顶/脚底。
- 四视角：正（+Z）、背（−Z）、左（+X）、右（−X）。
- 左 `#6ee7f0`、右 `#f0a26e`、中线 `#aab2bd`；选中 site 统一高亮 `#c8f04a`。
- 点击肌肉/骨骼按 site 选中，显示中文名、英文名、kind、左右、当前档位三角面与对象数；
  点空白取消。
- 层级：全身 / 浅层 / 深层 / 骨骼。深层保留深层肌肉、隐藏骨骼，浅层以 0.06
  透明度作为轮廓；浅层与骨骼预设各自只保留对应批次。
- “只看这块”隔离当前 site，并把相机聚焦到该 site 的包围盒；多对象 site
  （如多裂肌 6 个对象）全部保留。
- 快捷目标：臀大肌（背视/全身）、腹横肌（前视/深层）、多裂肌（背视/深层）。
- 顶部“自转”开关：开启后模型绕身体中轴持续旋转并每帧渲染，用于性能观察；
  关闭后恢复按需渲染。自转时统计显示滚动窗口的 `平均/最低 fps`。
- 直接关闭自转会保留当前模型角度；但任何显式视角、层级、选中或快捷目标操作
  都会先停止自转、把模型 yaw 归零，再应用新状态。

渲染是需求驱动：交互/状态变化时渲染，静止后停止 `requestAnimationFrame`，
所以不自转时统计固定显示 `— fps`；开启自转后显示如 `60/60 fps`。
自转约 0.45 rad/s（约 14 秒一圈）。

## URL 参数

| 参数 | 值 | 默认 | 说明 |
|---|---|---|---|
| `tier` | `raw` / `cap3000` | `raw` | 视觉档 / 性能档 |
| `view` | `front` / `back` / `left` / `right` | `front` | 初始视角 |
| `preset` | `all` / `shallow` / `deep` / `bone` | `all` | 层级预设 |
| `site` | `site_id` | 无 | 初始选中 site，如 `multifidus` |
| `isolate` | `1` | 关 | 配合 `site` 使用；只看该 site |
| `spin` | `1` | 关 | 启动自转/性能模式，持续渲染 |
| `ui` | `0` / `1` | `1` | `0` 隐藏全部 UI，便于截图 |

示例：

```text
?tier=cap3000&view=back
?tier=cap3000&view=back&spin=1
?tier=cap3000&view=back&preset=deep&site=multifidus&isolate=1&ui=0
```

`site_id` 与对象映射来自运行时 `fetch` 的 `/scripts/anatomy/za-export.json`。
页面从仓库根启动，因此绝对路径可直接命中；另有相对路径 fallback。

## 自动化契约

```js
window.__viewer = {
  ready,                 // boolean
  error,                 // string | null
  stats,                 // 见下
  setView(v),            // front|back|left|right
  setPreset(p),          // all|shallow|deep|bone
  selectSite(id),        // site_id | null
  setIsolate(b),         // boolean
  setSpin(b),            // boolean；开启自转/性能模式
  setTier(t),            // raw|cap3000，返回 Promise<boolean>
  reset(),               // 回 raw/front/all，清选择并关闭自转
};
```

Ready 后写 `document.body.dataset.viewerReady = '1'`；失败写
`document.body.dataset.viewerError`。加载/渲染不依赖用户手势，截图模式可直接跑。

`stats` 字段：

```text
tier, triangles, renderedTriangles, drawCalls, fps, fpsAvg, fpsMin, spin, spinYaw, loadMs, multiDraw,
instances, sites, selectedSite, selectedObjectCount, highlightColor,
visibleInstances
```

- `spin`：自转模式是否开启
- `fps` / `fpsAvg`：最近约 2 秒滚动窗口的平均帧率
- `fpsMin`：同一窗口内的最低瞬时帧率
- `spinYaw`：模型当前自转 yaw（弧度）。显式视角/层级/选中/快捷操作后归零
- `selectedSite`：当前 site id 或 `null`
- `selectedObjectCount`：该 site 在当前档位下的对象数
- `highlightColor`：选中时为 `#c8f04a`，未选中为 `null`
- `visibleInstances`：当前实际可见 instance 数

## 验证

无额外 npm 依赖，Node 22+（内置 `fetch`/`WebSocket`）：

```sh
node design/prototypes/anatomy-3d/verify.mjs
```

脚本会：

1. 若 8765 没有服务，自动从仓库根起 `python3 -m http.server`；
2. 用 Edge/Chrome headless 打开 `?tier=cap3000&view=back`；
3. 等 `__viewer.ready`，检查三角面、draw calls（≤ 5）、`WEBGL_multi_draw`；
4. 切深层、选中腹横肌/多裂肌、隔离、真实鼠标点击拾取；
5. 检查 390×844 与 430×932 顶栏/统计/底部控制条无横向溢出；
6. 往返 `raw` / `cap3000`，自转 2 秒检查 `fps>0`、avg/min 有值、draw calls
   不退化，关闭后恢复 `— fps`；
7. 自转约 1 秒后关闭并 `setView('back')`，断言 `spinYaw≈0`、背面按钮生效，
   截图到 `/tmp/anatomy-3d-back-after-spin.png`；
8. 验证 `ui=0&site=multifidus&isolate=1&spin=1` URL 契约；
9. 检查 console 无 error，并输出截图（默认 `/tmp/anatomy-3d-verify.png`）。

自定义浏览器或地址：

```sh
EDGE_BIN="/path/to/edge" VIEWER_URL="http://127.0.0.1:8765/design/prototypes/anatomy-3d/" \
  node design/prototypes/anatomy-3d/verify.mjs
```

单独截图时也要等异步加载，不要只靠 `--virtual-time-budget`（Draco worker 不是
虚拟时钟驱动；抢跑会截到加载态）。`verify.mjs` 已内部等待 ready。

## 实测（2026-11-20，macOS，Edge headless，390×844）

| 档位 | 三角面 | 合批 draw calls | 首屏加载 |
|---|---:|---:|---:|
| `raw` | 1,525,071 | 3 | 约 520 ms |
| `cap3000` | 743,912 | 3 | 约 494 ms |

- 深层预设：2 draw calls（深层 + 浅层 ghost）
- 隔离单 site：1 draw call
- `WEBGL_multi_draw`：有
- console：无 error / warning
- 自动化结果：`RESULT PASS`

自转（Edge headless，390×844，持续 3 秒）：

| 档位 | avg/min fps | draw calls |
|---|---:|---:|
| `raw` | 60/60 | 3 |
| `cap3000` | 60/60 | 3 |

headless 的 `requestAnimationFrame` 被 60 Hz 上限截住，所以两档都显示 60/60；
这只能证明连续渲染链路、统计和 draw call 正常，不能说明真机上限。

档位切换后 Draco/浏览器缓存命中时，重载约 90–120 ms。以上是桌面 headless
数据，不能替代 Android 真机；真机仍需测连续旋转 30 秒、内存与发热。

## 已知问题

- 仓库文档/handoff 写 raw 档为 1,502,535 面，但 GLB 节点引用的 accessor 实际
  合计 **1,525,071** 面；`cap3000` 的 743,912 与文档一致。本 viewer 与
  verify 脚本使用实测值。
- 只有两档资产（raw / cap3000）；2,000 面低端档未入库，所以没有第三档可切。
- GLB 没有材质、UV、法线贴图或 site 顶点属性；颜色、光照与映射都在运行时生成。
- 9 个骨性定位点不在 GLB 内，本原型不画定位点。
- `GLTFLoader` 会清洗节点名（空格/点号），映射通过 `gltf.parser.associations`
  取原始 glTF 节点名，不能直接用 `object.name`。
- 左右镜像节点带负缩放；几何烘焙世界矩阵后需反转三角形绕序，否则背面剔除会缺面。
- `BatchedMesh` 依赖 `WEBGL_multi_draw`。缺失时会退化为逐几何 draw，统计会
  显示红色警告；当前 Edge headless 可用，目标 WebView 仍需确认。
- 自转绕全身中轴旋转；同时隔离外周 site 时，该 site 仍绕身体中轴转。
- headless 下两档自转都是 60/60 fps，无法据此判断设备性能上限。
- 真实点击验证使用 390×844 下的固定点 `(188, 330)`；改布局后需同步调整。
- 未做自然手势教学、无动画过渡、无持久化；这是 spike。

## 本地 vendor

`three@0.180.0` 由 `npm pack` 解包复制，不走 CDN：

```text
vendor/three/three.module.js
vendor/three/three.core.js              # three.module.js 的相对依赖
vendor/three/addons/controls/OrbitControls.js
vendor/three/addons/loaders/GLTFLoader.js
vendor/three/addons/loaders/DRACOLoader.js
vendor/three/addons/utils/BufferGeometryUtils.js
vendor/draco/draco_decoder.js
vendor/draco/draco_decoder.wasm
vendor/draco/draco_wasm_wrapper.js
```

`DRACOLoader.decoderPath` 指向 `./vendor/draco/`。以上 9 个文件已与 npm 包逐字节
`cmp` 校验。Import map：

```json
{
  "imports": {
    "three": "./vendor/three/three.module.js",
    "three/addons/": "./vendor/three/addons/"
  }
}
```

## 文件

```text
index.html   页面、import map、中文 UI
style.css    深色移动端布局，沿用 pulse.css 色板
viewer.js    加载、合批、拾取、视角、预设、隔离、统计
verify.mjs   Edge/Chrome CDP 自动化契约检查
vendor/      three r180 + Draco 本地依赖
```

## 许可与署名

模型衍生自 [Z-Anatomy](https://www.z-anatomy.com/)（CC BY-SA 4.0），其模型
衍生自 BodyParts3D（Database Center for Life Science，CC-BY-SA 2.1 Japan）。
`docs/research/assets/` 下的 GLB 是筛选、简化、平滑后的修改版本，同样按
**CC BY-SA 4.0** 分发。Three.js 为 MIT；Draco 解码器为 Apache-2.0。

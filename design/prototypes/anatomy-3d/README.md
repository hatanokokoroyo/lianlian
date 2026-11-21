# 3D 身体图 viewer（页面骨架）

移动优先的 3D 身体图 viewer，用来验证 Z-Anatomy 三档 GLB 的加载、
`BatchedMesh` 合批、拾取、左右分色、层级预设与隔离。它已经接进 App 的档案栈；
当前页面骨架保留返回、重置、视角四段、层级菜单、首次提示、加载/失败态与
档案异常高亮；详情卡与异常列表尚未进入这一票的页面骨架。

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

默认加载视觉档（`raw`）。模型就绪后连续采样约 2 秒真实帧率：低于 24 fps
自动切到 `cap3000`，仍低于 20 fps 再切到 `cap2000`；`cap2000` 仍低于 20 fps
时向原生报告设备较慢。切档保留相机、选中、层级、视角与 `saved` 快照，且只显示
一次「已切到流畅档」提示。桌面上 viewer 居中，宽度上限 760 px；手机为全屏。

## App 内页面（Android）

viewer 已经通过 NSH WebView 接进 App，入口在「档案」页右上角：

```sh
nsh run --target android
# 档案 → 3D 身体图
```

- Rust 侧 `src/anatomy3d.rs` 用 `127.0.0.1:0` 起 loopback HTTP 服务，把 viewer、
  Three.js、Draco、映射表与三档 GLB 用 `include_bytes!` 编进二进制。
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
- 正常肌肉保留左青 / 右橙（默认 `#6ee7f0` / `#f0a26e`）；异常部位用
  `destructive`，选中用 `primary`。App 内这三个颜色与左右底色都由原生侧从主题
  token 传入；独立浏览器没有原生宿主时用 `viewer-state.js` 里的默认 palette。
- 高亮粒度是「部位 + 侧别」：`side: null` 表示该部位左右两侧都算异常。
  只给肌肉染色，骨骼即使出现在异常集合里也忽略。
- 视角按钮反映相机真实方向：自由旋转停止后，高亮最接近的正/背/左/右；
  旋转本身不触发取景。
- 层级：全身 / 浅层 / 深层 / 骨骼。深层保留深层肌肉、隐藏骨骼，浅层以 0.06
  透明度作为轮廓；浅层与骨骼预设各自只保留对应批次。
- 层级菜单从「层级：<当前> ▾」打开，点外部或 Escape 关闭；当前项有选中态。
- 首次进入显示「拖动旋转 · 双指缩放 · 点肌肉看详情」，第一次成功拖动/缩放/点选后
  淡出，并在 `localStorage` 记住，之后不再出现。
- 点选、切层级、开关浮层都不改变相机；只有首屏加载、重置和「只看这块」取景。
  隔离按钮在进入后变为「显示全部」，退出时原样恢复相机、层级、选中与侧别。
  隔离中层级控件禁用（视角仍可切），关闭详情卡也会退出隔离并恢复相机。
- 有异常时，第二行右侧出现「需注意 N 处 ›」。打开后按肌群分组列出部位、侧别与最差
  一条；缺网格的部位标「模型里暂缺」，仍可打开详情卡，但不提供「只看这块」。
  列表是绝对定位浮层，开关不影响画布尺寸与相机。
- 档位切换、自转与统计面板已从产品 UI 移除；对应能力保留在 `window.__viewer`
  里，供自动化契约检查使用。

渲染是需求驱动：交互/状态变化时渲染，静止后停止 `requestAnimationFrame`。
自转约 0.45 rad/s（约 14 秒一圈）。

## URL 参数

| 参数 | 值 | 默认 | 说明 |
|---|---|---|---|
| `tier` | `raw` / `cap3000` / `cap2000` | `raw` | 视觉档 / 性能档 / 流畅档 |
| `view` | `front` / `back` / `left` / `right` | `front` | 初始视角 |
| `preset` | `all` / `shallow` / `deep` / `bone` | `all` | 层级预设 |
| `site` | `site_id` | 无 | 初始选中 site，如 `multifidus` |
| `isolate` | `1` | 关 | 配合 `site` 使用；进入只看该 site，按钮可退出并恢复 |
| `focus` | `attention` | 无 | 首次 `setHighlight` 有异常行后自动打开异常列表 |
| `spin` | `1` | 关 | 启动自转/性能模式，持续渲染 |
| `ui` | `0` / `1` | `1` | `0` 隐藏全部 UI，便于截图 |
| `autoTier` | `0` / `1` | `1` | `0` 关闭自动帧率采样与降档 |
| `tierTest` | `1` | 关 | 测试模式：不跑真实采样，暴露 `testTierFps(fps)` |

示例：

```text
?view=back
?tier=cap3000&view=back&autoTier=0
?tier=cap2000&view=back&autoTier=0
?view=back&preset=deep&site=multifidus&isolate=1&ui=0
```

`site_id` 与对象映射来自运行时 `fetch` 的 `/scripts/anatomy/za-export.json`。
页面从仓库根启动，因此绝对路径可直接命中；另有相对路径 fallback。

## 自动化契约

```js
window.__viewer = {
  ready,                 // boolean
  error,                 // string | null
  stats,                 // 见下
  setHighlight({ palette, sites }), // 主题色 + 异常部位；不重新加载模型
  setView(v),            // front|back|left|right
  setPreset(p),          // all|shallow|deep|bone
  selectSite(id),        // site_id | null
  setIsolate(b),         // boolean
  openAttention(),       // 打开「需注意 N 处」列表；无异常时返回 false
  setSpin(b),            // boolean；开启自转/性能模式
  setTier(t),            // raw|cap3000|cap2000，返回 Promise<boolean>
  reset(),               // 回 front/all，清选择与隔离；保留当前设备档位
};
```

`?tierTest=1` 时额外暴露 `testTierFps(fps)`：把给定的平均帧率直接送进与真实
采样相同的纯函数决策与切档路径，用于无头校验。生产页面不显示任何测试控件。

`setHighlight` 的 `sites` 是 `{ siteId, side }` 数组，`side` 为 `left` /
`right` / `null`。`palette` 可只给 `left`、`right`、`abnormal`、`selected`，
其余键沿用默认；缺网格的部位会出现在 `stats.missingSites` 里，不会静默消失。
换档或重载模型后会沿用同一份高亮集合重新套色。

Ready 后写 `document.body.dataset.viewerReady = '1'`；失败写
`document.body.dataset.viewerError`。加载/渲染不依赖用户手势，截图模式可直接跑。

`stats` 字段：

```text
tier, triangles, renderedTriangles, drawCalls, fps, fpsAvg, fpsMin, spin, spinYaw, loadMs, multiDraw,
instances, sites, selectedSite, selectedObjectCount, highlightColor,
highlightSites, highlightedSiteIds, abnormalObjectCount, missingSites, palette,
visibleInstances, view, preset, cameraDistance, cameraTarget,
attentionOpen, attentionCount, attentionGroups, attentionMissing,
autoTierSampledFps, autoTierDecision, tierNoticeCount, slowDevice
```

- `spin`：自转模式是否开启
- `fps` / `fpsAvg`：最近约 2 秒滚动窗口的平均帧率
- `fpsMin`：同一窗口内的最低瞬时帧率
- `spinYaw`：模型当前自转 yaw（弧度）。显式视角/层级/选中/快捷操作后归零
- `selectedSite`：当前 site id 或 `null`
- `selectedObjectCount`：该 site 在当前档位下的对象数
- `highlightColor`：选中时为当前 palette 的 `selected`，未选中为 `null`
- `highlightSites`：最近一次 `setHighlight` 收到的部位 + 侧别
- `highlightedSiteIds`：实际匹配到肌肉网格的异常 site（骨性忽略）
- `abnormalObjectCount`：当前真正染成异常色的对象数（被选中覆盖的不算）
- `missingSites`：异常集合里没有网格的 site id
- `palette`：当前生效的 palette
- `visibleInstances`：当前实际可见 instance 数
- `view` / `preset`：当前视角与层级；自由旋转后 `view` 会更新为最接近的方向
- `cameraDistance` / `cameraTarget`：相机到目标点的距离与目标点，用于断言取景契约
- `attentionOpen` / `attentionCount`：异常列表是否打开、行数（含缺网格行）
- `attentionGroups` / `attentionMissing`：异常列表的分组数与缺网格行数
- `autoTierSampledFps` / `autoTierDecision`：最近一次采样均值与纯函数给出的决定
- `tierNoticeCount`：本次页面生命周期内「已切到流畅档」提示出现次数（最多 1）
- `slowDevice`：`cap2000` 仍低于 20 fps 时是否已向原生报告

## 验证

无额外 npm 依赖，Node 22+（内置 `fetch`/`WebSocket`）：

```sh
node design/prototypes/anatomy-3d/verify.mjs
```

脚本会：

1. 若 8765 没有服务，自动从仓库根起 `python3 -m http.server`；
2. 用 Edge/Chrome headless 打开默认档 `?view=back&autoTier=0`；
3. 等 `__viewer.ready`，检查三角面、draw calls（≤ 5）、`WEBGL_multi_draw`；
4. 检查产品控件：四视角、层级菜单开关/外部点击/Escape/选中态、首次提示、无档位/自转/统计；
5. 检查 390×844 与 430×932 底部控件与提示无横向溢出；
6. 自由旋转后断言视角高亮跟随相机方向，且相机距离/目标不变；
7. 切深层、选中腹横肌/多裂肌、隔离并恢复，断言选择与切层不改相机；
8. 真实鼠标点击拾取；
9. 往返 `raw` / `cap3000`，自转 2 秒检查 `fps>0`、avg/min 有值、draw calls 不退化；
   另用 `?tierTest=1&autoTier=0` 确定性检查 raw→cap3000→cap2000→slow、
   切档不改变相机/选中/层级/视角、提示只出现一次、慢设备消息与后续可操作性；
10. 自转约 1 秒后关闭并 `setView('back')`，断言 `spinYaw≈0`、背面按钮生效，
   截图到 `/tmp/anatomy-3d-back-after-spin.png`；
11. 验证 `ui=0&site=multifidus&isolate=1&spin=1` URL 契约；
12. 重载后断言首次提示不再出现；检查 console 无 error，并输出截图
    （默认 `/tmp/anatomy-3d-product.png` 与 `/tmp/anatomy-3d-verify.png`）。

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
| `cap2000` | 541,822 | 未单独测 | 未单独测 |

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
- `cap2000` 由现有 `cap3000` 再简化得到，不是从 Z-Anatomy `Startup.blend`
  直接导出的官方 2,000 档逐字节复刻；生成脚本与限制见
  `scripts/anatomy/README.md` 与 `docs/research/assets/README.md`。
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

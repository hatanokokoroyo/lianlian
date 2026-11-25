# Handoff：3D 身体图视觉刷新（2026-11-25）

## 这次会话要交接什么

- 在 Android 模拟器里用 8 条真实链路的档案条目复现了「3D 身体图首屏全白」。
- 根因是主题 token 的 8 位 hex 被 `THREE.Color` 解析成白色；不是数据、不是性能问题。
- 产出了自包含原型 `design/prototypes/anatomy-3d-refresh.html`：4 个可点状态、现在/建议对比滑杆、取证截图、P0/P1/P2 清单。
- 本文档是**执行清单**。新会话直接按 P0 → P1 做，不需要重新调研。
- 这轮**没有改产品代码**；模拟器档案已恢复为空，没留演示数据。

## 先读这三份

1. `design/prototypes/anatomy-3d-refresh.html`：视觉与交互决策的权威原型。
2. `docs/anatomy-3d-direction.md`：3D 方向、性能预算与验收线。
3. `design/prototypes/anatomy-3d/README.md`：viewer 契约、URL 参数、`__viewer` API。

补充：`.local/emulator.md`（本机 AVD、adb 路径、已验证项与坑，不入库）。

## 已经确定的结论（不要再争）

- 数据链路是对的：8 条判定 → 7 个肌群 → 12 个异常对象；`__viewer.stats` 里 `highlightSites`、`highlightedSiteIds`、`abnormalObjectCount` 都正确。
- 根因：`token("chart-1")` 实际传入 `#6ee7f0ff`；`new THREE.Color("#ff6b6bff").getHexString()` 返回 `"ffffff"`。`BatchedMesh` 的 instanceColor 全是 `(1,1,1)`。
- 例外：`palette.mid` 是 6 位 `#aab2bd`，所以只有中线骨骼被染成浅灰，肌肉全是白——这正好解释了截图里的「白模型 + 灰骨头」。
- 换成 6 位 hex 后，12 个异常对象全部着色；正面可见 2 处（斜方肌、股直肌），背面 5 处（斜方肌、冈下肌、臀中肌、臀大肌、比目鱼肌）；腹横肌/多裂肌是深层，`all` 预设下不可见。
- 视觉方向：暖象牙/浅沙/珊瑚；去掉左右对半分色；编号 + 图例；卡片避让；深层提示。
- 不做：重导 GLB、换数据源、加后处理/bloom、改 `src/anatomy/` 词表、把左右颜色写进品牌 token。
- 性能红线：`BatchedMesh` 3 draw calls、DPR ≤ 1.5、无后处理；Standard + ACES 是质量目标，掉帧回退 Lambert。

## 决策记录（已拍）

| # | 决策 | 理由 |
|---|---|---|
| D1 | 颜色归一化放在 viewer 的 `toColor()` / 纯函数 `normalizeColor()`，不改主题 token | 一个接缝覆盖所有入口；token 仍可给其他 UI 带 alpha |
| D2 | 正常肌肉统一暖象牙，左右只用文字芯片 | 半身青/橙是「玩具感」的主要来源；侧别不是主数据 |
| D3 | sheet 最大 38% 屏高；打开时相机上移/缩小 | 选中部位必须在卡片上方可见 |
| D4 | 深层异常在「全身」里用「深层 N」提示，点击自动切深层 | 不让用户找不存在的红点 |
| D5 | 先修颜色/避让/提示，再谈材质 | P0 是数据可见性，不是审美 |
| D6 | 慢设备提示改为一次性 toast + 顶栏状态点 | 常驻条吃模型空间，且「回档案」重复 |

## 实施顺序

### P0-1 颜色归一化（先做，最小 diff）

Files:

- `design/prototypes/anatomy-3d/viewer.js`：`toColor()`（约 280 行）
- `design/prototypes/anatomy-3d/viewer-state.js`：新增纯函数 `normalizeColor()`（放在 `DEFAULT_PALETTE` 附近）
- `design/prototypes/anatomy-3d/viewer-state.test.mjs`：新增测试
- `screens/anatomy3d.tsx`：`palette()` 不改也可以；如果要在 native 侧兜底，可把 `token()` 结果裁成 6 位，但**只做一处**，不要两边各写一套。

Steps:

1. `normalizeColor(value)` 接受 `#rgb` / `#rrggbb` / `#rrggbbaa`（大小写均可），返回 `#rrggbb`；非法返回 `null`。
2. `toColor()` 先 normalize，再 `new THREE.Color(...)`；非法值回退 `DEFAULT_PALETTE.mid` 或调用方给的 fallback，不要静默白。
3. 测试：
   - `normalizeColor('#6ee7f0ff') === '#6ee7f0'`
   - `normalizeColor('#ff6b6bff') === '#ff6b6b'`
   - `normalizeColor('#abc') === '#aabbcc'`
   - `colorForInstance(..., { palette: { abnormal: '#ff6b6bff' } })` 返回 `#ff6b6b` 或等价。
4. 验收：首屏 `abnormalObjectCount === 12` 且 12 个 instanceColor 不再是 `(1,1,1)`；正面截图见 2 处红、背面 5 处红。

Why not just trim in `screens/anatomy3d.tsx`? 因为 viewer 也可能从 URL、默认 palette 或测试直接拿到 8 位；`toColor` 是唯一着色入口。native 侧裁一次可以作为 belt-and-suspenders，但测试仍要锁 viewer。

### P0-2 卡片避让 + side=null

Files:

- `design/prototypes/anatomy-3d/viewer.js`：`updateProjectionLayout()`（约 590 行）、`renderSheet()`（约 911 行）、`openSheet()` / `closeSheet()`、`selectSite()`（约 1877 行）
- `design/prototypes/anatomy-3d/viewer-state.js`：`resolveCard()`（约 255 行）
- `design/prototypes/anatomy-3d/index.html` / `style.css`：`#detail-sheet`、`#attention-sheet` 高度与 side 控件

Steps:

1. 给 viewer 增加内部 `setSheetInset(px)`（或 `setSheetOpen(bool)`）：sheet 打开时，把 `bottomInset` 设为 sheet 实际高度 + 8，重新 `updateProjectionLayout()`，并把相机 offset 调整到选中部位仍在可视区上方。
   - 注意 `updateProjectionLayout` 现在用 `bottomStackEl.getBoundingClientRect().top`；`ui=0` 时该元素隐藏会让 `bottomInset` 变成 60% 屏高（另一个小 bug，顺手修：不可见时按 0 处理）。
2. `sheet` CSS 高度上限 38%；详情卡按内容自适应，不要固定 39%/55%；清单可以 55–58%，但模型要缩到卡片上方。
3. `resolveCard()` 在 `side === null` 时：
   - 若该 site 只有一侧有 card，返回那张 card，并标记 `needsSideChoice` / `availableSides`；
   - 若两侧都有，返回 `null` + `availableSides: ['left', 'right']`，让 UI 显示左右选择器；
   - 不要再用「这一侧还没有判定」这种把选择问题说成缺失的文案。
4. 验收：从清单点「臀中肌 · 左」进入详情，臀部完整出现在卡片上方 ≥ 25% 画布高度；`side=null` 时显示「左 / 右」选择，不出现矛盾文案；关闭 sheet 恢复原取景。

### P0-3 慢设备提示

Files:

- `screens/anatomy3d.tsx`：`slowDevice` signal 与 `anatomy3d-slow-device` 整条 bar（约 260 行）
- `design/prototypes/anatomy-3d/index.html`：`#tier-notice`
- `design/prototypes/anatomy-3d/style.css`：`.tier-notice` / `.slow-device`

Steps:

1. 删除整条 48px bar 和重复的「回档案」；保留 header 的 `← 档案`。
2. `anatomy3d:slow-device` 消息到达时显示 2.5s toast（「已切到流畅档」），并设一个 header 小状态点 / `流畅档` chip。
3. 每个页面生命周期最多提示一次；不要挡住模型/底部控件；`prefers-reduced-motion` 下淡出。
4. 验收：正常/清单/详情态都没有常驻条；降档只出现一次；返回/重进仍可用。

### P1-1 配色与材质

Files: `viewer.js`（lights / material / toneMapping）、`viewer-state.js`（`DEFAULT_PALETTE` / `colorForInstance`）、`screens/anatomy3d.tsx`（`palette()` token 映射）、`style.css`（图例 / `--palette-*`）。

Palette:

- base muscle `#cbbeb0`，bone `#b3a798`，mid / midline `#b3a798`
- abnormal `#e15e3f`
- selected `#d8e567`
- 不要 left/right 半身色；侧别用文字 chip。

Lighting / material target:

- hemisphere 1.15；key 1.50；fill 0.42；rim 0.75（冷色，后侧）
- ACESFilmicToneMapping，exposure 1.06
- MeshStandardMaterial roughness 0.72 / metalness 0.02
- 若目标机掉帧：回退 `MeshLambertMaterial`，只保留 palette + 降低 key/hemi，**不要**加后处理或换 GLB。

Acceptance: 正/背面无高光爆白；肌肉纹理可读；3 draw calls 不变；目标机 ≥ 30fps（未验证前只能标记「待测」）。

### P1-2 摘要 / 图例 / 标记

Files: `index.html`（`#ui` 顶部/底部）、`style.css`、`viewer.js`（marker 渲染/点击）。

- 顶部：`8 处需要注意` + `7 个肌群 · 左 5 · 右 3`；`深层 2` chip；`背面 5 ›` 切换。
- 底部：一条图例（需注意/肌肉/骨骼/深层/左·右用文字），不要两行控件。
- 模型上每视角最多 4 个编号；编号与 card 顺序一致；深层用虚线/青色 marker；点击只更新 focus pill，不直接开大 sheet。
- 修复 `ui=0` 布局：UI 隐藏时 `bottomStackEl` rect 为 0，导致 `bottomInset = 60%`、模型被缩小；`offsetParent === null` 时按 0 处理。

Acceptance: 8 处异常两步内可达；不再出现英文 site id；标记不遮挡关键部位；`ui=0` 截图模型占满可用高度。

### P1-3 注意清单

Files: `index.html` `#attention-sheet` / `.attention-list`、`viewer.js` `renderAttention()`、`viewer-state.js` `buildAttention()` / `attentionFocusView()`。

- 按严重度排序（max pain/异常轴），组内保留肌群；组标题只出现一次。
- 行：编号 + 部位中文 + 左/右 chip + 最差一句 + 严重度；深层行加「深层」badge。
- 点行：选中对应 site + side，切到详情 sheet（38%），关闭回清单；不要只关清单。
- 不再显示英文 id、不再重复「部位 + 侧」标题与详情。
- 验收：清单打开时模型关键部位仍可见；点臀中肌行显示左侧；深层行可一键切深层。

### P1-4 详情卡

Files: `index.html` `#detail-sheet`、`viewer.js` `renderSheet()`、`viewer-state.js` `resolveCard()`。

- 标题：`④ 臀中肌` + 侧别选择器（左/右，已选高亮）；不要「双侧」含糊。
- 轴 chip：已测（异常色/正常色）与未测（虚线）分开；显示 `最近 11/24 · 置信度 70`。
- 一句「最差/验证反馈」，一句「同区域还有…」（可点跳到另一张卡）；动作 `只看这块` / `在档案里看依据`。
- `side=null` 时按 P0-2 的 side 选择逻辑，不显示「这一侧还没有判定」。

### P2

- 深层/浅层：ghost 6% → 10%，加 rim，显示「浅层已淡出 122 块 / 深层 73 块」；腹横肌在前侧要有方向提示。
- 模型清理：手指骨条像爪子、面部空眼眶；短期用暗角/裁切弱化，中期换头手网格或默认「躯干优先」取景。不要为此阻塞 P0/P1。
- 1.3× 字号 / 320px 宽 / sheet 换行 / 安全区审计。
- 若引入 Standard 材质：确认真实机 30fps、30 秒发热；没测之前不要写「已达标」。

## 文件地图

| 文件 | 职责 | 本轮动作 |
|---|---|---|
| `design/prototypes/anatomy-3d/viewer.js` | Three 场景、光照、合批、拾取、sheet | 颜色、相机避让、marker、sheet |
| `design/prototypes/anatomy-3d/viewer-state.js` | 纯状态、palette、cards、attention | normalizeColor、resolveCard、排序 |
| `design/prototypes/anatomy-3d/index.html` | viewer DOM/UI | 摘要、图例、sheet 结构 |
| `design/prototypes/anatomy-3d/style.css` | viewer UI | 配色、sheet 高度、toast |
| `screens/anatomy3d.tsx` | NSH WebView 壳、token palette、慢设备消息 | 慢设备 toast、palette 兜底 |
| `screens/anatomy3d-model.ts` | derive sites/cards、scripts | 只读，通常不用改 |
| `design/prototypes/anatomy-3d/viewer-state.test.mjs` | 纯函数测试 | 8 位 hex、resolveCard |
| `design/prototypes/anatomy-3d/verify.mjs` | 无头契约检查 | 可加 8 位 hex/避让断言 |
| `src/anatomy3d.rs` | `include_bytes!` 嵌入 viewer 资源 | 改 viewer 后自动重打包，无需改 Rust |

## 验证

```sh
nsh check
nsh test
node --test design/prototypes/anatomy-3d/viewer-state.test.mjs
node design/prototypes/anatomy-3d/verify.mjs
```

模拟器（`.local/emulator.md`）：

```sh
nsh run --target android
# 档案 → 3D 身体图
```

截图：`adb exec-out screencap -p > /tmp/anatomy.png`。

验收截图清单：

1. 首屏正面：2 处珊瑚红（斜方肌、股直肌），其余暖象牙；无白色 instanceColor。
2. 背面：5 处珊瑚红（斜方肌、冈下肌、臀中肌、臀大肌、比目鱼肌）。
3. 点选臀中肌：臀部完整在 sheet 上方；侧别为左；无「这一侧还没有判定」。
4. 注意清单：按严重度排序；深层 2 处有「深层」badge；点行能定位。
5. 慢设备：只有 toast，无常驻条。
6. `ui=0`：模型占满可用高度（顺手修）。

## 复现数据（可选）

模拟器档案已还原为空。需要复现时，用临时 Rust example 写入 8 条判定（不要提交），再 `adb push` 回：

`./files/nsh/com.lianlian.app/lianlian.redb`

8 条判定：

| site | side | values |
|---|---|---|
| gluteus-medius | left | tension weak, symmetry left-weak, pain 3 |
| gluteus-maximus | right | tension tight, pain 4 |
| multifidus | left | tension weak, stability poor |
| transversus-abdominis | right | tension weak, stability poor |
| trapezius | left | tension tight, pain 5 |
| infraspinatus | right | tension tight, mobility limited |
| soleus | left | tension tight, mobility limited |
| rectus-femoris | left | tension weak, symmetry left-weak |

期望：8 条 → 7 个肌群；12 个异常对象；左 5 / 右 3；深层 2（腹横肌、多裂肌）。

Seed 提示：`Store::open(path)` + `record_with_evidence(FindingDraft, EvidenceDraft)`；app 运行时先 `adb shell am force-stop com.longbridge.nsh.host`，pull/push DB 后再启动。测试里优先用 `ProfileNavigation.test.tsx` 的 `fullTurn()` 网络 mock，不要为测试写第二套造数逻辑。

## 已知坑

- 主题 token 是 8 位 hex，不是 6 位；任何 `THREE.Color` 入口都要过 normalize。
- `ui=0` 时 `#bottom-stack` 隐藏，`updateProjectionLayout` 会用 0 作为 top，导致模型被压到上半屏；本轮原型截图绕过过，修复时别忘。
- `BatchedMesh` 换材质后仍要保持 3 个 batch；不要把 deeper layer 拆成新 draw call。
- 深层异常没有网格在 shallow batch；不要为了「显示红点」造假几何，切深层/提示即可。
- 模拟器是 SwiftShader，fps 不代表真机；不要把 2–3fps 当性能结论。
- 原型 HTML 里的 Edge 绿色「A」是浏览器扩展角标，不是页面元素；截图时忽略。
- 不要动 `src/anatomy/sites.rs` 词表；部位 id 与 `za-export.json` 已对齐。

## 建议调用的 skills

- `nsh`：构建/运行/打包与 WebView 集成。
- `nsh-design-guides`：改 sheet、密度、层级与动效前先读。
- `tdd`：`normalizeColor()` / `resolveCard()` / 排序逻辑先写红→绿。
- `code-review`：P0 合并前跑双轴评审；`/pr` 用「现在/建议」对比图做证据。
- `diagnosing-bugs`：只有颜色仍白、sheet 定位异常或真机掉帧时才用。

## 完成定义

- P0-1 / P0-2 / P0-3 合并；`nsh check`、`nsh test`、`viewer-state.test.mjs`、`verify.mjs` 全绿。
- 模拟器首屏看到 2 前 / 5 后珊瑚红；12/12 异常对象有色；sheet 不遮选中部位；慢设备无常驻条。
- 真实机 30fps / 30 秒发热 / APK 增量仍待测；未测前不写「已达标」。
- 视觉以 `design/prototypes/anatomy-3d-refresh.html` 为准；如果实现与原型冲突，先改原型或记录原因，不要静默偏离。

## 执行结果（2026-11-25 本轮）

- P0-1：`normalizeColor()` + `toColor()` 双入口；8 位 token 收成 6 位，非法值
  回退调色板默认值。验收数据下 12 个异常对象的 instanceColor 全是 `ff6b6b`，
  不再出现 `ffffff`。
- P0-2：详情卡打开时按 sheet 实际高度重算 `bottomInset`，并用投影 offset 把选中
  部位抬到卡片上方；相机位置/距离不变；关闭恢复。`side=null` 的新契约
  （单侧卡直出、双侧卡要求选一侧）落在 `resolveCard()`。`ui=0` 的 bottomInset
  归 0。
- P0-3：删掉 48px 常驻慢设备条与重复「回档案」；改为 2.5s toast + 顶栏
  「流畅档」小状态点，每个页面生命周期最多一次。
- P1-1：暖象牙肌肉 / 浅沙骨骼 / 珊瑚异常 / 青柠选中；去掉左右半身色；Standard +
  ACES + rim light，`BatchedMesh` 仍是 3 draw calls。
- P1-2：顶部摘要（N 处、肌群、左右、深层、正/背面切换）、单行图例、每视角最多
  4 个编号标记、focus pill + 「查看」、`ui=0` 模型占满可用高度。
- P1-3 / P1-4：清单按严重度排序、组标题带数量、深层 badge、行 → 详情卡、关闭回
  清单；详情卡编号 + 左/右切换、肌群/日期/置信度、同区域跳转。
- 验证：`node --test viewer-state.test.mjs` 44/44；`nsh check` 通过；
  `verify.mjs` 全绿（含 8 位 token、12 对象、摘要/标记/侧别选择/卡片避让验收）；
  `ProfileNavigation.test.tsx` 7/7；全量 `nsh test` 282 passed / 0 failed /
  2 skipped（中途有一次 5 个 Calendar/Today 日期用例失败，复跑后消失，与 3D 改动无关）。
- 截图：`design/prototypes/anatomy-3d/screenshots/refresh-*.png`（正面/背面/详情卡/
  App 顶栏流畅档）。模拟器档案与 App 数据已清空，没留演示数据。
- 仍待测：真实机 30fps、30 秒发热、APK 增量；SwiftShader 的 2–3fps 不作为结论。

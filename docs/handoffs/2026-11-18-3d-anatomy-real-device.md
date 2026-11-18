# Handoff：3D 解剖真机测试（2026-11-18）

## 这次会话要交接什么

2D 身体图原型没有达到预期，方向转为 3D。本次已完成数据源选型、Z-Anatomy
子集导出、平滑/减面/压缩实测，并把两档测试 GLB 放进了仓库。**App 代码还没有接
3D**；下一步是在另一台电脑上搭 WebView + Three.js spike，然后上真机测帧率与交互。

先读这三份，不要重复调研：

- `docs/anatomy-3d-direction.md`：方向、性能预算、spike 步骤与验收线
- `docs/research/z-anatomy-feasibility.md`：详细数据，重点 §6.6（平滑/压缩）、§9（嵌入）
- `docs/research/assets/README.md`：两档 GLB 的规格、限制与许可

## 已经确定的结论

- **数据源用 Z-Anatomy 单源**：79/79 肌肉、31/40 骨骼部位 + 9 个骨性定位点；
  不再走「Human Atlas 为主 + Z-Anatomy 补 6 块」。Human Atlas 只保留为
  CC BY 4.0 的 fallback 与交叉校验。
- **许可**：Z-Anatomy 是 CC BY-SA 4.0，模型及修改要 share-alike；App 代码可以
  独立。署名文本在 `docs/research/z-anatomy-feasibility.md` §4.5。自用/共享场景没有问题。
- **视觉档**：原始几何 + 清 custom split normals + 全面 smooth，
  Draco 2.73 MB / 1,502,535 渲染三角面。
- **性能档**：每对象 3,000 面上限 + smooth，Draco 2.38 MB / 743,912 面。
- **低端保底**：每对象 2,000 面上限 + smooth，1.92 MB / 547,889 面（未提交，
  用 `scripts/anatomy/export_za_smooth.py` 重导）。
- **压缩选 Draco**：这组数据上 meshopt 在 3,000 档裸体积略小，但 gzip 后反而
  更大；原始档 meshopt 3.98 MB，明显更差。
- **不做 normal map baking**：原始平滑档已经只有 2.73 MB，UV 图谱 + 2K 法线
  的成本和体积都不划算。
- **运行时必须合批**：311 个 draw call 是主要瓶颈，不是 2.73 MB 体积。用
  `THREE.BatchedMesh` 收成 1–3 个 draw call；matcap/Lambert，不开 PBR、阴影、
  后处理；DPR 上限 1.5；静止时停止渲染循环。

## 仓库里已有什么

- 两档 GLB：`docs/research/assets/za-raw-smooth.glb`、
  `docs/research/assets/za-cap3000-smooth.glb`
- 导出脚本与映射：`scripts/anatomy/`（用仓库内脚本重导 3,000 档，SHA-256 与
  已提交 GLB 一致）
- 逐条映射：`docs/research/z-anatomy-site-map.csv`
- 骨性定位点：`docs/research/z-anatomy-landmarks.csv`
- 渲染对比：`docs/research/z-anatomy-smooth-comparison.png` 等
- README 与 `design/screens/index.html` 已加 3D 链接；2D 原型保留在
  `design/prototypes/anatomy-map-2d.html`

**没有提交**：`.scratch/plan-anchor-timezone/`、`design/prototypes/legibility-compare.*`
是别的功能，别混进这次 3D 工作。

## 另一台电脑怎么开始

1. `git pull`，确认拿到本次 handoff 所在提交。
2. 读 `.local/emulator.md`（如果存在）。这个文件是**本机专属**、不入库；新电脑
   需要自己记录 AVD 名、SDK/adb 路径、端口和已验证项。
3. 按 README 构建/运行 NSH app。当前 App 没有 3D 页面，所以先做独立 spike，
   不要直接改档案页。
4. 测试 GLB 不需要 Blender：`docs/research/assets/` 里已经有导出的资产。
   如果要重新生成，见 `scripts/anatomy/README.md`；需要 Blender 5.3 和 Z-Anatomy
   固定版本。
5. 不要用 `file://` 直接加载 GLB。桌面浏览器用本地 HTTP；Android 端按
   `docs/research/z-anatomy-feasibility.md` §9.1 用 Rust `127.0.0.1` loopback + gzip +
   `usesCleartextTraffic`。
6. Three.js 用 `GLTFLoader` + `DRACOLoader`；decoder 放本地，不走 CDN。

## 真机测试要测什么

同一台设备、同一页面，分别加载两档：

- 首屏可交互时间（目标 < 2 s）
- 连续旋转 30 秒：平均 fps、最低 fps、发热后是否掉到 20 fps 以下
- 增量内存（目标 < 150 MB）
- 点肌肉到高亮延迟（目标 < 100 ms）
- APK 增量（目标 < 10 MB）
- `WEBGL_multi_draw` 是否存在；`BatchedMesh` 实际 draw call 数

记录设备型号、SoC、Android/WebView 版本、GPU renderer 字符串和 DPR。

判定规则：

- 视觉档稳定 ≥ 30 fps、无明显发热掉帧 → 默认视觉档，性能档做低端 fallback。
- 视觉档 < 30 fps 或发热后明显掉帧 → 默认 3,000 档。
- 两档都不行 → 先查 draw call/材质/DPR，再退 2,000 档；不要先砍到 1,500。

## 下一步实现（按顺序）

1. 搭一个最小 viewer：正/背/侧、轨道旋转、左右分色、点击拾取。
2. 用 `BatchedMesh` 合批；拾取结果先映射到节点名，再用
   `scripts/anatomy/za-export.json` 反查 `site_id`。
3. 只验证 3 个部位：臀大肌、腹横肌、多裂肌；后两者必须靠隔离/浅层淡出才看得到。
4. 把 viewer 接进 NSH WebView，走 loopback HTTP；量上面那组指标。
5. 通过验收线后，再决定是否接进档案页；不要先改领域模型。

## 已知坑

- 两档 GLB **没有材质、UV、`site_id` 顶点属性**，只是几何/性能测试资产。
- 节点名是 Z-Anatomy 对象名；生产前应导出一份稳定的
  `node -> site_id` manifest，不要依赖名称或节点顺序。
- 9 个骨性标志不在 GLB 里；坐标是 `.j` 两顶点锚点，位于 −X 侧，使用前 X 取反。
- Z-Anatomy 的 `Spinalis capitis muscle` 实际是**头半棘肌**，映射已按
  `Semispinalis capitis` 处理；`Spinalis` 组只用 `Spinalis colli` + `Spinalis thoracis`。
- 不要使用 Z-Anatomy 的 Blender 插件代码（GPL）；只把 `.blend` 当数据读。
- NSH 没有原生 3D 网格管线；`Canvas` 是 2D，`Shader` 没有顶点/深度/网格管线。
  WebView + Three.js 是当前路径；Gradle + `GLSurfaceView` 是后续单向门，spike
  通过前不要换。
- 视觉档 1.5M 面对中端机有风险；如果 `BatchedMesh` 的 multi-draw 不可用，
  Three.js 会退化，必须先确认扩展。

## 建议调用的 skills

- `nsh`：构建/运行/打包 NSH，WebView 与 Android 集成
- `nsh-design-guides`：设计 3D 页面、交互状态与信息层级时
- `diagnosing-bugs`：真机掉帧、WebView 加载失败、内存异常时
- `tdd`：实现 `node -> site_id` 映射、拾取与状态逻辑时
- `code-review`：spike 合并前
- `research`：只有出现新的数据源/许可问题时才用；现有结论不用重查

## 这次 spike 的完成定义

在目标 Android 真机上离线加载两档模型，连续旋转 30 秒达标；点击能正确高亮
臀大肌、腹横肌、多裂肌；给出默认档位的实测依据；把设备数据补回
`docs/anatomy-3d-direction.md` 和 `docs/research/z-anatomy-feasibility.md`。

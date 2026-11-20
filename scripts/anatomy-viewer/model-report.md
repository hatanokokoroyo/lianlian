# 3D 解剖测试资产：GLB 模型校验报告

由 `scripts/anatomy-viewer/verify_glb.py` 生成。输入：`docs/research/assets/za-raw-smooth.glb`、
`docs/research/assets/za-cap3000-smooth.glb`、`scripts/anatomy/za-export.json`、`docs/research/z-anatomy-landmarks.csv`。
Draco 几何未解码；三角面、顶点与 bbox 均来自 glTF JSON chunk 的 accessor 计数与 POSITION min/max。

## 文件

| 档位 | 文件 | 字节 | SHA-256 |
|---|---|---:|---|
| raw | `docs/research/assets/za-raw-smooth.glb` | 2,727,220 | `9bbfa25a39a394742baf9c11731f3abc507cef8e5890a009a83106a2f3c2c0f2` |
| cap3000 | `docs/research/assets/za-cap3000-smooth.glb` | 2,379,092 | `d2ecd5cabe793d8a0c127ff2e3e81b4ff2f5b13aa0dc2fa509f8e4ddd69a73fa` |

## 结构与几何

| 指标 | raw | cap3000 |
|---|---:|---:|
| 节点数 | 311 | 311 |
| mesh 数组长度 | 173 | 251 |
| 被节点使用的唯一 mesh 数 | 173 | 251 |
| 重复 mesh 引用数 | 138 | 60 |
| primitive 数 | 173 | 251 |
| 三角面总数（按 311 节点求和） | 1,525,071 | 743,912 |
| 三角面总数（唯一 mesh 求和） | 840,938 | 652,241 |
| 顶点总数（按 311 节点求和） | 763,015 | 372,351 |
| 顶点总数（唯一 mesh 求和） | 420,845 | 326,450 |
| POSITION 属性 | 全部存在 | 全部存在 |
| NORMAL 属性 | 全部存在 | 全部存在 |
| Draco primitive 数 | 173 | 251 |
| 材质数 | 0 | 0 |

两档的节点名均为 311 个且互不重复；`Sinus of frontal bone` 是 `Frontal bone` 的子节点，不在 scene 根节点列表中。

## glTF 坐标 bbox

| 轴 | min | max | size | center |
|---|---:|---:|---:|---:|
| X | -0.31506 | 0.31506 | 0.63012 | -0.00000 |
| Y | 0.00693 | 1.69919 | 1.69226 | 0.85306 |
| Z | -0.13013 | 0.12842 | 0.25855 | -0.00086 |

bbox 由节点世界矩阵变换 accessor 的 min/max 八个角点得到；raw 与 cap3000 的 bbox 差值 ≤ 0.000061 m。

## 与 za-export.json 的映射

- site：119；object：311；唯一 object：311。
- 重复 object：0；重复 site_id：0。
- 左右/中线：left 137、right 138、midline 36。
- raw 命中：311/311；缺失 0，多余 0。
- cap3000 命中：311/311；缺失 0，多余 0。
- raw 节点左右/中线：left 137、right 138、midline 36。

### 目标 site

| site_id | 中文 | object 数 | object 列表 | mapping tris | raw tris | cap3000 tris |
|---|---|---:|---|---:|---:|---:|
| `gluteus-maximus` | 臀大肌 | 2 | `Gluteus maximus muscle.l`<br>`Gluteus maximus muscle.r` | 6,652 | 6,652 | 6,000 |
| `transversus-abdominis` | 腹横肌 | 2 | `Transversus abdominis muscle.l`<br>`Transversus abdominis muscle.r` | 68,656 | 68,656 | 6,000 |
| `multifidus` | 多裂肌 | 6 | `Multifidus colli muscle.l`<br>`Multifidus colli muscle.r`<br>`Multifidus lumborum muscle.l`<br>`Multifidus lumborum muscle.r`<br>`Multifidus thoracis muscle.l`<br>`Multifidus thoracis muscle.r` | 16,224 | 16,224 | 14,420 |

## 坐标、朝向与尺寸

- glTF 为 Y-up：bbox Y 范围 0.00693–1.69919 m，身高（Y span）1.69226 m。
- 模型中心 -0.00000, 0.85306, -0.00086 m；地面 min Y 0.00693 m。
- 源坐标映射：glTF X = 源 X，glTF Y = 源 Z，glTF Z = −源 Y。
- 前侧为 +Z：ASIS z=0.07400，喙突 z=0.00800，耻骨 z=0.05000；PSIS z=-0.09700。`front_plus_z=true`。
- 解剖左侧为 +X：`.l` 父骨定位点 X 范围 [-0.004, 0.166] m。
- 9 个骨性定位点按上述映射落入 bbox：9/9。定位点源 Z 范围 0.80400–1.42600 m。

## 文档参考值与解析值

| 指标 | raw 解析值 | raw README | delta | cap3000 解析值 | cap3000 README | delta |
|---|---:|---:|---:|---:|---:|---:|
| 三角面 | 1,525,071 | 1,502,535 | +22,536 | 743,912 | 743,912 | +0 |
| 唯一 mesh 顶点 | 420,845 | 420,845 | +0 | 326,450 | 326,450 | +0 |

## 数据不一致（按解析结果记录）

- `za-export.json` 的 site tris 总和 1,467,016；raw GLB 按节点求和 1,525,071；差值 +58,055。
- raw GLB 与 `za-export.json` 逐 site 比较：9/119 个 site 的 tris 不相等。

| site_id | mapping tris | raw GLB tris | delta |
|---|---:|---:|---:|
| `diaphragm` | 9,592 | 38,868 | +29,276 |
| `carpal-bones` | 6,128 | 34,924 | +28,796 |
| `gastrocnemius` | 22,740 | 22,736 | -4 |
| `mandible` | 18,838 | 18,834 | -4 |
| `abductor-hallucis` | 3,376 | 3,374 | -2 |
| `piriformis` | 3,000 | 2,998 | -2 |
| `longissimus` | 26,104 | 26,102 | -2 |
| `extensor-carpi-radialis-longus` | 7,412 | 7,410 | -2 |
| `sternum` | 8,042 | 8,041 | -1 |

## 校验结果

- 检查项 32 个：error 0 个，warning 2 个。
- `raw_reference_triangles`（warning）：glb=1525071, README=1502535, delta=22536
- `raw_triangles_match_site_map`（warning）：mismatched sites=9/119, glb total=1525071, mapping total=1467016

两档 GLB 均无材质、UV、`site_id` 顶点属性；节点名是 Z-Anatomy 对象名。

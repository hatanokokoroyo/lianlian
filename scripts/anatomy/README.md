# Z-Anatomy 导出脚本

这条管线从 Z-Anatomy 的 `Startup.blend` 抽出词表里的 311 个对象，清掉
custom split normals、全面 smooth，按每对象三角面上限简化，最后导出 Draco GLB。

## 前置

- Blender **5.3**（其他版本会改变三角化/简化结果）
- Z-Anatomy 固定版本：
  `Z-Anatomy.zip` git blob SHA `f43cabc6f366b2a6058dd2ed4a2b3c7b9b2492cb`
- 本目录下的 `za-export.json`：`site_id -> 对象名` 的映射，由调研脚本生成

## 导出

```sh
# 视觉档：原始几何 + smooth（约 2.73 MB）
blender --background /path/to/Startup.blend \
  --python scripts/anatomy/export_za_smooth.py -- 999999999 /tmp/za-raw-smooth.glb

# 性能档：每对象 3,000 面上限 + smooth（约 2.38 MB）
blender --background /path/to/Startup.blend \
  --python scripts/anatomy/export_za_smooth.py -- 3000 /tmp/za-cap3000-smooth.glb

# 对照：保留 split normals 的 faceted 版本
blender --background /path/to/Startup.blend \
  --python scripts/anatomy/export_za_dec.py -- 3000 /tmp/za-cap3000-draco.glb
```

导出的 GLB **没有材质、UV、site 属性**，只用于几何/性能测试。节点名就是
Z-Anatomy 对象名，可用 `za-export.json` 反查 `site_id`。

## 渲染对比

```sh
blender --background --python scripts/anatomy/render_crop.py -- \
  docs/research/assets/za-raw-smooth.glb raws /tmp
```

## 许可

模型衍生自 Z-Anatomy（CC BY-SA 4.0）与 BodyParts3D（CC-BY-SA 2.1 Japan）。
导出的 GLB 及修改同样按 CC BY-SA 4.0 分发；署名文本见
`docs/research/z-anatomy-feasibility.md` §4.5。

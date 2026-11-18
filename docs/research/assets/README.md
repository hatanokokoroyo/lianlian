# 3D 解剖测试资产

这两个 GLB 是从 Z-Anatomy 抽出的 311 个对象（79/79 肌肉、31/40 骨骼部位），
用于真机几何/性能测试，不是最终生产资产。

| 文件 | 三角面（含左右） | 顶点 | 大小 | 说明 |
|---|---:|---:|---:|---|
| `za-raw-smooth.glb` | 1,502,535 | 420,845 | 2.73 MB | 原始几何 + smooth，视觉档 |
| `za-cap3000-smooth.glb` | 743,912 | 326,450 | 2.38 MB | 每对象 3,000 面上限 + smooth，性能档 |

SHA-256：

```text
9bbfa25a39a394742baf9c11731f3abc507cef8e5890a009a83106a2f3c2c0f2  za-raw-smooth.glb
d2ecd5cabe793d8a0c127ff2e3e81b4ff2f5b13aa0dc2fa509f8e4ddd69a73fa  za-cap3000-smooth.glb
```

## 限制

- 没有材质、UV、法线贴图；需要查看器给一个默认 matcap/Lambert。
- 没有 `site_id` 顶点属性；节点名是 Z-Anatomy 对象名，可用
  `scripts/anatomy/za-export.json` 反查。
- 9 个骨性标志（肩峰、喙突、关节盂、髂骨、坐骨、耻骨、ASIS、PSIS、大转子）
  不在这两个 GLB 里；坐标见 `docs/research/z-anatomy-landmarks.csv`。
- 左右共享的 mesh 在 GLB 里仍是两个节点；运行时用 `BatchedMesh` 合批。

## 许可与署名

模型衍生自 [Z-Anatomy](https://www.z-anatomy.com/)（CC BY-SA 4.0），其模型
衍生自 BodyParts3D（Database Center for Life Science，CC-BY-SA 2.1 Japan）。
本目录的 GLB 是筛选、简化、平滑后的修改版本，同样按 **CC BY-SA 4.0** 分发。
署名文本见 `docs/research/z-anatomy-feasibility.md` §4.5。

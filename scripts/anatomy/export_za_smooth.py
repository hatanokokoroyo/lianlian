"""Export the Z-Anatomy site subset with smooth shading.

Usage:
    blender --background /path/to/Startup.blend \
      --python scripts/anatomy/export_za_smooth.py -- 3000 /tmp/za-cap3000.glb

The second argument is the per-object triangle cap. Use a very large number
(for example 999999999) to export the original geometry without decimation.
"""

import json
import sys
from pathlib import Path

import bpy


HERE = Path(__file__).resolve().parent
MAPPING = HERE / "za-export.json"


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    cap = int(argv[0])
    dst = argv[1]

    data = json.loads(MAPPING.read_text())
    names = [name for site in data for name in site["objects"]]

    bpy.ops.object.select_all(action="DESELECT")
    for name in names:
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        if obj.modifiers:
            bpy.ops.object.convert(target="MESH")

    objects = [bpy.data.objects[name] for name in names if name in bpy.data.objects]
    for obj in objects:
        mesh = obj.data
        triangles = sum(len(poly.vertices) - 2 for poly in mesh.polygons)
        if triangles > cap:
            modifier = obj.modifiers.new("dec", "DECIMATE")
            modifier.decimate_type = "COLLAPSE"
            modifier.ratio = cap / triangles

        bpy.context.view_layer.objects.active = obj
        try:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except Exception:
            pass
        for poly in mesh.polygons:
            poly.use_smooth = True

    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="NONE",
        export_yup=True,
        export_normals=True,
        export_texcoords=False,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
    )
    print("EXPORTED", dst)


if __name__ == "__main__":
    main()

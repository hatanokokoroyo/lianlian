"""Derive the 2,000-triangle-cap smooth tier from the existing 3,000-cap GLB.

Usage:
    blender --background --python scripts/anatomy/decimate_glb.py -- \
      docs/research/assets/za-cap3000-smooth.glb \
      docs/research/assets/za-cap2000-smooth.glb 2000

Source note: the original Z-Anatomy ``Startup.blend`` is not available on the
machine that produced this file. This script therefore reads
``za-cap3000-smooth.glb`` and decimates it again. The result is a reproducible
derivation from the 3,000-cap asset; it is not a byte-for-byte reproduction of
an official 2,000-cap export from the source blend.

For every mesh above the cap this uses Blender's COLLAPSE decimator, clears
custom split normals, marks all faces smooth, and exports a Draco-compressed
GLB with the same compression settings as ``export_za_smooth.py``.
"""

import sys
from pathlib import Path

import bpy


def triangle_count(mesh):
    return sum(len(poly.vertices) - 2 for poly in mesh.polygons)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    if len(argv) < 2:
        raise SystemExit("usage: decimate_glb.py -- <src.glb> <dst.glb> [cap]")
    src = Path(argv[0]).resolve()
    dst = Path(argv[1]).resolve()
    cap = int(argv[2]) if len(argv) > 2 else 2000

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(src))

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise SystemExit(f"no meshes imported from {src}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        # Mirrored glTF nodes can share one mesh datablock; a modifier cannot be
        # applied to multi-user data, so give each node its own copy first.
        if obj.data.users > 1:
            obj.data = obj.data.copy()

        triangles = triangle_count(obj.data)
        if triangles > cap:
            modifier = obj.modifiers.new("dec", "DECIMATE")
            modifier.decimate_type = "COLLAPSE"
            modifier.ratio = cap / triangles
            bpy.ops.object.modifier_apply(modifier=modifier.name)

        try:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except Exception:
            pass
        for poly in obj.data.polygons:
            poly.use_smooth = True

    total = sum(triangle_count(obj.data) for obj in meshes)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=str(dst),
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
    print(f"EXPORTED {dst} objects={len(meshes)} triangles={total} cap={cap}")


if __name__ == "__main__":
    main()

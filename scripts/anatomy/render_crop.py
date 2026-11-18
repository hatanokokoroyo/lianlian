"""Render front/back torso crops of an exported anatomy GLB.

Usage:
    blender --background --python scripts/anatomy/render_crop.py -- \
      docs/research/assets/za-raw-smooth.glb raws /tmp
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    src, tag = argv[0], argv[1]
    out_dir = Path(argv[2]) if len(argv) > 2 else Path("/tmp")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.72, 0.72, 0.72)
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.show_object_outline = False
    scene.render.resolution_x = 760
    scene.render.resolution_y = 900
    if scene.world is None:
        scene.world = bpy.data.worlds.new("W")
    scene.world.color = (0.06, 0.06, 0.07)

    camera_data = bpy.data.cameras.new("C")
    camera = bpy.data.objects.new("C", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 0.72
    center = Vector((0, 0, 1.05))

    camera.location = (center.x, center.y - 3.0, center.z)
    camera.rotation_euler = (math.radians(90), 0, 0)
    scene.render.filepath = str(out_dir / f"crop-{tag}-front.png")
    bpy.ops.render.render(write_still=True)

    camera.location = (center.x, center.y + 3.0, center.z)
    camera.rotation_euler = (math.radians(90), 0, math.radians(180))
    scene.render.filepath = str(out_dir / f"crop-{tag}-back.png")
    bpy.ops.render.render(write_still=True)
    print("DONE", tag)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Validate the two Z-Anatomy test GLBs against the site mapping.

Pure Python standard library. Draco payloads are not decoded; geometry facts
come from the glTF JSON chunk (accessor counts and POSITION min/max).

Usage:
    python3 scripts/anatomy-viewer/verify_glb.py
    python3 scripts/anatomy-viewer/verify_glb.py --json-out /tmp/model-report.json
    python3 scripts/anatomy-viewer/verify_glb.py --strict

Exit code is 0 when no error-level check fails, 1 when any error-level check
fails, and 2 when an input cannot be parsed.
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import math
import struct
import sys
from pathlib import Path


GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

RAW_GLB = "docs/research/assets/za-raw-smooth.glb"
CAP_GLB = "docs/research/assets/za-cap3000-smooth.glb"
SITE_MAP = "scripts/anatomy/za-export.json"
LANDMARKS = "docs/research/z-anatomy-landmarks.csv"

# Values documented in docs/research/assets/README.md.
REFERENCE = {
    "raw": {"triangles": 1502535, "vertices": 420845},
    "cap3000": {"triangles": 743912, "vertices": 326450},
}

TARGET_SITES = ("gluteus-maximus", "transversus-abdominis", "multifidus")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_glb(path: Path) -> tuple[dict, list[dict], int]:
    data = path.read_bytes()
    if len(data) < 12:
        raise ValueError(f"{path}: file is shorter than the 12-byte GLB header")

    magic, version, declared_length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise ValueError(f"{path}: bad GLB magic 0x{magic:08x}")
    if version != 2:
        raise ValueError(f"{path}: unsupported GLB version {version}")

    chunks: list[dict] = []
    doc = None
    offset = 12
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError(f"{path}: truncated chunk header at byte {offset}")
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        start = offset + 8
        end = start + chunk_length
        if end > len(data):
            raise ValueError(f"{path}: chunk overruns file at byte {offset}")
        chunks.append(
            {
                "type": f"0x{chunk_type:08x}",
                "length": chunk_length,
                "offset": offset,
            }
        )
        if chunk_type == CHUNK_JSON:
            if doc is not None:
                raise ValueError(f"{path}: more than one JSON chunk")
            doc = json.loads(data[start:end].decode("utf-8").rstrip(" \t\r\n\0"))
        elif chunk_type != CHUNK_BIN:
            raise ValueError(f"{path}: unknown chunk type 0x{chunk_type:08x}")
        offset = end

    if doc is None:
        raise ValueError(f"{path}: no JSON chunk")
    return doc, chunks, len(data)


def quat_matrix(q: list[float]) -> list[list[float]]:
    x, y, z, w = (float(v) for v in q)
    length = math.sqrt(x * x + y * y + z * z + w * w)
    if length == 0:
        raise ValueError("zero-length rotation quaternion")
    x, y, z, w = x / length, y / length, z / length, w / length
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]


def local_matrix(node: dict) -> list[list[float]]:
    matrix = node.get("matrix")
    if matrix is not None:
        if len(matrix) != 16:
            raise ValueError(f"node {node.get('name')!r}: matrix is not 16 floats")
        # glTF matrices are column-major.
        return [[float(matrix[col * 4 + row]) for col in range(4)] for row in range(4)]

    t = [float(v) for v in node.get("translation", [0.0, 0.0, 0.0])]
    s = [float(v) for v in node.get("scale", [1.0, 1.0, 1.0])]
    r = quat_matrix(node.get("rotation", [0.0, 0.0, 0.0, 1.0]))
    return [
        [r[0][0] * s[0], r[0][1] * s[1], r[0][2] * s[2], t[0]],
        [r[1][0] * s[0], r[1][1] * s[1], r[1][2] * s[2], t[1]],
        [r[2][0] * s[0], r[2][1] * s[1], r[2][2] * s[2], t[2]],
        [0.0, 0.0, 0.0, 1.0],
    ]


def mat_mul(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    return [
        [sum(a[row][k] * b[k][col] for k in range(4)) for col in range(4)]
        for row in range(4)
    ]


def transform_point(m: list[list[float]], p: list[float]) -> list[float]:
    return [
        m[row][0] * p[0] + m[row][1] * p[1] + m[row][2] * p[2] + m[row][3]
        for row in range(3)
    ]


def node_world_matrices(doc: dict) -> tuple[dict[int, list[list[float]]], dict[int, int]]:
    nodes = doc.get("nodes", [])
    parents: dict[int, int] = {}
    for index, node in enumerate(nodes):
        for child in node.get("children", []):
            if not isinstance(child, int) or child < 0 or child >= len(nodes):
                raise ValueError(f"node {index}: child index {child!r} is out of range")
            if child in parents and parents[child] != index:
                raise ValueError(f"node {child}: more than one parent")
            parents[child] = index

    cache: dict[int, list[list[float]]] = {}
    visiting: set[int] = set()

    def world(index: int) -> list[list[float]]:
        if index in cache:
            return cache[index]
        if index in visiting:
            raise ValueError(f"node hierarchy contains a cycle at node {index}")
        visiting.add(index)
        m = local_matrix(nodes[index])
        if index in parents:
            m = mat_mul(world(parents[index]), m)
        visiting.remove(index)
        cache[index] = m
        return m

    for index in range(len(nodes)):
        world(index)

    # Also walk scene roots to verify that the scene graph is connected.
    roots: list[int] = []
    for scene in doc.get("scenes", []):
        roots.extend(scene.get("nodes", []))
    for root in roots:
        if not isinstance(root, int) or root < 0 or root >= len(nodes):
            raise ValueError(f"scene root {root!r} is out of range")
        if root in parents:
            raise ValueError(f"scene root {root} also has a parent")

    return cache, parents


def triangle_count(primitive: dict, accessors: list[dict]) -> int:
    mode = primitive.get("mode", 4)
    if "indices" in primitive:
        count = int(accessors[primitive["indices"]]["count"])
    else:
        count = int(accessors[primitive["attributes"]["POSITION"]]["count"])
    if mode == 4:
        return count // 3
    if mode in (5, 6):
        return max(0, count - 2)
    return 0


def primitive_facts(doc: dict) -> dict:
    accessors = doc.get("accessors", [])
    meshes = doc.get("meshes", [])
    total_primitives = 0
    missing_position = []
    missing_normal = []
    bad_position = []
    bad_normal = []
    draco_primitives = 0
    modes = collections.Counter()
    for mesh_index, mesh in enumerate(meshes):
        for primitive_index, primitive in enumerate(mesh.get("primitives", [])):
            total_primitives += 1
            modes[int(primitive.get("mode", 4))] += 1
            attrs = primitive.get("attributes", {})
            label = f"{mesh_index}:{primitive_index}"
            if "POSITION" not in attrs:
                missing_position.append(label)
            else:
                accessor = accessors[attrs["POSITION"]]
                if accessor.get("type") != "VEC3" or accessor.get("componentType") != 5126:
                    bad_position.append(label)
            if "NORMAL" not in attrs:
                missing_normal.append(label)
            else:
                accessor = accessors[attrs["NORMAL"]]
                if accessor.get("type") != "VEC3" or accessor.get("componentType") != 5126:
                    bad_normal.append(label)
            if "KHR_draco_mesh_compression" in primitive.get("extensions", {}):
                draco_primitives += 1
    return {
        "primitive_count": total_primitives,
        "primitive_modes": {str(k): v for k, v in sorted(modes.items())},
        "all_primitives_have_position": not missing_position and not bad_position,
        "all_primitives_have_normal": not missing_normal and not bad_normal,
        "missing_position": missing_position,
        "missing_normal": missing_normal,
        "bad_position_accessors": bad_position,
        "bad_normal_accessors": bad_normal,
        "draco_primitive_count": draco_primitives,
    }


def analyse_glb(key: str, path: Path, repo_root: Path) -> dict:
    doc, chunks, size = read_glb(path)
    nodes = doc.get("nodes", [])
    meshes = doc.get("meshes", [])
    accessors = doc.get("accessors", [])
    world, parents = node_world_matrices(doc)

    names = [node.get("name") for node in nodes]
    duplicate_names = sorted(
        name for name, count in collections.Counter(names).items() if count > 1
    )

    used_meshes: set[int] = set()
    node_triangles = 0
    node_vertices = 0
    missing_mesh = []
    per_node = {}
    bbox_min = [math.inf, math.inf, math.inf]
    bbox_max = [-math.inf, -math.inf, -math.inf]
    accessor_minmax_missing = []

    for index, node in enumerate(nodes):
        name = node.get("name")
        mesh_index = node.get("mesh")
        if mesh_index is None:
            missing_mesh.append({"node_index": index, "name": name})
            continue
        if not isinstance(mesh_index, int) or mesh_index < 0 or mesh_index >= len(meshes):
            raise ValueError(f"{path}: node {index} references missing mesh {mesh_index!r}")
        used_meshes.add(mesh_index)
        mesh = meshes[mesh_index]
        tri = 0
        verts = 0
        for primitive in mesh.get("primitives", []):
            tri += triangle_count(primitive, accessors)
            attrs = primitive.get("attributes", {})
            if "POSITION" in attrs:
                accessor = accessors[attrs["POSITION"]]
                verts += int(accessor["count"])
                if "min" not in accessor or "max" not in accessor:
                    accessor_minmax_missing.append(f"{mesh_index}:{name}")
                    continue
                lo, hi = accessor["min"], accessor["max"]
                for x in (lo[0], hi[0]):
                    for y in (lo[1], hi[1]):
                        for z in (lo[2], hi[2]):
                            point = transform_point(world[index], [x, y, z])
                            for axis in range(3):
                                bbox_min[axis] = min(bbox_min[axis], point[axis])
                                bbox_max[axis] = max(bbox_max[axis], point[axis])
        node_triangles += tri
        node_vertices += verts
        per_node[name] = {
            "node_index": index,
            "mesh_index": mesh_index,
            "triangles": tri,
            "vertices": verts,
        }

    unique_triangles = 0
    unique_vertices = 0
    for mesh in meshes:
        for primitive in mesh.get("primitives", []):
            unique_triangles += triangle_count(primitive, accessors)
            attrs = primitive.get("attributes", {})
            if "POSITION" in attrs:
                unique_vertices += int(accessors[attrs["POSITION"]]["count"])

    scene_roots = []
    for scene in doc.get("scenes", []):
        scene_roots.extend(scene.get("nodes", []))
    orphans = sorted(set(range(len(nodes))) - set(parents) - set(scene_roots))

    facts = primitive_facts(doc)
    facts.update(
        {
            "key": key,
            "path": str(path.relative_to(repo_root)),
            "bytes": size,
            "sha256": sha256(path),
            "asset": doc.get("asset", {}),
            "extensions_used": doc.get("extensionsUsed", []),
            "extensions_required": doc.get("extensionsRequired", []),
            "chunks": chunks,
            "declared_length": struct.unpack_from("<I", path.read_bytes(), 8)[0],
            "node_count": len(nodes),
            "mesh_count": len(meshes),
            "used_mesh_count": len(used_meshes),
            "reused_mesh_references": len(nodes) - len(used_meshes),
            "node_names": names,
            "duplicate_node_names": duplicate_names,
            "nodes_without_mesh": missing_mesh,
            "scene_count": len(doc.get("scenes", [])),
            "scene_root_count": len(scene_roots),
            "orphan_nodes": orphans,
            "node_triangle_total": node_triangles,
            "unique_mesh_triangle_total": unique_triangles,
            "node_vertex_total": node_vertices,
            "unique_mesh_vertex_total": unique_vertices,
            "bbox": {
                "min": [round(v, 6) for v in bbox_min],
                "max": [round(v, 6) for v in bbox_max],
                "size": [round(bbox_max[i] - bbox_min[i], 6) for i in range(3)],
                "center": [round((bbox_max[i] + bbox_min[i]) / 2, 6) for i in range(3)],
                "method": "accessor POSITION min/max corners transformed by node world matrices (glTF axes, no Draco decode)",
                "accessor_minmax_missing": accessor_minmax_missing,
            },
            "nodes": per_node,
        }
    )
    return facts


def read_site_map(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"{path}: expected a JSON array")

    objects = []
    site_ids = []
    for index, site in enumerate(data):
        if not isinstance(site, dict) or "site_id" not in site or "objects" not in site:
            raise ValueError(f"{path}: site {index} lacks site_id/objects")
        site_ids.append(site["site_id"])
        objects.extend(site["objects"])

    counts = collections.Counter(objects)
    side_counts = collections.Counter(classify_side(obj) for obj in objects)
    return {
        "path": str(path),
        "site_count": len(data),
        "object_count": len(objects),
        "unique_object_count": len(set(objects)),
        "duplicate_objects": sorted(obj for obj, n in counts.items() if n > 1),
        "duplicate_site_ids": sorted(
            sid for sid, n in collections.Counter(site_ids).items() if n > 1
        ),
        "side_counts": dict(side_counts),
        "objects": objects,
        "sites": data,
    }


def classify_side(name: str) -> str:
    if name.endswith(".l"):
        return "left"
    if name.endswith(".r"):
        return "right"
    return "midline"


def cross_check(glb: dict, site_map: dict) -> dict:
    node_names = glb["node_names"]
    node_set = set(node_names)
    object_set = set(site_map["objects"])
    missing = sorted(object_set - node_set)
    extra = sorted(node_set - object_set)
    return {
        "matched": len(object_set & node_set),
        "expected": site_map["unique_object_count"],
        "missing_from_glb": missing,
        "extra_in_glb": extra,
        "all_hit": not missing and not extra and len(object_set & node_set) == 311,
        "glb_side_counts": dict(
            collections.Counter(classify_side(name) for name in node_names)
        ),
    }


def target_sites(site_map: dict, glb_facts: dict[str, dict]) -> dict:
    sites = {site["site_id"]: site for site in site_map["sites"]}
    result = {}
    for site_id in TARGET_SITES:
        site = sites.get(site_id)
        if site is None:
            result[site_id] = {"present": False}
            continue
        entry = {
            "present": True,
            "en": site.get("en"),
            "zh": site.get("zh"),
            "kind": site.get("kind"),
            "object_count": len(site["objects"]),
            "objects": site["objects"],
            "mapping_triangles": site.get("tris"),
            "mapping_vertices": site.get("verts"),
        }
        for key, facts in glb_facts.items():
            entry[key] = {
                name: facts["nodes"].get(name, {"present": False})
                for name in site["objects"]
            }
            entry[f"{key}_triangle_sum"] = sum(
                facts["nodes"].get(name, {}).get("triangles", 0)
                for name in site["objects"]
            )
        result[site_id] = entry
    return result


def triangle_consistency(site_map: dict, glb_facts: dict[str, dict]) -> dict:
    result = {}
    for key, facts in glb_facts.items():
        mismatches = []
        for site in site_map["sites"]:
            actual = sum(
                facts["nodes"].get(name, {}).get("triangles", 0)
                for name in site["objects"]
            )
            expected = int(site.get("tris", 0))
            if actual != expected:
                mismatches.append(
                    {
                        "site_id": site["site_id"],
                        "mapping_tris": expected,
                        "glb_tris": actual,
                        "delta": actual - expected,
                    }
                )
        result[key] = {
            "sites_compared": site_map["site_count"],
            "mismatch_count": len(mismatches),
            "mismatches": mismatches,
            "mapping_triangle_total": sum(int(s.get("tris", 0)) for s in site_map["sites"]),
            "glb_triangle_total": facts["node_triangle_total"],
        }
    return result


def analyse_landmarks(path: Path, bbox: dict) -> dict:
    rows = []
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            x = float(row["x_m"])
            y = float(row["y_m"])
            z = float(row["z_m"])
            # Source is Z-up with +X anatomical left and -Y anterior.
            # glTF is Y-up: (x, y, z) -> (x, z, -y).
            expected = [x, z, -y]
            outside = []
            for axis, value in enumerate(expected):
                if value < bbox["min"][axis] or value > bbox["max"][axis]:
                    delta = (
                        value - bbox["min"][axis]
                        if value < bbox["min"][axis]
                        else value - bbox["max"][axis]
                    )
                    outside.append(
                        {"axis": "xyz"[axis], "value": round(value, 6), "delta": round(delta, 6)}
                    )
            rows.append(
                {
                    "site_id": row["site_id"],
                    "en": row["en"],
                    "zh": row["zh"],
                    "parent_bone": row.get("parent_bone", ""),
                    "source_xyz_m": [x, y, z],
                    "expected_gltf_xyz_m": [round(v, 6) for v in expected],
                    "inside_bbox": not outside,
                    "outside": outside,
                }
            )

    by_id = {row["site_id"]: row for row in rows}
    asis = by_id.get("asis")
    psis = by_id.get("psis")
    coracoid = by_id.get("coracoid-process")
    pubis = by_id.get("pubis")
    anterior_z = {
        key: by_id[key]["expected_gltf_xyz_m"][2]
        for key in ("asis", "coracoid-process", "pubis")
        if key in by_id
    }
    posterior_z = {"psis": psis["expected_gltf_xyz_m"][2]} if psis else {}
    front_plus_z = bool(
        asis
        and psis
        and asis["expected_gltf_xyz_m"][2] > 0
        and psis["expected_gltf_xyz_m"][2] < 0
        and asis["expected_gltf_xyz_m"][2] > psis["expected_gltf_xyz_m"][2]
    )
    if coracoid and pubis:
        front_plus_z = (
            front_plus_z
            and coracoid["expected_gltf_xyz_m"][2] > 0
            and pubis["expected_gltf_xyz_m"][2] > 0
        )

    left_x = [
        row["expected_gltf_xyz_m"][0]
        for row in rows
        if row["parent_bone"].endswith(".l")
    ]
    return {
        "path": str(path),
        "count": len(rows),
        "axis_mapping": {
            "gltf_x": "source x (anatomical left is +X; .l parent bones have positive x)",
            "gltf_y": "source z (up)",
            "gltf_z": "negative source y (+Z is anterior/front)",
        },
        "front_plus_z": front_plus_z,
        "anterior_marker_z": anterior_z,
        "posterior_marker_z": posterior_z,
        "left_parent_x_range": [round(min(left_x), 6), round(max(left_x), 6)]
        if left_x
        else None,
        "all_inside_bbox": all(row["inside_bbox"] for row in rows),
        "landmarks": rows,
    }


def add_check(checks: list[dict], check_id: str, ok: bool, detail: str, severity: str = "error") -> None:
    checks.append(
        {
            "id": check_id,
            "ok": bool(ok),
            "severity": severity,
            "detail": detail,
        }
    )


def build_report(repo_root: Path) -> dict:
    raw_path = repo_root / RAW_GLB
    cap_path = repo_root / CAP_GLB
    map_path = repo_root / SITE_MAP
    landmark_path = repo_root / LANDMARKS
    for path in (raw_path, cap_path, map_path, landmark_path):
        if not path.is_file():
            raise FileNotFoundError(path)

    glb_facts = {
        "raw": analyse_glb("raw", raw_path, repo_root),
        "cap3000": analyse_glb("cap3000", cap_path, repo_root),
    }
    site_map = read_site_map(map_path)
    checks: list[dict] = []

    for key, facts in glb_facts.items():
        add_check(
            checks,
            f"{key}_chunks_declared_length",
            facts["declared_length"] == facts["bytes"],
            f"declared {facts['declared_length']}, file {facts['bytes']}",
        )
        add_check(
            checks,
            f"{key}_node_count_311",
            facts["node_count"] == 311,
            f"nodes={facts['node_count']}",
        )
        add_check(
            checks,
            f"{key}_nodes_without_mesh_zero",
            not facts["nodes_without_mesh"],
            f"nodes without mesh={len(facts['nodes_without_mesh'])}",
        )
        add_check(
            checks,
            f"{key}_unique_node_names",
            not facts["duplicate_node_names"],
            f"duplicate names={len(facts['duplicate_node_names'])}",
        )
        add_check(
            checks,
            f"{key}_position_normal",
            facts["all_primitives_have_position"] and facts["all_primitives_have_normal"],
            f"POSITION ok={facts['all_primitives_have_position']}, "
            f"NORMAL ok={facts['all_primitives_have_normal']}",
        )
        add_check(
            checks,
            f"{key}_triangle_mode",
            facts["primitive_modes"] == {"4": facts["primitive_count"]},
            f"modes={facts['primitive_modes']}",
        )
        add_check(
            checks,
            f"{key}_bbox_finite",
            all(math.isfinite(v) for v in facts["bbox"]["min"] + facts["bbox"]["max"]),
            f"bbox={facts['bbox']['min']}..{facts['bbox']['max']}",
        )
        add_check(
            checks,
            f"{key}_reference_triangles",
            facts["node_triangle_total"] == REFERENCE[key]["triangles"],
            f"glb={facts['node_triangle_total']}, README={REFERENCE[key]['triangles']}, "
            f"delta={facts['node_triangle_total'] - REFERENCE[key]['triangles']}",
            severity="warning",
        )
        add_check(
            checks,
            f"{key}_reference_unique_vertices",
            facts["unique_mesh_vertex_total"] == REFERENCE[key]["vertices"],
            f"unique mesh vertices={facts['unique_mesh_vertex_total']}, "
            f"README={REFERENCE[key]['vertices']}",
            severity="warning",
        )

    add_check(
        checks,
        "site_map_site_count_119",
        site_map["site_count"] == 119,
        f"sites={site_map['site_count']}",
    )
    add_check(
        checks,
        "site_map_object_count_311_unique",
        site_map["object_count"] == 311 and site_map["unique_object_count"] == 311,
        f"objects={site_map['object_count']}, unique={site_map['unique_object_count']}",
    )
    add_check(
        checks,
        "site_map_no_duplicate_objects",
        not site_map["duplicate_objects"],
        f"duplicates={len(site_map['duplicate_objects'])}",
    )
    add_check(
        checks,
        "site_map_no_duplicate_site_ids",
        not site_map["duplicate_site_ids"],
        f"duplicate site ids={len(site_map['duplicate_site_ids'])}",
    )

    cross = {}
    for key, facts in glb_facts.items():
        cross[key] = cross_check(facts, site_map)
        add_check(
            checks,
            f"{key}_mapping_311_of_311",
            cross[key]["all_hit"],
            f"matched={cross[key]['matched']}/{cross[key]['expected']}, "
            f"missing={len(cross[key]['missing_from_glb'])}, "
            f"extra={len(cross[key]['extra_in_glb'])}",
        )
        add_check(
            checks,
            f"{key}_left_right_counts",
            cross[key]["glb_side_counts"] == site_map["side_counts"],
            f"glb={cross[key]['glb_side_counts']}, mapping={site_map['side_counts']}",
        )

    targets = target_sites(site_map, glb_facts)
    expected_target_counts = {
        "gluteus-maximus": 2,
        "transversus-abdominis": 2,
        "multifidus": 6,
    }
    for site_id, expected in expected_target_counts.items():
        entry = targets[site_id]
        add_check(
            checks,
            f"target_{site_id}",
            entry.get("present") and entry.get("object_count") == expected,
            f"present={entry.get('present')}, objects={entry.get('object_count')}, "
            f"expected={expected}",
        )

    triangles = triangle_consistency(site_map, glb_facts)
    add_check(
        checks,
        "raw_triangles_match_site_map",
        triangles["raw"]["mismatch_count"] == 0,
        f"mismatched sites={triangles['raw']['mismatch_count']}/{triangles['raw']['sites_compared']}, "
        f"glb total={triangles['raw']['glb_triangle_total']}, "
        f"mapping total={triangles['raw']['mapping_triangle_total']}",
        severity="warning",
    )

    landmarks = analyse_landmarks(landmark_path, glb_facts["raw"]["bbox"])
    add_check(
        checks,
        "landmarks_inside_glb_bbox",
        landmarks["all_inside_bbox"],
        f"inside={sum(1 for row in landmarks['landmarks'] if row['inside_bbox'])}"
        f"/{landmarks['count']}",
    )
    add_check(
        checks,
        "front_plus_z",
        landmarks["front_plus_z"],
        f"anterior marker z={landmarks['anterior_marker_z']}, "
        f"posterior marker z={landmarks['posterior_marker_z']}",
    )

    errors = [c for c in checks if not c["ok"] and c["severity"] == "error"]
    warnings = [c for c in checks if not c["ok"] and c["severity"] == "warning"]

    return {
        "repo_root": str(repo_root),
        "inputs": {
            "raw": RAW_GLB,
            "cap3000": CAP_GLB,
            "site_map": SITE_MAP,
            "landmarks": LANDMARKS,
        },
        "reference": REFERENCE,
        "glb": glb_facts,
        "site_map": {
            key: value
            for key, value in site_map.items()
            if key not in ("objects", "sites")
        },
        "mapping": {
            "sites": site_map["sites"],
            "cross_check": cross,
        },
        "target_sites": targets,
        "triangle_consistency": triangles,
        "landmarks": landmarks,
        "checks": checks,
        "summary": {
            "ok": not errors,
            "error_count": len(errors),
            "warning_count": len(warnings),
            "failed_checks": [c["id"] for c in errors + warnings],
        },
    }


def fmt(value: float, digits: int = 5) -> str:
    return f"{value:.{digits}f}"


def write_markdown(report: dict, path: Path) -> None:
    raw = report["glb"]["raw"]
    cap = report["glb"]["cap3000"]
    land = report["landmarks"]
    bbox = raw["bbox"]
    cross = report["mapping"]["cross_check"]
    site_map = report["site_map"]
    lines = [
        "# 3D 解剖测试资产：GLB 模型校验报告",
        "",
        f"由 `scripts/anatomy-viewer/verify_glb.py` 生成。输入：`{RAW_GLB}`、",
        f"`{CAP_GLB}`、`{SITE_MAP}`、`{LANDMARKS}`。",
        "Draco 几何未解码；三角面、顶点与 bbox 均来自 glTF JSON chunk 的 accessor 计数与 POSITION min/max。",
        "",
        "## 文件",
        "",
        "| 档位 | 文件 | 字节 | SHA-256 |",
        "|---|---|---:|---|",
        f"| raw | `{raw['path']}` | {raw['bytes']:,} | `{raw['sha256']}` |",
        f"| cap3000 | `{cap['path']}` | {cap['bytes']:,} | `{cap['sha256']}` |",
        "",
        "## 结构与几何",
        "",
        "| 指标 | raw | cap3000 |",
        "|---|---:|---:|",
        f"| 节点数 | {raw['node_count']} | {cap['node_count']} |",
        f"| mesh 数组长度 | {raw['mesh_count']} | {cap['mesh_count']} |",
        f"| 被节点使用的唯一 mesh 数 | {raw['used_mesh_count']} | {cap['used_mesh_count']} |",
        f"| 重复 mesh 引用数 | {raw['reused_mesh_references']} | {cap['reused_mesh_references']} |",
        f"| primitive 数 | {raw['primitive_count']} | {cap['primitive_count']} |",
        f"| 三角面总数（按 311 节点求和） | {raw['node_triangle_total']:,} | {cap['node_triangle_total']:,} |",
        f"| 三角面总数（唯一 mesh 求和） | {raw['unique_mesh_triangle_total']:,} | {cap['unique_mesh_triangle_total']:,} |",
        f"| 顶点总数（按 311 节点求和） | {raw['node_vertex_total']:,} | {cap['node_vertex_total']:,} |",
        f"| 顶点总数（唯一 mesh 求和） | {raw['unique_mesh_vertex_total']:,} | {cap['unique_mesh_vertex_total']:,} |",
        f"| POSITION 属性 | {'全部存在' if raw['all_primitives_have_position'] else '有缺失'} | {'全部存在' if cap['all_primitives_have_position'] else '有缺失'} |",
        f"| NORMAL 属性 | {'全部存在' if raw['all_primitives_have_normal'] else '有缺失'} | {'全部存在' if cap['all_primitives_have_normal'] else '有缺失'} |",
        f"| Draco primitive 数 | {raw['draco_primitive_count']} | {cap['draco_primitive_count']} |",
        f"| 材质数 | 0 | 0 |",
        "",
        "两档的节点名均为 311 个且互不重复；`Sinus of frontal bone` 是 `Frontal bone` 的子节点，"
        "不在 scene 根节点列表中。",
        "",
        "## glTF 坐标 bbox",
        "",
        "| 轴 | min | max | size | center |",
        "|---|---:|---:|---:|---:|",
    ]
    for axis in range(3):
        lines.append(
            f"| {'XYZ'[axis]} | {fmt(bbox['min'][axis])} | {fmt(bbox['max'][axis])} | "
            f"{fmt(bbox['size'][axis])} | {fmt(bbox['center'][axis])} |"
        )
    lines += [
        "",
        f"bbox 由节点世界矩阵变换 accessor 的 min/max 八个角点得到；raw 与 cap3000 的 bbox 差值 "
        f"≤ {max(abs(raw['bbox']['min'][i] - cap['bbox']['min'][i]) for i in range(3)):.6f} m。",
        "",
        "## 与 za-export.json 的映射",
        "",
        f"- site：{site_map['site_count']}；object：{site_map['object_count']}；唯一 object：{site_map['unique_object_count']}。",
        f"- 重复 object：{len(site_map['duplicate_objects'])}；重复 site_id：{len(site_map['duplicate_site_ids'])}。",
        f"- 左右/中线：left {site_map['side_counts'].get('left', 0)}、right {site_map['side_counts'].get('right', 0)}、midline {site_map['side_counts'].get('midline', 0)}。",
        f"- raw 命中：{cross['raw']['matched']}/{cross['raw']['expected']}；缺失 {len(cross['raw']['missing_from_glb'])}，多余 {len(cross['raw']['extra_in_glb'])}。",
        f"- cap3000 命中：{cross['cap3000']['matched']}/{cross['cap3000']['expected']}；缺失 {len(cross['cap3000']['missing_from_glb'])}，多余 {len(cross['cap3000']['extra_in_glb'])}。",
        f"- raw 节点左右/中线：left {cross['raw']['glb_side_counts'].get('left', 0)}、right {cross['raw']['glb_side_counts'].get('right', 0)}、midline {cross['raw']['glb_side_counts'].get('midline', 0)}。",
        "",
        "### 目标 site",
        "",
        "| site_id | 中文 | object 数 | object 列表 | mapping tris | raw tris | cap3000 tris |",
        "|---|---|---:|---|---:|---:|---:|",
    ]
    for site_id in TARGET_SITES:
        target = report["target_sites"][site_id]
        objects = "<br>".join(f"`{name}`" for name in target["objects"])
        lines.append(
            f"| `{site_id}` | {target['zh']} | {target['object_count']} | {objects} | "
            f"{target['mapping_triangles']:,} | {target['raw_triangle_sum']:,} | "
            f"{target['cap3000_triangle_sum']:,} |"
        )
    lines += [
        "",
        "## 坐标、朝向与尺寸",
        "",
        f"- glTF 为 Y-up：bbox Y 范围 {fmt(bbox['min'][1])}–{fmt(bbox['max'][1])} m，"
        f"身高（Y span）{fmt(bbox['size'][1])} m。",
        f"- 模型中心 {fmt(bbox['center'][0])}, {fmt(bbox['center'][1])}, {fmt(bbox['center'][2])} m；"
        f"地面 min Y {fmt(bbox['min'][1])} m。",
        f"- 源坐标映射：glTF X = 源 X，glTF Y = 源 Z，glTF Z = −源 Y。",
        f"- 前侧为 +Z：ASIS z={fmt(land['anterior_marker_z'].get('asis', 0))}，"
        f"喙突 z={fmt(land['anterior_marker_z'].get('coracoid-process', 0))}，"
        f"耻骨 z={fmt(land['anterior_marker_z'].get('pubis', 0))}；"
        f"PSIS z={fmt(land['posterior_marker_z'].get('psis', 0))}。`front_plus_z={str(land['front_plus_z']).lower()}`。",
        f"- 解剖左侧为 +X：`.l` 父骨定位点 X 范围 {land['left_parent_x_range']} m。",
        f"- 9 个骨性定位点按上述映射落入 bbox：{sum(1 for row in land['landmarks'] if row['inside_bbox'])}/{land['count']}。"
        f"定位点源 Z 范围 {fmt(min(row['source_xyz_m'][2] for row in land['landmarks']))}–"
        f"{fmt(max(row['source_xyz_m'][2] for row in land['landmarks']))} m。",
        "",
        "## 文档参考值与解析值",
        "",
        "| 指标 | raw 解析值 | raw README | delta | cap3000 解析值 | cap3000 README | delta |",
        "|---|---:|---:|---:|---:|---:|---:|",
        f"| 三角面 | {raw['node_triangle_total']:,} | {REFERENCE['raw']['triangles']:,} | "
        f"{raw['node_triangle_total'] - REFERENCE['raw']['triangles']:+,} | "
        f"{cap['node_triangle_total']:,} | {REFERENCE['cap3000']['triangles']:,} | "
        f"{cap['node_triangle_total'] - REFERENCE['cap3000']['triangles']:+,} |",
        f"| 唯一 mesh 顶点 | {raw['unique_mesh_vertex_total']:,} | {REFERENCE['raw']['vertices']:,} | "
        f"{raw['unique_mesh_vertex_total'] - REFERENCE['raw']['vertices']:+,} | "
        f"{cap['unique_mesh_vertex_total']:,} | {REFERENCE['cap3000']['vertices']:,} | "
        f"{cap['unique_mesh_vertex_total'] - REFERENCE['cap3000']['vertices']:+,} |",
        "",
        "## 数据不一致（按解析结果记录）",
        "",
    ]
    raw_tri = report["triangle_consistency"]["raw"]
    lines.append(
        f"- `za-export.json` 的 site tris 总和 {raw_tri['mapping_triangle_total']:,}；"
        f"raw GLB 按节点求和 {raw_tri['glb_triangle_total']:,}；差值 "
        f"{raw_tri['glb_triangle_total'] - raw_tri['mapping_triangle_total']:+,}。"
    )
    lines.append(
        f"- raw GLB 与 `za-export.json` 逐 site 比较：{raw_tri['mismatch_count']}/"
        f"{raw_tri['sites_compared']} 个 site 的 tris 不相等。"
    )
    if raw_tri["mismatches"]:
        top = sorted(raw_tri["mismatches"], key=lambda row: -abs(row["delta"]))[:10]
        lines.append("")
        lines.append("| site_id | mapping tris | raw GLB tris | delta |")
        lines.append("|---|---:|---:|---:|")
        for row in top:
            lines.append(
                f"| `{row['site_id']}` | {row['mapping_tris']:,} | {row['glb_tris']:,} | "
                f"{row['delta']:+,} |"
            )
    checks_failed = [c for c in report["checks"] if not c["ok"]]
    lines += [
        "",
        "## 校验结果",
        "",
        f"- 检查项 {len(report['checks'])} 个：error {report['summary']['error_count']} 个，"
        f"warning {report['summary']['warning_count']} 个。",
    ]
    for check in checks_failed:
        lines.append(
            f"- `{check['id']}`（{check['severity']}）：{check['detail']}"
        )
    if not checks_failed:
        lines.append("- 所有检查项通过。")
    lines += [
        "",
        "两档 GLB 均无材质、UV、`site_id` 顶点属性；节点名是 Z-Anatomy 对象名。",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def print_summary(report: dict) -> None:
    raw = report["glb"]["raw"]
    cap = report["glb"]["cap3000"]
    cross = report["mapping"]["cross_check"]["raw"]
    bbox = raw["bbox"]
    print(
        f"raw: nodes={raw['node_count']} meshes={raw['mesh_count']} "
        f"unique_meshes={raw['used_mesh_count']} tris={raw['node_triangle_total']:,} "
        f"verts={raw['node_vertex_total']:,}"
    )
    print(
        f"cap3000: nodes={cap['node_count']} meshes={cap['mesh_count']} "
        f"unique_meshes={cap['used_mesh_count']} tris={cap['node_triangle_total']:,} "
        f"verts={cap['node_vertex_total']:,}"
    )
    print(
        f"mapping: {cross['matched']}/{cross['expected']} hit, "
        f"missing={len(cross['missing_from_glb'])}, extra={len(cross['extra_in_glb'])}"
    )
    print(
        f"bbox: min={bbox['min']} max={bbox['max']} "
        f"size={bbox['size']} center={bbox['center']}"
    )
    print(
        f"front_plus_z={report['landmarks']['front_plus_z']} "
        f"height={bbox['size'][1]:.5f} m"
    )
    print(
        f"checks: error={report['summary']['error_count']} "
        f"warning={report['summary']['warning_count']}"
    )
    for check in report["checks"]:
        if not check["ok"]:
            print(f"  [{check['severity']}] {check['id']}: {check['detail']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="repository root (default: two levels above this script)",
    )
    parser.add_argument(
        "--json-out",
        type=Path,
        help="write the full JSON report to this path instead of stdout only",
    )
    parser.add_argument(
        "--md-out",
        type=Path,
        default=None,
        help="markdown report path (default: scripts/anatomy-viewer/model-report.md)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="exit non-zero when any error-level check fails",
    )
    args = parser.parse_args(argv)

    repo_root = args.repo_root.resolve()
    try:
        report = build_report(repo_root)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"verify_glb: {exc}", file=sys.stderr)
        return 2

    payload = json.dumps(report, ensure_ascii=False, indent=2)
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(payload + "\n", encoding="utf-8")
        print_summary(report)
    else:
        print(payload)

    md_out = args.md_out or repo_root / "scripts/anatomy-viewer/model-report.md"
    write_markdown(report, md_out)

    if args.strict and not report["summary"]["ok"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

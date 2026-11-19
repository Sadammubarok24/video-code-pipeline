#!/usr/bin/env python3
"""Membuat aset .glb contoh BERANIMASI (robot.glb, kota.glb) tanpa Blender.

Jalankan:  python3 tools/make-sample-glb.py assets
Hanya butuh numpy. Ini cuma aset uji agar pipeline langsung jalan;
ganti dengan model .glb Anda sendiri kapan saja.
"""
import json, math, struct, sys, os
import numpy as np


class GLB:
    def __init__(self):
        self.bin = bytearray()
        self.views, self.accessors, self.meshes = [], [], []
        self.nodes, self.materials, self.anims = [], [], []
        self._time_cache = {}

    def _align(self):
        while len(self.bin) % 4:
            self.bin.append(0)

    def view(self, data, target=None):
        self._align()
        v = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            v["target"] = target
        self.bin += data
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, arr, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        if arr.dtype == np.uint16:
            comp = 5123
        else:
            arr = arr.astype(np.float32)
            comp = 5126
        if arr.ndim == 1:
            typ = "SCALAR"
        else:
            typ = {2: "VEC2", 3: "VEC3", 4: "VEC4"}[arr.shape[1]]
        a = {"bufferView": self.view(arr.tobytes(), target), "componentType": comp,
             "count": int(arr.shape[0]), "type": typ}
        if minmax:
            a["min"] = np.atleast_1d(arr.min(axis=0)).astype(float).tolist()
            a["max"] = np.atleast_1d(arr.max(axis=0)).astype(float).tolist()
        self.accessors.append(a)
        return len(self.accessors) - 1

    def material(self, color, metal=0.2, rough=0.6, emissive=None):
        m = {"pbrMetallicRoughness": {"baseColorFactor": list(color) + [1.0],
                                      "metallicFactor": metal, "roughnessFactor": rough}}
        if emissive:
            m["emissiveFactor"] = list(emissive)
        self.materials.append(m)
        return len(self.materials) - 1

    def mesh(self, parts):
        """parts = [(positions, normals, indices, material_idx), ...]"""
        prims = []
        for pos, nor, idx, mat in parts:
            prims.append({
                "attributes": {"POSITION": self.accessor(pos, 34962, True),
                               "NORMAL": self.accessor(nor, 34962)},
                "indices": self.accessor(idx.astype(np.uint16), 34963),
                "material": mat})
        self.meshes.append({"primitives": prims})
        return len(self.meshes) - 1

    def node(self, name, mesh=None, t=None, s=None, children=None):
        n = {"name": name}
        if mesh is not None:
            n["mesh"] = mesh
        if t:
            n["translation"] = list(t)
        if s:
            n["scale"] = list(s)
        if children:
            n["children"] = children
        self.nodes.append(n)
        return len(self.nodes) - 1

    def _times(self, times):
        key = tuple(times)
        if key not in self._time_cache:
            self._time_cache[key] = self.accessor(np.array(times, dtype=np.float32), None, True)
        return self._time_cache[key]

    def animation(self, name, channels):
        """channels = [(node_idx, 'rotation'|'translation'|'scale', times, values)]"""
        samplers, chans = [], []
        for node, path, times, values in channels:
            samplers.append({"input": self._times(times),
                             "output": self.accessor(np.array(values, dtype=np.float32)),
                             "interpolation": "LINEAR"})
            chans.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})
        self.anims.append({"name": name, "samplers": samplers, "channels": chans})

    def save(self, path, scene_nodes):
        self._align()
        doc = {"asset": {"version": "2.0", "generator": "make-sample-glb.py"},
               "scene": 0, "scenes": [{"nodes": scene_nodes}], "nodes": self.nodes,
               "meshes": self.meshes, "materials": self.materials,
               "accessors": self.accessors, "bufferViews": self.views,
               "buffers": [{"byteLength": len(self.bin)}]}
        if self.anims:
            doc["animations"] = self.anims
        js = json.dumps(doc, separators=(",", ":")).encode()
        js += b" " * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, "wb") as f:
            f.write(struct.pack("<4sII", b"glTF", 2, total))
            f.write(struct.pack("<I4s", len(js), b"JSON") + js)
            f.write(struct.pack("<I4s", len(self.bin), b"BIN\x00") + bytes(self.bin))


def box(w, h, d, off=(0, 0, 0)):
    x, y, z = w / 2, h / 2, d / 2
    faces = [
        ((0, 0, 1), [(-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]),
        ((0, 0, -1), [(x, -y, -z), (-x, -y, -z), (-x, y, -z), (x, y, -z)]),
        ((1, 0, 0), [(x, -y, z), (x, -y, -z), (x, y, -z), (x, y, z)]),
        ((-1, 0, 0), [(-x, -y, -z), (-x, -y, z), (-x, y, z), (-x, y, -z)]),
        ((0, 1, 0), [(-x, y, z), (x, y, z), (x, y, -z), (-x, y, -z)]),
        ((0, -1, 0), [(-x, -y, -z), (x, -y, -z), (x, -y, z), (-x, -y, z)]),
    ]
    pos, nor, idx = [], [], []
    for i, (n, vs) in enumerate(faces):
        for v in vs:
            pos.append([v[0] + off[0], v[1] + off[1], v[2] + off[2]])
            nor.append(list(n))
        b = i * 4
        idx += [b, b + 1, b + 2, b, b + 2, b + 3]
    return np.array(pos, np.float32), np.array(nor, np.float32), np.array(idx, np.uint16)


def qx(a): return [math.sin(a / 2), 0, 0, math.cos(a / 2)]
def qy(a): return [0, math.sin(a / 2), 0, math.cos(a / 2)]
def qz(a): return [0, 0, math.sin(a / 2), math.cos(a / 2)]


def make_robot(path):
    g = GLB()
    body = g.material((0.78, 0.82, 0.9), 0.7, 0.35)
    accent = g.material((1.0, 0.55, 0.15), 0.4, 0.5)
    dark = g.material((0.12, 0.13, 0.18), 0.5, 0.5)
    visor = g.material((0.0, 0.0, 0.0), 0.0, 1.0, emissive=(0.0, 0.9, 1.0))

    torso = g.mesh([(*box(0.8, 0.9, 0.45, (0, 0.45, 0)), body), (*box(0.3, 0.3, 0.05, (0, 0.5, 0.23)), visor)])
    head = g.mesh([(*box(0.5, 0.5, 0.46, (0, 0.25, 0)), body), (*box(0.4, 0.14, 0.05, (0, 0.28, 0.235)), visor),
                   (*box(0.06, 0.25, 0.06, (0, 0.62, 0)), dark)])
    arm = g.mesh([(*box(0.2, 0.75, 0.22, (0, -0.35, 0)), accent)])
    leg = g.mesh([(*box(0.28, 0.95, 0.3, (0, -0.475, 0)), dark)])

    n_torso = g.node("Torso", torso)
    n_head = g.node("Head", head, t=(0, 0.95, 0))
    n_al = g.node("ArmL", arm, t=(-0.55, 0.8, 0))
    n_ar = g.node("ArmR", arm, t=(0.55, 0.8, 0))
    n_ll = g.node("LegL", leg, t=(-0.2, 0, 0))
    n_lr = g.node("LegR", leg, t=(0.2, 0, 0))
    hips = g.node("Hips", None, t=(0, 0.95, 0), children=[n_torso, n_head, n_al, n_ar, n_ll, n_lr])
    root = g.node("Robot", None, children=[hips])

    def ys(v): return [0, v, 0]

    # idle: napas + kepala menoleh + lengan mengayun pelan (2 dtk, loop)
    T = [0, 0.5, 1.0, 1.5, 2.0]
    g.animation("idle", [
        (hips, "translation", T, [ys(.95), ys(.97), ys(.95), ys(.97), ys(.95)]),
        (n_head, "rotation", T, [qy(0), qy(.18), qy(0), qy(-.18), qy(0)]),
        (n_al, "rotation", T, [qz(.05), qz(.12), qz(.05), qz(.12), qz(.05)]),
        (n_ar, "rotation", T, [qz(-.05), qz(-.12), qz(-.05), qz(-.12), qz(-.05)]),
    ])
    # walk: jalan di tempat (1 dtk, loop)
    T = [0, 0.25, 0.5, 0.75, 1.0]
    sw = .75
    g.animation("walk", [
        (hips, "translation", T, [ys(.95), ys(.99), ys(.95), ys(.99), ys(.95)]),
        (n_ll, "rotation", T, [qx(sw), qx(0), qx(-sw), qx(0), qx(sw)]),
        (n_lr, "rotation", T, [qx(-sw), qx(0), qx(sw), qx(0), qx(-sw)]),
        (n_al, "rotation", T, [qx(-.55), qx(0), qx(.55), qx(0), qx(-.55)]),
        (n_ar, "rotation", T, [qx(.55), qx(0), qx(-.55), qx(0), qx(.55)]),
        (n_head, "rotation", T, [qy(.08), qy(0), qy(-.08), qy(0), qy(.08)]),
    ])
    # wave: lengan kanan terangkat dan melambai (1,6 dtk, loop)
    T = [0, 0.3, 0.55, 0.8, 1.05, 1.3, 1.6]
    g.animation("wave", [
        (n_ar, "rotation", T, [qz(0), qz(2.7), qz(2.3), qz(2.9), qz(2.3), qz(2.9), qz(0)]),
        (n_head, "rotation", T, [qz(0), qz(.12), qz(.12), qz(.12), qz(.12), qz(.12), qz(0)]),
        (hips, "translation", T, [ys(.95), ys(.97), ys(.95), ys(.97), ys(.95), ys(.97), ys(.95)]),
        (n_al, "rotation", T, [qz(.05), qz(.1), qz(.05), qz(.1), qz(.05), qz(.1), qz(.05)]),
    ])
    g.save(path, [root])


def make_city(path):
    g = GLB()
    mats = [g.material((0.35, 0.45, 0.85), 0.3, 0.5),
            g.material((0.9, 0.5, 0.3), 0.3, 0.5),
            g.material((0.3, 0.8, 0.7), 0.3, 0.5)]
    win = g.material((0, 0, 0), 0, 1, emissive=(1.0, 0.85, 0.4))
    rng = np.random.default_rng(7)
    children, per_node = [], []
    T = [i * 0.5 for i in range(7)]  # 0..3 dtk
    for gx in range(5):
        for gz in range(5):
            h = float(rng.uniform(0.8, 3.2))
            w = 0.7
            parts = [(*box(w, h, w, (0, h / 2, 0)), mats[(gx + gz) % 3]),
                     (*box(w * 0.5, 0.12, w + 0.02, (0, h * 0.7, 0)), win)]
            m = g.mesh(parts)
            n = g.node(f"B{gx}{gz}", m, t=((gx - 2) * 1.0, 0, (gz - 2) * 1.0), s=(1, 1, 1))
            children.append(n)
            per_node.append((n, float(rng.uniform(0, 1))))
    root = g.node("City", None, children=children)
    chans = []
    for n, ph in per_node:
        vals = [[1, 0.65 + 0.35 * math.sin(2 * math.pi * (t / 3.0 + ph)), 1] for t in T]
        chans.append((n, "scale", T, vals))
    g.animation("rise", chans)
    g.save(path, [root])


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "assets"
    os.makedirs(out, exist_ok=True)
    make_robot(os.path.join(out, "robot.glb"))
    make_city(os.path.join(out, "kota.glb"))
    print("OK ->", out)

// Logika sinematik murni (tanpa three.js) supaya bisa diuji di Node.
// Semua fungsi DETERMINISTIK terhadap waktu t: frame mana pun bisa dirender di shard mana pun.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, u) => a + (b - a) * u;
export const smooth = (u) => u * u * (3 - 2 * u);
export const easeOutBack = (u) => { const c1 = 1.70158, c3 = c1 + 1, x = u - 1; return 1 + c3 * x * x * x + c1 * x * x; };
// gerak kamera: hampir linear + sedikit ease, supaya TIDAK ada "diam" di ujung shot
export const camEase = (u) => lerp(u, smooth(u), 0.3);

export const FOV = 42;

export const THEMES = {
  malam:  { bg: 0x0b1030, floor: 0x151a45, grid: 0x4a63ff, accent: 0x6fd0ff, rim: 0x7a5cff, key: 2.0 },
  siang:  { bg: 0x8fd3ff, floor: 0xe8f4ff, grid: 0x5aa9e6, accent: 0xffc857, rim: 0xffffff, key: 2.6 },
  studio: { bg: 0x23232b, floor: 0x2f2f3a, grid: 0x6b6b80, accent: 0xff6b6b, rim: 0x4aa3ff, key: 2.2 },
};

export function prepareTimeline(tl) {
  for (const sc of tl.scenes) {
    sc.end = sc.start + sc.duration;
    for (const sh of sc.shots) { sh.abs0 = sc.start + sh.start; sh.abs1 = sc.start + sh.end; }
  }
  return tl;
}

export function locate(tl, t) {
  let si = tl.scenes.length - 1;
  for (let i = 0; i < tl.scenes.length; i++) if (t < tl.scenes[i].end) { si = i; break; }
  const sc = tl.scenes[si];
  let hi = sc.shots.length - 1;
  for (let j = 0; j < sc.shots.length; j++) if (t < sc.shots[j].abs1) { hi = j; break; }
  return { si, sc, hi, sh: sc.shots[hi] };
}

// jarak kamera agar seluruh model muat di frame (termasuk layar portrait 9:16)
export function fitDistance(h, w, aspect, fov = FOV) {
  const tanV = Math.tan((fov * Math.PI) / 360);
  const dH = (h * 1.3) / (2 * tanV);
  const dW = (w * 1.25) / (2 * tanV * aspect);
  return Math.max(dH, dW, 2.5);
}

// m = { D (jarak fit), h (tinggi), w (lebar) }; u = progres shot 0..1; t = waktu global
export function camParams(type, u, t, m) {
  const e = camEase(clamp(u));
  const D = m.D, H = m.h, X = m.w * 0.22;
  switch (type) {
    case "dolly_in":  return { az: lerp(0.35, 0.05, e), el: 0.10, d: D * lerp(1.55, 0.85, e), tx: 0, ty: H * 0.5, roll: 0 };
    case "dolly_out": return { az: lerp(-0.10, 0.30, e), el: 0.12, d: D * lerp(0.80, 1.50, e), tx: 0, ty: H * 0.5, roll: 0 };
    case "orbit":     return { az: lerp(-1.0, 1.0, e), el: 0.14, d: D * 1.10, tx: 0, ty: H * 0.5, roll: 0 };
    case "pan_left":  return { az: lerp(0.55, -0.55, e), el: 0.06, d: D * 1.15, tx: lerp(X, -X, e), ty: H * 0.5, roll: 0 };
    case "pan_right": return { az: lerp(-0.55, 0.55, e), el: 0.06, d: D * 1.15, tx: lerp(-X, X, e), ty: H * 0.5, roll: 0 };
    case "crane_up":  return { az: lerp(0.20, -0.20, e), el: lerp(-0.08, 0.65, e), d: D * lerp(1.35, 1.10, e), tx: 0, ty: H * 0.45, roll: 0 };
    case "low_hero":  return { az: lerp(0.35, 0.10, e), el: lerp(-0.14, -0.04, e), d: D * lerp(1.05, 0.85, e), tx: 0, ty: H * 0.62, roll: lerp(0.07, -0.03, e) };
    case "close_up":  return { az: lerp(-0.25, 0.25, e), el: 0.05, d: D * lerp(0.62, 0.50, e), tx: 0, ty: H * 0.78, roll: 0 };
    default:          return { az: 0.12 + 0.07 * Math.sin(t * 0.8), el: 0.10, d: D * 1.15, tx: 0, ty: H * 0.5, roll: 0 }; // "static" tetap hidup
  }
}

// posisi kamera dari parameter + guncangan tangan halus (handheld)
export function camPosition(p, t, D) {
  const cosE = Math.cos(p.el), s = D * 0.006;
  const shx = (Math.sin(t * 2.3) + Math.sin(t * 3.7 + 1.1)) * s;
  const shy = (Math.sin(t * 2.9 + 0.4) + Math.sin(t * 4.1)) * s;
  return {
    x: p.tx + p.d * Math.sin(p.az) * cosE + shx,
    y: Math.max(0.25, p.ty + p.d * Math.sin(p.el) + shy),   // jangan sampai menembus lantai
    z: p.d * Math.cos(p.az) * cosE,
  };
}

// kata terakhir yang sudah mulai diucapkan + denyut "beat" yang meluruh
export function beatInfo(sc, local) {
  let idx = -1;
  for (let i = 0; i < sc.words.length; i++) if (sc.words[i].t0 <= local) idx = i; else break;
  const beat = idx < 0 ? 0 : Math.exp(-(local - sc.words[idx].t0) * 9);
  return { idx, beat };
}

export function captionChunk(sc, idx, group = 3) {
  const i = Math.max(0, idx);
  const start = Math.floor(i / group) * group;
  return { start, words: sc.words.slice(start, start + group) };
}

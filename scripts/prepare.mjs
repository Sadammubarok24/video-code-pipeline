// Tahap 1 (GitHub Actions): scenes.json -> suara (TTS) -> timeline.json + voice.wav
//
// Prinsip "tanpa jeda tak bermakna":
//  - durasi scene = panjang suara yang SUDAH dipotong heningnya (+ jeda napas 0,08 dtk), bukan angka tebakan LLM
//  - setiap scene dipecah jadi 2-3 shot; shot tidak pernah lebih lama dari MAX_SHOT
//  - cut dijatuhkan tepat di awal kata (sinkron dengan narasi) + efek suara "whoosh"
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { readGlbInfo } from "./glb.mjs";

const FPS = 30;
const draft = process.env.DRAFT === "true";
const W = draft ? 540 : 1080;
const H = draft ? 960 : 1920;
const VOICE = process.env.TTS_VOICE || "id-ID-ArdiNeural";
const RATE = process.env.TTS_RATE || "+8%";
const GAP = 0.08;          // jeda napas antar kalimat (detik)
const MAX_TOTAL = 59.5;    // batas keras 60 dtk
const MIN_SHOT = 1.3, MAX_SHOT = 2.6;
const CAM_CYCLE = ["dolly_in", "orbit", "crane_up", "pan_left", "low_hero", "close_up", "dolly_out", "pan_right"];
const SFX = process.env.SFX !== "false";

const run = (cmd, args, opt = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opt }).toString();
const probe = (f) => parseFloat(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]));
const fail = (msg) => { console.error("GAGAL: " + msg); process.exit(1); };

const data = JSON.parse(Buffer.from(process.env.SCENES_B64, "base64").toString("utf8"));
const scenes = data.scenes;
if (!Array.isArray(scenes) || !scenes.length) fail("scenes kosong");

// ---- 1. cek aset SEBELUM membuang waktu untuk TTS ----
const clipsOf = {};
const missing = [];
for (const s of scenes) for (const sh of s.shots || []) {
  if (clipsOf[sh.model]) continue;
  const f = "assets/" + sh.model;
  if (!fs.existsSync(f)) { missing.push(sh.model); clipsOf[sh.model] = []; continue; }
  clipsOf[sh.model] = readGlbInfo(f).animations;
}
if (missing.length) {
  const have = fs.existsSync("assets") ? fs.readdirSync("assets").filter((x) => x.endsWith(".glb")) : [];
  fail(`file model tidak ada di assets/: ${[...new Set(missing)].join(", ")}. Yang tersedia: ${have.join(", ") || "(kosong)"}`);
}

fs.mkdirSync("build/audio", { recursive: true });

// ---- 2. TTS + potong hening awal/akhir ----
const raw = scenes.map((s, i) => {
  const n = String(i).padStart(2, "0");
  const base = `build/audio/${n}`;
  fs.writeFileSync(`${base}.txt`, s.narration);
  run("edge-tts", ["--voice", VOICE, `--rate=${RATE}`, "--file", `${base}.txt`, "--write-media", `${base}.mp3`]);
  const trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02";
  run("ffmpeg", ["-y", "-i", `${base}.mp3`, "-af", `${trim},areverse,${trim},areverse,aresample=44100`, "-ac", "2", `${base}.raw.wav`]);
  const dur = probe(`${base}.raw.wav`);
  if (!(dur > 0.3)) fail(`suara scene ${i + 1} terlalu pendek/kosong (${dur})`);
  return { n, base, dur };
});

// ---- 3. jika total > 60 dtk, percepat suara secukupnya (maks 1,35x) ----
const rawTotal = raw.reduce((a, r) => a + r.dur + GAP, 0);
const factor = Math.max(1, rawTotal / MAX_TOTAL);
if (factor > 1.35) fail(`narasi terlalu panjang: ${rawTotal.toFixed(1)} dtk (butuh percepatan ${factor.toFixed(2)}x). Persingkat narasi.`);
if (factor > 1) console.log(`Suara dipercepat ${factor.toFixed(3)}x agar muat 60 dtk`);

// ---- 4. susun timeline ----
let startFrame = 0;
const timeline = [], wavList = [];
const cuts = [];   // waktu absolut tiap cut (untuk SFX)

scenes.forEach((s, i) => {
  const r = raw[i];
  const speech = r.dur / factor;
  const frames = Math.ceil((speech + GAP) * FPS);
  const d = frames / FPS;

  const af = (factor > 1 ? `atempo=${factor.toFixed(4)},` : "") + `apad=whole_dur=${d.toFixed(4)}`;
  run("ffmpeg", ["-y", "-i", `${r.base}.raw.wav`, "-af", af, "-t", d.toFixed(4), "-ar", "44100", "-ac", "2", `${r.base}.wav`]);
  wavList.push(`file '${r.n}.wav'`);

  // waktu tiap kata (proporsional jumlah huruf) -> caption kata-per-kata & denyut "beat"
  const toks = s.narration.trim().split(/\s+/);
  const wts = toks.map((w) => w.length + 2);
  const sum = wts.reduce((a, b) => a + b, 0);
  let acc = 0;
  const words = toks.map((w, k) => {
    const t0 = (acc / sum) * speech; acc += wts[k];
    return { w, t0: +t0.toFixed(3), t1: +((acc / sum) * speech).toFixed(3) };
  });

  // pecah jadi shot: jumlah ditentukan agar tiap shot 1,3-2,6 dtk
  const given = s.shots && s.shots.length ? s.shots : [{ model: Object.keys(clipsOf)[0], animation: "", camera: "static" }];
  let n = Math.max(1, Math.min(given.length, Math.floor(d / MIN_SHOT)));
  n = Math.max(n, Math.ceil(d / MAX_SHOT));
  const bounds = [0];
  for (let k = 1; k < n; k++) {
    const target = (k * d) / n;
    let best = target, bd = 0.35;           // tempel ke awal kata terdekat (maks geser 0,35 dtk)
    for (const w of words) { const dd = Math.abs(w.t0 - target); if (dd < bd) { bd = dd; best = w.t0; } }
    const prev = bounds[bounds.length - 1];
    bounds.push(best - prev >= 1.0 && d - best >= 1.0 ? best : target);
  }
  bounds.push(d);

  const shots = [];
  for (let k = 0; k < n; k++) {
    const src = given[k % given.length];
    let camera = src.camera;
    if (k >= given.length) camera = CAM_CYCLE[(CAM_CYCLE.indexOf(src.camera) + 1 + k) % CAM_CYCLE.length];
    if (k > 0 && camera === shots[k - 1].camera) camera = CAM_CYCLE[(CAM_CYCLE.indexOf(camera) + 2) % CAM_CYCLE.length];
    const clips = clipsOf[src.model];
    let animation = src.animation || "";
    if (clips.length && !clips.includes(animation)) {
      console.warn(`Scene ${i + 1}: clip "${animation}" tidak ada di ${src.model}, pakai "${clips[0]}"`);
      animation = clips[0];
    }
    if (!clips.length) animation = "";
    shots.push({ start: +bounds[k].toFixed(3), end: k === n - 1 ? d : +bounds[k + 1].toFixed(3), model: src.model, animation, camera });
    if (i > 0 || k > 0) cuts.push((startFrame / FPS) + bounds[k]);
  }

  timeline.push({
    id: i + 1, start: startFrame / FPS, startFrame, frames, duration: d,
    background: s.background, text_overlay: s.text_overlay || "", narration: s.narration, words, shots,
  });
  startFrame += frames;
});

const totalSec = startFrame / FPS;
console.log(`Total ${totalSec.toFixed(1)} dtk, ${startFrame} frame, ${timeline.reduce((a, s) => a + s.shots.length, 0)} shot, ${cuts.length} cut`);
if (totalSec > 60) fail(`${totalSec.toFixed(1)} dtk melebihi 60 dtk`);
if (totalSec < 30) console.warn(`PERINGATAN: video hanya ${totalSec.toFixed(1)} dtk (target 40-60). Narasi terlalu pendek.`);

// ---- 5. suara akhir: gabung + whoosh di tiap cut ----
fs.writeFileSync("build/audio/list.txt", wavList.join("\n"));
run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", "build/audio/list.txt", "-c", "copy", "build/voice_dry.wav"]);

let mixed = false;
if (SFX && cuts.length) {
  try {
    run("ffmpeg", ["-y", "-f", "lavfi", "-i", "anoisesrc=d=0.45:c=pink:a=0.6:r=44100",
      "-af", "highpass=f=500,lowpass=f=7000,afade=t=in:d=0.18,afade=t=out:st=0.2:d=0.25,volume=0.55,aformat=channel_layouts=stereo", "build/whoosh.wav"]);
    const N = cuts.length;
    const parts = [];
    if (N === 1) parts.push(`[1:a]adelay=${Math.max(0, Math.round((cuts[0] - 0.12) * 1000))}|${Math.max(0, Math.round((cuts[0] - 0.12) * 1000))}[d0]`);
    else {
      parts.push(`[1:a]asplit=${N}${cuts.map((_, k) => `[s${k}]`).join("")}`);
      cuts.forEach((c, k) => { const ms = Math.max(0, Math.round((c - 0.12) * 1000)); parts.push(`[s${k}]adelay=${ms}|${ms}[d${k}]`); });
    }
    parts.push(`[0:a]${cuts.map((_, k) => `[d${k}]`).join("")}amix=inputs=${N + 1}:normalize=0:duration=first,alimiter=limit=0.95[a]`);
    run("ffmpeg", ["-y", "-i", "build/voice_dry.wav", "-i", "build/whoosh.wav", "-filter_complex", parts.join(";"), "-map", "[a]", "-ar", "44100", "-ac", "2", "build/voice.wav"]);
    mixed = true;
  } catch (e) {
    console.warn("SFX gagal, pakai suara tanpa efek:", String(e.stderr || e.message).slice(-300));
  }
}
if (!mixed) fs.copyFileSync("build/voice_dry.wav", "build/voice.wav");

fs.writeFileSync("build/timeline.json",
  JSON.stringify({ fps: FPS, width: W, height: H, total: totalSec, totalFrames: startFrame, scenes: timeline }, null, 2));
console.log("timeline.json siap");

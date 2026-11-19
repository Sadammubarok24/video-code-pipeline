// Tahap 1 (di GitHub Actions): scenes.json -> suara (TTS) -> timeline.json + voice.wav
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const FPS = 30;
const draft = process.env.DRAFT === "true";
const W = draft ? 540 : 1080;
const H = draft ? 960 : 1920;
const VOICE = process.env.TTS_VOICE || "id-ID-ArdiNeural";

const data = JSON.parse(Buffer.from(process.env.SCENES_B64, "base64").toString("utf8"));
const scenes = data.scenes;
fs.mkdirSync("build/audio", { recursive: true });

let startFrame = 0;
const timeline = [];
const wavList = [];

scenes.forEach((s, i) => {
  const n = String(i).padStart(2, "0");
  const txt = `build/audio/${n}.txt`;
  const mp3 = `build/audio/${n}.mp3`;
  const wav = `build/audio/${n}.wav`;
  fs.writeFileSync(txt, s.narration);

  execFileSync("edge-tts", ["--voice", VOICE, "--file", txt, "--write-media", mp3], { stdio: "inherit" });

  const audioSec = parseFloat(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3]).toString()
  );
  // durasi scene = yang terpanjang antara rencana LLM dan panjang suara (+0,5 detik jeda)
  const frames = Math.ceil(Math.max(s.duration, audioSec + 0.5) * FPS);
  const sec = frames / FPS;

  execFileSync("ffmpeg", ["-y", "-i", mp3, "-af", `apad=whole_dur=${sec.toFixed(4)}`, "-t", sec.toFixed(4), "-ar", "44100", "-ac", "2", wav], { stdio: "ignore" });
  wavList.push(`file '${n}.wav'`);

  timeline.push({
    id: i + 1,
    start: startFrame / FPS,
    startFrame,
    frames,
    duration: sec,
    model: s.model,
    animation: s.animation || "",
    camera: s.camera,
    background: s.background,
    text_overlay: s.text_overlay || "",
    narration: s.narration,
  });
  startFrame += frames;
});

const totalSec = startFrame / FPS;
console.log(`Total durasi setelah sinkron suara: ${totalSec.toFixed(1)} detik, ${startFrame} frame`);
if (totalSec > 60) {
  console.error(`GAGAL: ${totalSec.toFixed(1)} detik melebihi 60 detik. Persingkat narasi.`);
  process.exit(1);
}

fs.writeFileSync("build/audio/list.txt", wavList.join("\n"));
execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", "build/audio/list.txt", "-c", "copy", "build/voice.wav"], { stdio: "ignore" });
fs.writeFileSync(
  "build/timeline.json",
  JSON.stringify({ fps: FPS, width: W, height: H, total: totalSec, totalFrames: startFrame, scenes: timeline }, null, 2)
);

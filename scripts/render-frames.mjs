// Tahap 2 (matrix, tiap shard = 1 job): render potongan frame -> segmen mp4 tanpa suara
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import puppeteer from "puppeteer";

const SHARD = parseInt(process.env.SHARD || "0", 10);
const SHARDS = parseInt(process.env.SHARDS || "1", 10);
const tl = JSON.parse(fs.readFileSync("build/timeline.json", "utf8"));

const per = Math.ceil(tl.totalFrames / SHARDS);
const from = SHARD * per;
const to = Math.min(tl.totalFrames, from + per);
if (from >= to) {
  console.log(`Shard ${SHARD}: tidak ada frame.`);
  process.exit(0);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".png": "image/png", ".jpg": "image/jpeg", ".bin": "application/octet-stream" };
const ROUTES = [
  ["/vendor/three/", "node_modules/three/"],
  ["/assets/", "assets/"],
  ["/build/", "build/"],
  ["/", "web/"],
];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const [prefix, dir] = ROUTES.find(([p]) => url.startsWith(p));
  const file = path.normalize(path.join(dir, url.slice(prefix.length) || "index.html"));
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});
const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.error("[page error]", e.message));
await page.setViewport({ width: tl.width, height: tl.height, deviceScaleFactor: 1 });
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForFunction("window.ready === true", { timeout: 180000 });

const out = `build/seg-${SHARD}.mp4`;
const ff = spawn("ffmpeg", ["-y", "-f", "image2pipe", "-framerate", String(tl.fps), "-vcodec", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(tl.fps), out], { stdio: ["pipe", "ignore", "inherit"] });
const ffDone = once(ff, "close");

console.log(`Shard ${SHARD}: frame ${from}-${to - 1} dari ${tl.totalFrames}`);
const t0 = Date.now();
for (let f = from; f < to; f++) {
  await page.evaluate((t) => window.renderFrame(t), f / tl.fps);
  const buf = await page.screenshot({ type: "jpeg", quality: 95 });
  if (!ff.stdin.write(buf)) await once(ff.stdin, "drain");
  if ((f - from) % 60 === 0) console.log(`  frame ${f} (${((Date.now() - t0) / 1000).toFixed(0)} dtk)`);
}
ff.stdin.end();
const [code] = await ffDone;
await browser.close();
server.close();
if (code !== 0) process.exit(code);
console.log("Selesai:", out);

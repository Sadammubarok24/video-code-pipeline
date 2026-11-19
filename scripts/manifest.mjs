// Memindai assets/*.glb -> assets/manifest.json  (dibaca Node-RED agar daftar aset selalu cocok)
// Jalankan lokal:  node scripts/manifest.mjs
import fs from "node:fs";
import path from "node:path";
import { readGlbInfo } from "./glb.mjs";

const dir = "assets";
const models = {};
for (const f of fs.readdirSync(dir).sort()) {
  if (!f.toLowerCase().endsWith(".glb")) continue;
  try {
    const info = readGlbInfo(path.join(dir, f));
    models[f] = info.animations;
    console.log(`${f}: ${info.animations.length ? info.animations.join(", ") : "(tanpa animasi)"}`);
  } catch (e) {
    console.error(`LEWATI ${f}: ${e.message}`);
  }
}
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ models }, null, 2) + "\n");
console.log(`manifest.json ditulis (${Object.keys(models).length} model)`);

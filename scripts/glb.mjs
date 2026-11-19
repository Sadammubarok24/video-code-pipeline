// Pembaca ringan file .glb (tanpa dependensi): daftar nama clip animasi + ukuran.
import fs from "node:fs";

export function readGlbInfo(file) {
  const b = fs.readFileSync(file);
  if (b.length < 20 || b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: bukan file .glb yang valid`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.toString("utf8", 20, 20 + jsonLen));
  // GLTFLoader three.js memberi nama "animation_<i>" jika clip tidak bernama
  const animations = (json.animations || []).map((a, i) => a.name || `animation_${i}`);
  return { animations, nodes: (json.nodes || []).length, meshes: (json.meshes || []).length };
}

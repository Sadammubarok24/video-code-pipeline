# video-code-pipeline v2

Node-RED -> Gemini -> GitHub Actions (Three.js + file `.glb`) -> video mp4 vertikal.

## Yang berubah dari v1

| Masalah v1 | Perbaikan v2 |
|---|---|
| Video hanya kubus biru karena `assets/` kosong, dan renderer diam-diam memakai kubus pengganti | Ada `robot.glb` dan `kota.glb` beranimasi sebagai contoh. Jika model hilang, build **gagal dengan pesan jelas** (tidak ada lagi kubus diam-diam) |
| Layar hitam 0,3 dtk di awal dan akhir tiap scene (fade) | Fade dihapus. Pergantian lewat *hard cut* + zoom-punch + flash singkat + efek suara whoosh |
| Durasi scene = tebakan LLM + 0,5 dtk hening | Durasi scene = panjang suara yang sudah dipotong heningnya + 0,08 dtk |
| 1 scene = 1 kamera, 1 gerakan lambat | 1 scene = 2-3 *shot*, tiap shot 1,3-2,6 dtk, cut jatuh tepat di awal kata |
| Kamera `static` benar-benar diam | Semua kamera selalu bergerak (+ guncangan tangan halus); `static` pun melayang pelan |
| Model hanya memutar 1 clip | Lapisan gerak tambahan: pop-in, napas, denyut tiap kata, goyang. Lantai, partikel, dan progress bar ikut bergerak |
| Tidak ada caption | Caption kata-per-kata yang menyorot kata yang sedang diucapkan |
| Daftar aset di flow harus diketik manual (salah nama = kubus) | `assets/manifest.json` dibuat otomatis, Node-RED membacanya |

## Pasang

1. Unggah **seluruh isi** folder ini ke repo GitHub publik Anda (timpa file lama).
   Pastikan `.github/workflows/render.yml` dan `.github/workflows/manifest.yml` ikut terunggah.
2. Di Node-RED: **hapus tab lama**, lalu *Import* `node-red-flow-v2.json`, lalu Deploy.
3. Token GitHub tetap sama (Actions: Read and write, Contents: Read and write).
4. Jalankan dengan `draft:true` dulu.

## Memakai model `.glb` sendiri

1. Taruh file `.glb` di `assets/` lalu commit. Workflow `manifest` otomatis memperbarui `assets/manifest.json`.
2. Atau cek lokal: `node scripts/manifest.mjs` mencetak nama model beserta nama clip animasinya.
3. Restart / Deploy ulang Node-RED supaya daftar aset dimuat ulang (GitHub menyimpan cache file raw sekitar 5 menit).

Syarat model yang bagus untuk video padat:
- Format `.glb` dengan **animasi tertanam** (idle, walk, wave, dll). Makin banyak clip, makin variatif.
- Ukuran file kecil (idealnya di bawah 20 MB) agar render cepat.
- Periksa lisensinya jika video akan dipublikasikan.

Model dinormalisasi otomatis (sisi terpanjang menjadi 2,4 unit, kaki di lantai), jadi ukuran asli model tidak masalah.
Jangan memakai tekstur yang membutuhkan ekstensi Draco/Meshopt kecuali Anda menambahkan decoder-nya ke `web/index.html`.

## Menambah kamera / tema

- Kamera ada di `camParams()` dalam `web/logic.js`. Tambah `case` baru, lalu tambahkan namanya ke `CAMERAS` di node "Daftar aset" pada flow.
- Tema warna ada di `THEMES` pada file yang sama.

## Aset contoh

`python3 tools/make-sample-glb.py assets` membuat ulang `robot.glb` dan `kota.glb` (hanya butuh numpy).

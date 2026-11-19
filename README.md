# video-code-pipeline

Repo ini dirender oleh GitHub Actions saat dipicu Node-RED.

1. Buat repo **publik** di GitHub, unggah isi folder ini (termasuk `.github/workflows/render.yml`).
2. Taruh file `.glb` di folder `assets/` (nama harus sama dengan daftar aset di flow Node-RED).
   Tanpa file .glb, renderer memakai kubus biru sebagai pengganti, jadi pipeline tetap bisa diuji.
3. Buat Personal Access Token (fine-grained) untuk repo ini dengan izin:
   Actions: Read and write, Contents: Read and write.
4. Jalankan workflow pertama dengan draft=true untuk uji cepat.

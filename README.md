# Asesmen Presentasi Virtual — Versi Vercel

Ini adalah versi deploy-able dari artifact form asesmen yang sudah dibuat di
Claude, dengan penyimpanan data diganti dari `window.storage` (khusus
environment Claude) menjadi **Supabase** (database gratis) supaya bisa jalan
di hosting biasa seperti Vercel.

## Satu link, banyak asesmen

Project ini mendukung **banyak jenis asesmen sekaligus** dari satu deployment
yang sama:

- Setiap asesmen punya link sendiri: `nama-project.vercel.app/?id=<id-asesmen>`
- Semua asesmen dikelola dari satu **Daftar Asesmen** di panel admin (buat
  baru, edit pertanyaan/kolom form, buka/tutup, lihat & export hasil, hapus)
  tanpa perlu deploy ulang atau bikin project baru
- Panel admin dilindungi **satu kode akses master** (bukan per-asesmen lagi)
- Skala penilaian tiap asesmen bisa dipilih **1–4** atau **1–5**, diatur
  sendiri-sendiri per asesmen

Cara masuk ke panel admin: buka link apa saja dari project ini (boleh tanpa
`?id=`, misal langsung `nama-project.vercel.app`), klik **Masuk sebagai
admin** di bagian bawah, masukkan kode akses (default: **1234**, segera
ganti lewat panel setelah masuk pertama kali).

## Langkah 1 — Buat database di Supabase (gratis)

1. Daftar/masuk ke https://supabase.com, buat **New Project**.
2. Setelah project jadi, buka menu **SQL Editor** > **New query**.
3. Salin isi file `supabase_schema.sql` di folder ini, tempel, lalu klik **Run**.
   Ini akan membuat tabel `kv_store` tempat semua data (pengaturan form &
   jawaban audiens) disimpan.
4. Buka menu **Settings > API**. Catat dua hal ini:
   - **Project URL**
   - **anon public key**

## Langkah 2 — Isi environment variable

1. Salin file `.env.example` menjadi `.env.local`.
2. Isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` dengan nilai dari Langkah 1.

## Langkah 3 — Coba jalan di komputer sendiri (opsional tapi disarankan)

```bash
npm install
npm run dev
```

Buka `http://localhost:5173`, klik **Masuk sebagai admin** (kode akses
default: **1234**), buat satu asesmen contoh, lalu buka linknya
(`?id=<id-yang-dibuat>`) di tab baru untuk coba isi form-nya.

## Langkah 4 — Push ke GitHub

Buat repository baru di GitHub, lalu push semua file di folder ini (folder
`node_modules` dan `.env.local` tidak usah ikut, sudah otomatis diabaikan
lewat `.gitignore`).

```bash
git init
git add .
git commit -m "Asesmen presentasi virtual"
git branch -M main
git remote add origin <url-repo-github-anda>
git push -u origin main
```

## Langkah 5 — Deploy ke Vercel

1. Masuk ke https://vercel.com, klik **New Project**, pilih repo GitHub yang
   baru dibuat.
2. Vercel otomatis mendeteksi ini project Vite — biarkan pengaturan build
   default (`npm run build`, output folder `dist`).
3. Sebelum klik Deploy, buka bagian **Environment Variables**, tambahkan:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   (nilainya sama seperti di `.env.local`)
4. Klik **Deploy**. Setelah selesai, Anda dapat link seperti
   `nama-project.vercel.app` — inilah yang dibagikan ke audiens.

## Judul thumbnail link (WhatsApp/Telegram/dll) otomatis ikut admin panel

Project ini sudah dilengkapi `middleware.js` yang jalan otomatis di Vercel
(Edge Middleware). Saat link dibuka oleh bot pembuat preview (WhatsApp,
Telegram, Facebook, dll — dikenali dari user-agent-nya), server akan
mengambil judul & subjudul terbaru langsung dari Supabase dan mengirimkannya
sebagai judul thumbnail. Jadi begitu Anda ganti judul di panel admin, link
yang sama otomatis menampilkan judul baru di thumbnail — tidak perlu
redeploy manual lagi.

Tidak ada langkah tambahan yang perlu dilakukan — middleware ini otomatis
aktif begitu di-deploy ke Vercel, dan memakai environment variable yang sama
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) yang sudah Anda isi di
Langkah 5.

Catatan: aplikasi WhatsApp/Telegram biasanya nge-cache thumbnail lama untuk
link yang sama selama beberapa waktu. Kalau setelah ganti judul thumbnail
masih menampilkan yang lama, coba kirim link dengan sedikit tambahan di
akhir (misal `?v=2`) supaya dianggap link baru dan cache lama dilewati.

## Catatan penting soal keamanan

Tabel Supabase di sini dibuat **terbuka** (siapa saja yang tahu Project URL +
anon key bisa baca/tulis lewat API Supabase langsung), karena app ini tidak
pakai sistem login sungguhan — proteksi admin hanya berupa kode akses di
level tampilan (UI), bukan di level database. Anon key juga otomatis
"terlihat" di kode yang di-load browser (ini normal untuk semua app berbasis
Supabase tanpa backend sendiri, bukan bug).

Untuk kebutuhan training internal, ini biasanya cukup aman karena tidak ada
insentif orang iseng mengutak-atik. Kalau nanti datanya jadi lebih sensitif
(misal ada data pribadi lengkap), beri tahu saya — bisa ditambah proteksi
lapis kedua (Supabase Auth atau serverless function) supaya penulisan data
tidak langsung terbuka ke publik.

## Struktur file

```
src/
  App.jsx            — komponen utama: form audiens, daftar asesmen, panel admin per-asesmen
  main.jsx           — entry point React
  supabaseClient.js  — koneksi ke Supabase
  lib/storage.js      — pengganti window.storage, baca/tulis ke Supabase
middleware.js         — Edge Middleware, judul thumbnail otomatis per asesmen
supabase_schema.sql  — script bikin tabel di Supabase
.env.example         — contoh env var yang perlu diisi
```

## Skema penyimpanan data (untuk referensi)

- `assessment:<id>` — pengaturan satu asesmen (judul, pertanyaan, kolom form, skala, status buka/tutup)
- `resp:<id>:<timestamp>-<random>` — satu baris jawaban audiens untuk asesmen `<id>`
- `master-admin` — kode akses panel admin (berlaku untuk semua asesmen)

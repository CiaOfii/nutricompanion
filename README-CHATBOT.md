# NutriCompanion — Chatbot Gemini dan Deploy

Website asli dipertahankan. Backend chatbot memakai Node.js dan Google Gemini API; API key tidak boleh ditaruh di HTML/JavaScript browser.

## Jalankan lokal (Windows)
1. Pasang Node.js 22.9 atau lebih baru.
2. Salin `.env.example` menjadi `.env`.
3. Buka `.env` dan ganti `PASTE_API_KEY_BARU_DI_SINI` dengan API key baru dari Google AI Studio. Jangan unggah `.env` ke GitHub.
4. Di terminal, masuk ke folder yang berisi `package.json`, lalu jalankan `npm start`.
5. Buka `http://localhost:3000`. Cek backend lewat `http://localhost:3000/api/health`.

`npm start` memakai `.env` bila file itu ada. Pada hosting, variabel dapat diatur melalui dashboard sehingga file `.env` lokal tidak dibutuhkan.

## Deploy ke Render
1. Simpan folder proyek ini ke repository GitHub milikmu, tetapi pastikan `.env` tidak ikut di-commit (`.gitignore` sudah mengecualikannya).
2. Di Render, buat **New + → Blueprint** dan pilih repository. Render akan membaca `render.yaml`; atau buat Web Service dengan Build Command `npm install` dan Start Command `npm start`.
3. Pada Environment Variables service, tambahkan `GEMINI_API_KEY` dengan API key baru. `GEMINI_MODELS` dapat memakai `gemini-3.8-flash,gemini-3.5-flash,gemini-3.1-flash-lite`.
4. Deploy, lalu buka URL HTTPS yang diberikan Render dan coba kirim pesan di chatbot. Periksa `/api/health` untuk memastikan backend hidup.

## Jika chatbot gagal
- Baca pesan error yang muncul di chat dan log service pada Render. Backend sekarang mencatat model, status HTTP, dan error koneksi tanpa mencetak API key.
- `404`: model tidak tersedia untuk API key tersebut; sesuaikan `GEMINI_MODELS` dengan model yang terdaftar dan mendukung `generateContent`.
- `403`: periksa akses API/key/project. `429`: periksa kuota dan batas penggunaan. Error jaringan: periksa koneksi keluar server.
- Jangan pernah membagikan API key atau menyimpan key di file HTML/JavaScript publik.

## Catatan hosting
Gunakan hosting yang mendukung aplikasi Node.js, bukan static-only hosting, karena `/api/chat` harus berjalan di backend.

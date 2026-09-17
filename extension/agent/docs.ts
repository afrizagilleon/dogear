/**
 * extension/agent/docs.ts
 * AGENTS.md document template written to notebook project store (A1-T4, RQ-08, D-7).
 */

export const AGENTS_MD_CONTENT = `# Protokol Integrasi Agent dogear

Dokumen ini menjelaskan cara bagi agen otomatis (coding assistant, script eksternal, proses AI) untuk berinteraksi dengan **dogear** melalui filesystem lokal tanpa memerlukan server, WebSocket, atau socket port khusus.

---

## 1. Antarmuka Folder

dogear berkomunikasi melalui struktur folder project:

\`\`\`text
<project-root>/
├── notebook.md                  # Definisi urutan dan konfigurasi steps
├── steps/                       # Berkas kode step (*.js)
├── requests/                    # INBOX: Tempat agen menulis request baru
│   └── processed/               # ARSIP: Request yang telah selesai diproses dipindahkan ke sini
└── runs/                        # OUTBOX: Hasil eksekusi setiap run (JSON terurut waktu)
\`\`\`

---

## 2. Mengirim Request Eksekusi (\`requests/*.json\`)

Untuk meminta eksekusi suatu step pada browser, buat satu berkas JSON di dalam folder \`requests/\` (misalnya \`requests/req-01.json\`).

### Format Request
\`\`\`json
{
  "stepId": "steps/01-init.js",
  "host": "localhost:3000",
  "data": {
    "key": "value"
  }
}
\`\`\`

### Penjelasan Field
- **\`stepId\`** (*string*, wajib): ID step atau path file step sebagaimana didefinisikan pada \`notebook.md\`.
- **\`host\`** (*string*, opsional): Host domain tab browser tempat step dieksekusi (contoh: \`localhost:3000\`, \`127.0.0.1:8080\`). Jika tidak diisi, ekstensi akan menargetkan tab aktif.
- **\`data\`** (*object*, opsional): Payload data awal yang ingin diteruskan ke konteks runtime \`ctx.data\`.

---

## 3. Siklus Pemrosesan & Pemindahan Request

1. Ekstensi dogear memantau kemunculan berkas \`*.json\` di dalam folder \`requests/\`.
2. Saat request terdeteksi:
   - Ekstensi memvalidasi keberadaan step dan izin situs pada Site Registry.
   - Ekstensi mengeksekusi step pada tab target melalui kernel service.
   - Ekstensi menulis berkas hasil eksekusi ke \`runs/\`.
3. Setelah selesai (baik sukses maupun gagal), berkas request **dipindahkan** dari \`requests/<nama-file>\` ke \`requests/processed/<nama-file>\`.

> **Catatan Penting:** Request tidak pernah dihapus tanpa jejak. Keberadaan berkas di \`requests/processed/\` menandakan request telah selesai dieksekusi oleh ekstensi.

---

## 4. Membaca Hasil Eksekusi (\`runs/*.json\`)

Setiap eksekusi step (dari agen, panel UI, pintasan keyboard, maupun mode otomatis) menghasilkan tepat satu berkas laporan JSON di dalam folder \`runs/\`.

Nama berkas selalu terurut waktu: \`runs/<ISO-Timestamp>_<StepId>.json\` (contoh: \`runs/2026-09-01T12-00-00-000Z_01-init.js.json\`).

### Contoh Hasil Sukses
\`\`\`json
{
  "stepId": "1. Initialize Data",
  "startedAt": "2026-09-01T12:00:00.000Z",
  "completedAt": "2026-09-01T12:00:00.015Z",
  "status": "ok",
  "result": 42,
  "output": "42",
  "error": null,
  "host": "localhost:3000"
}
\`\`\`

### Contoh Hasil Gagal (Dengan Sebab & Tindakan)
\`\`\`json
{
  "stepId": "2. Failing Step",
  "startedAt": "2026-09-01T12:00:01.000Z",
  "completedAt": "2026-09-01T12:00:01.008Z",
  "status": "error",
  "output": "✖ TypeError: Database connection lost\\n  Sebab: Eksepsi dilempar saat mengeksekusi step.\\n  Tindakan: Periksa logika pada kode step atau tangani error dengan blok try/catch.",
  "error": {
    "name": "TypeError",
    "message": "Database connection lost",
    "stack": "TypeError: Database connection lost\\n    at ...",
    "cause": "Eksepsi dilempar saat mengeksekusi step.",
    "action": "Periksa logika pada kode step atau tangani error dengan blok try/catch."
  },
  "host": "localhost:3000"
}
\`\`\`

---

## 5. Model Kepercayaan & Keamanan

1. **Batas Folder:** Siapa pun dan proses apa pun yang memiliki akses baca-tulis ke folder project di disk dapat mengirimkan request.
2. **Penjaga Site Registry:** Eksekusi script oleh agen **wajib terdaftar di Site Registry**. Ekstensi menolak request untuk host yang belum didaftarkan oleh pengguna melalui UI panel dengan error \`SiteNotRegisteredError\`.
3. **Tanpa Server / Socket Terbuka:** Tidak ada port jaringan, WebSocket, atau server lokal yang dibuka oleh ekstensi. Semua komunikasi bersifat pasif melalui berkas JSON.

---

## 6. Batasan Platform Browser

- **Google Chrome / Chromium:** Didukung penuh menggunakan File System Access API (\`showDirectoryPicker\`).
- **Mozilla Firefox:** Saat ini integrasi filesystem eksternal terbatas karena Firefox belum mendukung File System Access API untuk direktori lokal. Mode disk saat ini dikhususkan untuk lingkungan berbasis Chromium.

---

## 7. Perilaku Service Worker Sleep & Lifecycle

1. **Watcher Berbasis Interval:** Watcher produk berjalan di context ekstensi dengan interval polling default \`300ms\`.
2. **Kondisi Tidur Service Worker (Chromium MV3):** Saat browser tidak memiliki panel aktif yang terbuka dan tidak ada event runtime, Service Worker MV3 akan memasuki status sleep. Menulis berkas ke folder \`requests/\` **tidak** membangunkan Service Worker secara otomatis.
3. **Jaminan Request Tidak Hilang:** Berkas request yang ditulis saat Service Worker tidur tetap tersimpan aman di antrean \`requests/\`. Begitu Service Worker bangun (dipicu oleh pembukaan side panel, interaksi pengguna, event navigasi tab, atau pemanggilan runtime), watcher akan segera memproses semua request tertunda yang menumpuk dan memindahkannya ke \`requests/processed/\`.
`;

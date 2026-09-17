/**
 * extension/native/fixtures.ts
 * Four canonical notebook fixtures representing the four terminal execution states (T-02, RQ-02, RQ-03, D-1, D-2, D-3).
 * Written from human author perspective before bridge implementation.
 */

import type { TerminalState } from './types';

export interface ExampleNotebookFixture {
  id: string;
  name: string;
  description: string;
  expectedState: TerminalState;
  markdown: string;
  files: Record<string, string>;
}

/**
 * 1. State: COMPLETED
 * Seluruh cell lewat dan validasi lolos. Alur standar pesanan tuntas.
 */
export const NOTEBOOK_COMPLETED: ExampleNotebookFixture = {
  id: 'nb-01-completed',
  name: 'Proses Pesanan Toko',
  description: 'Alur pemrosesan pesanan standar dari pengambilan hingga konfirmasi sukses.',
  expectedState: 'completed',
  markdown: `---
name: "Proses Pesanan Toko"
steps:
  - path: "steps/01-ambil-pesanan.js"
    name: "Ambil Pesanan Baru"
  - path: "steps/02-konfirmasi.js"
    name: "Konfirmasi dan Selesaikan"
---

# Alur Pesanan Selesai
Notebook ini berjalan normal hingga seluruh langkah selesai diproses.
Mencapai keadaan akhir: completed.
`,
  files: {
    'steps/01-ambil-pesanan.js': `// steps/01-ambil-pesanan.js
// Mengambil data pesanan dan menyimpannya ke ctx.data
ctx.data.nomorPesanan = 'INV-2026-0901';
ctx.data.itemCount = 3;
print('Pesanan ditemukan:', ctx.data.nomorPesanan);
return { status: 'completed', data: { nomorPesanan: ctx.data.nomorPesanan } };
`,
    'steps/02-konfirmasi.js': `// steps/02-konfirmasi.js
// Memvalidasi pemrosesan dan menyelesaikan pipeline
if (ctx.data.nomorPesanan && ctx.data.itemCount > 0) {
  ctx.data.statusPemrosesan = 'SUKSES';
  print('Pesanan berhasil diproses:', ctx.data.nomorPesanan);
  return { status: 'completed', data: { statusPemrosesan: 'SUKSES', nomorPesanan: ctx.data.nomorPesanan } };
}
throw new Error('Data pesanan tidak lengkap untuk konfirmasi');
`,
  },
};

/**
 * 2. State: SKIPPED
 * Cell memeriksa keadaan dan memutuskan memang tidak perlu diproses (antrian kosong).
 */
export const NOTEBOOK_SKIPPED: ExampleNotebookFixture = {
  id: 'nb-02-skipped',
  name: 'Pengecekan Antrian Harian',
  description: 'Alur pemeriksaan antrian harian. Menyatakan dilewati jika tidak ada tugas baru.',
  expectedState: 'skipped',
  markdown: `---
name: "Pengecekan Antrian Harian"
steps:
  - path: "steps/01-cek-antrian.js"
    name: "Periksa Antrian Pesanan"
---

# Alur Pengecekan Antrian
Notebook ini memeriksa apakah ada antrian pesanan baru.
Bila tidak ada antrian, langkah menyatakan dilewati.
Mencapai keadaan akhir: skipped.
`,
  files: {
    'steps/01-cek-antrian.js': `// steps/01-cek-antrian.js
// Memeriksa antrian pesanan. Jika kosong, nyatakan dilewati.
const jumlahAntrian = 0; // simulasi: antrian kosong
print('Memeriksa antrian pesanan... Jumlah pending:', jumlahAntrian);

if (jumlahAntrian === 0) {
  const reason = 'Tidak ada pesanan baru dalam antrian hari ini';
  return { status: 'skipped', reason };
}

ctx.data.lanjut = true;
return { status: 'completed' };
`,
  },
};

/**
 * 3. State: NEEDS_REVIEW
 * Terjadi anomali atau perbedaan nominal yang memerlukan verifikasi manual staf.
 */
export const NOTEBOOK_NEEDS_REVIEW: ExampleNotebookFixture = {
  id: 'nb-03-needs-review',
  name: 'Rekonsiliasi Nominal Tagihan',
  description: 'Alur rekonsiliasi yang menemukan selisih saldo sehingga dialihkan ke staf.',
  expectedState: 'needs_review',
  markdown: `---
name: "Rekonsiliasi Nominal Tagihan"
steps:
  - path: "steps/01-validasi-data.js"
    name: "Validasi Kesesuaian Saldo"
---

# Alur Rekonsiliasi Tagihan
Notebook ini mendeteksi anomali selisih saldo yang tidak boleh diputuskan otomatis oleh bot.
Mencapai keadaan akhir: needs_review.
`,
  files: {
    'steps/01-validasi-data.js': `// steps/01-validasi-data.js
// Memeriksa kesesuaian saldo. Bila ada selisih, laporkan needs_review untuk intervensi manusia.
const saldoSistem = 1500000;
const saldoMutasi = 1450000;
print('Memeriksa saldo sistem vs mutasi...', { saldoSistem, saldoMutasi });

if (saldoSistem !== saldoMutasi) {
  const reason = 'Selisih saldo terdeteksi: Sistem Rp 1.500.000 vs Mutasi Rp 1.450.000 (butuh konfirmasi staf)';
  return { status: 'needs_review', reason };
}

return { status: 'completed' };
`,
  },
};

/**
 * 4. State: SESSION_DEAD
 * Form login atau cookie kedaluwarsa terdeteksi. Dikembalikan lewat jalur hasil, bukan error (D-3).
 */
export const NOTEBOOK_SESSION_DEAD: ExampleNotebookFixture = {
  id: 'nb-04-session-dead',
  name: 'Pemeriksaan Sesi Marketplace',
  description: 'Alur pemeriksaan sesi login aktif. Mengembalikan session_dead sebagai hasil kelas satu.',
  expectedState: 'session_dead',
  markdown: `---
name: "Pemeriksaan Sesi Marketplace"
steps:
  - path: "steps/01-cek-sesi.js"
    name: "Deteksi Sesi Login Aktif"
---

# Alur Pemeriksaan Sesi Marketplace
Notebook ini memeriksa apakah sesi login akun seller masih aktif.
Bila sesi habis dan form login muncul, laporkan session_dead lewat jalur hasil (bukan error).
Mencapai keadaan akhir: session_dead.
`,
  files: {
    'steps/01-cek-sesi.js': `// steps/01-cek-sesi.js
// Memeriksa keberadaan form login/password atau sesi kedaluwarsa.
// Kembalikan status session_dead sebagai hasil kelas satu (D-3, bukan lewat throw error).
const isLoginPage = true; // simulasi: halaman menampilkan form login/sesi habis
print('Memeriksa status sesi pengguna... isLoginPage:', isLoginPage);

if (isLoginPage) {
  const reason = 'Halaman login terdeteksi — sesi akun telah habis atau cookie kedaluwarsa';
  return { status: 'session_dead', reason };
}

return { status: 'completed' };
`,
  },
};

export const ALL_EXAMPLE_NOTEBOOKS: ExampleNotebookFixture[] = [
  NOTEBOOK_COMPLETED,
  NOTEBOOK_SKIPPED,
  NOTEBOOK_NEEDS_REVIEW,
  NOTEBOOK_SESSION_DEAD,
];

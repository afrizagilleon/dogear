# Sintaks dogear — menulis notebook dan step

Rujukan untuk orang yang menulis otomasi di dalam dogear. Bukan dokumen arsitektur — untuk itu
bacalah kodenya langsung di `extension/`.

Semua yang ada di sini diambil dari kode yang berjalan, bukan dari rencana. Sumber kebenarannya
disebut di tiap bagian, supaya kalau dokumen ini basi kamu tahu ke mana harus melihat.

---

## 1. Satu notebook, banyak step

Sebuah notebook adalah satu folder berisi:

```
notebook.md          <- daftar langkah dan urutannya
steps/01-buka.js     <- satu berkas per langkah
steps/02-isi.js
steps/lib/format.js  <- boleh; berkas pendukung tidak harus jadi langkah
```

`notebook.md` punya frontmatter YAML sederhana:

```markdown
---
name: "Audit kotak masuk"
steps:
  - path: "steps/01-buka.js"
    name: "Buka daftar percakapan"
  - path: "steps/02-hitung.js"
    name: "Hitung yang belum dibaca"
    enabled: false
  - path: "steps/03-lapor.js"
    world: "USER_SCRIPT"
---

Catatan bebas di bawah frontmatter. Tidak dieksekusi.
```

| kunci | wajib | bawaan | arti |
|---|---|---|---|
| `name` (atas) | tidak | `Untitled Notebook` | nama notebook |
| `path` | **ya** | — | letak berkas step, relatif ke folder notebook |
| `name` (step) | tidak | isi `path` | nama yang muncul di panel dan di laporan |
| `enabled` | tidak | `true` | `false` melewati langkah ini tanpa menghapusnya |
| `world` | tidak | `MAIN` | `MAIN` atau `USER_SCRIPT` — lihat §7 |

Langkah dijalankan **berurutan sesuai daftar**, bukan sesuai nama berkas. Mengurutkan ulang
berarti mengurutkan ulang daftar ini.

*Sumber: `extension/project/notebook-parser.ts`*

---

## 2. Berkas step adalah modul ES sungguhan

Bukan potongan teks yang ditempel. Kamu boleh `import` antar-berkas, dan `export` dari berkas
pendukung:

```js
// steps/lib/format.js
export function rupiah(n) {
  return 'Rp' + n.toLocaleString('id-ID');
}
```

```js
// steps/03-lapor.js
import { rupiah } from './lib/format.js';

print(rupiah(ctx.data.total));
```

Yang didukung: named import, default import, `import * as ns`, dan `export function` /
`export class` / `export const`. Penautannya terjadi sebelum eksekusi, dan **jejak error tetap
menunjuk ke berkas aslimu** — `steps/03-lapor.js:5:12`, bukan ke berkas gabungan.

*Sumber: `extension/project/linker.ts`*

---

## 3. Yang tersedia di dalam sel

Tujuh belas nama sudah ada tanpa perlu di-`import`. Daftar ini dikunci oleh tes dua arah — kalau
ada helper baru, dokumentasinya wajib ikut, dan sebaliknya.

### Mencari elemen

```js
$('#submit')                    // Element | null       — satu, sekarang juga
$$('a.item')                    // Element[]            — semua, sekarang juga
await waitFor('#app')           // Promise<Element>     — tunggu sampai muncul
await pick(['#ok', '.btn'])     // Promise<Element>     — kandidat pertama yang cocok
```

`$` dan `$$` **tidak menunggu**. Kalau halamannya masih memuat, keduanya mengembalikan
kosong — pakai `waitFor` atau `pick`.

**Pakai `pick`, bukan `waitFor`, untuk apa pun yang penting.** `pick` menerima daftar kandidat dan
mencatat kandidat ke berapa yang akhirnya kena. Kalau situsnya berubah dan kandidat pertama mati,
langkahmu tetap jalan dengan kandidat kedua — dan laporannya memberi tahu bahwa itu terjadi
(`[WARNING] Selector shift: matched candidate 2 of 3`). Itu peringatan dini bahwa situsnya bergeser.

Opsi untuk `waitFor` dan `pick`:

| opsi | bawaan | arti |
|---|---|---|
| `timeout` | `5000` | milidetik sebelum menyerah |
| `interval` | `50` | jeda antar-percobaan (`waitFor` saja) |
| `root` | `document` | batasi pencarian ke sub-pohon |
| `signal` | sinyal step | untuk membatalkan sendiri |

```js
await pick(['#kirim', '[aria-label="Kirim"]'], { timeout: 15000 });
```

### Bertindak

```js
await click('#submit')                  // gulir ke tampilan, periksa terhalang, lalu klik
await fill('#judul', 'Halo')            // isi teks, lalu verifikasi nilainya benar-benar masuk
await press('#q', 'Enter')              // kirim keydown/keyup ke listener halaman
await sleep(1000)                       // jeda; bisa dihentikan tombol Stop
```

Ketiganya menerima **selector, elemen, atau array kandidat** sebagai target:

```js
await click(['#kirim', 'button[type=submit]']);   // sama seperti pick, lalu klik
```

`press` menerima modifier:

```js
await press('#q', 'a', { ctrl: true });     // ctrl+a
await press(document.body, 'Escape');
```

### Berpindah dan mengelola tab (di batas langkah)

Empat helper untuk mengarahkan eksekusi antar-tab:

```js
useNewTab({ timeout: 10000 })      // langkah berikutnya berjalan di tab baru yang dibuka klik
openTab('https://example.com')     // buka URL ini di tab baru (latar), lanjut di sana
goto('https://example.com/item/2') // pindahkan tab ini ke URL lain, tunggu selesai muat
backToOpener({ close: true })      // kembali ke tab asal; tutup tab ini jika close: true
```

Aturan batas langkah (*step boundaries*):
- **Permintaan tidak langsung memindahkan halaman di tengah baris kode.** Helper mencatat permintaan pada penampung langkah, dan perpindahan tab dilakukan oleh runtime **di antara langkah saat ini dan langkah berikutnya**.
- **Maksimal satu permintaan per langkah.** Memanggil dua helper tab dalam satu langkah yang sama akan melempar error seketika.
- **Dogear tidak pernah merebut fokus.** Tab baru dibuka di latar belakang (`active: false`) dan tab yang dibuka klik dibiarkan dalam kondisi fokus bawaan Chrome tanpa merebut fokus jendela pengguna.
- **Di panel interaktif, keempat helper ini melempar error.** Otomasi multi-tab hanya berlaku pada eksekusi run notebook via jembatan native.

### Membawa data antar-langkah

```js
ctx.data.orderId = 'ORD-99';    // bertahan ke langkah berikutnya
print('halo', ctx.data);        // masuk ke riwayat keluaran step
```

### Lain-lain

```js
await gmFetch('https://example.com/api')   // HTTP lintas-domain lewat background worker
await auto.next('/halaman-berikut')        // simpan checkpoint lalu navigasi
await parkForUnload()                      // tunggu halaman benar-benar pindah
```

`gmFetch` berjalan di background worker, jadi ia **tidak terkena CORS**. Itu satu-satunya cara
memanggil domain lain dari dalam sel.

*Sumber: `RUNTIME_HELPERS` di `extension/kernel/helpers.ts`*

---

## 4. Memberi tahu hasil: empat keadaan akhir

Sebuah step boleh mengakhiri seluruh notebook dengan mengembalikan objek berstatus:

```js
return { status: 'skipped', reason: 'Antrean kosong, tidak ada yang diproses' };
```

| status | kapan dipakai | yang dilakukan pemanggil |
|---|---|---|
| `completed` | semua beres | catat berhasil, lanjut tugas berikutnya |
| `skipped` | memang tidak ada pekerjaan | catat terlewati, jadwalkan pemeriksaan ulang |
| `needs_review` | anomali bisnis, selisih angka, hal aneh | **kirim ke daftar tinjauan manusia** |
| `session_dead` | halaman login, captcha, sesi habis | **minta pemilik akun login ulang** |

Hanya empat. Tidak ada nilai kelima — apa pun yang lain dipetakan ke `needs_review`.

Kalau step tidak mengembalikan apa-apa, ia dianggap berhasil dan notebook lanjut ke langkah
berikutnya. Kalau step **melempar error**, notebook berhenti di situ dengan `needs_review`.

`data` boleh disertakan dan akan sampai ke pemanggil:

```js
return { status: 'completed', data: { diproses: 12, dilewati: 3 } };
```

*Sumber: `extension/native/types.ts`, `extension/native/outcome.ts`*

---

## 5. Error yang bisa kamu tangkap

Helper melempar error bertipe supaya kamu bisa membedakan sebabnya:

| error | dilempar oleh | artinya |
|---|---|---|
| `ClickBlockedError` | `click` | ada yang menutupi elemennya (overlay, modal, cookie banner) |
| `NotEditableError` | `fill` | targetnya bukan sesuatu yang bisa diketik |
| `FillVerifyError` | `fill` | teks sudah dimasukkan tapi nilainya tidak bertahan |
| `FillStrategyError` | `fill` | tidak ada cara mengisi elemen jenis itu |
| `AbortError` | semua | kamu menekan Stop, atau halaman pindah |

```js
try {
  await click('#kirim');
} catch (e) {
  if (e.name === 'ClickBlockedError') {
    await click('.tutup-banner');
    await click('#kirim');
  } else {
    throw e;
  }
}
```

Error dari `pick` membawa daftar kandidat yang dicoba, dan itulah yang muncul di laporan sebagai
*"yang dicari"*. **Jangan menelan error `pick` diam-diam** — kalau kamu `catch` lalu `return`
tanpa status, laporannya kehilangan satu-satunya petunjuk yang berguna.

---

## 6. `ctx.data` — apa yang bertahan

| bertahan antar-step | ya |
|---|---|
| bertahan antar-navigasi halaman | hanya kalau kamu pakai `auto.next()` |
| bertahan antar-run | tidak |
| bisa berisi elemen DOM atau fungsi | **tidak** — keduanya dibuang |

Isinya disalin dengan `structuredClone`, jadi `Date`, `Map`, dan `Set` ikut selamat. Elemen DOM dan
fungsi **tidak** — kunci yang memuatnya dibuang diam-diam saat disimpan, sementara kunci lain
tetap utuh. Simpan selectornya, bukan elemennya.

*Sumber: `safeSnapshot` di `extension/kernel/checkpoint.ts`*

Selisih `ctx.data` tiap langkah dikirim ke pemanggil sebagai `dataDiff` (kunci tingkat pertama saja),
jadi **apa yang kamu taruh di `ctx.data` menjadi apa yang terlihat di layar pemantau di sisi pemanggil.** Nama kunci
yang jelas terbayar di sana.

---

## 7. Batasan yang mengejutkan

Ini yang paling sering membuang waktu. Semuanya sudah diukur.

**`press` mengirim event sintetis.** `isTrusted` selalu `false`, jadi ia menjangkau listener
JavaScript halaman tapi **bukan** perilaku bawaan browser. `Ctrl+C` tidak menyalin ke papan klip,
`Tab` tidak memindahkan fokus, `Enter` tidak mengirim form kecuali halaman itu sendiri yang
menanganinya.

**`while (true) {}` tanpa `await` tidak bisa dihentikan.** Tombol Stop bekerja lewat pembatalan
di titik `await`. Loop sinkron tak berujung akan mengunci sel sampai tab ditutup. Selipkan
`await sleep(0)` kalau kamu benar-benar butuh loop panjang.

**Halaman tersembunyi memperlambat timer — angka terukur (OQ-1):**
Diuji secara empiris pada Chrome 152 tanpa CDP:
- **Murni timer (5x `sleep(50)`):** tab depan **306 ms** vs tab latar pada jendela terlihat **4502 ms** (14,7x lebih lambat) vs jendela diminimalkan **4457 ms** (14,6x lebih lambat). Clamping timer 1 Hz Chrome berlaku sama kerasnya pada tab latar di jendela terlihat maupun jendela yang diminimalkan.
- **Menunggu DOM (`fetch` tunda 300 ms + `pick`):** tab depan **371 ms** vs tab latar pada jendela terlihat **500 ms** (1,35x lebih lambat) vs jendela diminimalkan **497 ms** (1,34x lebih lambat).
Callback respons jaringan tidak dijepit oleh timer. Helper `waitFor` dan `pick` menggunakan polling murni dengan interval default 50 ms. Selalu gunakan `pick` atau `waitFor` untuk menunggu respons DOM, dan pasang timeout yang longgar; hindari perulangan `sleep` berdurasi kecil di tab latar.

**Tangkapan layar hanya untuk tab yang terlihat.** Bukti yang selalu ada adalah potongan DOM;
tangkapan layar bersifat *best-effort* dan akan hilang justru saat kamu menjalankan otomasi di
latar. Jangan merancang alur yang bergantung padanya.

**`MAIN` vs `USER_SCRIPT`.** Bawaannya `MAIN`: kodemu berbagi konteks dengan JavaScript halaman,
jadi kamu bisa menyentuh variabel global situs. `USER_SCRIPT` memberi dunia terisolasi — pakai
kalau situsnya punya CSP ketat atau kalau kamu tidak mau bertabrakan dengan kode halaman.

**Navigasi multi-tab di batas langkah.** Satu run dapat berpindah antar-tab menggunakan empat helper tab (`useNewTab`, `openTab`, `goto`, `backToOpener`) di batas langkah tanpa pernah merebut fokus. Untuk menjalankan beberapa otomasi terpisah di tab berbeda secara bersamaan, pemanggil dapat memicu beberapa `run` bersamaan — runtime dogear mengisolasi memori dan kode tiap run secara mandiri tanpa saling mengotori.

**Batas tautan `rel="noopener"` pada `useNewTab()`.** Tautan dengan atribut `rel="noopener"` (atau tautan eksternal `target="_blank"` modern di Chrome) tidak mengirimkan relasi pembuka (`openerTabId`) ke browser. Akibatnya, `useNewTab()` tidak dapat mengaitkan tab baru yang dibuka melalui klik tautan tersebut secara otomatis dan akan mencapai timeout. Jalan keluarnya: jangan klik elemen tautan tersebut — baca nilai atribut tautannya (misalnya `$('#link')?.href`), lalu panggil `openTab(href)` secara eksplisit untuk membuka dan beralih ke tab baru di batas langkah tanpa memerlukan izin baru.

---

## 8. Contoh utuh

```markdown
---
name: "Audit kotak masuk"
steps:
  - path: "steps/01-buka.js"
    name: "Buka daftar"
  - path: "steps/02-hitung.js"
    name: "Hitung belum dibaca"
---
```

```js
// steps/01-buka.js
const daftar = await pick([
  '[data-testid="inbox-list"]',
  '#list-pane',
], { timeout: 20000 });

// Kalau halaman justru meminta login, katakan begitu — jangan lempar error.
if ($('form[action*="login"]') || $('[data-testid="login"]')) {
  return { status: 'session_dead', reason: 'Halaman meminta login ulang' };
}

ctx.data.siap = true;
print('Daftar siap:', daftar.children.length, 'baris');
```

```js
// steps/02-hitung.js
const lencana = $$('[data-testid="unread-badge"]');

if (lencana.length === 0) {
  return { status: 'skipped', reason: 'Tidak ada yang belum dibaca' };
}

ctx.data.belumDibaca = lencana.length;
print('Belum dibaca:', lencana.length);

return { status: 'completed', data: { belumDibaca: lencana.length } };
```

Perhatikan tiga hal: `pick` dengan dua kandidat dan timeout longgar; `session_dead` dikembalikan
sebagai **hasil**, bukan dilempar sebagai error; dan `ctx.data` diisi dengan nama kunci yang
terbaca manusia, karena nama itu yang muncul di layar pemantau di sisi pemanggil.

---

## 9. Kalau dokumen ini basi

Urutan sumber kebenaran:

1. `RUNTIME_HELPERS` di `extension/kernel/helpers.ts` — daftar helper, dikunci tes dua arah
2. `extension/project/notebook-parser.ts` — bentuk `notebook.md`
3. `extension/native/types.ts` — empat keadaan akhir
4. dokumen ini

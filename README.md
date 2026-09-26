# AR Family Finance Web App

Web app laporan keuangan keluarga + AR Studio.

Arsitektur:
- Frontend: GitHub Pages (`index.html`, `styles.css`, `app.js`, `config.js`)
- Backend API: Google Apps Script (`apps-script/Code.gs`)
- Database: Google Spreadsheet
- Login: username/password dibaca dari sheet `USERS`

## 1. Siapkan Spreadsheet

1. Buat / buka Spreadsheet laporan keuangan Anda.
2. Buka **Extensions > Apps Script**.
3. Salin isi `apps-script/Code.gs` ke project Apps Script.
4. Jalankan fungsi `setupDatabase()` satu kali dan berikan izin.
5. Setelah selesai, spreadsheet akan memiliki sheet:
   - `USERS`
   - `SETTINGS`
   - `ACCOUNTS`
   - `CATEGORIES`
   - `TRANSACTIONS`
   - `SESSIONS`
6. Login awal:
   - Username: `admin`
   - Password: `admin123`
7. Segera ubah password pada sheet `USERS`.

> Catatan keamanan: sesuai kebutuhan agar password dapat diubah langsung dari Spreadsheet, kolom PASSWORD disimpan sebagai teks. Jangan gunakan password yang sama dengan email, bank, atau akun penting lain. Spreadsheet harus dibatasi aksesnya.

## 2. Menggunakan data laporan lama

Jika workbook Anda masih memiliki sheet `Transaksi Rumah` dan `Transaksi Studio` dari laporan sebelumnya, jalankan fungsi:

`importLegacyTransactions()`

Fungsi ini mencoba mengimpor struktur kolom lama:
Tanggal, Jenis, Kategori, Uraian / layanan, Klien / pihak, Akun asal, Akun tujuan, Nominal (Rp), Metode, Catatan.

Jalankan hanya satu kali agar data tidak terduplikasi.

## 3. Deploy Apps Script sebagai Web App

1. Klik **Deploy > New deployment**.
2. Pilih **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**.
5. Deploy.
6. Salin URL yang berakhiran `/exec`.

Backend memakai form POST + iframe bridge agar frontend GitHub Pages tidak bergantung pada `google.script.run` dan tidak terkena masalah CORS umum pada frontend lintas domain.

## 4. Set URL API di GitHub

Buka `config.js`, ganti:

```js
window.AR_FINANCE_CONFIG = {
  API_URL: 'PASTE_APPS_SCRIPT_WEB_APP_URL_HERE'
};
```

menjadi URL deployment Apps Script Anda.

## 5. Set origin GitHub Pages

Setelah repository GitHub Pages aktif, buka sheet `SETTINGS` lalu ubah:

`GITHUB_ORIGIN` menjadi misalnya:

`https://username.github.io`

atau jika memakai custom domain:

`https://keuangan.domainanda.com`

Gunakan origin saja, tanpa path repository.

## 6. Upload ke GitHub

Upload file di root repository:
- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `.nojekyll`

Folder `apps-script` boleh ikut disimpan di GitHub sebagai source code, tetapi **jangan** masukkan data rahasia ke source code.

Aktifkan GitHub Pages:
**Repository > Settings > Pages > Deploy from a branch > main / root**.

## Fitur

- Login username/password dari Spreadsheet
- Role Admin / User
- Password dapat diganti dari sheet `USERS`
- Dashboard Rumah Tangga dan AR Studio
- KPI pemasukan, pengeluaran, cash flow, laba studio, saldo Bank/Tunai
- Grafik tren 12 bulan
- Grafik pengeluaran per kategori
- Filter bulan/tahun/book
- Tambah/edit/hapus transaksi
- Transfer antar akun
- Tarik ATM dicatat sebagai transfer, bukan pengeluaran
- Prive Studio -> Rumah dapat dicatat dengan pola yang sudah digunakan pada laporan
- Responsive desktop/tablet/mobile
- Session login disimpan di browser, diverifikasi lewat sheet `SESSIONS`

## Struktur transaksi

`TRANSACTIONS`:
- ID
- DATE
- BOOK (`HOUSE` / `STUDIO`)
- TYPE (`INCOME`, `EXPENSE`, `TRANSFER`, `PRIVE`)
- CATEGORY
- DESCRIPTION
- PARTY
- FROM_ACCOUNT
- TO_ACCOUNT
- AMOUNT
- METHOD
- NOTE
- CREATED_BY
- CREATED_AT
- UPDATED_AT

## Catatan deployment

Jika Apps Script di-deploy ulang sebagai deployment baru dan URL `/exec` berubah, update `config.js` lalu push ulang ke GitHub.

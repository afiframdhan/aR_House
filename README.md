# AR Family Finance v1.2

Frontend: GitHub Pages  
Backend: Google Apps Script Web App  
Database: Google Spreadsheet

## Fitur v1.2
- Dashboard Keseluruhan
- Dashboard AR Studio
- Dashboard Rumah Tangga
- Transaksi pemasukan, pengeluaran, transfer, dan prive
- Pengeluaran rutin Rumah Tangga per bulan
- Metode pengeluaran rutin Cash/ATM dan Online
- Status Belum Dibayar / Sudah Dibayar
- Saat ditandai dibayar, otomatis dibuat transaksi pengeluaran Rumah Tangga
- Profil user: nama, username, password, dan foto profil
- Upload + crop foto profil langsung di browser
- Login persisten: tetap login setelah refresh, browser ditutup, atau Add to Home Screen, sampai logout / user dinonaktifkan
- Cache lokal untuk menampilkan dashboard lebih cepat saat aplikasi dibuka
- Satu request sinkronisasi untuk dashboard, transaksi, saldo, dan pengeluaran rutin agar Apps Script tidak dipanggil berkali-kali

## Upgrade dari v1.0 / v1.1
JANGAN hapus Spreadsheet lama.

1. Buka Spreadsheet database yang sama.
2. Extensions > Apps Script.
3. Ganti isi `Code.gs` dengan file `apps-script/Code.gs` versi ini.
4. Jalankan fungsi `setupDatabase()` SATU KALI.
   - Fungsi ini tidak menghapus transaksi lama.
   - Fungsi ini menambah kolom `PHOTO` ke USERS.
   - Menambah kolom `ROUTINE_ID` ke TRANSACTIONS.
   - Membuat sheet baru `ROUTINES`.
   - Menambah setting login persisten jika database baru.
5. Deploy > Manage deployments > Edit > New version > Deploy.
6. Pastikan deployment tetap:
   - Execute as: Me
   - Who has access: Anyone
7. Di frontend, buka `config.js` dan isi URL Web App Apps Script `/exec` yang Anda gunakan.
8. Upload seluruh file frontend ke repository GitHub Pages, menggantikan file versi lama.

## Agar login lama benar-benar persisten
Jika sheet SETTINGS Anda berasal dari versi sebelumnya, pastikan terdapat baris:

| KEY | VALUE |
| --- | --- |
| PERSIST_LOGIN | TRUE |
| SESSION_DAYS | 3650 |

Jika belum ada, tambahkan manual. `PERSIST_LOGIN=TRUE` membuat session yang sudah tersimpan di browser tidak dipaksa expired oleh tanggal session. User tetap akan logout jika menekan Keluar, token dihapus, user dinonaktifkan, atau username diubah langsung dari Spreadsheet.

## Pengeluaran rutin
Data tersimpan di sheet `ROUTINES`.

Kolom utama:
- DESCRIPTION = nama tagihan
- CATEGORY = kategori pengeluaran rumah
- AMOUNT = nominal bulanan
- PAYMENT_MODE = `CASH_ATM` atau `ONLINE`
- DUE_DAY = tanggal jatuh tempo
- FROM_ACCOUNT = akun pembayaran
- ACTIVE = TRUE/FALSE

Default:
- Cash/ATM -> Rumah · Tunai
- Online -> Rumah · Bank

Saat tombol **Tandai Dibayar** ditekan, aplikasi membuat transaksi EXPENSE Rumah Tangga dan menyimpan ID pengeluaran rutin pada kolom `ROUTINE_ID`. Ini mencegah tagihan yang sama dicatat dua kali pada bulan yang sama.

## Foto profil
Foto dicrop menjadi ukuran kecil dan dikompres di browser, lalu disimpan pada kolom `PHOTO` di USERS sebagai data JPEG. Cara ini menghindari request tambahan ke Google Drive sehingga loading tetap cepat.

## Catatan kecepatan
Versi ini menggunakan:
- localStorage cache untuk render awal instan
- session token localStorage untuk login persisten
- satu endpoint `initialData/sync` untuk mengambil data utama sekaligus
- grafik tanpa animasi agar render lebih ringan

Jika jumlah transaksi nantinya sudah puluhan ribu baris, backend sebaiknya dilanjutkan ke Supabase/SQL. Untuk jumlah transaksi keluarga/studio normal, Spreadsheet masih memadai.

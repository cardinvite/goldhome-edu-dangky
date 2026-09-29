# Phiếu Đăng Ký 2026 — Graphic KEY

Form đăng ký tĩnh (HTML/CSS/JS), ghi trực tiếp vào Google Sheet qua Google Sheets API v4 —
không dùng Google Apps Script, không dùng dịch vụ trung gian nào.

## Cách hoạt động

Khi người dùng bấm **GỬI ĐĂNG KÝ**, JS mở popup đăng nhập Google (Google Identity Services),
lấy access token có quyền `spreadsheets`, rồi gọi thẳng API
`POST https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{range}:append` để thêm 1 dòng
vào Google Sheet — xem `js/sheetsApi.js` và `script.js`.

**Lưu ý quan trọng:** vì đây là form công khai, ai điền cũng phải đăng nhập Google để ghi được
dữ liệu, và Google Sheet đích phải được chia sẻ ở chế độ **"Anyone with the link — Editor"**.
Điều này có nghĩa: bất kỳ ai có link Sheet cũng có thể xem/sửa toàn bộ các dòng đăng ký khác
(CCCD, địa chỉ, SĐT của người khác). Nếu dữ liệu cần kín hơn, cách khác là dùng Google Apps
Script (ghi bằng service account, không cần chia sẻ Editor công khai) — nhưng bạn đã yêu cầu
không dùng Apps Script, nên đây là đánh đổi cần biết trước khi công khai link GitHub Pages.

## Cài đặt (một lần)

### 1. Tạo Google Sheet
1. Tải file `DangKy2026.xlsx` (đã tạo sẵn trong repo này) lên Google Drive của bạn.
2. Click phải file → **Mở bằng → Google Sheets** để chuyển thành Google Sheet thật.
3. Xoá dòng 2 (dòng ví dụ, chữ nghiêng màu xám) — đó chỉ để minh hoạ định dạng.
4. Copy **Spreadsheet ID** từ URL: `docs.google.com/spreadsheets/d/**ĐÂY**/edit`.
5. Vào **Share** (Chia sẻ) → đổi thành **Anyone with the link → Editor**.

### 2. Tạo OAuth Client ID
1. Vào [Google Cloud Console](https://console.cloud.google.com/) → tạo project mới (hoặc dùng project có sẵn).
2. **APIs & Services → Library** → bật **Google Sheets API**.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Authorized JavaScript origins: thêm domain GitHub Pages của bạn, ví dụ
     `https://<username>.github.io` (và `http://localhost:5500` hoặc cổng bạn dùng để test local).
4. Copy **Client ID** (dạng `xxxx.apps.googleusercontent.com`).
5. Nếu chưa cấu hình **OAuth consent screen**, vào cấu hình trước (chọn External, thêm scope
   `.../auth/spreadsheets`), nếu app còn ở "Testing" thì cần thêm email người test vào
   **Test users** (đến khi bạn Publish app).

### 3. Cấu hình `js/config.js`
```js
SPREADSHEET_ID: 'ID_bạn_vừa_copy',
SHEET_NAME: 'DangKy',
CLIENT_ID: 'client-id-của-bạn.apps.googleusercontent.com',
```

### 4. Test local rồi deploy
- Mở `index.html` bằng một local server (VD: `npx serve` hoặc extension Live Server) — mở
  trực tiếp bằng `file://` sẽ không hoạt động vì Google OAuth chặn origin `null`.
- Điền thử form, xác nhận dòng mới xuất hiện trong Google Sheet.
- Push code lên GitHub, bật **Settings → Pages** cho repo, thêm domain Pages vào
  **Authorized JavaScript origins** ở bước 2 nếu chưa thêm.

### 5. Cập nhật link chia sẻ (Open Graph)
Sau khi bật GitHub Pages, mở `index.html`, tìm `PASTE_PAGE_URL_HERE` (3 chỗ trong thẻ
`<meta property="og:...">` / `twitter:image`) và thay bằng link Pages thật, ví dụ
`https://username.github.io/form`. Bước này giúp link hiển thị đẹp (ảnh + tiêu đề) khi dán
vào Zalo/Facebook/Messenger gửi cho khách.

## Cấu trúc file
```
index.html            # giao diện form + thẻ Open Graph
style.css             # giao diện
script.js             # logic form + luồng đăng nhập/ghi dữ liệu
js/config.js          # SPREADSHEET_ID, SHEET_NAME, CLIENT_ID — điền tay
js/sheetsApi.js       # gọi Google Sheets API v4 (append row)
DangKy2026.xlsx       # template Sheet — tải lên Drive rồi mở bằng Google Sheets
assets/logo.png       # logo GOLD HOME - Edu (hiển thị trong form)
assets/og-image.png   # ảnh preview 1200x630 khi chia sẻ link
qr-code.jpeg          # QR chuyển khoản Vietcombank
```

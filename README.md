# Phiếu Đăng Ký 2026 — GOLD HOME - Edu

Form đăng ký tĩnh (HTML/CSS/JS), ghi vào Google Sheet qua Google Apps Script Web App.
Người điền form **không cần đăng nhập Google**, không popup, không lỗi verify.

## Cách hoạt động

Khi người dùng bấm **GỬI ĐĂNG KÝ**, JS `fetch()` POST dữ liệu tới URL của một Apps Script Web
App (xem `script.js`). Script đó (`apps-script/Code.gs`) chạy dưới quyền của bạn — chủ sở hữu
Sheet — nên người điền form không cần tài khoản Google, và Sheet cũng không cần chia sẻ công
khai "Anyone can edit" (an toàn cho CCCD/SĐT của khách).

## Cài đặt (một lần, ~5 phút)

### 1. Tạo Google Sheet
1. Tải file `GoldHomeEduDangKy.xlsx` (có sẵn trong repo này) lên Google Drive của bạn.
2. Click phải file → **Mở bằng → Google Sheets** để chuyển thành Google Sheet thật.
3. Xoá dòng 2 (dòng ví dụ, chữ nghiêng màu xám) — đó chỉ để minh hoạ định dạng.
4. Giữ nguyên tên tab là **DangKy** (khớp với `apps-script/Code.gs`).

### 2. Deploy Apps Script
1. Trong Google Sheet vừa tạo: **Extensions (Tiện ích mở rộng) → Apps Script**.
2. Xoá nội dung mặc định trong `Code.gs`, dán toàn bộ nội dung file
   `apps-script/Code.gs` của repo này vào.
3. Bấm **Deploy → New deployment**.
   - Chọn loại: **Web app**.
   - **Execute as**: Me (email của bạn).
   - **Who has access**: **Anyone**.
4. Bấm **Deploy** → lần đầu Google sẽ hỏi cấp quyền (Authorize access) → chọn tài khoản của
   bạn → bấm **Advanced → Go to (tên project) (unsafe)** → **Allow** (đây là script của chính
   bạn nên an toàn, cảnh báo này là mặc định cho mọi Apps Script mới).
5. Copy **Web app URL** (dạng `https://script.google.com/macros/s/xxxx/exec`).

### 3. Cấu hình `script.js`
```js
const WEB_APP_URL = 'https://script.google.com/macros/s/xxxx/exec';
```

### 4. Test rồi deploy
- Mở `index.html` bằng local server (VD: `npx serve`) hoặc trực tiếp trên GitHub Pages.
- Điền thử form, xác nhận dòng mới xuất hiện trong Google Sheet.
- Push code lên GitHub, bật **Settings → Pages** cho repo.

### 5. Mỗi khi sửa `apps-script/Code.gs`
Phải **Deploy → Manage deployments → sửa (bút chì) → New version → Deploy** lại thì thay đổi
mới có hiệu lực (Apps Script không tự cập nhật deployment cũ).

## Link chia sẻ (Open Graph)
Đã trỏ sẵn vào `https://cardinvite.github.io/goldhome-edu-dangky/` trong các thẻ
`<meta property="og:...">` / `twitter:image` của `index.html`. Nếu sau này đổi domain/tên
repo, nhớ cập nhật lại 3 chỗ này.

## Cấu trúc file
```
index.html              # giao diện form + thẻ Open Graph
style.css               # giao diện
script.js               # logic form + gửi dữ liệu tới Apps Script Web App
apps-script/Code.gs     # dán vào Extensions > Apps Script của Google Sheet
GoldHomeEduDangKy.xlsx  # template Sheet — tải lên Drive rồi mở bằng Google Sheets
assets/logo.png         # logo GOLD HOME - Edu (hiển thị trong form)
assets/og-image.png     # ảnh preview 1200x630 khi chia sẻ link
qr-code.jpeg            # QR chuyển khoản Vietcombank
```

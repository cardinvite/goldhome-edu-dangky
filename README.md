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

## Trang quản lý khách hàng (admin.html)

Trang nội bộ cho Sales/Admin quản lý SĐT khách: ai đang chăm sóc, trạng thái, ghi chú, hẹn gọi
lại, lịch sử. Vào bằng link mờ **"Nội bộ"** ở cuối trang đăng ký (hoặc mở thẳng `admin.html`),
đăng nhập bằng Google. Chỉ email có trong tab **Users** của Sheet mới vào được.

- **2 mảng: Đào tạo / Xây dựng** — chọn ở đầu tab Khách hàng. Mỗi mảng là một danh sách riêng
  (bộ đếm, lọc, lịch sử riêng). Cùng một SĐT có thể là khách của cả 2 mảng với sales/trạng thái
  riêng; chỉ chống trùng trong cùng một mảng. Mọi sales đều xem được cả 2 mảng. Khách từ form
  đăng ký và dữ liệu cũ (cột `segment` trống) thuộc **Đào tạo**.
- **Trạng thái chăm sóc** do ADMIN quản lý ở tab **Trạng thái** (lưu trong tab `Statuses` của Sheet).
  3 trạng thái hệ thống `NEW`, `CALLING`, `CLOSED` chỉ đổi được tên/màu. Xoá trạng thái đang có khách
  thì chọn trạng thái thay thế (có ghi lịch sử).
- Dữ liệu nằm trong cùng Google Sheet, 3 tab tự tạo: **Leads** (mỗi SĐT một dòng, không trùng),
  **Activities** (lịch sử, chỉ ghi thêm), **Users** (danh sách được phép đăng nhập).
- Khách điền form đăng ký có SĐT → tự thêm vào **Leads** với trạng thái "Chưa chăm sóc".
- Sales không có quyền mở Sheet, mọi thao tác đi qua Apps Script (kiểm tra quyền + `LockService`
  chống 2 Sales nhận cùng một số).
- Trang tự tải lại dữ liệu mỗi 60 giây (khi không mở hộp thoại).
- **Tốc độ**: mở trang hiện ngay dữ liệu lần trước (lưu trên trình duyệt, xoá khi Đăng xuất) rồi cập
  nhật ngầm. Apps Script cache dữ liệu 10 phút và trigger `warmCache` (5 phút/lần, do `setupAdmin`
  tạo) nạp sẵn cache. Mọi thao tác trên trang xoá cache ngay; **sửa tay trong Sheet** thì bấm
  **Tải lại** để thấy ngay.

### Cài đặt (một lần)

**1. Tạo OAuth Client ID (cho nút "Đăng nhập bằng Google")**
1. Vào https://console.cloud.google.com → tạo project mới (VD: `goldhome-admin`).
2. **APIs & Services → OAuth consent screen**: chọn **External**, điền tên app + email hỗ trợ,
   không cần thêm scope. Xong bấm **Publish app** (scope cơ bản email/profile không cần Google
   duyệt). Nếu để chế độ *Testing* thì phải thêm từng email Sales vào mục *Test users*.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://cardinvite.github.io` (và `http://localhost:3000`
     nếu muốn test local). Không cần Redirect URI.
4. Copy **Client ID** (dạng `xxxx.apps.googleusercontent.com`).

**2. Cấu hình**
- `admin.js`: dán Client ID vào `GOOGLE_CLIENT_ID`. `API_URL` để giống `WEB_APP_URL` trong `script.js`.
- Apps Script → **Project Settings (bánh răng) → Script Properties → Add**:
  `GOOGLE_CLIENT_ID` = Client ID ở trên. Nếu project Apps Script được tạo riêng ở
  script.google.com (không mở từ Extensions của Sheet) thì thêm `SPREADSHEET_ID` = ID của Sheet
  (đoạn giữa `/d/` và `/edit` trong URL Sheet).
- Cũng trong Project Settings: **Time zone** = `(GMT+07:00) Bangkok/Hà Nội`. Sheet: **File →
  Settings → Time zone** cũng chọn GMT+7.

**3. Cập nhật Apps Script**
1. Dán lại toàn bộ `apps-script/Code.gs` (đã thêm phần chuyển request sang Admin).
2. Bấm **+ → Script**, đặt tên `Admin`, dán toàn bộ `apps-script/Admin.gs`.
3. Chọn hàm `setupAdmin` trên thanh công cụ → **Run** → cấp quyền lại (lần này có thêm quyền
   "kết nối dịch vụ bên ngoài" — dùng để xác minh đăng nhập Google). Hàm này tạo 3 tab và thêm
   chủ Sheet làm ADMIN.
4. **Deploy → Manage deployments → bút chì → Version: New version → Deploy** (giữ nguyên URL).

**4. Thêm người dùng** — sau khi đăng nhập bằng tài khoản ADMIN, vào tab **Sales** trên trang
admin để **Thêm / Sửa / Khoá / Xoá** sales (xoá sales đang phụ trách khách thì chọn người nhận lại
khách). Hoặc sửa trực tiếp tab **Users** trong Sheet, mỗi người một dòng:

| email | name | role | active |
|---|---|---|---|
| nguyenvana@gmail.com | Sale A | SALE | TRUE |
| admin@gmail.com | Admin | ADMIN | TRUE |

- `role`: `ADMIN` hoặc `SALE`. Muốn khoá ai thì đặt `active` = `FALSE` (không xoá dòng để lịch
  sử vẫn hiển thị đúng tên).
- Email viết thường, đúng email Google mà người đó đăng nhập.

### Phân quyền
| | SALE | ADMIN |
|---|---|---|
| Xem / tìm kiếm / thêm SĐT | ✓ | ✓ |
| Nhận chăm sóc số chưa ai nhận | ✓ | ✓ |
| Cập nhật trạng thái, ghi chú, hẹn gọi lại | chỉ số mình phụ trách | mọi số |
| Chuyển khách giữa Sales | | ✓ |
| Thêm / sửa / khoá / xoá tài khoản (tab Sales) | | ✓ |
| Thêm / sửa / ẩn / xoá / sắp xếp trạng thái chăm sóc (tab Trạng thái) | | ✓ |
| Tab Đăng ký (dữ liệu form, tab `DangKy`) | ✓ (CCCD, địa chỉ bị che) | ✓ đầy đủ + Xuất CSV |
| Tab Hoạt động (lịch sử toàn hệ thống), tab Sales | | ✓ |

### Phiên đăng nhập
- Đăng nhập Google một lần, hệ thống giữ phiên **1 ngày** (24 giờ) trên trình duyệt đó (đổi
  `SESSION_DAYS` trong `Admin.gs`). Dùng máy chung thì nhớ bấm **Đăng xuất**.
- Khoá một người ngay lập tức: đặt `active` = `FALSE` trong tab **Users** (có hiệu lực ở request
  kế tiếp dù phiên còn hạn).
- Đăng xuất **tất cả** mọi người (VD: nghi lộ phiên): Apps Script → Project Settings → Script
  Properties → xoá `SESSION_SECRET`. Không cần deploy lại.

Lịch sử (tab **Activities**) không ai sửa/xoá được từ trang web. Đừng chia sẻ quyền sửa Google
Sheet cho Sales — họ chỉ cần đăng nhập trang admin.

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
apps-script/Admin.gs    # backend trang quản lý khách (cùng project Apps Script)
admin.html / admin.js / admin.css  # trang quản lý khách hàng (đăng nhập Google)
GoldHomeEduDangKy.xlsx  # template Sheet — tải lên Drive rồi mở bằng Google Sheets
assets/logo.png         # logo GOLD HOME - Edu (hiển thị trong form)
assets/og-image.png     # ảnh preview 1200x630 khi chia sẻ link
qr-code.jpeg            # QR chuyển khoản Vietcombank
```

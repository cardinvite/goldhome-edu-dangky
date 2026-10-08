// Dán toàn bộ file này vào Extensions > Apps Script của Google Sheet (DangKy2026),
// rồi Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
// Xem README.md ở gốc repo để biết đầy đủ các bước.

function doPost(e) {
  // Request từ trang quản lý khách hàng (admin.html) — xử lý trong Admin.gs.
  var adminBody = parseAdminBody_(e);
  if (adminBody) return handleAdminRequest_(adminBody);

  var ss = spreadsheet_();
  var sheet = ss.getSheetByName('DangKy') || ss.getSheets()[0];

  var p = e.parameter;

  // Bỏ qua request không phải từ form (không có họ tên) để không ghi dòng trống vào Sheet.
  if (!p.hoTen) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'error', message: 'Thiếu dữ liệu form.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  sheet.appendRow([
    new Date(),
    p.hoTen || '',
    p.ngaySinh || '',
    p.cccd || '',
    p.diaChi || '',
    p.soDienThoai || '',
    p.tenZalo || '',
    p.khoaHoc || '',
    p.hinhThucHoc || '',
    p.camKet || '',
    p.thanhToan || ''
  ]);

  // Tự thêm SĐT vào danh sách khách (tab Leads). Lỗi ở đây không được làm hỏng form.
  try {
    invalidateCache_('regs');
    addLeadFromRegistration_(p);
  } catch (err) {
    console.error(err);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ result: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Script mở từ Extensions > Apps Script của Sheet thì tự lấy được Sheet.
// Script tạo riêng (script.google.com) thì cần Script Property SPREADSHEET_ID.
function spreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error('Script không gắn với Google Sheet. Thêm Script Property SPREADSHEET_ID = ID của Sheet '
      + '(đoạn giữa /d/ và /edit trong URL của Sheet).');
  }
  return SpreadsheetApp.openById(id);
}

function doGet(e) {
  return ContentService
    .createTextOutput('Endpoint is running. Use POST to submit data.')
    .setMimeType(ContentService.MimeType.TEXT);
}

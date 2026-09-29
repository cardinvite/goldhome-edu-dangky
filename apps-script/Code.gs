// Dán toàn bộ file này vào Extensions > Apps Script của Google Sheet (DangKy2026),
// rồi Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
// Xem README.md ở gốc repo để biết đầy đủ các bước.

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('DangKy')
    || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  var p = e.parameter;

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

  return ContentService
    .createTextOutput(JSON.stringify({ result: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService
    .createTextOutput('Endpoint is running. Use POST to submit data.')
    .setMimeType(ContentService.MimeType.TEXT);
}

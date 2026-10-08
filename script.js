// Dán URL Web App (lấy sau khi Deploy Apps Script) vào đây — xem README.md
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbz6dZx1Di5-LRpmnewqeWIsMB3TK6pk1q9R9ucmWE0BN0rFVm-hdcJTM2ZwxNO29qdqYw/exec';

const form = document.getElementById('regForm');
const statusEl = document.getElementById('formStatus');
const submitBtn = form.querySelector('.submit-btn');
const khoaHocKhacCheck = document.getElementById('khoaHocKhacCheck');
const khoaHocKhacWrap = document.getElementById('khoaHocKhacWrap');
const khoaHocKhacInput = document.getElementById('khoaHocKhacInput');
const qrBox = document.getElementById('qrBox');
const khoaHocInputs = Array.from(form.querySelectorAll('input[name="khoaHoc"]'));

function validateKhoaHoc() {
  const hasSelection = khoaHocInputs.some((input) => input.checked) || khoaHocKhacCheck.checked;
  khoaHocInputs[0].setCustomValidity(
    hasSelection ? '' : 'Vui lòng chọn ít nhất một khóa học.'
  );
}

khoaHocInputs.forEach((input) => input.addEventListener('change', validateKhoaHoc));

khoaHocKhacCheck.addEventListener('change', () => {
  khoaHocKhacWrap.hidden = !khoaHocKhacCheck.checked;
  khoaHocKhacInput.required = khoaHocKhacCheck.checked;
  if (!khoaHocKhacCheck.checked) khoaHocKhacInput.value = '';
  validateKhoaHoc();
});

validateKhoaHoc();

form.querySelectorAll('input[name="thanhToan"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    qrBox.hidden = radio.value !== 'Chuyển khoản' || !radio.checked;
  });
});

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'form-status' + (type ? ' ' + type : '');
}

function setSubmitting(isSubmitting) {
  submitBtn.disabled = isSubmitting;
  submitBtn.textContent = isSubmitting ? 'Đang gửi...' : 'GỬI ĐĂNG KÝ';
}

function buildPayload() {
  const khoaHocChecked = Array.from(
    form.querySelectorAll('input[name="khoaHoc"]:checked')
  ).map((el) => el.value);

  if (khoaHocKhacCheck.checked && khoaHocKhacInput.value.trim()) {
    khoaHocChecked.push('Khác: ' + khoaHocKhacInput.value.trim());
  }

  const payload = new URLSearchParams();
  payload.append('hoTen', form.hoTen.value.trim());
  payload.append('ngaySinh', form.ngaySinh.value.trim());
  payload.append('cccd', form.cccd.value.trim());
  payload.append('diaChi', form.diaChi.value.trim());
  payload.append('soDienThoai', form.soDienThoai.value.trim());
  payload.append('tenZalo', form.tenZalo.value.trim());
  payload.append('khoaHoc', khoaHocChecked.join('; '));
  payload.append('hinhThucHoc', form.hinhThucHoc.value);
  payload.append('camKet', form.camKet.checked ? 'Đã đồng ý' : '');
  payload.append('thanhToan', form.thanhToan.value);
  return payload;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  validateKhoaHoc();
  if (!form.reportValidity()) {
    setStatus('Vui lòng điền đầy đủ các mục bắt buộc.', 'error');
    return;
  }

  if (!WEB_APP_URL || WEB_APP_URL.includes('PASTE_')) {
    setStatus('Chưa cấu hình WEB_APP_URL trong script.js. Xem README.md.', 'error');
    return;
  }

  setSubmitting(true);
  setStatus('', '');

  try {
    // mode: "no-cors" vì Apps Script Web App không trả CORS header cho fetch thường.
    // Request vẫn được xử lý và ghi vào Sheet ở phía server, chỉ là JS không đọc được response.
    await fetch(WEB_APP_URL, { method: 'POST', mode: 'no-cors', body: buildPayload() });
    setStatus('Đăng ký thành công! Trung tâm sẽ liên hệ với bạn sớm.', 'success');
    form.reset();
    khoaHocKhacWrap.hidden = true;
    qrBox.hidden = true;
  } catch (error) {
    setStatus('Có lỗi xảy ra khi gửi. Vui lòng thử lại hoặc liên hệ trực tiếp.', 'error');
  } finally {
    setSubmitting(false);
  }
});

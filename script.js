const ROW_HEADERS = [
  'timestamp', 'hoTen', 'ngaySinh', 'cccd', 'diaChi',
  'soDienThoai', 'tenZalo', 'khoaHoc', 'hinhThucHoc', 'camKet', 'thanhToan',
];

const form = document.getElementById('regForm');
const statusEl = document.getElementById('formStatus');
const submitBtn = form.querySelector('.submit-btn');
const khoaHocKhacCheck = document.getElementById('khoaHocKhacCheck');
const khoaHocKhacWrap = document.getElementById('khoaHocKhacWrap');
const khoaHocKhacInput = document.getElementById('khoaHocKhacInput');
const qrBox = document.getElementById('qrBox');

let tokenClient;
let accessToken = null;

khoaHocKhacCheck.addEventListener('change', () => {
  khoaHocKhacWrap.hidden = !khoaHocKhacCheck.checked;
  if (!khoaHocKhacCheck.checked) khoaHocKhacInput.value = '';
});

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

function buildRegistration() {
  const khoaHocChecked = Array.from(
    form.querySelectorAll('input[name="khoaHoc"]:checked')
  ).map((el) => el.value);

  if (khoaHocKhacCheck.checked && khoaHocKhacInput.value.trim()) {
    khoaHocChecked.push('Khác: ' + khoaHocKhacInput.value.trim());
  }

  return {
    timestamp: new Date().toISOString(),
    hoTen: form.hoTen.value.trim(),
    ngaySinh: form.ngaySinh.value.trim(),
    cccd: form.cccd.value.trim(),
    diaChi: form.diaChi.value.trim(),
    soDienThoai: form.soDienThoai.value.trim(),
    tenZalo: form.tenZalo.value.trim(),
    khoaHoc: khoaHocChecked.join('; '),
    hinhThucHoc: form.hinhThucHoc.value,
    camKet: form.camKet.checked ? 'Đã đồng ý' : '',
    thanhToan: form.thanhToan.value,
  };
}

async function submitRegistration() {
  setSubmitting(true);
  setStatus('', '');
  try {
    await appendRow(accessToken, CONFIG.SPREADSHEET_ID, CONFIG.SHEET_NAME, buildRegistration(), ROW_HEADERS);
    setStatus('Đăng ký thành công! Trung tâm sẽ liên hệ với bạn sớm.', 'success');
    form.reset();
    khoaHocKhacWrap.hidden = true;
  } catch (error) {
    if (String(error.message).includes('401') || String(error.message).includes('403')) {
      accessToken = null;
    }
    setStatus('Gửi thất bại: ' + error.message, 'error');
  } finally {
    setSubmitting(false);
  }
}

function initAuth() {
  if (!window.google?.accounts?.oauth2) {
    setStatus('Không tải được dịch vụ đăng nhập Google. Vui lòng tải lại trang.', 'error');
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    callback: (response) => {
      setSubmitting(false);
      if (response.error) {
        setStatus('Đăng nhập Google thất bại: ' + response.error, 'error');
        return;
      }
      accessToken = response.access_token;
      submitRegistration();
    },
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID.includes('PASTE_')) {
    setStatus('Chưa cấu hình SPREADSHEET_ID trong js/config.js.', 'error');
    return;
  }
  if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.includes('PASTE_')) {
    setStatus('Chưa cấu hình CLIENT_ID trong js/config.js.', 'error');
    return;
  }
  if (!tokenClient) {
    setStatus('Dịch vụ đăng nhập Google chưa sẵn sàng, vui lòng thử lại.', 'error');
    return;
  }

  setSubmitting(true);
  setStatus('Vui lòng đăng nhập Google để xác nhận gửi đăng ký...', '');

  if (accessToken) {
    submitRegistration();
  } else {
    tokenClient.requestAccessToken();
  }
});

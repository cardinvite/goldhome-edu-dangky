// Giống WEB_APP_URL trong script.js — cùng một Apps Script Web App.
const API_URL = 'https://script.google.com/macros/s/AKfycbwgFz4eT7G7x2gzwkDwfCk3QCFNueiCcMxHkIho3Fch58l39-VmxqESQJvxVvxt20NRNA/exec';
// OAuth Client ID tạo trong Google Cloud Console — xem README.md.
const GOOGLE_CLIENT_ID = '884064042089-drsbl39b8utv2rttar95aaoea45pstt8.apps.googleusercontent.com';

const SESSION_KEY = 'goldhome_admin_session';
const AUTO_REFRESH_MS = 60 * 1000;
const MAX_ROWS = 300;

const STATUS = {
  NEW: { label: 'Chưa chăm sóc', color: 'gray' },
  CALLING: { label: 'Đang liên hệ', color: 'blue' },
  NO_ANSWER: { label: 'Không nghe máy', color: 'red' },
  CONTACTED: { label: 'Đã liên hệ', color: 'blue' },
  CONSULTING: { label: 'Đang tư vấn', color: 'blue' },
  CALLBACK: { label: 'Hẹn gọi lại', color: 'orange' },
  INTERESTED: { label: 'Khách quan tâm', color: 'teal' },
  NOT_INTERESTED: { label: 'Không có nhu cầu', color: 'dark' },
  CLOSED: { label: 'Đã chốt', color: 'green' },
  INVALID: { label: 'Số sai / Không hợp lệ', color: 'dark' },
};
const DONE_STATUSES = ['CLOSED', 'NOT_INTERESTED', 'INVALID'];

const state = {
  token: '',
  me: null,
  users: [],
  leads: [],
  filter: 'all',
  sale: '',
  query: '',
  openPhone: '',
};

const $ = (id) => document.getElementById(id);

// ---------- Helpers ----------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Giống normalizePhone_ trong apps-script/Admin.gs.
function normalizePhone(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('0084')) digits = digits.slice(4);
  else if (digits.startsWith('84') && digits.length >= 11) digits = digits.slice(2);
  if (digits && digits[0] !== '0') digits = '0' + digits;
  return /^0(\d{9}|2\d{9})$/.test(digits) ? digits : '';
}

const pad = (n) => String(n).padStart(2, '0');

function fmtShort(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  const year = d.getFullYear() !== new Date().getFullYear() ? '/' + d.getFullYear() : '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}${year}`;
}

function fmtFull(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function isDone(lead) {
  return DONE_STATUSES.includes(lead.status);
}

function isDueToday(lead) {
  return !!lead.next_followup_at && !isDone(lead) && new Date(lead.next_followup_at) <= endOfToday();
}

function isActive(lead) {
  return !!lead.assigned_email && lead.status !== 'NEW' && !isDone(lead);
}

function userName(email) {
  if (!email) return '';
  const u = state.users.find((x) => x.email === email);
  return u ? u.name : email;
}

function saleLabel(lead) {
  if (!lead.assigned_email) return '-';
  return lead.assigned_email === state.me.email ? 'Tôi' : userName(lead.assigned_email);
}

function badge(status) {
  const s = STATUS[status] || STATUS.NEW;
  return `<span class="badge ${s.color}">${esc(s.label)}</span>`;
}

function followupClass(lead) {
  if (!lead.next_followup_at || isDone(lead)) return '';
  const d = new Date(lead.next_followup_at);
  if (d < new Date()) return 'overdue';
  if (d <= endOfToday()) return 'today';
  return '';
}

let toastTimer;
function toast(message, type = '') {
  const el = $('toast');
  el.textContent = message;
  el.className = 'toast ' + type;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- API ----------

// Thao tác chỉ đọc (hoặc lặp lại vô hại) — được tự thử lại khi Google trả lỗi tạm thời.
const RETRYABLE_ACTIONS = ['login', 'init', 'list', 'history', 'activities'];

async function api(action, params = {}, attempt = 1) {
  try {
    return await apiOnce(action, params);
  } catch (err) {
    if (err.code === 'BAD_RESPONSE' && attempt < 3 && RETRYABLE_ACTIONS.includes(action)) {
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
      return api(action, params, attempt + 1);
    }
    throw err;
  }
}

async function apiOnce(action, params) {
  let text;
  try {
    // text/plain để tránh CORS preflight — Apps Script không xử lý OPTIONS.
    // Apps Script luôn trả 302 sang script.googleusercontent.com, fetch tự đi theo.
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: state.token, ...params }),
    });
    text = await res.text();
    // Bước chuyển hướng sang script.googleusercontent.com đôi khi trả 404 tạm thời.
    if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { code: 'BAD_RESPONSE', status: res.status });
  } catch (err) {
    if (err.code === 'BAD_RESPONSE') {
      console.error('Apps Script trả HTTP', err.status, text.slice(0, 300));
      throw Object.assign(new Error('Máy chủ Google trả lỗi tạm thời (HTTP ' + err.status + '). '
        + 'Vui lòng thử lại; nếu lặp lại, kiểm tra Deploy → Manage deployments.'), { code: 'BAD_RESPONSE' });
    }
    console.error(err);
    throw Object.assign(new Error('Không kết nối được máy chủ (CORS/mạng). Kiểm tra Web App đã deploy với '
      + 'Who has access = Anyone.'), { code: 'NETWORK' });
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch (err) {
    console.error('Phản hồi không phải JSON:', text.slice(0, 500));
    throw Object.assign(new Error('Máy chủ trả về trang HTML thay vì dữ liệu — thường do Web App chưa để '
      + 'Who has access = Anyone, hoặc Apps Script lỗi. Xem Console (F12).'), { code: 'BAD_RESPONSE' });
  }
  if (body.result === 'success' && body.ok === undefined) {
    throw Object.assign(new Error('Apps Script đang chạy bản cũ (chưa có Admin.gs). Vào Deploy → Manage '
      + 'deployments → bút chì → New version → Deploy.'), { code: 'OLD_DEPLOYMENT' });
  }
  if (!body.ok) {
    const error = Object.assign(new Error(body.message), { code: body.code, data: body.data });
    if (body.code === 'AUTH' || body.code === 'NOT_ALLOWED') logout(body.message);
    throw error;
  }
  return body.data;
}

function upsertLead(lead) {
  const i = state.leads.findIndex((l) => l.phone === lead.phone);
  if (i >= 0) state.leads[i] = lead;
  else state.leads.unshift(lead);
}

// ---------- Auth ----------

// Phiên do Apps Script cấp sau khi xác minh Google (hạn SESSION_DAYS trong Admin.gs),
// lưu localStorage để đóng trình duyệt mở lại không phải đăng nhập.
function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (saved?.token && new Date(saved.expiresAt) > new Date()) return saved.token;
  } catch (err) { /* private mode / dữ liệu hỏng */ }
  return '';
}

function saveSession(token, expiresAt) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt })); } catch (err) { /* ignore */ }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ }
}

function setLoginStatus(message, type = '') {
  $('loginStatus').textContent = message;
  $('loginStatus').className = 'login-status ' + type;
}

function initGoogle() {
  if (GOOGLE_CLIENT_ID.includes('PASTE_')) {
    setLoginStatus('Chưa cấu hình GOOGLE_CLIENT_ID trong admin.js. Xem README.md.', 'error');
    return;
  }
  if (!window.google?.accounts?.id) {
    setTimeout(initGoogle, 150);
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (resp) => loginWithGoogle(resp.credential),
    auto_select: true,
  });
  google.accounts.id.renderButton($('googleBtn'), {
    theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill', locale: 'vi',
  });
  if (!state.token) google.accounts.id.prompt();
}

function applyInit(data) {
  state.me = data.me;
  state.users = data.users;
  state.leads = data.leads;
  showApp();
}

async function loginWithGoogle(idToken) {
  setLoginStatus('Đang đăng nhập...');
  try {
    const data = await api('login', { idToken });
    state.token = data.session;
    saveSession(data.session, data.sessionExpiresAt);
    applyInit(data);
  } catch (err) {
    if (err.code !== 'AUTH' && err.code !== 'NOT_ALLOWED') setLoginStatus(err.message, 'error');
  }
}

async function resumeSession(token) {
  state.token = token;
  setLoginStatus('Đang tải dữ liệu...');
  try {
    applyInit(await api('init'));
  } catch (err) {
    if (err.code !== 'AUTH' && err.code !== 'NOT_ALLOWED') setLoginStatus(err.message, 'error');
  }
}

function logout(message = '') {
  state.token = '';
  state.me = null;
  clearSession();
  window.google?.accounts?.id?.disableAutoSelect();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  $('appView').hidden = true;
  $('loginView').hidden = false;
  setLoginStatus(message, message ? 'error' : '');
}

function showApp() {
  $('loginView').hidden = true;
  $('appView').hidden = false;
  $('meName').textContent = state.me.name;
  $('meRole').textContent = state.me.role;
  document.querySelectorAll('[data-admin-only]').forEach((el) => {
    el.hidden = state.me.role !== 'ADMIN';
  });
  renderSaleFilter();
  renderLeads();
}

// ---------- Danh sách ----------

const FILTERS = [
  { key: 'all', label: 'Tất cả', test: () => true },
  { key: 'mine', label: 'Của tôi', test: (l) => l.assigned_email === state.me.email },
  { key: 'today', label: 'Gọi lại hôm nay', test: isDueToday },
  { key: 'active', label: 'Đang chăm sóc', test: isActive },
  ...Object.keys(STATUS).map((key) => ({ key, label: STATUS[key].label, test: (l) => l.status === key })),
];

function matchSale(lead) {
  if (!state.sale) return true;
  if (state.sale === '__none') return !lead.assigned_email;
  return lead.assigned_email === state.sale;
}

function matchQuery(lead, query) {
  const digits = query.replace(/\D/g, '');
  if (digits.length >= 3) {
    let d = digits;
    if (d.startsWith('84') && d.length >= 11) d = '0' + d.slice(2);
    return lead.phone.includes(d) || lead.phone.includes(d.replace(/^0+/, ''));
  }
  const text = query.trim().toLowerCase();
  return !!text && !/\d/.test(text) && String(lead.customer_name).toLowerCase().includes(text);
}

function renderStats() {
  const leads = state.leads;
  const stats = [
    { key: 'NEW', label: 'Chưa chăm sóc', value: leads.filter((l) => l.status === 'NEW').length, color: 'gray' },
    { key: 'active', label: 'Đang chăm sóc', value: leads.filter(isActive).length, color: 'blue' },
    { key: 'today', label: 'Gọi lại hôm nay', value: leads.filter(isDueToday).length, color: 'orange' },
    { key: 'CLOSED', label: 'Đã chốt', value: leads.filter((l) => l.status === 'CLOSED').length, color: 'green' },
  ];
  $('stats').innerHTML = stats.map((s) => `
    <button type="button" class="stat ${s.color} ${state.filter === s.key ? 'active' : ''}" data-filter="${s.key}">
      <span class="stat-value">${s.value}</span>
      <span class="stat-label">${esc(s.label)}</span>
    </button>`).join('');
}

function renderChips() {
  const base = state.leads.filter(matchSale);
  $('chips').innerHTML = FILTERS.map((f) => {
    const count = base.filter(f.test).length;
    return `<button type="button" class="chip ${state.filter === f.key ? 'active' : ''}" data-filter="${f.key}">
      ${esc(f.label)} <span class="count">${count}</span></button>`;
  }).join('');
}

function renderSaleFilter() {
  const options = [['', 'Tất cả Sales'], ['__none', 'Chưa ai nhận']]
    .concat(state.users.map((u) => [u.email, u.name + (u.active ? '' : ' (đã khoá)')]));
  $('saleFilter').innerHTML = options
    .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
  $('saleFilter').value = state.sale;
}

function renderSearchResult() {
  const box = $('searchResult');
  const phone = normalizePhone(state.query);
  if (!phone) {
    box.innerHTML = '';
    return;
  }
  const lead = state.leads.find((l) => l.phone === phone);
  if (!lead) {
    box.innerHTML = `
      <div class="result missing">
        <div><strong>${esc(phone)}</strong> — Chưa có trong hệ thống.</div>
        <button type="button" class="btn primary" data-add-phone="${esc(phone)}">Thêm khách</button>
      </div>`;
    return;
  }
  box.innerHTML = `
    <div class="result found">
      ${leadSummary(lead)}
      <button type="button" class="btn primary" data-open="${esc(lead.phone)}">Mở chi tiết</button>
    </div>`;
}

function leadSummary(lead) {
  return `
    <dl class="summary">
      <dt>SĐT</dt><dd><strong>${esc(lead.phone)}</strong>${lead.customer_name ? ' · ' + esc(lead.customer_name) : ''}</dd>
      <dt>Trạng thái</dt><dd>${badge(lead.status)}</dd>
      <dt>Sales phụ trách</dt><dd>${lead.assigned_email ? esc(userName(lead.assigned_email)) : 'Chưa ai nhận'}</dd>
      <dt>Lần chăm sóc gần nhất</dt><dd>${fmtFull(lead.last_contacted_at)}</dd>
      <dt>Hẹn gọi lại</dt><dd>${fmtFull(lead.next_followup_at)}</dd>
      <dt>Ghi chú</dt><dd class="pre">${esc(lead.note) || '-'}</dd>
    </dl>`;
}

function visibleLeads() {
  if (state.query.trim()) {
    // Khi tìm kiếm thì tìm trong toàn bộ khách, bỏ qua bộ lọc.
    return state.leads.filter((l) => matchQuery(l, state.query));
  }
  const filter = FILTERS.find((f) => f.key === state.filter) || FILTERS[0];
  const list = state.leads.filter((l) => matchSale(l) && filter.test(l));
  if (state.filter === 'today' || state.filter === 'CALLBACK') {
    return list.sort((a, b) => String(a.next_followup_at).localeCompare(String(b.next_followup_at)));
  }
  return list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

function renderLeads() {
  renderStats();
  renderChips();
  renderSearchResult();

  const list = visibleLeads();
  const shown = list.slice(0, MAX_ROWS);
  $('leadRows').innerHTML = shown.map((lead) => `
    <tr data-open="${esc(lead.phone)}" class="${lead.assigned_email === state.me.email ? 'mine' : ''}">
      <td data-label="SĐT" class="phone">${esc(lead.phone)}</td>
      <td data-label="Khách hàng">${esc(lead.customer_name) || '-'}</td>
      <td data-label="Sales">${esc(saleLabel(lead))}</td>
      <td data-label="Trạng thái">${badge(lead.status)}</td>
      <td data-label="Chăm sóc cuối">${fmtShort(lead.last_contacted_at)}</td>
      <td data-label="Gọi lại" class="${followupClass(lead)}">${fmtShort(lead.next_followup_at)}</td>
      <td data-label="Ghi chú" class="note">${esc(lead.note) || '-'}</td>
    </tr>`).join('');

  let info = '';
  if (!list.length) info = state.query.trim() ? 'Không tìm thấy khách phù hợp.' : 'Không có khách nào.';
  else if (list.length > shown.length) info = `Hiển thị ${shown.length}/${list.length} khách — dùng tìm kiếm hoặc bộ lọc để thu hẹp.`;
  else if (state.query.trim()) info = `Tìm thấy ${list.length} khách (trong tất cả khách).`;
  $('listInfo').textContent = info;
}

async function refresh(silent = false) {
  try {
    const data = await api('list');
    state.leads = data.leads;
    renderLeads();
    if (!silent) toast('Đã tải lại dữ liệu.');
  } catch (err) {
    if (!silent) toast(err.message, 'error');
  }
}

// ---------- Chi tiết khách ----------

function canEdit(lead) {
  return state.me.role === 'ADMIN' || lead.assigned_email === state.me.email;
}

function openLead(phone) {
  const lead = state.leads.find((l) => l.phone === phone);
  if (!lead) return;
  state.openPhone = phone;
  renderLeadDialog(lead);
  if (!$('leadDialog').open) $('leadDialog').showModal();
  loadHistory(phone);
}

function renderLeadDialog(lead) {
  const isAdmin = state.me.role === 'ADMIN';
  const editable = canEdit(lead);

  let assignment;
  if (!lead.assigned_email) {
    assignment = `<div class="notice gray"><span>Chưa ai nhận chăm sóc.</span>
      <button type="button" class="btn primary" data-claim="${esc(lead.phone)}">Nhận chăm sóc</button></div>`;
  } else if (lead.assigned_email === state.me.email) {
    assignment = '<div class="notice green">Bạn đang phụ trách số này.</div>';
  } else {
    assignment = `<div class="notice orange"><span>Đang được <strong>${esc(userName(lead.assigned_email))}</strong> chăm sóc.</span></div>`;
  }

  const adminAssign = isAdmin ? `
    <div class="assign-row">
      <select id="assignSelect" aria-label="Chuyển cho Sales">
        <option value="">— Chưa ai —</option>
        ${state.users.filter((u) => u.active).map((u) => `
          <option value="${esc(u.email)}" ${u.email === lead.assigned_email ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
      </select>
      <button type="button" class="btn ghost" data-assign="${esc(lead.phone)}">Chuyển khách</button>
    </div>` : '';

  const statusOptions = Object.keys(STATUS)
    .filter((key) => isAdmin || key !== 'NEW' || lead.status === 'NEW')
    .map((key) => `<option value="${key}" ${key === lead.status ? 'selected' : ''}>${esc(STATUS[key].label)}</option>`)
    .join('');

  const form = editable ? `
    <form id="updateForm" class="update-form" data-phone="${esc(lead.phone)}">
      <label class="field">
        <span>Tên khách hàng</span>
        <input name="customerName" type="text" value="${esc(lead.customer_name)}" autocomplete="off">
      </label>
      <label class="field">
        <span>Trạng thái</span>
        <select name="status">${statusOptions}</select>
      </label>
      <label class="field">
        <span>Ghi chú</span>
        <textarea name="note" rows="3">${esc(lead.note)}</textarea>
      </label>
      <label class="field">
        <span>Ngày gọi lại</span>
        <input name="followupAt" type="datetime-local" value="${toLocalInput(lead.next_followup_at)}">
      </label>
      <div class="quick">
        <button type="button" class="chip" data-quick="2h">+2 giờ</button>
        <button type="button" class="chip" data-quick="tomorrow9">Sáng mai 9:00</button>
        <button type="button" class="chip" data-quick="tomorrow14">Chiều mai 14:00</button>
        <button type="button" class="chip" data-quick="clear">Bỏ hẹn</button>
      </div>
      <button type="submit" class="btn primary block">LƯU</button>
    </form>` : leadSummary(lead);

  $('leadDialogBody').innerHTML = `
    <div class="dialog-inner">
      <div class="dialog-head">
        <div>
          <h2 class="phone-title">${esc(lead.phone)}</h2>
          <div class="sub">${badge(lead.status)} · Nguồn: ${esc(lead.source) || '-'} · Tạo: ${fmtFull(lead.created_at)}</div>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Đóng">×</button>
      </div>
      <div class="contact-row">
        <a class="btn ghost" href="tel:${esc(lead.phone)}">Gọi</a>
        <a class="btn ghost" href="https://zalo.me/${esc(lead.phone)}" target="_blank" rel="noopener">Zalo</a>
        <button type="button" class="btn ghost" data-copy="${esc(lead.phone)}">Copy SĐT</button>
      </div>
      ${assignment}
      ${adminAssign}
      ${form}
      <h3 class="history-title">Lịch sử chăm sóc</h3>
      <div id="historyList" class="timeline"><p class="muted">Đang tải...</p></div>
    </div>`;
}

function describeActivity(a) {
  const who = esc(a.user_name || a.user_email || 'Hệ thống');
  const lines = [];
  switch (a.action) {
    case 'CREATE':
      lines.push(`${who} thêm số vào hệ thống${a.new_status && a.new_status !== 'NEW' ? ' và nhận chăm sóc' : ''}.`);
      break;
    case 'CLAIM':
      lines.push(`${who} nhận khách.`);
      break;
    case 'ASSIGN':
      lines.push(`${who} chuyển khách. ${esc(a.note)}`);
      break;
    case 'FORM':
      lines.push(esc(a.note));
      break;
    default:
      lines.push(`${who} cập nhật.`);
  }
  if (a.old_status && a.new_status) {
    lines.push(`Trạng thái: ${esc(STATUS[a.old_status]?.label || a.old_status)} → ${esc(STATUS[a.new_status]?.label || a.new_status)}`);
  }
  if (a.note && (a.action === 'UPDATE' || a.action === 'CREATE')) {
    lines.push(`Ghi chú: <span class="pre">${esc(a.note)}</span>`);
  }
  if (a.followup_at) {
    lines.push(a.followup_at === 'CLEARED' ? 'Bỏ hẹn gọi lại' : `Hẹn gọi lại: ${fmtFull(a.followup_at)}`);
  }
  return lines.join('<br>');
}

function renderTimeline(activities, withPhone) {
  if (!activities.length) return '<p class="muted">Chưa có hoạt động.</p>';
  return activities.map((a) => `
    <div class="tl-item">
      <div class="tl-time">${fmtFull(a.created_at)}
        ${withPhone ? `· <button type="button" class="link" data-open="${esc(a.phone)}">${esc(a.phone)}</button>` : ''}</div>
      <div class="tl-body">${describeActivity(a)}</div>
    </div>`).join('');
}

async function loadHistory(phone) {
  try {
    const data = await api('history', { phone });
    if (state.openPhone === phone && $('historyList')) {
      $('historyList').innerHTML = renderTimeline(data.activities, false);
    }
  } catch (err) {
    if ($('historyList')) $('historyList').innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
  }
}

// Lỗi kèm dữ liệu mới nhất (VD: người khác vừa nhận) thì cập nhật lại giao diện.
function handleLeadError(err) {
  if (err.data?.lead) {
    upsertLead(err.data.lead);
    renderLeads();
    if (state.openPhone === err.data.lead.phone && $('leadDialog').open) openLead(err.data.lead.phone);
  }
  toast(err.message, 'error');
}

async function runLeadAction(button, action, params, successMessage) {
  button.disabled = true;
  try {
    const data = await api(action, params);
    upsertLead(data.lead);
    renderLeads();
    if ($('leadDialog').open) openLead(data.lead.phone);
    toast(successMessage, 'success');
  } catch (err) {
    handleLeadError(err);
  } finally {
    button.disabled = false;
  }
}

function quickFollowup(kind) {
  const d = new Date();
  if (kind === '2h') d.setHours(d.getHours() + 2);
  else {
    d.setDate(d.getDate() + 1);
    d.setHours(kind === 'tomorrow9' ? 9 : 14, 0, 0, 0);
  }
  return toLocalInput(d.toISOString());
}

// ---------- Thêm khách ----------

function openAddDialog(phone = '') {
  const form = $('addForm');
  form.reset();
  form.phone.value = phone;
  checkAddPhone();
  $('addDialog').showModal();
  form.phone.focus();
}

function duplicateBox(lead) {
  return `
    <div class="duplicate">
      <div class="duplicate-title">SỐ ĐIỆN THOẠI ĐÃ TỒN TẠI</div>
      <dl class="summary">
        <dt>Sales phụ trách</dt><dd>${lead.assigned_email ? esc(userName(lead.assigned_email)) : 'Chưa ai nhận'}</dd>
        <dt>Trạng thái</dt><dd>${badge(lead.status)}</dd>
        <dt>Lần chăm sóc</dt><dd>${fmtFull(lead.last_contacted_at)}</dd>
      </dl>
      <button type="button" class="btn ghost" data-open="${esc(lead.phone)}">Mở khách này</button>
    </div>`;
}

function checkAddPhone() {
  const raw = $('addForm').phone.value;
  const phone = normalizePhone(raw);
  const box = $('addPhoneCheck');
  const existing = phone && state.leads.find((l) => l.phone === phone);
  $('addSubmit').disabled = !phone || !!existing;
  if (existing) box.innerHTML = duplicateBox(existing);
  else if (phone) box.innerHTML = `<p class="hint ok">Sẽ lưu thành: <strong>${esc(phone)}</strong></p>`;
  else if (raw.replace(/\D/g, '').length >= 9) box.innerHTML = '<p class="hint bad">Số điện thoại chưa hợp lệ.</p>';
  else box.innerHTML = '';
}

async function submitAdd(event) {
  event.preventDefault();
  const form = $('addForm');
  const phone = normalizePhone(form.phone.value);
  if (!phone) return;
  $('addSubmit').disabled = true;
  try {
    const data = await api('create', {
      phone,
      customerName: form.customerName.value,
      note: form.note.value,
      claim: form.claim.checked,
    });
    upsertLead(data.lead);
    $('addDialog').close();
    state.query = '';
    $('searchInput').value = '';
    renderLeads();
    toast('Đã thêm ' + phone, 'success');
  } catch (err) {
    if (err.code === 'DUPLICATE' && err.data?.lead) {
      upsertLead(err.data.lead);
      renderLeads();
      $('addPhoneCheck').innerHTML = duplicateBox(err.data.lead);
    } else {
      toast(err.message, 'error');
      $('addSubmit').disabled = false;
    }
  }
}

// ---------- Tab admin ----------

async function loadActivityTab() {
  $('activityList').innerHTML = '<p class="muted">Đang tải...</p>';
  try {
    const data = await api('activities');
    $('activityList').innerHTML = renderTimeline(data.activities, true);
  } catch (err) {
    $('activityList').innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
  }
}

function renderSalesTab() {
  const rows = state.users.map((u) => {
    const own = state.leads.filter((l) => l.assigned_email === u.email);
    return `<tr>
      <td>${esc(u.name)}${u.active ? '' : ' <span class="muted">(đã khoá)</span>'}</td>
      <td>${esc(u.email)}</td>
      <td>${esc(u.role)}</td>
      <td>${own.filter(isActive).length}</td>
      <td>${own.filter(isDueToday).length}</td>
      <td>${own.filter((l) => l.status === 'CLOSED').length}</td>
    </tr>`;
  });
  const unassigned = state.leads.filter((l) => !l.assigned_email).length;
  rows.push(`<tr class="muted"><td colspan="3">Chưa ai nhận</td><td colspan="3">${unassigned}</td></tr>`);
  $('salesRows').innerHTML = rows.join('');
}

function switchTab(tab) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  ['leads', 'activity', 'sales'].forEach((t) => { $('tab-' + t).hidden = t !== tab; });
  if (tab === 'activity') loadActivityTab();
  if (tab === 'sales') renderSalesTab();
}

// ---------- Sự kiện ----------

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-filter],[data-open],[data-add-phone],[data-close],[data-claim],[data-assign],[data-copy],[data-quick],[data-tab]');
  if (!el) return;
  const d = el.dataset;

  if (d.tab) switchTab(d.tab);
  else if (d.filter) {
    state.filter = d.filter;
    state.query = '';
    $('searchInput').value = '';
    renderLeads();
  } else if (d.open) {
    if ($('addDialog').open) $('addDialog').close();
    openLead(d.open);
  } else if (d.addPhone) openAddDialog(d.addPhone);
  else if ('close' in d) el.closest('dialog').close();
  else if (d.claim) runLeadAction(el, 'claim', { phone: d.claim }, 'Đã nhận chăm sóc.');
  else if (d.assign) {
    runLeadAction(el, 'assign', { phone: d.assign, assignedEmail: $('assignSelect').value }, 'Đã chuyển khách.');
  } else if (d.copy) {
    navigator.clipboard?.writeText(d.copy).then(() => toast('Đã copy ' + d.copy));
  } else if (d.quick) {
    $('updateForm').followupAt.value = d.quick === 'clear' ? '' : quickFollowup(d.quick);
  }
});

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'updateForm') return;
  event.preventDefault();
  const form = event.target;
  const followup = form.followupAt.value ? new Date(form.followupAt.value).toISOString() : '';
  runLeadAction(form.querySelector('[type=submit]'), 'update', {
    phone: form.dataset.phone,
    customerName: form.customerName.value,
    status: form.status.value,
    note: form.note.value,
    followupAt: followup,
  }, 'Đã lưu.');
});

$('searchInput').addEventListener('input', (event) => {
  state.query = event.target.value;
  renderLeads();
});

$('searchInput').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const phone = normalizePhone(state.query);
  if (!phone) return;
  if (state.leads.some((l) => l.phone === phone)) openLead(phone);
  else openAddDialog(phone);
});

$('saleFilter').addEventListener('change', (event) => {
  state.sale = event.target.value;
  renderLeads();
});

$('addBtn').addEventListener('click', () => openAddDialog(normalizePhone(state.query)));
$('addForm').addEventListener('submit', submitAdd);
$('addForm').phone.addEventListener('input', checkAddPhone);
$('refreshBtn').addEventListener('click', () => refresh(false));
$('logoutBtn').addEventListener('click', () => logout());
$('leadDialog').addEventListener('close', () => { state.openPhone = ''; });

// Tự tải lại để thấy khách mới / thay đổi của Sales khác (bỏ qua khi đang mở hộp thoại).
setInterval(() => {
  if (state.me && !document.hidden && !document.querySelector('dialog[open]')) refresh(true);
}, AUTO_REFRESH_MS);

document.addEventListener('visibilitychange', () => {
  if (state.me && !document.hidden && !document.querySelector('dialog[open]')) refresh(true);
});

// ---------- Khởi động ----------

// Khôi phục phiên trước khi initGoogle để không bật One Tap khi đã đăng nhập.
const savedSession = loadSession();
if (savedSession) resumeSession(savedSession);
initGoogle();

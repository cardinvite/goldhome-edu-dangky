// Giống WEB_APP_URL trong script.js — cùng một Apps Script Web App.
const API_URL = 'https://script.google.com/macros/s/AKfycbz6dZx1Di5-LRpmnewqeWIsMB3TK6pk1q9R9ucmWE0BN0rFVm-hdcJTM2ZwxNO29qdqYw/exec';
// OAuth Client ID tạo trong Google Cloud Console — xem README.md.
const GOOGLE_CLIENT_ID = '884064042089-drsbl39b8utv2rttar95aaoea45pstt8.apps.googleusercontent.com';

const SESSION_KEY = 'goldhome_admin_session';
// Bản sao dữ liệu lần trước (theo phiên) để mở trang hiện ngay, rồi cập nhật ngầm. Xoá khi đăng xuất.
// Không lưu dữ liệu tab Đăng ký (có CCCD).
const SNAPSHOT_KEY = 'goldhome_admin_snapshot';
const AUTO_REFRESH_MS = 60 * 1000;
const MAX_ROWS = 300;

// Trạng thái do ADMIN quản lý (tab Statuses), nạp từ server qua applyStatuses().
// Giá trị dưới đây chỉ là mặc định khi server chưa trả về danh sách.
let STATUS = {
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
let DONE_STATUSES = ['CLOSED', 'NOT_INTERESTED', 'INVALID'];
// Gắn với logic (số mới / nhận chăm sóc / thống kê "Đã chốt") — chỉ đổi tên, màu.
const SYSTEM_STATUSES = ['NEW', 'CALLING', 'CLOSED'];
const STATUS_COLORS = ['gray', 'blue', 'teal', 'green', 'orange', 'red', 'purple', 'dark'];

function applyStatuses(list) {
  if (!Array.isArray(list) || !list.length) return;
  state.statuses = list;
  STATUS = Object.fromEntries(list.map((st) => [st.key, st]));
  DONE_STATUSES = list.filter((st) => st.done).map((st) => st.key);
}

// Hai mảng kinh doanh — mỗi mảng là một danh sách khách riêng (cùng SĐT có thể có ở cả hai).
const SEGMENTS = {
  DAO_TAO: { label: 'Đào tạo', short: 'ĐT' },
  XAY_DUNG: { label: 'Xây dựng', short: 'XD' },
};
const SEGMENT_KEY = 'goldhome_admin_segment';

const state = {
  token: '',
  me: null,
  users: [],
  leads: [],
  filter: 'all',
  sale: '',
  query: '',
  openKey: '', // "<segment>|<phone>" của khách đang mở
  segment: loadSegment(),
  tab: 'leads',
  regs: null, // tải khi mở tab "Đăng ký"
  reg: { range: 'all', course: '', mode: '', payment: '', query: '' },
};

const $ = (id) => document.getElementById(id);

function loadSegment() {
  try {
    const saved = localStorage.getItem(SEGMENT_KEY);
    if (SEGMENTS[saved]) return saved;
  } catch (err) { /* ignore */ }
  return 'DAO_TAO';
}

function setSegment(segment) {
  if (!SEGMENTS[segment]) return;
  state.segment = segment;
  try { localStorage.setItem(SEGMENT_KEY, segment); } catch (err) { /* ignore */ }
}

function segLabel(segment) {
  return SEGMENTS[segment]?.label || segment;
}

function segTag(segment) {
  return `<span class="seg-tag ${esc(segment)}">${esc(segLabel(segment))}</span>`;
}

function findLead(segment, phone) {
  return state.leads.find((l) => l.segment === segment && l.phone === phone);
}

// Khách của mảng đang xem.
function segLeads() {
  return state.leads.filter((l) => l.segment === state.segment);
}

function otherSegmentLeads(phone, segment) {
  return state.leads.filter((l) => l.phone === phone && l.segment !== segment);
}

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
  const s = STATUS[status] || { label: status || '-', color: 'gray' };
  return `<span class="badge ${esc(s.color)}">${esc(s.label)}</span>`;
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
  const i = state.leads.findIndex((l) => l.segment === lead.segment && l.phone === lead.phone);
  if (i >= 0) state.leads[i] = lead;
  else state.leads.unshift(lead);
  saveSnapshot();
}

function removeLead(segment, phone) {
  state.leads = state.leads.filter((l) => !(l.segment === segment && l.phone === phone));
  saveSnapshot();
}

// Thao tác đang gửi lên máy chủ: "<segment>|<phone>" → bản khách đã hiện trước trên giao diện.
const pendingLeads = new Map();
// Khách thêm thành công trong phiên này (để danh sách tải về muộn không làm "mất" khách vừa thêm).
const createdLeads = new Set();

// Ghép danh sách vừa tải về với dữ liệu trên trang. Lần tải có thể gửi đi trước khi một thao tác
// lưu xong nhưng về sau → mang bản cũ. Vì vậy giữ bản trên trang khi:
// - khách đang chờ lưu, hoặc
// - bản trên trang có updated_at mới hơn (máy chủ đã xác nhận thay đổi sau thời điểm đọc).
function mergeFetched(leads) {
  const local = new Map(state.leads.map((l) => [l.segment + '|' + l.phone, l]));
  const out = leads.map((l) => {
    const key = l.segment + '|' + l.phone;
    if (pendingLeads.has(key)) return pendingLeads.get(key);
    const mine = local.get(key);
    return mine && timeOf(mine.updated_at) > timeOf(l.updated_at) ? mine : l;
  });
  const keys = new Set(out.map((l) => l.segment + '|' + l.phone));
  pendingLeads.forEach((lead, key) => { if (!keys.has(key)) out.unshift(lead); });
  createdLeads.forEach((key) => { if (!keys.has(key) && local.has(key)) out.unshift(local.get(key)); });
  return out;
}

function timeOf(value) {
  const t = value ? new Date(value).getTime() : 0;
  return Number.isNaN(t) ? 0 : t;
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
  applyStatuses(data.statuses);
  state.leads = mergeFetched(data.leads);
  showApp();
}

function saveSnapshot() {
  if (!state.me || !state.token) return;
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      token: state.token,
      data: { me: state.me, users: state.users, statuses: state.statuses, leads: state.leads },
    }));
  } catch (err) { /* hết dung lượng / private mode: bỏ qua */ }
}

function loadSnapshot(token) {
  try {
    const snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
    return snap && snap.token === token ? snap.data : null;
  } catch (err) {
    return null;
  }
}

function clearSnapshot() {
  try { localStorage.removeItem(SNAPSHOT_KEY); } catch (err) { /* ignore */ }
}

let syncCount = 0;
function setSyncing(on) {
  syncCount = Math.max(0, syncCount + (on ? 1 : -1));
  $('syncStatus').hidden = syncCount === 0;
}

// Sau khi có dữ liệu mới nhất: lưu bản sao và tải trước tab Đăng ký trong nền.
function afterFreshData() {
  saveSnapshot();
  if (!state.regs) loadRegistrations(true);
}

async function loginWithGoogle(idToken) {
  setLoginStatus('Đang đăng nhập...');
  try {
    const data = await api('login', { idToken });
    state.token = data.session;
    saveSession(data.session, data.sessionExpiresAt);
    applyInit(data);
    afterFreshData();
  } catch (err) {
    if (err.code !== 'AUTH' && err.code !== 'NOT_ALLOWED') setLoginStatus(err.message, 'error');
  }
}

async function resumeSession(token) {
  state.token = token;
  // Có bản sao lần trước → hiện ngay, dữ liệu mới về sẽ thay thế.
  const snapshot = loadSnapshot(token);
  if (snapshot) applyInit(snapshot);
  else setLoginStatus('Đang tải dữ liệu...');
  setSyncing(true);
  try {
    const data = await api('init');
    if (!state.token) return; // đã đăng xuất trong lúc chờ
    const openDialog = document.querySelector('dialog[open]');
    state.me = data.me;
    state.users = data.users;
    applyStatuses(data.statuses);
    state.leads = data.leads;
    if (snapshot && openDialog) renderLeads(); // đang thao tác thì chỉ cập nhật bảng
    else showApp();
    afterFreshData();
  } catch (err) {
    if (err.code === 'AUTH' || err.code === 'NOT_ALLOWED') return;
    if (snapshot) toast('Không cập nhật được dữ liệu mới: ' + err.message, 'error');
    else setLoginStatus(err.message, 'error');
  } finally {
    setSyncing(false);
  }
}

function logout(message = '') {
  state.token = '';
  state.me = null;
  state.regs = null;
  clearSession();
  clearSnapshot();
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

// Trạng thái ngừng dùng vẫn hiện bộ lọc nếu còn khách đang ở trạng thái đó.
function getFilters() {
  const leads = segLeads();
  return [
    { key: 'all', label: 'Tất cả', test: () => true },
    { key: 'mine', label: 'Của tôi', test: (l) => l.assigned_email === state.me.email },
    { key: 'today', label: 'Gọi lại hôm nay', test: isDueToday },
    { key: 'active', label: 'Đang chăm sóc', test: isActive },
    ...Object.keys(STATUS)
      .filter((key) => STATUS[key].active !== false || leads.some((l) => l.status === key))
      .map((key) => ({ key, label: STATUS[key].label, test: (l) => l.status === key })),
  ];
}

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

function renderSegmentTabs() {
  $('segmentTabs').innerHTML = Object.keys(SEGMENTS).map((key) => {
    const leads = state.leads.filter((l) => l.segment === key);
    return `<button type="button" class="segment ${key} ${state.segment === key ? 'active' : ''}" data-segment="${key}">
      <span class="segment-name">${esc(segLabel(key))}</span>
      <span class="segment-meta">${leads.length} khách · ${leads.filter((l) => l.status === 'NEW').length} chưa chăm sóc</span>
    </button>`;
  }).join('');
}

function renderStats() {
  const leads = segLeads();
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
  const base = segLeads().filter(matchSale);
  $('chips').innerHTML = getFilters().map((f) => {
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
  const lead = findLead(state.segment, phone);
  const others = otherSegmentLeads(phone, state.segment).map((o) => `
    <div class="other-seg">Số này cũng có ở mảng ${segTag(o.segment)}: ${badge(o.status)}
      · ${o.assigned_email ? esc(userName(o.assigned_email)) : 'Chưa ai nhận'}
      <button type="button" class="link" data-open="${esc(o.phone)}" data-seg="${esc(o.segment)}">Mở</button></div>`).join('');
  if (!lead) {
    box.innerHTML = `
      <div class="result missing">
        <div><strong>${esc(phone)}</strong> — Chưa có trong mảng ${esc(segLabel(state.segment))}.${others}</div>
        <button type="button" class="btn primary" data-add-phone="${esc(phone)}">Thêm khách</button>
      </div>`;
    return;
  }
  box.innerHTML = `
    <div class="result found">
      <div>${leadSummary(lead)}${others}</div>
      <button type="button" class="btn primary" data-open="${esc(lead.phone)}" data-seg="${esc(lead.segment)}">Mở chi tiết</button>
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
    // Khi tìm kiếm thì tìm trong toàn bộ khách của mảng, bỏ qua bộ lọc.
    return segLeads().filter((l) => matchQuery(l, state.query));
  }
  const filters = getFilters();
  const filter = filters.find((f) => f.key === state.filter) || filters[0];
  const list = segLeads().filter((l) => matchSale(l) && filter.test(l));
  if (state.filter === 'today' || state.filter === 'CALLBACK') {
    return list.sort((a, b) => String(a.next_followup_at).localeCompare(String(b.next_followup_at)));
  }
  return list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

function renderLeads() {
  renderSegmentTabs();
  renderStats();
  renderChips();
  renderSearchResult();

  const list = visibleLeads();
  const shown = list.slice(0, MAX_ROWS);
  $('leadRows').innerHTML = shown.map((lead) => `
    <tr data-open="${esc(lead.phone)}" data-seg="${esc(lead.segment)}" class="${lead.assigned_email === state.me.email ? 'mine' : ''}">
      <td data-label="SĐT" class="phone">${esc(lead.phone)}</td>
      <td data-label="Khách hàng">${esc(lead.customer_name) || '-'}</td>
      <td data-label="Sales">${esc(saleLabel(lead))}</td>
      <td data-label="Trạng thái">${badge(lead.status)}</td>
      <td data-label="Chăm sóc cuối">${fmtShort(lead.last_contacted_at)}</td>
      <td data-label="Gọi lại" class="${followupClass(lead)}">${fmtShort(lead.next_followup_at)}</td>
      <td data-label="Ghi chú" class="note">${esc(lead.note) || '-'}</td>
    </tr>`).join('');

  let info = '';
  if (!list.length) info = state.query.trim() ? 'Không tìm thấy khách phù hợp.' : `Mảng ${segLabel(state.segment)} chưa có khách nào phù hợp.`;
  else if (list.length > shown.length) info = `Hiển thị ${shown.length}/${list.length} khách — dùng tìm kiếm hoặc bộ lọc để thu hẹp.`;
  else if (state.query.trim()) info = `Tìm thấy ${list.length} khách (trong toàn bộ mảng ${segLabel(state.segment)}).`;
  $('listInfo').textContent = info;
  // Tab khác cũng hiện sale phụ trách → vẽ lại nếu đang mở.
  if (state.tab === 'sales') renderSalesTab();
  if (state.tab === 'registrations' && state.regs) renderRegs();
}

// fresh = bỏ qua cache phía server (nút "Tải lại").
async function refresh(silent = false, fresh = false) {
  setSyncing(true);
  try {
    const data = await api('list', { fresh });
    applyStatuses(data.statuses);
    state.leads = mergeFetched(data.leads);
    renderLeads();
    saveSnapshot();
    if (!silent) toast('Đã tải lại dữ liệu.');
  } catch (err) {
    if (!silent) toast(err.message, 'error');
  } finally {
    setSyncing(false);
  }
}

// ---------- Chi tiết khách ----------

function canEdit(lead) {
  return state.me.role === 'ADMIN' || lead.assigned_email === state.me.email;
}

function openLead(segment, phone) {
  const lead = findLead(segment, phone);
  if (!lead) return;
  state.openKey = segment + '|' + phone;
  renderLeadDialog(lead);
  if (!$('leadDialog').open) $('leadDialog').showModal();
  loadHistory(segment, phone);
}

function renderLeadDialog(lead) {
  const isAdmin = state.me.role === 'ADMIN';
  const editable = canEdit(lead);

  let assignment;
  if (!lead.assigned_email) {
    assignment = `<div class="notice gray"><span>Chưa ai nhận chăm sóc.</span>
      <button type="button" class="btn primary" data-claim="${esc(lead.phone)}" data-seg="${esc(lead.segment)}">Nhận chăm sóc</button></div>`;
  } else if (lead.assigned_email === state.me.email) {
    assignment = '<div class="notice green">Bạn đang phụ trách số này.</div>';
  } else {
    assignment = `<div class="notice orange"><span>Đang được <strong>${esc(userName(lead.assigned_email))}</strong> chăm sóc.</span></div>`;
  }

  // Người đang phụ trách luôn có trong danh sách (kể cả đã khoá), để LƯU không vô tình bỏ người đó.
  const assignees = state.users.filter((u) => u.active || u.email === lead.assigned_email);
  if (lead.assigned_email && !assignees.some((u) => u.email === lead.assigned_email)) {
    assignees.push({ email: lead.assigned_email, name: lead.assigned_email, active: false });
  }
  const adminAssign = isAdmin ? `
      <label class="field">
        <span>Sales phụ trách</span>
        <select name="assignedEmail">
          <option value="">— Chưa ai nhận —</option>
          ${assignees.map((u) => `
            <option value="${esc(u.email)}" ${u.email === lead.assigned_email ? 'selected' : ''}>${esc(u.name)}${u.active ? '' : ' (đã khoá)'}</option>`).join('')}
        </select>
      </label>` : '';

  const statusOptions = Object.keys(STATUS)
    .filter((key) => STATUS[key].active !== false || key === lead.status)
    .filter((key) => isAdmin || key !== 'NEW' || lead.status === 'NEW')
    .map((key) => `<option value="${key}" ${key === lead.status ? 'selected' : ''}>${esc(STATUS[key].label)}</option>`)
    .join('');

  const form = editable ? `
    <form id="updateForm" class="update-form" data-phone="${esc(lead.phone)}" data-seg="${esc(lead.segment)}">
      <label class="field">
        <span>Tên khách hàng</span>
        <input name="customerName" type="text" value="${esc(lead.customer_name)}" autocomplete="off">
      </label>
      ${adminAssign}
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
          <div class="sub">${segTag(lead.segment)} ${badge(lead.status)} · Nguồn: ${esc(lead.source) || '-'} · Tạo: ${fmtFull(lead.created_at)}</div>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Đóng">×</button>
      </div>
      <div class="contact-row">
        <a class="btn ghost" href="tel:${esc(lead.phone)}">Gọi</a>
        <a class="btn ghost" href="https://zalo.me/${esc(lead.phone)}" target="_blank" rel="noopener">Zalo</a>
        <button type="button" class="btn ghost" data-copy="${esc(lead.phone)}">Copy SĐT</button>
      </div>
      ${otherSegmentLeads(lead.phone, lead.segment).map((o) => `
        <div class="other-seg">Số này cũng là khách mảng ${segTag(o.segment)}: ${badge(o.status)}
          · ${o.assigned_email ? esc(userName(o.assigned_email)) : 'Chưa ai nhận'}
          <button type="button" class="link" data-open="${esc(o.phone)}" data-seg="${esc(o.segment)}">Mở</button></div>`).join('')}
      ${assignment}
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
        ${withPhone ? `· ${segTag(a.segment)} <button type="button" class="link" data-open="${esc(a.phone)}" data-seg="${esc(a.segment)}">${esc(a.phone)}</button>` : ''}</div>
      <div class="tl-body">${describeActivity(a)}</div>
    </div>`).join('');
}

async function loadHistory(segment, phone) {
  try {
    const data = await api('history', { segment, phone });
    if (state.openKey === segment + '|' + phone && $('historyList')) {
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
    const lead = err.data.lead;
    if (state.openKey === lead.segment + '|' + lead.phone && $('leadDialog').open) openLead(lead.segment, lead.phone);
  }
  toast(err.message, 'error');
}

function isOpenLead(lead) {
  return $('leadDialog').open && state.openKey === lead.segment + '|' + lead.phone;
}

// Hiện kết quả ngay trên giao diện (predict), gửi lên máy chủ trong nền; máy chủ trả lỗi
// (VD: người khác vừa nhận) thì quay về dữ liệu máy chủ / dữ liệu cũ.
async function runLeadAction(action, params, successMessage, predict) {
  const key = params.segment + '|' + params.phone;
  if (pendingLeads.has(key)) {
    toast('Đang lưu thao tác trước của khách này, đợi giây lát…');
    return;
  }
  const before = findLead(params.segment, params.phone);
  if (!before) return;
  const guess = predict({ ...before, updated_at: new Date().toISOString() });
  pendingLeads.set(key, guess);
  upsertLead(guess);
  renderLeads();
  if (isOpenLead(guess)) {
    const history = $('historyList')?.innerHTML;
    renderLeadDialog(guess);
    if (history) $('historyList').innerHTML = history;
  }
  toast('Đang lưu…');
  setSyncing(true);
  try {
    const data = await api(action, params);
    pendingLeads.delete(key);
    upsertLead(data.lead);
    renderLeads();
    // Không vẽ lại form (người dùng có thể đang gõ tiếp) — chỉ tải lại lịch sử.
    if (isOpenLead(data.lead)) loadHistory(data.lead.segment, data.lead.phone);
    toast(successMessage, 'success');
  } catch (err) {
    pendingLeads.delete(key);
    if (!err.data?.lead) {
      upsertLead(before);
      renderLeads();
      if (isOpenLead(before)) openLead(before.segment, before.phone);
    }
    handleLeadError(err);
  } finally {
    setSyncing(false);
  }
}

function claimLead(segment, phone) {
  runLeadAction('claim', { segment, phone }, 'Đã nhận chăm sóc.', (l) => {
    l.assigned_email = state.me.email;
    l.assigned_name = state.me.name;
    if (l.status === 'NEW') l.status = 'CALLING';
    return l;
  });
}

function updateLead(form) {
  const values = {
    customerName: form.customerName.value.trim(),
    status: form.status.value,
    note: form.note.value.trim(),
    followupAt: form.followupAt.value ? new Date(form.followupAt.value).toISOString() : '',
  };
  if (form.assignedEmail) values.assignedEmail = form.assignedEmail.value; // chỉ ADMIN có ô này
  runLeadAction('update', { segment: form.dataset.seg, phone: form.dataset.phone, ...values }, 'Đã lưu.', (l) => {
    if (values.status !== l.status || values.note !== (l.note || '')) l.last_contacted_at = l.updated_at;
    l.customer_name = values.customerName;
    l.status = values.status;
    l.note = values.note;
    l.next_followup_at = values.followupAt;
    if (values.assignedEmail !== undefined) {
      l.assigned_email = values.assignedEmail;
      l.assigned_name = values.assignedEmail ? userName(values.assignedEmail) : '';
    }
    return l;
  });
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

function openAddDialog(phone = '', customerName = '', segment = state.segment) {
  const form = $('addForm');
  form.reset();
  form.dataset.segment = segment;
  $('addTitle').textContent = 'Thêm SĐT — ' + segLabel(segment);
  form.phone.value = phone;
  form.customerName.value = customerName;
  checkAddPhone();
  $('addDialog').showModal();
  form.phone.focus();
}

function duplicateBox(lead) {
  return `
    <div class="duplicate">
      <div class="duplicate-title">SỐ ĐIỆN THOẠI ĐÃ TỒN TẠI (${esc(segLabel(lead.segment).toUpperCase())})</div>
      <dl class="summary">
        <dt>Sales phụ trách</dt><dd>${lead.assigned_email ? esc(userName(lead.assigned_email)) : 'Chưa ai nhận'}</dd>
        <dt>Trạng thái</dt><dd>${badge(lead.status)}</dd>
        <dt>Lần chăm sóc</dt><dd>${fmtFull(lead.last_contacted_at)}</dd>
      </dl>
      <button type="button" class="btn ghost" data-open="${esc(lead.phone)}" data-seg="${esc(lead.segment)}">Mở khách này</button>
    </div>`;
}

function checkAddPhone() {
  const raw = $('addForm').phone.value;
  const phone = normalizePhone(raw);
  const box = $('addPhoneCheck');
  const segment = $('addForm').dataset.segment;
  const existing = phone && findLead(segment, phone);
  $('addSubmit').disabled = !phone || !!existing;
  if (existing) box.innerHTML = duplicateBox(existing);
  else if (phone) {
    const others = otherSegmentLeads(phone, segment).map((o) =>
      `<p class="hint">Số này đã là khách mảng ${segTag(o.segment)} (${esc(o.assigned_email ? userName(o.assigned_email) : 'chưa ai nhận')}) — vẫn thêm được vào mảng ${esc(segLabel(segment))}.</p>`).join('');
    box.innerHTML = `<p class="hint ok">Sẽ lưu thành: <strong>${esc(phone)}</strong></p>${others}`;
  }
  else if (raw.replace(/\D/g, '').length >= 9) box.innerHTML = '<p class="hint bad">Số điện thoại chưa hợp lệ.</p>';
  else box.innerHTML = '';
}

// Thêm ngay vào danh sách và đóng hộp thoại; máy chủ báo trùng/lỗi thì gỡ ra.
async function submitAdd(event) {
  event.preventDefault();
  const form = $('addForm');
  const phone = normalizePhone(form.phone.value);
  if (!phone) return;
  const segment = form.dataset.segment;
  const key = segment + '|' + phone;
  if (pendingLeads.has(key)) return;
  const params = {
    segment,
    phone,
    customerName: form.customerName.value.trim(),
    note: form.note.value.trim(),
    claim: form.claim.checked,
  };
  const now = new Date().toISOString();
  const guess = {
    phone,
    segment,
    customer_name: params.customerName,
    note: params.note,
    assigned_email: params.claim ? state.me.email : '',
    assigned_name: params.claim ? state.me.name : '',
    status: params.claim ? 'CALLING' : 'NEW',
    last_contacted_at: '',
    next_followup_at: '',
    created_at: now,
    updated_at: now,
    source: 'Nhập tay',
    created_by: state.me.email,
  };
  pendingLeads.set(key, guess);
  upsertLead(guess);
  $('addDialog').close();
  setSegment(segment);
  state.query = '';
  $('searchInput').value = '';
  renderLeads();
  toast('Đang lưu…');
  setSyncing(true);
  try {
    const data = await api('create', params);
    pendingLeads.delete(key);
    createdLeads.add(key);
    upsertLead(data.lead);
    renderLeads();
    toast(`Đã thêm ${phone} vào mảng ${segLabel(segment)}`, 'success');
  } catch (err) {
    pendingLeads.delete(key);
    removeLead(segment, phone);
    if (err.code === 'DUPLICATE' && err.data?.lead) {
      // Người khác vừa thêm số này trước: hiện khách đó.
      upsertLead(err.data.lead);
      renderLeads();
      toast(err.message, 'error');
      if (!document.querySelector('dialog[open]')) openLead(segment, phone);
    } else {
      renderLeads();
      toast(err.message, 'error');
      if (!document.querySelector('dialog[open]')) {
        openAddDialog(phone, params.customerName, segment);
        form.note.value = params.note;
        form.claim.checked = params.claim;
      }
    }
  } finally {
    setSyncing(false);
  }
}

// ---------- Tab Đăng ký (dữ liệu form, tab DangKy) ----------

const REG_RANGES = [
  { key: 'today', label: 'Hôm nay', days: 0 },
  { key: '7d', label: '7 ngày', days: 7 },
  { key: '30d', label: '30 ngày', days: 30 },
  { key: 'all', label: 'Tất cả', days: null },
];

function splitCourses(value) {
  return String(value || '').split(';').map((c) => c.trim()).filter(Boolean);
}

function fmtDate(value) {
  if (!value) return '-';
  // Sheet có thể tự đổi "30/12/1995" thành ngày → nhận về ISO.
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  return value;
}

function regRangeTest(key) {
  const range = REG_RANGES.find((r) => r.key === key);
  if (!range || range.days === null) return () => true;
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - range.days);
  return (r) => new Date(r.created_at) >= from;
}

function regMatches(r, skipRange = false) {
  const f = state.reg;
  if (!skipRange && !regRangeTest(f.range)(r)) return false;
  if (f.course && !splitCourses(r.courses).includes(f.course)) return false;
  if (f.mode && r.study_mode !== f.mode) return false;
  if (f.payment && r.payment !== f.payment) return false;
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 3 && /^[\d\s.+-]+$/.test(q)) {
    return r.phone.includes(digits.replace(/^84/, '0')) || r.phone.includes(digits.replace(/^0+/, ''));
  }
  return [r.name, r.zalo, r.courses, r.phone].some((v) => String(v).toLowerCase().includes(q));
}

function fillSelect(id, allLabel, values, current) {
  $(id).innerHTML = [`<option value="">${esc(allLabel)}</option>`]
    .concat(values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`)).join('');
  $(id).value = values.includes(current) ? current : '';
}

function renderRegFilters() {
  const regs = state.regs;
  const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  fillSelect('regCourse', 'Tất cả khóa học', uniq(regs.flatMap((r) => splitCourses(r.courses))), state.reg.course);
  fillSelect('regMode', 'Tất cả hình thức học', uniq(regs.map((r) => r.study_mode)), state.reg.mode);
  fillSelect('regPayment', 'Tất cả hình thức thanh toán', uniq(regs.map((r) => r.payment)), state.reg.payment);
  state.reg.course = $('regCourse').value;
  state.reg.mode = $('regMode').value;
  state.reg.payment = $('regPayment').value;
}

// Người đăng ký khóa học = khách mảng Đào tạo.
function leadBadgeFor(phone) {
  const lead = findLead('DAO_TAO', phone);
  if (!lead) return '-';
  return `${badge(lead.status)}${lead.assigned_email ? '<br><span class="muted">' + esc(saleLabel(lead)) + '</span>' : ''}`;
}

function filteredRegs() {
  return state.regs.filter((r) => regMatches(r));
}

function renderRegs() {
  if (!state.regs) return;
  const base = state.regs.filter((r) => regMatches(r, true));
  $('regRangeChips').innerHTML = REG_RANGES.map((range) => `
    <button type="button" class="chip ${state.reg.range === range.key ? 'active' : ''}" data-reg-range="${range.key}">
      ${esc(range.label)} <span class="count">${base.filter(regRangeTest(range.key)).length}</span></button>`).join('');

  const list = filteredRegs();
  const shown = list.slice(0, MAX_ROWS);
  $('regRows').innerHTML = shown.map((r) => `
    <tr data-reg="${r.row}">
      <td data-label="Thời gian" class="nowrap">${fmtShort(r.created_at)}</td>
      <td data-label="Họ và tên" class="phone">${esc(r.name)}</td>
      <td data-label="SĐT">${esc(r.phone) || '-'}</td>
      <td data-label="Tên Zalo">${esc(r.zalo) || '-'}</td>
      <td data-label="Khóa học" class="courses"><div class="tags">${splitCourses(r.courses).map((c) => `<span class="course-tag">${esc(c)}</span>`).join('') || '-'}</div></td>
      <td data-label="Hình thức">${esc(r.study_mode) || '-'}</td>
      <td data-label="Thanh toán">${esc(r.payment) || '-'}</td>
      <td data-label="Chăm sóc">${leadBadgeFor(r.phone)}</td>
    </tr>`).join('');

  let info = `${list.length} lượt đăng ký`;
  if (list.length > shown.length) info += ` — hiển thị ${shown.length} mới nhất, dùng tìm kiếm/bộ lọc để thu hẹp`;
  $('regInfo').textContent = list.length ? info + '.' : 'Không có lượt đăng ký nào phù hợp.';
}

async function loadRegistrations(silent = false, fresh = false) {
  if (!state.regs) $('regInfo').textContent = 'Đang tải...';
  try {
    const data = await api('registrations', { fresh });
    state.regs = data.registrations;
    renderRegFilters();
    renderRegs();
  } catch (err) {
    if (!silent) toast(err.message, 'error');
    if (!state.regs) $('regInfo').textContent = err.message;
  }
}

function openReg(row) {
  const r = state.regs?.find((x) => String(x.row) === String(row));
  if (!r) return;
  const lead = findLead('DAO_TAO', r.phone);
  const fields = [
    ['Thời gian', fmtFull(r.created_at)],
    ['Họ và tên', r.name],
    ['Ngày sinh', fmtDate(r.birthday)],
    ['Số CCCD', r.cccd],
    ['Địa chỉ', r.address],
    ['SĐT Zalo', r.phone],
    ['Tên Zalo', r.zalo],
    ['Khóa học', splitCourses(r.courses).join('\n')],
    ['Hình thức học', r.study_mode],
    ['Cam kết', r.commitment],
    ['Thanh toán', r.payment],
  ];
  const phoneOk = !!normalizePhone(r.phone);
  $('regDialogBody').innerHTML = `
    <div class="dialog-inner">
      <div class="dialog-head">
        <div>
          <h2>${esc(r.name)}</h2>
          <div class="sub">Đăng ký lúc ${fmtFull(r.created_at)} · dòng ${r.row} trong tab DangKy</div>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Đóng">×</button>
      </div>
      ${phoneOk ? `<div class="contact-row">
        <a class="btn ghost" href="tel:${esc(r.phone)}">Gọi</a>
        <a class="btn ghost" href="https://zalo.me/${esc(r.phone)}" target="_blank" rel="noopener">Zalo</a>
        <button type="button" class="btn ghost" data-copy="${esc(r.phone)}">Copy SĐT</button>
      </div>` : ''}
      <dl class="summary reg-detail">
        ${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="pre">${esc(v) || '-'}</dd>`).join('')}
      </dl>
      ${lead
        ? `<div class="notice gray"><span>Đã là khách mảng Đào tạo: ${badge(lead.status)}
            ${lead.assigned_email ? ' · ' + esc(userName(lead.assigned_email)) : ' · Chưa ai nhận'}</span>
            <button type="button" class="btn primary" data-open="${esc(lead.phone)}" data-seg="DAO_TAO">Mở khách</button></div>`
        : phoneOk
          ? `<div class="notice gray"><span>Số này chưa có trong mảng Đào tạo.</span>
              <button type="button" class="btn primary" data-add-phone="${esc(r.phone)}" data-add-name="${esc(r.name)}" data-seg="DAO_TAO">Thêm khách</button></div>`
          : ''}
    </div>`;
  $('regDialog').showModal();
}

function exportRegsCsv() {
  const header = ['Thời gian', 'Họ và Tên', 'Ngày sinh', 'Số CCCD', 'Địa chỉ', 'SĐT Zalo', 'Tên Zalo',
    'Khóa học đăng ký', 'Hình thức học', 'Cam kết', 'Phương thức thanh toán'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = filteredRegs().map((r) => [fmtFull(r.created_at), r.name, fmtDate(r.birthday), r.cccd, r.address,
    r.phone, r.zalo, r.courses, r.study_mode, r.commitment, r.payment].map(cell).join(','));
  // BOM để Excel đọc đúng tiếng Việt.
  const blob = new Blob(['\ufeff' + [header.map(cell).join(',')].concat(lines).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dang-ky-${toLocalInput(new Date().toISOString()).slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
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
  const segKeys = Object.keys(SEGMENTS);
  // Mỗi mảng: Đang chăm sóc / Gọi lại hôm nay / Đã chốt.
  const cells = (leads) => segKeys.map((seg) => {
    const list = leads.filter((l) => l.segment === seg);
    return `<td>${list.filter(isActive).length}</td><td>${list.filter(isDueToday).length}</td>`
      + `<td>${list.filter((l) => l.status === 'CLOSED').length}</td>`;
  }).join('');
  const rows = state.users.map((u) => `<tr class="${u.active ? '' : 'inactive'}">
      <td>${esc(u.name)}${u.active ? '' : ' <span class="muted">(đã khoá)</span>'}<br><span class="muted">${esc(u.email)}</span></td>
      <td>${esc(u.role)}</td>
      ${cells(state.leads.filter((l) => l.assigned_email === u.email))}
      <td><div class="row-actions">
        <button type="button" class="btn ghost" data-user-edit="${esc(u.email)}">Sửa</button>
        ${u.email === state.me.email ? '' : `<button type="button" class="btn ghost danger-text" data-user-del="${esc(u.email)}">Xoá</button>`}
      </div></td>
    </tr>`);
  rows.push(`<tr class="muted"><td colspan="2">Chưa ai nhận (số khách)</td>${segKeys.map((seg) =>
    `<td colspan="3">${state.leads.filter((l) => l.segment === seg && !l.assigned_email).length}</td>`).join('')}<td></td></tr>`);
  $('salesRows').innerHTML = rows.join('');
}

// ---------- Quản lý Sales (ADMIN) ----------

function applyUsers(users) {
  state.users = users;
  const me = users.find((u) => u.email === state.me.email);
  if (me) {
    state.me.name = me.name;
    $('meName').textContent = me.name;
  }
  renderSaleFilter();
  renderSalesTab();
  renderLeads();
}

function openUserDialog(email = '') {
  const u = state.users.find((x) => x.email === email);
  const isSelf = !!u && u.email === state.me.email;
  $('userDialogBody').innerHTML = `
    <form id="userForm" class="dialog-inner" data-new="${u ? '' : '1'}" novalidate>
      <div class="dialog-head">
        <h2>${u ? 'Sửa tài khoản' : 'Thêm sales'}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Đóng">×</button>
      </div>
      <label class="field">
        <span>Email Google <span class="req">*</span></span>
        <input name="email" type="email" autocomplete="off" value="${esc(u?.email || '')}" ${u ? 'readonly' : 'required'}
               placeholder="vidu@gmail.com">
      </label>
      <label class="field">
        <span>Tên hiển thị <span class="req">*</span></span>
        <input name="name" type="text" autocomplete="off" value="${esc(u?.name || '')}" required placeholder="VD: Vân Anh">
      </label>
      <label class="field">
        <span>Quyền</span>
        <select name="role" ${isSelf ? 'disabled' : ''}>
          <option value="SALE" ${u?.role !== 'ADMIN' ? 'selected' : ''}>SALE — chăm sóc khách</option>
          <option value="ADMIN" ${u?.role === 'ADMIN' ? 'selected' : ''}>ADMIN — quản lý toàn bộ</option>
        </select>
      </label>
      <label class="check">
        <input name="active" type="checkbox" ${!u || u.active ? 'checked' : ''} ${isSelf ? 'disabled' : ''}>
        <span>Đang hoạt động (bỏ tick = khoá, không cho đăng nhập)</span>
      </label>
      ${isSelf ? '<p class="hint">Bạn không thể tự đổi quyền hoặc tự khoá tài khoản của mình.</p>' : ''}
      <div class="dialog-actions">
        <button type="button" class="btn ghost" data-close>Huỷ</button>
        <button type="submit" class="btn primary">${u ? 'Lưu' : 'Thêm'}</button>
      </div>
    </form>`;
  $('userDialog').showModal();
  $('userForm')[u ? 'name' : 'email'].focus();
}

async function submitUserForm(form) {
  const email = form.email.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Email không hợp lệ.', 'error');
  if (!form.name.value.trim()) return toast('Vui lòng nhập tên.', 'error');
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  try {
    const data = await api('saveUser', {
      isNew: !!form.dataset.new,
      email,
      name: form.name.value,
      role: form.role.value,
      active: form.active.checked,
    });
    $('userDialog').close();
    applyUsers(data.users);
    toast(form.dataset.new ? 'Đã thêm ' + email : 'Đã lưu ' + email, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function openDeleteUser(email) {
  const u = state.users.find((x) => x.email === email);
  if (!u) return;
  const owned = state.leads.filter((l) => l.assigned_email === email);
  const receivers = state.users.filter((x) => x.active && x.email !== email);
  $('userDialogBody').innerHTML = `
    <form id="deleteUserForm" class="dialog-inner" data-email="${esc(email)}">
      <div class="dialog-head">
        <h2>Xoá tài khoản</h2>
        <button type="button" class="icon-btn" data-close aria-label="Đóng">×</button>
      </div>
      <p>Xoá <strong>${esc(u.name)}</strong> (${esc(u.email)})? Người này sẽ không đăng nhập được nữa.
        Lịch sử chăm sóc cũ vẫn giữ tên.</p>
      ${owned.length ? `
        <div class="warn-box">Đang phụ trách <strong>${owned.length}</strong> khách
          (Đào tạo: ${owned.filter((l) => l.segment === 'DAO_TAO').length},
          Xây dựng: ${owned.filter((l) => l.segment === 'XAY_DUNG').length}).</div>
        <label class="field">
          <span>Chuyển các khách này cho</span>
          <select name="transferTo">
            <option value="">— Chưa ai nhận (để sales khác nhận) —</option>
            ${receivers.map((r) => `<option value="${esc(r.email)}">${esc(r.name)} (${esc(r.role)})</option>`).join('')}
          </select>
        </label>` : '<p class="muted">Người này không phụ trách khách nào.</p>'}
      <p class="hint">Chỉ nghỉ tạm thời? Dùng <button type="button" class="link" data-user-edit="${esc(email)}">Sửa → bỏ tick "Đang hoạt động"</button> thay vì xoá.</p>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" data-close>Huỷ</button>
        <button type="submit" class="btn danger">Xoá tài khoản</button>
      </div>
    </form>`;
  $('userDialog').showModal();
}

async function submitDeleteUser(form) {
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  try {
    const data = await api('deleteUser', {
      email: form.dataset.email,
      transferTo: form.transferTo ? form.transferTo.value : '',
    });
    $('userDialog').close();
    state.users = data.users;
    await refresh(true);
    applyUsers(data.users);
    toast(`Đã xoá ${form.dataset.email}` + (data.moved ? `, chuyển ${data.moved} khách.` : '.'), 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

// ---------- Quản lý trạng thái (ADMIN) ----------

const COLOR_NAMES = {
  gray: 'Xám', blue: 'Xanh dương', teal: 'Xanh ngọc', green: 'Xanh lá',
  orange: 'Cam', red: 'Đỏ', purple: 'Tím', dark: 'Xám đậm',
};

function renderStatusesTab() {
  const list = state.statuses || [];
  $('statusRows').innerHTML = list.map((st, i) => {
    const count = (seg) => state.leads.filter((l) => l.segment === seg && l.status === st.key).length;
    const system = SYSTEM_STATUSES.includes(st.key);
    return `<tr class="${st.active ? '' : 'inactive'}">
      <td><div class="order-btns">
        <button type="button" class="btn ghost" data-status-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Lên">▲</button>
        <button type="button" class="btn ghost" data-status-move="${i}" data-dir="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Xuống">▼</button>
      </div></td>
      <td>${badge(st.key)}</td>
      <td><span class="status-key">${esc(st.key)}</span>${system ? ' 🔒' : ''}</td>
      <td>${st.done ? '✓' : ''}</td>
      <td>${count('DAO_TAO')} / ${count('XAY_DUNG')}</td>
      <td>${st.active ? 'Đang dùng' : '<span class="muted">Ngừng dùng</span>'}</td>
      <td><div class="row-actions">
        <button type="button" class="btn ghost" data-status-edit="${esc(st.key)}">Sửa</button>
        ${system ? '' : `<button type="button" class="btn ghost danger-text" data-status-del="${esc(st.key)}">Xoá</button>`}
      </div></td>
    </tr>`;
  }).join('');
}

function afterStatusesChanged(statuses) {
  applyStatuses(statuses);
  renderStatusesTab();
  renderLeads();
}

function openStatusDialog(key = '') {
  const st = STATUS[key] ? { key, ...STATUS[key] } : null;
  const system = !!st && SYSTEM_STATUSES.includes(st.key);
  const color = st?.color || 'blue';
  $('statusDialogBody').innerHTML = `
    <form id="statusForm" class="dialog-inner" data-key="${esc(st?.key || '')}" novalidate>
      <div class="dialog-head">
        <h2>${st ? 'Sửa trạng thái' : 'Thêm trạng thái'}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Đóng">×</button>
      </div>
      <label class="field">
        <span>Tên hiển thị <span class="req">*</span></span>
        <input name="label" type="text" maxlength="40" autocomplete="off" value="${esc(st?.label || '')}"
               placeholder="VD: Đã gửi báo giá" required>
      </label>
      ${st ? `<p class="hint">Mã: <span class="status-key">${esc(st.key)}</span> (không đổi được)</p>` : `
      <label class="field">
        <span>Mã (tự tạo từ tên, có thể sửa)</span>
        <input name="key" type="text" maxlength="30" autocomplete="off" class="status-key" placeholder="DA_GUI_BAO_GIA">
      </label>`}
      <div class="field">
        <span>Màu</span>
        <div class="swatches">
          ${STATUS_COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}>
            <span class="badge ${c}">${esc(COLOR_NAMES[c])}</span></label>`).join('')}
        </div>
      </div>
      <label class="check">
        <input name="done" type="checkbox" ${st?.done ? 'checked' : ''} ${system ? 'disabled' : ''}>
        <span>Kết thúc chăm sóc (VD: Đã chốt, Không có nhu cầu)</span>
      </label>
      <label class="check">
        <input name="active" type="checkbox" ${!st || st.active !== false ? 'checked' : ''} ${system ? 'disabled' : ''}>
        <span>Đang dùng (bỏ tick = ẩn khỏi ô chọn, khách cũ giữ nguyên)</span>
      </label>
      ${system ? '<p class="hint">Trạng thái hệ thống: chỉ đổi được tên và màu.</p>' : ''}
      <div class="dialog-actions">
        <button type="button" class="btn ghost" data-close>Huỷ</button>
        <button type="submit" class="btn primary">${st ? 'Lưu' : 'Thêm'}</button>
      </div>
    </form>`;
  $('statusDialog').showModal();
  const form = $('statusForm');
  form.label.focus();
  if (!st) {
    // Gợi ý mã từ tên cho đến khi người dùng tự sửa mã.
    let touched = false;
    form.key.addEventListener('input', () => { touched = true; });
    form.label.addEventListener('input', () => { if (!touched) form.key.value = statusKeyFrom(form.label.value); });
  }
}

// Giống statusKeyFrom_ trong Admin.gs.
function statusKeyFrom(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
}

async function submitStatusForm(form) {
  if (!form.label.value.trim()) return toast('Vui lòng nhập tên trạng thái.', 'error');
  const isNew = !form.dataset.key;
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  try {
    const data = await api('saveStatus', {
      isNew,
      key: isNew ? form.key.value : form.dataset.key,
      label: form.label.value,
      color: form.color.value,
      done: form.done.checked,
      active: form.active.checked,
    });
    $('statusDialog').close();
    afterStatusesChanged(data.statuses);
    toast(isNew ? 'Đã thêm trạng thái.' : 'Đã lưu trạng thái.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function openDeleteStatus(key) {
  const st = STATUS[key];
  if (!st) return;
  const used = state.leads.filter((l) => l.status === key);
  const targets = (state.statuses || []).filter((x) => x.key !== key && x.active !== false);
  $('statusDialogBody').innerHTML = `
    <form id="deleteStatusForm" class="dialog-inner" data-key="${esc(key)}">
      <div class="dialog-head">
        <h2>Xoá trạng thái</h2>
        <button type="button" class="icon-btn" data-close aria-label="Đóng">×</button>
      </div>
      <p>Xoá trạng thái ${badge(key)}?</p>
      ${used.length ? `
        <div class="warn-box">Có <strong>${used.length}</strong> khách đang ở trạng thái này
          (Đào tạo: ${used.filter((l) => l.segment === 'DAO_TAO').length},
          Xây dựng: ${used.filter((l) => l.segment === 'XAY_DUNG').length}).</div>
        <label class="field">
          <span>Chuyển các khách này sang trạng thái</span>
          <select name="migrateTo" required>
            ${targets.map((x) => `<option value="${esc(x.key)}">${esc(x.label)}</option>`).join('')}
          </select>
        </label>` : '<p class="muted">Không có khách nào ở trạng thái này.</p>'}
      <p class="hint">Chỉ muốn ẩn đi? Dùng <button type="button" class="link" data-status-edit="${esc(key)}">Sửa → bỏ tick "Đang dùng"</button>.</p>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" data-close>Huỷ</button>
        <button type="submit" class="btn danger">Xoá trạng thái</button>
      </div>
    </form>`;
  $('statusDialog').showModal();
}

async function submitDeleteStatus(form) {
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  try {
    const data = await api('deleteStatus', {
      key: form.dataset.key,
      migrateTo: form.migrateTo ? form.migrateTo.value : '',
    });
    $('statusDialog').close();
    applyStatuses(data.statuses);
    await refresh(true);
    renderStatusesTab();
    toast('Đã xoá trạng thái' + (data.moved ? `, chuyển ${data.moved} khách.` : '.'), 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function moveStatus(index, dir) {
  const keys = (state.statuses || []).map((st) => st.key);
  const j = index + dir;
  if (j < 0 || j >= keys.length) return;
  [keys[index], keys[j]] = [keys[j], keys[index]];
  // Đổi chỗ ngay trên giao diện, server xác nhận sau.
  const previous = state.statuses;
  applyStatuses(keys.map((k) => state.statuses.find((st) => st.key === k)));
  renderStatusesTab();
  try {
    const data = await api('reorderStatuses', { keys });
    afterStatusesChanged(data.statuses);
  } catch (err) {
    applyStatuses(previous);
    renderStatusesTab();
    toast(err.message, 'error');
  }
}

function switchTab(tab) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  ['leads', 'registrations', 'activity', 'sales', 'statuses'].forEach((t) => { $('tab-' + t).hidden = t !== tab; });
  state.tab = tab;
  if (tab === 'registrations') {
    if (state.regs) renderRegs();
    loadRegistrations(!!state.regs);
  }
  if (tab === 'activity') loadActivityTab();
  if (tab === 'sales') renderSalesTab();
  if (tab === 'statuses') renderStatusesTab();
}

// ---------- Sự kiện ----------

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-filter],[data-open],[data-add-phone],[data-close],[data-claim],[data-copy],[data-quick],[data-tab],[data-reg],[data-reg-range],[data-segment],[data-user-new],[data-user-edit],[data-user-del],[data-status-new],[data-status-edit],[data-status-del],[data-status-move]');
  if (!el) return;
  const d = el.dataset;

  if (d.tab) switchTab(d.tab);
  else if ('statusNew' in d) openStatusDialog();
  else if (d.statusEdit) {
    if ($('statusDialog').open) $('statusDialog').close();
    openStatusDialog(d.statusEdit);
  } else if (d.statusDel) openDeleteStatus(d.statusDel);
  else if (d.statusMove) moveStatus(Number(d.statusMove), Number(d.dir));
  else if ('userNew' in d) openUserDialog();
  else if (d.userEdit) {
    if ($('userDialog').open) $('userDialog').close();
    openUserDialog(d.userEdit);
  } else if (d.userDel) openDeleteUser(d.userDel);
  else if (d.segment) {
    setSegment(d.segment);
    state.filter = 'all';
    renderLeads();
  } else if (d.regRange) {
    state.reg.range = d.regRange;
    renderRegs();
  } else if (d.reg) openReg(d.reg);
  else if (d.filter) {
    state.filter = d.filter;
    state.query = '';
    $('searchInput').value = '';
    renderLeads();
  } else if (d.open) {
    if ($('addDialog').open) $('addDialog').close();
    if ($('regDialog').open) $('regDialog').close();
    openLead(d.seg || state.segment, d.open);
  } else if (d.addPhone) {
    if ($('regDialog').open) $('regDialog').close();
    openAddDialog(d.addPhone, d.addName || '', d.seg || state.segment);
  }
  else if ('close' in d) el.closest('dialog').close();
  else if (d.claim) claimLead(d.seg, d.claim);
  else if (d.copy) {
    navigator.clipboard?.writeText(d.copy).then(() => toast('Đã copy ' + d.copy));
  } else if (d.quick) {
    $('updateForm').followupAt.value = d.quick === 'clear' ? '' : quickFollowup(d.quick);
  }
});

document.addEventListener('submit', (event) => {
  const handlers = {
    userForm: submitUserForm,
    deleteUserForm: submitDeleteUser,
    statusForm: submitStatusForm,
    deleteStatusForm: submitDeleteStatus,
  };
  if (handlers[event.target.id]) {
    event.preventDefault();
    handlers[event.target.id](event.target);
    return;
  }
  if (event.target.id !== 'updateForm') return;
  event.preventDefault();
  updateLead(event.target);
});

$('searchInput').addEventListener('input', (event) => {
  state.query = event.target.value;
  renderLeads();
});

$('searchInput').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const phone = normalizePhone(state.query);
  if (!phone) return;
  if (findLead(state.segment, phone)) openLead(state.segment, phone);
  else openAddDialog(phone);
});

$('saleFilter').addEventListener('change', (event) => {
  state.sale = event.target.value;
  renderLeads();
});

$('addBtn').addEventListener('click', () => openAddDialog(normalizePhone(state.query)));
$('addForm').addEventListener('submit', submitAdd);
$('addForm').phone.addEventListener('input', checkAddPhone);
$('refreshBtn').addEventListener('click', () => {
  refresh(false, true);
  if (state.tab === 'registrations') loadRegistrations(false, true);
});
$('regSearch').addEventListener('input', (event) => {
  state.reg.query = event.target.value;
  renderRegs();
});
['regCourse', 'regMode', 'regPayment'].forEach((id) => {
  const key = { regCourse: 'course', regMode: 'mode', regPayment: 'payment' }[id];
  $(id).addEventListener('change', (event) => {
    state.reg[key] = event.target.value;
    renderRegs();
  });
});
$('regExport').addEventListener('click', exportRegsCsv);
$('logoutBtn').addEventListener('click', () => logout());
$('leadDialog').addEventListener('close', () => { state.openKey = ''; });

// Tự tải lại để thấy khách mới / thay đổi của Sales khác (bỏ qua khi đang mở hộp thoại).
setInterval(() => {
  if (state.me && !document.hidden && !document.querySelector('dialog[open]')) refresh(true);
}, AUTO_REFRESH_MS);

document.addEventListener('visibilitychange', () => {
  if (state.me && !document.hidden && !document.querySelector('dialog[open]')) refresh(true);
});

// Đóng tab khi còn thao tác chưa lưu xong thì hỏi lại.
window.addEventListener('beforeunload', (event) => {
  if (pendingLeads.size) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// ---------- Khởi động ----------

// Khôi phục phiên trước khi initGoogle để không bật One Tap khi đã đăng nhập.
const savedSession = loadSession();
if (savedSession) resumeSession(savedSession);
initGoogle();

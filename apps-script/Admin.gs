// Backend cho trang quản lý khách hàng (admin.html).
// Thêm file này vào cùng project Apps Script với Code.gs (bấm "+" > Script > đặt tên Admin).
// Cấu hình: Project Settings > Script Properties > thêm GOOGLE_CLIENT_ID = OAuth Client ID.
// Chạy hàm setupAdmin() một lần để tạo các tab Leads / Activities / Users.
// Xem README.md để biết đầy đủ các bước.

var LEADS_SHEET = 'Leads';
var ACTIVITIES_SHEET = 'Activities';
var USERS_SHEET = 'Users';

// Cột mới luôn thêm vào CUỐI để dữ liệu cũ trong Sheet vẫn đọc đúng.
var LEAD_COLS = ['phone', 'customer_name', 'assigned_email', 'status', 'note',
  'last_contacted_at', 'next_followup_at', 'created_at', 'updated_at', 'source', 'created_by', 'segment'];
var ACTIVITY_COLS = ['created_at', 'phone', 'user_email', 'user_name', 'action',
  'old_status', 'new_status', 'note', 'followup_at', 'assigned_email', 'segment'];
var USER_COLS = ['email', 'name', 'role', 'active'];
// Thứ tự cột của tab DangKy (do Code.gs ghi khi khách gửi form).
var REG_SHEET = 'DangKy';
var REG_COLS = ['created_at', 'name', 'birthday', 'cccd', 'address', 'phone', 'zalo',
  'courses', 'study_mode', 'commitment', 'payment'];

var DATE_FIELDS = ['last_contacted_at', 'next_followup_at', 'created_at', 'updated_at', 'followup_at'];

// Số ngày giữ đăng nhập. Muốn đăng xuất tất cả mọi người: xoá Script Property SESSION_SECRET.
var SESSION_DAYS = 1;

// Hai mảng kinh doanh. Mỗi SĐT có thể có 1 bản ghi riêng ở mỗi mảng (chống trùng theo mảng + SĐT).
// Dòng cũ chưa có segment được coi là DAO_TAO.
var SEGMENTS = ['DAO_TAO', 'XAY_DUNG'];
var DEFAULT_SEGMENT = 'DAO_TAO';
var SEGMENT_LABELS = { DAO_TAO: 'Đào tạo', XAY_DUNG: 'Xây dựng' };

// Trạng thái chăm sóc do ADMIN quản lý (tab Statuses). Tab trống → dùng DEFAULT_STATUSES.
// done = "Kết thúc chăm sóc": không còn tính là đang chăm sóc / cần gọi lại.
var STATUSES_SHEET = 'Statuses';
var STATUS_COLS = ['key', 'label', 'color', 'done', 'order', 'active'];
var STATUS_COLORS = ['gray', 'blue', 'teal', 'green', 'orange', 'red', 'purple', 'dark'];
// Gắn với logic: NEW = số mới, CALLING = khi bấm "Nhận chăm sóc", CLOSED = thống kê "Đã chốt".
// Chỉ được đổi tên / màu, không xoá, không khoá.
var SYSTEM_STATUSES = { NEW: { done: false }, CALLING: { done: false }, CLOSED: { done: true } };
var DEFAULT_STATUSES = [
  ['NEW', 'Chưa chăm sóc', 'gray', false],
  ['CALLING', 'Đang liên hệ', 'blue', false],
  ['NO_ANSWER', 'Không nghe máy', 'red', false],
  ['CONTACTED', 'Đã liên hệ', 'blue', false],
  ['CONSULTING', 'Đang tư vấn', 'blue', false],
  ['CALLBACK', 'Hẹn gọi lại', 'orange', false],
  ['INTERESTED', 'Khách quan tâm', 'teal', false],
  ['NOT_INTERESTED', 'Không có nhu cầu', 'dark', true],
  ['CLOSED', 'Đã chốt', 'green', true],
  ['INVALID', 'Số sai / Không hợp lệ', 'dark', true]
];

// Cache đọc (CacheService) — mọi thao tác ghi qua withLock_ đều cập nhật/xoá cache "leads",
// nên chỉ trường hợp sửa tay trực tiếp trong Sheet mới thấy dữ liệu cũ (tối đa CACHE_SECONDS,
// hoặc bấm "Tải lại" trên trang để đọc thẳng Sheet). Users giữ ngắn để khoá tài khoản có hiệu lực nhanh.
var CACHE_SECONDS = { leads: 600, statuses: 600, regs: 600, users: 60 };

// Bộ nhớ tạm trong một lần chạy (Apps Script khởi tạo lại biến toàn cục mỗi request).
var memo_ = {};

function ApiError(code, message, data) {
  this.code = code;
  this.message = message;
  this.data = data || null;
}

// ---------- Setup ----------

function setupAdmin() {
  getSheet_(LEADS_SHEET, LEAD_COLS);
  getSheet_(ACTIVITIES_SHEET, ACTIVITY_COLS);
  ensureStatusesSeeded_();
  var users = getSheet_(USERS_SHEET, USER_COLS);
  if (users.getLastRow() < 2) {
    var owner = Session.getEffectiveUser().getEmail();
    users.appendRow([owner, 'Admin', 'ADMIN', true]);
  }
  sessionSecret_();
  installWarmTrigger_();
  if (!PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID')) {
    Logger.log('Chưa có Script Property GOOGLE_CLIENT_ID — xem README.md.');
  }
}

// Chạy tự động mỗi 5 phút (trigger do setupAdmin tạo): nạp sẵn cache để người mở trang
// không phải chờ đọc Sheet.
function warmCache() {
  memo_ = {};
  readUsers_();
  readStatuses_();
  cachedLeads_();
  cachedJson_('regs', readRegistrationsFromSheet_);
}

function installWarmTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'warmCache';
  });
  if (!exists) ScriptApp.newTrigger('warmCache').timeBased().everyMinutes(5).create();
  warmCache();
}

function getSheet_(name, cols) {
  if (memo_['sheet_' + name]) return memo_['sheet_' + name];
  var ss = spreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(cols);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, cols.length).setFontWeight('bold');
  } else if (sheet.getLastColumn() < cols.length) {
    // Sheet tạo từ phiên bản cũ: bổ sung tiêu đề cho cột mới.
    var start = Math.max(sheet.getLastColumn(), 1);
    sheet.getRange(1, start + 1, 1, cols.length - start).setValues([cols.slice(start)])
      .setFontWeight('bold');
  }
  memo_['sheet_' + name] = sheet;
  return sheet;
}

// ---------- Routing ----------

// Trang admin gửi JSON (Content-Type text/plain để tránh CORS preflight); form đăng ký gửi
// x-www-form-urlencoded ("hoTen=...") nên không bao giờ bắt đầu bằng "{".
// Không dựa vào e.postData.type vì có thể kèm "; charset=utf-8".
function parseAdminBody_(e) {
  var raw = e && e.postData ? String(e.postData.contents || '') : '';
  if (raw.charAt(0) !== '{') return null;
  try {
    var body = JSON.parse(e.postData.contents);
    return body && body.action ? body : null;
  } catch (err) {
    return null;
  }
}

function handleAdminRequest_(body) {
  memo_ = {};
  try {
    // "login" xác minh Google ID token (sống ~1 giờ) rồi cấp phiên riêng SESSION_DAYS ngày;
    // các action khác dùng phiên đó.
    var user = body.action === 'login'
      ? activeUser_(verifyIdToken_(body.idToken))
      : activeUser_(verifySession_(body.token));
    return json_({ ok: true, data: dispatch_(body.action, body, user) });
  } catch (err) {
    if (err instanceof ApiError) {
      return json_({ ok: false, code: err.code, message: err.message, data: err.data });
    }
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, code: 'SERVER', message: 'Lỗi máy chủ: ' + err });
  }
}

function dispatch_(action, body, user) {
  switch (action) {
    case 'login':
      var session = createSession_(user.email);
      var data = initData_(user);
      data.session = session.token;
      data.sessionExpiresAt = session.expiresAt;
      return data;
    case 'init':
      return initData_(user);
    case 'list':
      // fresh = nút "Tải lại": bỏ qua cache, đọc thẳng Sheet (thấy cả thay đổi sửa tay trong Sheet).
      if (body.fresh) ['leads', 'statuses', 'users'].forEach(invalidateCache_);
      return { leads: cachedLeads_(), statuses: readStatuses_() };
    case 'create':
      return createLead_(body, user);
    case 'claim':
      return claimLead_(body.segment, body.phone, user);
    case 'update':
      return updateLead_(body, user);
    case 'assign':
      requireAdmin_(user);
      return assignLead_(body.segment, body.phone, body.assignedEmail, user);
    case 'history':
      return { activities: readActivities_(parseSegment_(body.segment), normalizePhone_(body.phone), 500) };
    case 'activities':
      requireAdmin_(user);
      return { activities: readActivities_('', '', 300) };
    case 'registrations':
      if (body.fresh) invalidateCache_('regs');
      return { registrations: readRegistrations_(user.role === 'ADMIN') };
    case 'saveUser':
      requireAdmin_(user);
      return saveUser_(body, user);
    case 'deleteUser':
      requireAdmin_(user);
      return deleteUser_(body, user);
    case 'saveStatus':
      requireAdmin_(user);
      return saveStatus_(body);
    case 'deleteStatus':
      requireAdmin_(user);
      return deleteStatus_(body, user);
    case 'reorderStatuses':
      requireAdmin_(user);
      return reorderStatuses_(body.keys);
    default:
      throw new ApiError('BAD_REQUEST', 'Action không hợp lệ: ' + action);
  }
}

function initData_(user) {
  return {
    me: publicUser_(user),
    users: readUsers_().map(publicUser_),
    statuses: readStatuses_(),
    leads: cachedLeads_(),
    serverTime: new Date().toISOString()
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- Auth ----------

// Kiểm tra lại tab Users mỗi request: đặt active = FALSE là khoá ngay, dù phiên còn hạn.
function activeUser_(email) {
  var user = findUser_(email);
  if (!user || !user.active) {
    throw new ApiError('NOT_ALLOWED', 'Tài khoản ' + email + ' chưa được cấp quyền. Liên hệ admin.');
  }
  return user;
}

// Xác minh Google ID token (từ nút "Sign in with Google") và trả về email.
// Kết quả được cache theo token để không gọi Google mỗi request.
function verifyIdToken_(idToken) {
  if (!idToken) throw new ApiError('AUTH', 'Vui lòng đăng nhập.');
  var clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) throw new ApiError('CONFIG', 'Chưa cấu hình GOOGLE_CLIENT_ID trong Script Properties.');

  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 43);
  var cached = cache.get(key);
  if (cached) return cached;

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', {
    method: 'post',
    payload: { id_token: idToken },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new ApiError('AUTH', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  }
  var info = JSON.parse(res.getContentText());
  if (info.aud !== clientId) throw new ApiError('AUTH', 'Token không dành cho ứng dụng này.');
  if (String(info.email_verified) !== 'true') throw new ApiError('AUTH', 'Email Google chưa được xác minh.');

  var email = String(info.email).toLowerCase();
  var ttl = Math.min(600, Number(info.exp) - Math.floor(Date.now() / 1000));
  if (ttl > 30) cache.put(key, email, ttl);
  return email;
}

// Phiên dạng "<payload>.<chữ ký HMAC>", payload = {e: email, x: hạn (ms)}.
// Không cần lưu phiên ở đâu cả; đổi SESSION_SECRET là mọi phiên cũ mất hiệu lực.
function createSession_(email) {
  var exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ e: email, x: exp }), Utilities.Charset.UTF_8);
  return { token: payload + '.' + signSession_(payload), expiresAt: new Date(exp).toISOString() };
}

function verifySession_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || parts[1] !== signSession_(parts[0])) {
    throw new ApiError('AUTH', 'Vui lòng đăng nhập.');
  }
  var data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  if (!data.e || !(data.x > Date.now())) {
    throw new ApiError('AUTH', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  }
  return data.e;
}

function signSession_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, sessionSecret_()));
}

function sessionSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('SESSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', secret);
  }
  return secret;
}

function requireAdmin_(user) {
  if (user.role !== 'ADMIN') throw new ApiError('FORBIDDEN', 'Chỉ ADMIN được thực hiện thao tác này.');
}

// Khoá tài khoản (active = FALSE) sửa tay trong Sheet có hiệu lực sau tối đa CACHE_SECONDS.users.
function readUsers_() {
  if (!memo_.users) memo_.users = cachedJson_('users', readUsersFromSheet_);
  return memo_.users;
}

function readUsersFromSheet_() {
  var sheet = getSheet_(USERS_SHEET, USER_COLS);
  return readRows_(sheet, USER_COLS).map(function (u) {
    var active = String(u.active).toLowerCase();
    return {
      email: String(u.email).trim().toLowerCase(),
      name: String(u.name || u.email).trim(),
      role: String(u.role).trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'SALE',
      active: active !== 'false' && active !== '0'
    };
  }).filter(function (u) { return u.email; });
}

function findUser_(email) {
  var users = readUsers_();
  for (var i = 0; i < users.length; i++) {
    if (users[i].email === email) return users[i];
  }
  return null;
}

function publicUser_(u) {
  return { email: u.email, name: u.name, role: u.role, active: u.active };
}

function nameOf_(email) {
  var u = email ? findUser_(email) : null;
  return u ? u.name : email;
}

// ---------- Quản lý tài khoản (ADMIN) ----------

// Đọc thẳng Sheet (không cache) kèm số dòng, dùng cho thao tác ghi.
function readUserRows_() {
  return readRows_(getSheet_(USERS_SHEET, USER_COLS), USER_COLS).map(function (u) {
    var active = String(u.active).toLowerCase();
    return {
      _row: u._row,
      email: String(u.email).trim().toLowerCase(),
      name: String(u.name || u.email).trim(),
      role: String(u.role).trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'SALE',
      active: active !== 'false' && active !== '0'
    };
  }).filter(function (u) { return u.email; });
}

function activeAdminCount_(rows) {
  return rows.filter(function (u) { return u.role === 'ADMIN' && u.active; }).length;
}

// Thêm (isNew) hoặc sửa tên / quyền / trạng thái. Email không đổi được.
function saveUser_(body, me) {
  var email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('BAD_REQUEST', 'Email không hợp lệ.');
  var name = cleanText_(body.name, 60);
  if (!name) throw new ApiError('BAD_REQUEST', 'Vui lòng nhập tên.');
  var role = body.role === 'ADMIN' ? 'ADMIN' : 'SALE';
  var active = body.active !== false;

  return withUsersLock_(function () {
    var rows = readUserRows_();
    var existing = rows.filter(function (u) { return u.email === email; })[0];
    if (body.isNew && existing) throw new ApiError('DUPLICATE', 'Email ' + email + ' đã có trong danh sách.');
    if (!body.isNew && !existing) throw new ApiError('NOT_FOUND', 'Không tìm thấy tài khoản ' + email + '.');

    if (existing && email === me.email && (role !== 'ADMIN' || !active)) {
      throw new ApiError('FORBIDDEN', 'Không thể tự hạ quyền hoặc tự khoá tài khoản của chính mình.');
    }
    if (existing && existing.role === 'ADMIN' && existing.active && (role !== 'ADMIN' || !active)
        && activeAdminCount_(rows) <= 1) {
      throw new ApiError('FORBIDDEN', 'Phải còn ít nhất 1 ADMIN đang hoạt động.');
    }

    var values = [[email, sheetSafe_(name), role, active]];
    var sheet = getSheet_(USERS_SHEET, USER_COLS);
    if (existing) sheet.getRange(existing._row, 1, 1, USER_COLS.length).setValues(values);
    else sheet.appendRow(values[0]);
    return { users: readUserRows_().map(publicUser_) };
  });
}

// Xoá tài khoản. Khách đang phụ trách (cả 2 mảng) được chuyển cho transferTo ('' = chưa ai nhận).
function deleteUser_(body, me) {
  var email = String(body.email || '').trim().toLowerCase();
  var transferTo = String(body.transferTo || '').trim().toLowerCase();
  if (email === me.email) throw new ApiError('FORBIDDEN', 'Không thể tự xoá tài khoản của chính mình.');
  if (transferTo === email) throw new ApiError('BAD_REQUEST', 'Không thể chuyển khách cho chính tài khoản đang xoá.');

  return withUsersLock_(function () {
    var rows = readUserRows_();
    var target = rows.filter(function (u) { return u.email === email; })[0];
    if (!target) throw new ApiError('NOT_FOUND', 'Không tìm thấy tài khoản ' + email + '.');
    if (target.role === 'ADMIN' && target.active && activeAdminCount_(rows) <= 1) {
      throw new ApiError('FORBIDDEN', 'Phải còn ít nhất 1 ADMIN đang hoạt động.');
    }
    var receiver = transferTo ? rows.filter(function (u) { return u.email === transferTo && u.active; })[0] : null;
    if (transferTo && !receiver) throw new ApiError('BAD_REQUEST', 'Người nhận khách không tồn tại hoặc đã khoá.');

    // Chuyển khách trước, xoá tài khoản sau.
    var moved = 0;
    readLeads_().forEach(function (lead) {
      if (lead.assigned_email !== email) return;
      lead.assigned_email = transferTo;
      lead.updated_at = new Date();
      writeLead_(lead);
      logActivity_(lead, me, 'ASSIGN', '', '', 'Chuyển: ' + target.name + ' (tài khoản bị xoá) → '
        + (receiver ? receiver.name : 'Chưa ai'), '', transferTo);
      moved++;
    });

    getSheet_(USERS_SHEET, USER_COLS).deleteRow(target._row);
    return { users: readUserRows_().map(publicUser_), moved: moved };
  });
}

function withUsersLock_(fn) {
  try {
    return withLock_(fn);
  } finally {
    invalidateCache_('users');
    memo_.users = null;
  }
}

// ---------- Leads ----------

function leadsSheet_() {
  return getSheet_(LEADS_SHEET, LEAD_COLS);
}

// Danh sách cho màn hình (có cache). Thao tác ghi luôn dùng readLeads_() đọc thẳng Sheet.
function cachedLeads_() {
  return cachedJson_('leads', function () { return readLeads_().map(serializeLead_); });
}

function readLeads_() {
  var known = statusMap_();
  return readRows_(leadsSheet_(), LEAD_COLS)
    .map(function (lead) {
      lead.phone = normalizePhone_(lead.phone);
      lead.assigned_email = String(lead.assigned_email || '').trim().toLowerCase();
      lead.status = known[lead.status] ? lead.status : 'NEW';
      lead.segment = segmentOf_(lead.segment);
      return lead;
    })
    .filter(function (lead) { return lead.phone; });
}

function findLead_(segment, phone) {
  var leads = readLeads_();
  for (var i = 0; i < leads.length; i++) {
    if (leads[i].segment === segment && leads[i].phone === phone) return leads[i];
  }
  return null;
}

function mustFindLead_(rawSegment, rawPhone) {
  var segment = parseSegment_(rawSegment);
  var phone = normalizePhone_(rawPhone);
  var lead = phone ? findLead_(segment, phone) : null;
  if (!lead) throw new ApiError('NOT_FOUND', 'Số điện thoại chưa có trong mảng ' + SEGMENT_LABELS[segment] + '.');
  return lead;
}

// Giá trị đọc từ Sheet: rỗng/sai → mảng mặc định.
function segmentOf_(value) {
  var v = String(value || '').trim().toUpperCase();
  return SEGMENTS.indexOf(v) >= 0 ? v : DEFAULT_SEGMENT;
}

// Giá trị client gửi lên: bắt buộc đúng.
function parseSegment_(value) {
  if (SEGMENTS.indexOf(value) < 0) throw new ApiError('BAD_REQUEST', 'Mảng không hợp lệ: ' + value);
  return value;
}

function writeLead_(lead) {
  leadsSheet_().getRange(lead._row, 1, 1, LEAD_COLS.length).setValues([leadToRow_(lead)]);
}

function leadToRow_(lead) {
  return LEAD_COLS.map(function (col) {
    // Dấu ' giữ số 0 ở đầu SĐT, không để Sheet đổi thành số.
    if (col === 'phone') return "'" + lead.phone;
    return sheetSafe_(lead[col]);
  });
}

function serializeLead_(lead) {
  var out = {};
  LEAD_COLS.forEach(function (col) { out[col] = serializeValue_(lead[col]); });
  out.assigned_name = lead.assigned_email ? nameOf_(lead.assigned_email) : '';
  return out;
}

function createLead_(body, user) {
  var segment = parseSegment_(body.segment);
  var phone = normalizePhone_(body.phone);
  if (!phone) throw new ApiError('INVALID_PHONE', 'Số điện thoại không hợp lệ.');

  return withLock_(function () {
    var existing = findLead_(segment, phone);
    if (existing) {
      throw new ApiError('DUPLICATE', 'Số điện thoại đã tồn tại trong mảng ' + SEGMENT_LABELS[segment] + '.',
        { lead: serializeLead_(existing) });
    }
    var now = new Date();
    var claim = !!body.claim;
    var lead = {
      phone: phone,
      customer_name: cleanText_(body.customerName, 100),
      assigned_email: claim ? user.email : '',
      status: claim ? 'CALLING' : 'NEW',
      note: cleanText_(body.note, 1000),
      last_contacted_at: '',
      next_followup_at: '',
      created_at: now,
      updated_at: now,
      source: 'Nhập tay',
      created_by: user.email,
      segment: segment
    };
    leadsSheet_().appendRow(leadToRow_(lead));
    logActivity_(lead, user, 'CREATE', '', lead.status, lead.note, '', lead.assigned_email);
    return { lead: serializeLead_(lead) };
  });
}

// Chống race condition: chỉ một request được giữ lock, và trong lock đọc lại
// assigned_email mới nhất từ Sheet trước khi ghi.
function claimLead_(rawSegment, rawPhone, user) {
  return withLock_(function () {
    var lead = mustFindLead_(rawSegment, rawPhone);
    if (lead.assigned_email && lead.assigned_email !== user.email) {
      throw new ApiError('ALREADY_CLAIMED',
        'Số này đang được ' + nameOf_(lead.assigned_email) + ' chăm sóc.',
        { lead: serializeLead_(lead) });
    }
    if (lead.assigned_email === user.email) return { lead: serializeLead_(lead) };

    var oldStatus = lead.status;
    lead.assigned_email = user.email;
    if (lead.status === 'NEW') lead.status = 'CALLING';
    lead.updated_at = new Date();
    writeLead_(lead);
    logActivity_(lead, user, 'CLAIM', oldStatus, lead.status, '', '', user.email);
    return { lead: serializeLead_(lead) };
  });
}

function updateLead_(body, user) {
  return withLock_(function () {
    var lead = mustFindLead_(body.segment, body.phone);
    var isAdmin = user.role === 'ADMIN';
    if (!isAdmin && lead.assigned_email !== user.email) {
      throw new ApiError('FORBIDDEN', lead.assigned_email
        ? 'Số này đang được ' + nameOf_(lead.assigned_email) + ' chăm sóc.'
        : 'Bạn cần bấm "Nhận chăm sóc" trước khi cập nhật.',
        { lead: serializeLead_(lead) });
    }

    var oldStatus = lead.status;
    var statusChanged = false;
    var noteChanged = false;
    var followupChanged = false;
    var extra = [];
    var assignNote = '';

    // ADMIN chuyển sales phụ trách ngay trong form (cùng lần LƯU).
    if (body.assignedEmail !== undefined) {
      var email = String(body.assignedEmail || '').trim().toLowerCase();
      if (email !== lead.assigned_email) {
        if (!isAdmin) throw new ApiError('FORBIDDEN', 'Chỉ ADMIN được chuyển khách.');
        if (email) {
          var target = findUser_(email);
          if (!target || !target.active) throw new ApiError('BAD_REQUEST', 'Sales không tồn tại hoặc đã khoá.');
        }
        assignNote = 'Chuyển: ' + (lead.assigned_email ? nameOf_(lead.assigned_email) : 'Chưa ai')
          + ' → ' + (email ? nameOf_(email) : 'Chưa ai');
        lead.assigned_email = email;
      }
    }

    if (body.status !== undefined && body.status !== lead.status) {
      var st = statusMap_()[body.status];
      if (!st) throw new ApiError('BAD_REQUEST', 'Trạng thái không hợp lệ.');
      if (!st.active) throw new ApiError('BAD_REQUEST', 'Trạng thái "' + st.label + '" đã ngừng sử dụng.');
      if (body.status === 'NEW' && !isAdmin) throw new ApiError('FORBIDDEN', 'Chỉ ADMIN được đặt lại "Chưa chăm sóc".');
      lead.status = body.status;
      statusChanged = true;
    }

    if (body.note !== undefined) {
      var note = cleanText_(body.note, 1000);
      if (note !== String(lead.note || '')) {
        lead.note = note;
        noteChanged = true;
      }
    }

    if (body.followupAt !== undefined) {
      var followup = parseDate_(body.followupAt);
      if (body.followupAt && !followup) throw new ApiError('BAD_REQUEST', 'Ngày gọi lại không hợp lệ.');
      var oldTime = lead.next_followup_at instanceof Date ? lead.next_followup_at.getTime() : 0;
      var newTime = followup ? followup.getTime() : 0;
      if (oldTime !== newTime) {
        lead.next_followup_at = followup || '';
        followupChanged = true;
      }
    }

    if (body.customerName !== undefined) {
      var name = cleanText_(body.customerName, 100);
      if (name !== String(lead.customer_name || '')) {
        extra.push('Tên KH: ' + (lead.customer_name || '-') + ' → ' + (name || '-'));
        lead.customer_name = name;
      }
    }

    var otherChanged = statusChanged || noteChanged || followupChanged || extra.length;
    if (!otherChanged && !assignNote) {
      return { lead: serializeLead_(lead) };
    }

    var now = new Date();
    if (statusChanged || noteChanged) lead.last_contacted_at = now;
    lead.updated_at = now;
    writeLead_(lead);

    if (assignNote) logActivity_(lead, user, 'ASSIGN', '', '', assignNote, '', lead.assigned_email);
    if (otherChanged) {
      var logLines = noteChanged ? [lead.note || '(Xoá ghi chú)'] : [];
      logActivity_(lead, user, 'UPDATE',
        statusChanged ? oldStatus : '', statusChanged ? lead.status : '',
        logLines.concat(extra).join('\n'), followupChanged ? (lead.next_followup_at || 'CLEARED') : '', '');
    }
    return { lead: serializeLead_(lead) };
  });
}

function assignLead_(rawSegment, rawPhone, rawEmail, user) {
  var email = String(rawEmail || '').trim().toLowerCase();
  if (email) {
    var target = findUser_(email);
    if (!target || !target.active) throw new ApiError('BAD_REQUEST', 'Sales không tồn tại hoặc đã khoá.');
  }
  return withLock_(function () {
    var lead = mustFindLead_(rawSegment, rawPhone);
    if (lead.assigned_email === email) return { lead: serializeLead_(lead) };

    var from = lead.assigned_email ? nameOf_(lead.assigned_email) : 'Chưa ai';
    var to = email ? nameOf_(email) : 'Chưa ai';
    lead.assigned_email = email;
    lead.updated_at = new Date();
    writeLead_(lead);
    logActivity_(lead, user, 'ASSIGN', '', '', 'Chuyển: ' + from + ' → ' + to, '', email);
    return { lead: serializeLead_(lead) };
  });
}

// Gọi từ doPost của form đăng ký: tự thêm SĐT vào mảng Đào tạo (không bao giờ làm hỏng form).
function addLeadFromRegistration_(p) {
  var phone = normalizePhone_(p.soDienThoai);
  if (!phone) return;
  var system = { email: '', name: 'Form đăng ký' };
  var summary = cleanText_([p.khoaHoc, p.hinhThucHoc].filter(String).join(' · '), 1000);

  withLock_(function () {
    var existing = findLead_('DAO_TAO', phone);
    if (existing) {
      logActivity_(existing, system, 'FORM', '', '', 'Khách điền lại form đăng ký: ' + summary, '', '');
      return;
    }
    var now = new Date();
    var lead = {
      phone: phone,
      customer_name: cleanText_(p.hoTen, 100),
      assigned_email: '',
      status: 'NEW',
      note: summary ? 'Đăng ký: ' + summary : '',
      created_at: now,
      updated_at: now,
      source: 'Form đăng ký',
      created_by: '',
      segment: 'DAO_TAO'
    };
    leadsSheet_().appendRow(leadToRow_(lead));
    logActivity_(lead, system, 'CREATE', '', 'NEW', lead.note, '', '');
  });
}

// ---------- Trạng thái (ADMIN) ----------

function readStatuses_() {
  if (!memo_.statuses) memo_.statuses = cachedJson_('statuses', readStatusesFromSheet_);
  return memo_.statuses;
}

function statusMap_() {
  var map = {};
  readStatuses_().forEach(function (st) { map[st.key] = st; });
  return map;
}

function defaultStatusObjects_() {
  return DEFAULT_STATUSES.map(function (d, i) {
    return { key: d[0], label: d[1], color: d[2], done: d[3], order: i + 1, active: true };
  });
}

function readStatusesFromSheet_() {
  var rows = readStatusRows_();
  if (!rows.length) return defaultStatusObjects_();
  // Trạng thái hệ thống bị xoá tay khỏi Sheet → bổ sung lại bản mặc định.
  defaultStatusObjects_().forEach(function (d) {
    var has = rows.some(function (r) { return r.key === d.key; });
    if (SYSTEM_STATUSES[d.key] && !has) rows.push(d);
  });
  return rows.map(function (r) {
    return { key: r.key, label: r.label, color: r.color, done: r.done, order: r.order, active: r.active };
  });
}

// Đọc thẳng Sheet (không cache) kèm số dòng, sắp theo order.
function readStatusRows_() {
  return readRows_(getSheet_(STATUSES_SHEET, STATUS_COLS), STATUS_COLS).map(function (r) {
    var key = String(r.key || '').trim().toUpperCase();
    var sys = SYSTEM_STATUSES[key];
    var active = String(r.active).toLowerCase();
    return {
      _row: r._row,
      key: key,
      label: String(r.label || key).trim(),
      color: STATUS_COLORS.indexOf(String(r.color)) >= 0 ? String(r.color) : 'gray',
      done: sys ? sys.done : String(r.done).toLowerCase() === 'true',
      order: Number(r.order) || 0,
      active: sys ? true : active !== 'false' && active !== '0'
    };
  }).filter(function (r) { return r.key; }).sort(function (a, b) { return a.order - b.order; });
}

// Lần ghi đầu tiên: chép danh sách mặc định vào Sheet.
function ensureStatusesSeeded_() {
  var sheet = getSheet_(STATUSES_SHEET, STATUS_COLS);
  if (sheet.getLastRow() >= 2) return;
  var values = defaultStatusObjects_().map(function (st) {
    return [st.key, st.label, st.color, st.done, st.order, st.active];
  });
  sheet.getRange(2, 1, values.length, STATUS_COLS.length).setValues(values);
}

function withStatusesLock_(fn) {
  try {
    return withLock_(function () {
      ensureStatusesSeeded_();
      return fn();
    });
  } finally {
    invalidateCache_('statuses');
    memo_.statuses = null;
  }
}

function statusesResult_() {
  memo_.statuses = null;
  return { statuses: readStatusesFromSheet_() };
}

// "Đang tư vấn lần 2" → "DANG_TU_VAN_LAN_2"
function statusKeyFrom_(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
}

function saveStatus_(body) {
  var label = cleanText_(body.label, 40);
  if (!label) throw new ApiError('BAD_REQUEST', 'Vui lòng nhập tên trạng thái.');
  var color = STATUS_COLORS.indexOf(body.color) >= 0 ? body.color : 'gray';

  return withStatusesLock_(function () {
    var rows = readStatusRows_();
    var sheet = getSheet_(STATUSES_SHEET, STATUS_COLS);
    if (body.isNew) {
      var key = statusKeyFrom_(body.key || label);
      if (!key) throw new ApiError('BAD_REQUEST', 'Mã trạng thái không hợp lệ.');
      if (rows.some(function (r) { return r.key === key; })) {
        throw new ApiError('DUPLICATE', 'Mã trạng thái ' + key + ' đã tồn tại.');
      }
      var order = rows.reduce(function (m, r) { return Math.max(m, r.order); }, 0) + 1;
      sheet.appendRow([key, sheetSafe_(label), color, !!body.done, order, body.active !== false]);
    } else {
      var row = rows.filter(function (r) { return r.key === body.key; })[0];
      if (!row) throw new ApiError('NOT_FOUND', 'Không tìm thấy trạng thái ' + body.key + '.');
      var sys = SYSTEM_STATUSES[row.key];
      sheet.getRange(row._row, 1, 1, STATUS_COLS.length).setValues([[
        row.key, sheetSafe_(label), color,
        sys ? sys.done : !!body.done, row.order, sys ? true : body.active !== false
      ]]);
    }
    return statusesResult_();
  });
}

// Xoá trạng thái; khách đang ở trạng thái đó được chuyển sang migrateTo (có ghi lịch sử).
function deleteStatus_(body, me) {
  var key = String(body.key || '');
  if (SYSTEM_STATUSES[key]) throw new ApiError('FORBIDDEN', 'Không thể xoá trạng thái hệ thống.');

  return withStatusesLock_(function () {
    var rows = readStatusRows_();
    var target = rows.filter(function (r) { return r.key === key; })[0];
    if (!target) throw new ApiError('NOT_FOUND', 'Không tìm thấy trạng thái ' + key + '.');
    var leads = readLeadsWithRawStatus_().filter(function (l) { return l.status === key; });
    var dest = rows.filter(function (r) { return r.key === body.migrateTo && r.key !== key && r.active; })[0];
    if (leads.length && !dest) {
      throw new ApiError('BAD_REQUEST', 'Có ' + leads.length + ' khách đang ở trạng thái này — chọn trạng thái thay thế.');
    }
    leads.forEach(function (lead) {
      lead.status = dest.key;
      lead.updated_at = new Date();
      writeLead_(lead);
      logActivity_(lead, me, 'UPDATE', key, dest.key, 'Trạng thái "' + target.label + '" bị xoá', '', '');
    });
    getSheet_(STATUSES_SHEET, STATUS_COLS).deleteRow(target._row);
    var result = statusesResult_();
    result.moved = leads.length;
    return result;
  });
}

// readLeads_ đổi trạng thái lạ thành NEW; khi xoá trạng thái cần giá trị gốc trong Sheet.
function readLeadsWithRawStatus_() {
  return readRows_(leadsSheet_(), LEAD_COLS).map(function (lead) {
    lead.phone = normalizePhone_(lead.phone);
    lead.assigned_email = String(lead.assigned_email || '').trim().toLowerCase();
    lead.segment = segmentOf_(lead.segment);
    return lead;
  }).filter(function (lead) { return lead.phone; });
}

function reorderStatuses_(keys) {
  return withStatusesLock_(function () {
    var rows = readStatusRows_();
    if (!Array.isArray(keys) || keys.length !== rows.length
        || rows.some(function (r) { return keys.indexOf(r.key) < 0; })) {
      throw new ApiError('BAD_REQUEST', 'Danh sách trạng thái đã thay đổi, vui lòng tải lại.');
    }
    // Ghi cả cột "order" một lần.
    var sheet = getSheet_(STATUSES_SHEET, STATUS_COLS);
    var orderCol = STATUS_COLS.indexOf('order') + 1;
    var range = sheet.getRange(2, orderCol, sheet.getLastRow() - 1, 1);
    var values = range.getValues();
    rows.forEach(function (r) { values[r._row - 2][0] = keys.indexOf(r.key) + 1; });
    range.setValues(values);
    return statusesResult_();
  });
}

// ---------- Activities ----------

function logActivity_(lead, user, action, oldStatus, newStatus, note, followupAt, assignedEmail) {
  getSheet_(ACTIVITIES_SHEET, ACTIVITY_COLS).appendRow([
    new Date(), "'" + lead.phone, user.email, sheetSafe_(user.name), action,
    oldStatus || '', newStatus || '', sheetSafe_(note), followupAt || '', assignedEmail || '', lead.segment
  ]);
}

// segment/phone rỗng = không lọc theo trường đó.
function readActivities_(segment, phone, limit) {
  var rows = readRows_(getSheet_(ACTIVITIES_SHEET, ACTIVITY_COLS), ACTIVITY_COLS);
  var out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    var a = rows[i];
    a.phone = normalizePhone_(a.phone);
    a.segment = segmentOf_(a.segment);
    if (phone && a.phone !== phone) continue;
    if (segment && a.segment !== segment) continue;
    var item = {};
    ACTIVITY_COLS.forEach(function (col) { item[col] = serializeValue_(a[col]); });
    out.push(item);
  }
  return out;
}

// ---------- Đăng ký (tab DangKy) ----------

// CCCD và địa chỉ là dữ liệu nhạy cảm: chỉ ADMIN xem đầy đủ, SALE thấy bản che.
function readRegistrations_(full) {
  var list = cachedJson_('regs', readRegistrationsFromSheet_);
  if (full) return list;
  return list.map(function (item) {
    item.cccd = item.cccd ? '•••••••••' + item.cccd.slice(-3) : '';
    item.address = item.address ? '(chỉ ADMIN xem)' : '';
    return item;
  });
}

function readRegistrationsFromSheet_() {
  var sheet = spreadsheet_().getSheetByName(REG_SHEET);
  if (!sheet) return [];
  var out = [];
  readRows_(sheet, REG_COLS).forEach(function (r) {
    if (!String(r.name || '').trim()) return; // bỏ dòng trống
    var item = { row: r._row };
    REG_COLS.forEach(function (col) { item[col] = serializeValue_(r[col]); });
    item.phone = normalizePhone_(r.phone) || item.phone;
    out.push(item);
  });
  return out.reverse(); // mới nhất trước
}

// ---------- Helpers ----------

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new ApiError('BUSY', 'Hệ thống đang bận, vui lòng thử lại.');
  var result;
  try {
    result = fn();
    return result;
  } finally {
    SpreadsheetApp.flush();
    // Thao tác trên 1 khách: sửa thẳng khách đó trong cache để lần đọc sau vẫn nhanh.
    // Còn lại (đổi nhiều khách, lỗi giữa chừng...) thì xoá cache cho chắc.
    if (!(result && result.lead && patchLeadsCache_(result.lead))) invalidateCache_('leads');
    lock.releaseLock();
  }
}

// ---------- Cache ----------

// Mỗi loại dữ liệu có một "phiên bản" (name_ver). Ghi dữ liệu = đổi phiên bản, nên cache cũ
// tự mất hiệu lực. Người đọc chỉ lưu cache nếu phiên bản không đổi trong lúc mình đọc Sheet,
// tránh trường hợp đọc dữ liệu cũ rồi ghi đè lên cache sau khi người khác vừa sửa.
function cachedJson_(name, build) {
  var cache = CacheService.getScriptCache();
  var ver = cache.get(name + '_ver');
  if (ver) {
    var hit = getChunks_(cache, name + '_' + ver);
    if (hit) return JSON.parse(hit);
  } else {
    ver = Utilities.getUuid();
    cache.put(name + '_ver', ver, 21600);
  }
  var data = build();
  try {
    if (cache.get(name + '_ver') === ver) {
      putChunks_(cache, name + '_' + ver, JSON.stringify(data), CACHE_SECONDS[name] || 60);
    }
  } catch (err) {
    console.warn('Không ghi được cache ' + name + ': ' + err);
  }
  return data;
}

// Gọi trong lock. Ghi bản đã sửa dưới phiên bản mới, nên người đang đọc Sheet song song
// (giữ phiên bản cũ) sẽ không ghi đè bản cũ lên cache.
function patchLeadsCache_(lead) {
  try {
    var cache = CacheService.getScriptCache();
    var ver = cache.get('leads_ver');
    var hit = ver && getChunks_(cache, 'leads_' + ver);
    if (!hit) return false;
    var list = JSON.parse(hit);
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].segment === lead.segment && list[i].phone === lead.phone) {
        list[i] = lead;
        found = true;
        break;
      }
    }
    if (!found) list.push(lead); // khách mới nằm cuối Sheet
    var newVer = Utilities.getUuid();
    if (!putChunks_(cache, 'leads_' + newVer, JSON.stringify(list), CACHE_SECONDS.leads)) return false;
    cache.put('leads_ver', newVer, 21600);
    return true;
  } catch (err) {
    console.warn('Không cập nhật được cache leads: ' + err);
    return false;
  }
}

function invalidateCache_(name) {
  CacheService.getScriptCache().put(name + '_ver', Utilities.getUuid(), 21600);
}

// CacheService giới hạn 100KB/giá trị → chia nhỏ (30k ký tự ≤ 90KB kể cả tiếng Việt 3 byte/ký tự).
var CACHE_CHUNK = 30000;

function putChunks_(cache, key, str, ttl) {
  var n = Math.ceil(str.length / CACHE_CHUNK) || 1;
  if (n > 100) return false; // quá lớn, bỏ qua cache
  var values = {};
  for (var i = 0; i < n; i++) values[key + '_' + i] = str.substr(i * CACHE_CHUNK, CACHE_CHUNK);
  values[key + '_n'] = String(n);
  cache.putAll(values, ttl);
  return true;
}

function getChunks_(cache, key) {
  var n = Number(cache.get(key + '_n'));
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = cache.getAll(keys);
  var parts = [];
  for (var j = 0; j < n; j++) {
    if (got[keys[j]] == null) return null;
    parts.push(got[keys[j]]);
  }
  return parts.join('');
}

function readRows_(sheet, cols) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, cols.length).getValues().map(function (row, i) {
    var obj = { _row: i + 2 };
    cols.forEach(function (col, j) { obj[col] = row[j]; });
    return obj;
  });
}

function serializeValue_(v) {
  if (v instanceof Date) return v.toISOString();
  return v === undefined || v === null ? '' : String(v);
}

function parseDate_(value) {
  if (!value) return null;
  var d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function cleanText_(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

// Chặn chuỗi bắt đầu bằng =, +, -, @ bị Sheet hiểu thành công thức.
function sheetSafe_(v) {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

// 0988 123 456 / 0988.123.456 / +84 988 123 456 / 84988123456 → 0988123456
// Trả về '' nếu không phải SĐT Việt Nam hợp lệ (di động 10 số, cố định 11 số 02x).
function normalizePhone_(raw) {
  var digits = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (digits.indexOf('0084') === 0) digits = digits.slice(4);
  else if (digits.indexOf('84') === 0 && digits.length >= 11) digits = digits.slice(2);
  if (digits && digits.charAt(0) !== '0') digits = '0' + digits;
  return /^0(\d{9}|2\d{9})$/.test(digits) ? digits : '';
}

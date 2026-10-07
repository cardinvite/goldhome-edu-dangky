// Backend cho trang quản lý khách hàng (admin.html).
// Thêm file này vào cùng project Apps Script với Code.gs (bấm "+" > Script > đặt tên Admin).
// Cấu hình: Project Settings > Script Properties > thêm GOOGLE_CLIENT_ID = OAuth Client ID.
// Chạy hàm setupAdmin() một lần để tạo các tab Leads / Activities / Users.
// Xem README.md để biết đầy đủ các bước.

var LEADS_SHEET = 'Leads';
var ACTIVITIES_SHEET = 'Activities';
var USERS_SHEET = 'Users';

var LEAD_COLS = ['phone', 'customer_name', 'assigned_email', 'status', 'note',
  'last_contacted_at', 'next_followup_at', 'created_at', 'updated_at', 'source', 'created_by'];
var ACTIVITY_COLS = ['created_at', 'phone', 'user_email', 'user_name', 'action',
  'old_status', 'new_status', 'note', 'followup_at', 'assigned_email'];
var USER_COLS = ['email', 'name', 'role', 'active'];

var DATE_FIELDS = ['last_contacted_at', 'next_followup_at', 'created_at', 'updated_at', 'followup_at'];

// Số ngày giữ đăng nhập. Muốn đăng xuất tất cả mọi người: xoá Script Property SESSION_SECRET.
var SESSION_DAYS = 1;

var STATUSES = ['NEW', 'CALLING', 'NO_ANSWER', 'CONTACTED', 'CONSULTING', 'CALLBACK',
  'INTERESTED', 'NOT_INTERESTED', 'CLOSED', 'INVALID'];

function ApiError(code, message, data) {
  this.code = code;
  this.message = message;
  this.data = data || null;
}

// ---------- Setup ----------

function setupAdmin() {
  getSheet_(LEADS_SHEET, LEAD_COLS);
  getSheet_(ACTIVITIES_SHEET, ACTIVITY_COLS);
  var users = getSheet_(USERS_SHEET, USER_COLS);
  if (users.getLastRow() < 2) {
    var owner = Session.getEffectiveUser().getEmail();
    users.appendRow([owner, 'Admin', 'ADMIN', true]);
  }
  sessionSecret_();
  if (!PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID')) {
    Logger.log('Chưa có Script Property GOOGLE_CLIENT_ID — xem README.md.');
  }
}

function getSheet_(name, cols) {
  var ss = spreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(cols);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, cols.length).setFontWeight('bold');
  }
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
      return { leads: readLeads_().map(serializeLead_) };
    case 'create':
      return createLead_(body, user);
    case 'claim':
      return claimLead_(body.phone, user);
    case 'update':
      return updateLead_(body, user);
    case 'assign':
      requireAdmin_(user);
      return assignLead_(body.phone, body.assignedEmail, user);
    case 'history':
      return { activities: readActivities_(normalizePhone_(body.phone), 500) };
    case 'activities':
      requireAdmin_(user);
      return { activities: readActivities_('', 300) };
    default:
      throw new ApiError('BAD_REQUEST', 'Action không hợp lệ: ' + action);
  }
}

function initData_(user) {
  return {
    me: publicUser_(user),
    users: readUsers_().map(publicUser_),
    leads: readLeads_().map(serializeLead_),
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

function readUsers_() {
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

// ---------- Leads ----------

function leadsSheet_() {
  return getSheet_(LEADS_SHEET, LEAD_COLS);
}

function readLeads_() {
  return readRows_(leadsSheet_(), LEAD_COLS)
    .map(function (lead) {
      lead.phone = normalizePhone_(lead.phone);
      lead.assigned_email = String(lead.assigned_email || '').trim().toLowerCase();
      lead.status = STATUSES.indexOf(lead.status) >= 0 ? lead.status : 'NEW';
      return lead;
    })
    .filter(function (lead) { return lead.phone; });
}

function findLead_(phone) {
  var leads = readLeads_();
  for (var i = 0; i < leads.length; i++) {
    if (leads[i].phone === phone) return leads[i];
  }
  return null;
}

function mustFindLead_(rawPhone) {
  var phone = normalizePhone_(rawPhone);
  var lead = phone ? findLead_(phone) : null;
  if (!lead) throw new ApiError('NOT_FOUND', 'Số điện thoại chưa có trong hệ thống.');
  return lead;
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
  var phone = normalizePhone_(body.phone);
  if (!phone) throw new ApiError('INVALID_PHONE', 'Số điện thoại không hợp lệ.');

  return withLock_(function () {
    var existing = findLead_(phone);
    if (existing) {
      throw new ApiError('DUPLICATE', 'Số điện thoại đã tồn tại.', { lead: serializeLead_(existing) });
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
      created_by: user.email
    };
    leadsSheet_().appendRow(leadToRow_(lead));
    logActivity_(phone, user, 'CREATE', '', lead.status, lead.note, '', lead.assigned_email);
    return { lead: serializeLead_(lead) };
  });
}

// Chống race condition: chỉ một request được giữ lock, và trong lock đọc lại
// assigned_email mới nhất từ Sheet trước khi ghi.
function claimLead_(rawPhone, user) {
  return withLock_(function () {
    var lead = mustFindLead_(rawPhone);
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
    logActivity_(lead.phone, user, 'CLAIM', oldStatus, lead.status, '', '', user.email);
    return { lead: serializeLead_(lead) };
  });
}

function updateLead_(body, user) {
  return withLock_(function () {
    var lead = mustFindLead_(body.phone);
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

    if (body.status !== undefined && body.status !== lead.status) {
      if (STATUSES.indexOf(body.status) < 0) throw new ApiError('BAD_REQUEST', 'Trạng thái không hợp lệ.');
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

    if (!statusChanged && !noteChanged && !followupChanged && !extra.length) {
      return { lead: serializeLead_(lead) };
    }

    var now = new Date();
    if (statusChanged || noteChanged) lead.last_contacted_at = now;
    lead.updated_at = now;
    writeLead_(lead);

    var logLines = noteChanged ? [lead.note || '(Xoá ghi chú)'] : [];
    logActivity_(lead.phone, user, 'UPDATE',
      statusChanged ? oldStatus : '', statusChanged ? lead.status : '',
      logLines.concat(extra).join('\n'), followupChanged ? (lead.next_followup_at || 'CLEARED') : '', '');
    return { lead: serializeLead_(lead) };
  });
}

function assignLead_(rawPhone, rawEmail, user) {
  var email = String(rawEmail || '').trim().toLowerCase();
  if (email) {
    var target = findUser_(email);
    if (!target || !target.active) throw new ApiError('BAD_REQUEST', 'Sales không tồn tại hoặc đã khoá.');
  }
  return withLock_(function () {
    var lead = mustFindLead_(rawPhone);
    if (lead.assigned_email === email) return { lead: serializeLead_(lead) };

    var from = lead.assigned_email ? nameOf_(lead.assigned_email) : 'Chưa ai';
    var to = email ? nameOf_(email) : 'Chưa ai';
    lead.assigned_email = email;
    lead.updated_at = new Date();
    writeLead_(lead);
    logActivity_(lead.phone, user, 'ASSIGN', '', '', 'Chuyển: ' + from + ' → ' + to, '', email);
    return { lead: serializeLead_(lead) };
  });
}

// Gọi từ doPost của form đăng ký: tự thêm SĐT vào danh sách khách (không bao giờ làm hỏng form).
function addLeadFromRegistration_(p) {
  var phone = normalizePhone_(p.soDienThoai);
  if (!phone) return;
  var system = { email: '', name: 'Form đăng ký' };
  var summary = cleanText_([p.khoaHoc, p.hinhThucHoc].filter(String).join(' · '), 1000);

  withLock_(function () {
    if (findLead_(phone)) {
      logActivity_(phone, system, 'FORM', '', '', 'Khách điền lại form đăng ký: ' + summary, '', '');
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
      created_by: ''
    };
    leadsSheet_().appendRow(leadToRow_(lead));
    logActivity_(phone, system, 'CREATE', '', 'NEW', lead.note, '', '');
  });
}

// ---------- Activities ----------

function logActivity_(phone, user, action, oldStatus, newStatus, note, followupAt, assignedEmail) {
  getSheet_(ACTIVITIES_SHEET, ACTIVITY_COLS).appendRow([
    new Date(), "'" + phone, user.email, sheetSafe_(user.name), action,
    oldStatus || '', newStatus || '', sheetSafe_(note), followupAt || '', assignedEmail || ''
  ]);
}

function readActivities_(phone, limit) {
  var rows = readRows_(getSheet_(ACTIVITIES_SHEET, ACTIVITY_COLS), ACTIVITY_COLS);
  var out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    var a = rows[i];
    a.phone = normalizePhone_(a.phone);
    if (phone && a.phone !== phone) continue;
    var item = {};
    ACTIVITY_COLS.forEach(function (col) { item[col] = serializeValue_(a[col]); });
    out.push(item);
  }
  return out;
}

// ---------- Helpers ----------

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new ApiError('BUSY', 'Hệ thống đang bận, vui lòng thử lại.');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
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

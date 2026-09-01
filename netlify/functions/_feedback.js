// ============================================================
// IDFL - customer feedback: validation, projection and rate limiting.
//
// Every field that reaches storage passes through validate() here. The client
// may only ever set content fields; status, replies, internal notes and all
// timestamps are decided server-side.
//
// Projection matters as much as validation: customers share one access
// password, so a customer response must never carry another customer's name,
// e-mail, phone number or submitter token.
// ============================================================

const TYPES = ['question', 'comment', 'correction'];
const TYPE_JA = { question: '質問', comment: 'コメント・補足', correction: '修正依頼' };
const STATUSES = ['new', 'in_progress', 'resolved', 'dismissed'];
const STATUS_JA = { new: '新規', in_progress: '対応中', resolved: '解決済み', dismissed: '却下' };
// What the customer is shown. Deliberately softer than the internal status.
const STATUS_CUSTOMER_JA = { new: '受付済み', in_progress: '確認中', resolved: '対応済み', dismissed: '対応済み' };

const MAX_BODY_BYTES = 32 * 1024;
const LIMITS = { message: 4000, name: 100, email: 200, phone: 40, selector: 600, quote: 300, section: 200, reply: 4000, note: 4000 };

// Intentionally permissive but anchored: one @, a dot in the domain, no spaces.
const EMAIL_RE = /^[^\s@,;:<>()[\]\\"]{1,64}@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function s(v){ return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

// Drop control characters (newline and tab stay: they are legitimate inside a
// message body) so nothing odd reaches storage, a log line or an e-mail header.
// Written as a scan rather than a regex literal to keep raw control bytes out
// of this source file.
function stripCtrl(str){
  let out = '';
  for(let i = 0; i < str.length; i++){
    const c = str.charCodeAt(i);
    if(c === 9 || c === 10) { out += str[i]; continue; }        // tab, newline
    if(c === 13) { continue; }                                  // CR: normalised away
    if(c < 32 || c === 127) continue;
    out += str[i];
  }
  return out;
}
function trim(v, max){ return stripCtrl(s(v)).trim().slice(0, max); }

/** HTML-escape. Used everywhere feedback text is rendered or mailed. */
function esc(v){
  return s(v).replace(/[&<>"']/g, function(c){
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function validEmail(v){ const e = trim(v, LIMITS.email); return EMAIL_RE.test(e) ? e : ''; }

/** Accepts JP and international shapes; requires at least 9 real digits. */
function validPhone(v){
  const p = trim(v, LIMITS.phone);
  if(!p) return '';
  if(!/^[0-9+\-() 　.]+$/.test(p)) return '';
  const digits = p.replace(/[^0-9]/g, '');
  if(digits.length < 9 || digits.length > 15) return '';
  return p;
}

function num01(v){
  const n = Number(v);
  if(!isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Anchors are hints for re-finding a spot; never trusted as markup. */
function validAnchor(a){
  if(!a || typeof a !== 'object') return null;
  const out = {
    selector: trim(a.selector, LIMITS.selector),
    textQuote: trim(a.textQuote, LIMITS.quote),
    section: trim(a.section, LIMITS.section),
    position: null,
  };
  const p = a.position;
  if(p && typeof p === 'object'){
    out.position = { x: num01(p.x), y: num01(p.y), w: num01(p.w), h: num01(p.h) };
  }
  if(!out.selector && !out.textQuote && !out.position && !out.section) return null;
  return out;
}

/**
 * Validate a customer submission.
 * Returns { ok:true, value } or { ok:false, error } with a Japanese message.
 */
function validateSubmission(body){
  if(!body || typeof body !== 'object') return { ok: false, error: 'リクエストが不正です' };

  const mediaId = trim(body.mediaId, 64);
  if(!ID_RE.test(mediaId)) return { ok: false, error: '資料IDが不正です' };

  const type = TYPES.indexOf(s(body.type)) >= 0 ? s(body.type) : '';
  if(!type) return { ok: false, error: 'フィードバックの種類を選択してください' };

  const message = trim(body.message, LIMITS.message);
  if(message.length < 2) return { ok: false, error: 'フィードバック内容を入力してください' };

  const c = body.customer || {};
  const name = trim(c.name, LIMITS.name);
  if(name.length < 1) return { ok: false, error: 'お名前を入力してください' };
  const email = validEmail(c.email);
  if(!email) return { ok: false, error: 'メールアドレスの形式が正しくありません' };
  const phone = validPhone(c.phone);
  if(!phone) return { ok: false, error: '電話番号の形式が正しくありません（数字9桁以上）' };

  const token = TOKEN_RE.test(s(body.token)) ? s(body.token) : '';
  if(!token) return { ok: false, error: 'セッション識別子が不正です' };

  const mediaVersion = Math.max(1, Math.min(9999, parseInt(body.mediaVersion, 10) || 1));

  return {
    ok: true,
    value: {
      mediaId, mediaVersion, type, message, token,
      anchor: validAnchor(body.anchor),
      customer: { name, email, phone },
    },
  };
}

/** STAFF-only mutation payload. Anything absent is left untouched. */
function validateManage(body){
  if(!body || typeof body !== 'object') return { ok: false, error: 'リクエストが不正です' };
  const id = trim(body.id, 128);
  if(!/^[A-Za-z0-9_/-]{3,160}$/.test(id)) return { ok: false, error: 'IDが不正です' };
  const patch = {};
  if(body.status != null){
    if(STATUSES.indexOf(s(body.status)) < 0) return { ok: false, error: 'ステータスが不正です' };
    patch.status = s(body.status);
  }
  if(body.staffReply != null) patch.staffReply = trim(body.staffReply, LIMITS.reply);
  if(body.internalNote != null) patch.internalNote = trim(body.internalNote, LIMITS.note);
  if(body.publicVisible != null) patch.publicVisible = !!body.publicVisible;
  return { ok: true, value: { id, patch } };
}

// --------------------------------------------------------------------------
// Projection
// --------------------------------------------------------------------------

/** Full record, staff only. */
function projectStaff(r){
  return {
    id: r.id, key: r.key, mediaId: r.mediaId, mediaTitle: r.mediaTitle || '', mediaVersion: r.mediaVersion,
    seq: r.seq, type: r.type, typeLabel: TYPE_JA[r.type] || r.type, message: r.message, anchor: r.anchor || null,
    customer: r.customer || null, status: r.status, statusLabel: STATUS_JA[r.status] || r.status,
    staffReply: r.staffReply || '', internalNote: r.internalNote || '', publicVisible: !!r.publicVisible,
    createdAt: r.createdAt, updatedAt: r.updatedAt, resolvedAt: r.resolvedAt || null,
  };
}

/**
 * Customer view. Drops every personal field, the submitter token and staff
 * internal notes. `mine` is computed from the caller's own token only.
 */
function projectCustomer(r, viewerToken){
  const mine = !!viewerToken && r.token === viewerToken;
  return {
    id: r.id, mediaId: r.mediaId, mediaVersion: r.mediaVersion, seq: r.seq,
    type: r.type, typeLabel: TYPE_JA[r.type] || r.type,
    message: r.message, anchor: r.anchor || null,
    status: r.status, statusLabel: STATUS_CUSTOMER_JA[r.status] || '受付済み',
    staffReply: (mine || r.publicVisible) ? (r.staffReply || '') : '',
    mine, createdAt: r.createdAt,
  };
}

/** Which records a customer may see at all: their own, or staff-published ones. */
function visibleToCustomer(r, viewerToken){
  if(viewerToken && r.token === viewerToken) return true;
  return !!r.publicVisible;
}

// --------------------------------------------------------------------------
// Rate limiting (best-effort, per function instance - same approach as
// auth-login.js). Spam control, not a security boundary.
// --------------------------------------------------------------------------
const hits = Object.create(null);
const RL = { windowMs: 10 * 60 * 1000, max: 10, minGapMs: 5000 };

function rateLimit(key, now){
  const t = now || Date.now();
  const e = hits[key] || { stamps: [], last: 0 };
  e.stamps = e.stamps.filter(x => t - x < RL.windowMs);
  if(e.last && t - e.last < RL.minGapMs){ hits[key] = e; return '送信間隔が短すぎます。数秒おいて再度お試しください。'; }
  if(e.stamps.length >= RL.max){ hits[key] = e; return '短時間の送信が多すぎます。しばらく経ってから再度お試しください。'; }
  e.stamps.push(t); e.last = t; hits[key] = e;
  return '';
}
function _resetRateLimit(){ for(const k in hits) delete hits[k]; }

module.exports = {
  TYPES, TYPE_JA, STATUSES, STATUS_JA, STATUS_CUSTOMER_JA, LIMITS, MAX_BODY_BYTES,
  EMAIL_RE, TOKEN_RE, ID_RE,
  esc, trim, validEmail, validPhone, validAnchor,
  validateSubmission, validateManage,
  projectStaff, projectCustomer, visibleToCustomer,
  rateLimit, RL, _resetRateLimit,
};

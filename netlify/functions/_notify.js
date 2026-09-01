// ============================================================
// IDFL - feedback e-mail notification.
//
// The repository had no transactional e-mail provider, so this is a minimal
// Resend adapter over plain fetch (no new dependency).
//
// Contract: notification is best-effort and MUST NOT be able to fail a
// submission. The caller saves first and calls this afterwards; every path
// here resolves, never rejects.
//
// Environment (all three required, none may be hard-coded):
//   RESEND_API_KEY      Resend API key
//   FEEDBACK_NOTIFY_TO  recipient(s), comma-separated
//   FEEDBACK_FROM       verified sender, e.g. "IDFL JAPAN <noreply@idfl-japan.com>"
// ============================================================

const F = require('./_feedback');

const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 6000;

function configured(){
  return !!(process.env.RESEND_API_KEY && process.env.FEEDBACK_NOTIFY_TO && process.env.FEEDBACK_FROM);
}

/** Header-injection guard: subjects must stay on one line. */
function oneLine(v, max){ return F.trim(v, max).replace(/[\r\n]+/g, ' '); }

function buildSubject(rec, mediaTitle){
  const t = F.TYPE_JA[rec.type] || rec.type;
  return oneLine('[IDFL Media Feedback] ' + (mediaTitle || rec.mediaId) + ' – ' + t, 180);
}

function buildText(rec, mediaTitle, adminUrl){
  const a = rec.anchor || {};
  const target = [a.section, a.textQuote].filter(Boolean).join(' / ') || '（箇所指定なし）';
  return [
    '資料:',
    (mediaTitle || rec.mediaId) + '（Version ' + rec.mediaVersion + '）',
    '',
    '種類:',
    F.TYPE_JA[rec.type] || rec.type,
    '',
    '対象箇所:',
    target,
    '',
    'お名前:',
    rec.customer.name,
    '',
    'メール:',
    rec.customer.email,
    '',
    '電話:',
    rec.customer.phone,
    '',
    '内容:',
    rec.message,
    '',
    '受付日時:',
    rec.createdAt,
    '',
    '--',
    'Admin:',
    adminUrl,
  ].join('\n');
}

/**
 * Send the notification.
 * Resolves to { sent, reason?, id? } - never throws, never rejects.
 */
async function notifyFeedback(rec, mediaTitle, siteUrl){
  if(!configured()) return { sent: false, reason: 'not_configured' };
  const adminUrl = (siteUrl || 'https://idfl-japan.com').replace(/\/+$/, '') + '/admin';
  const to = String(process.env.FEEDBACK_NOTIFY_TO).split(',').map(x => x.trim()).filter(Boolean).slice(0, 10);
  if(!to.length) return { sent: false, reason: 'not_configured' };

  const payload = {
    from: oneLine(process.env.FEEDBACK_FROM, 200),
    to,
    reply_to: rec.customer && rec.customer.email ? rec.customer.email : undefined,
    subject: buildSubject(rec, mediaTitle),
    text: buildText(rec, mediaTitle, adminUrl),
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try{
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if(!r.ok){
      // Provider errors mention the sender/domain, not the customer - safe to log.
      let detail = '';
      try{ detail = (await r.text()).slice(0, 300); }catch(e){}
      return { sent: false, reason: 'provider_error', status: r.status, detail };
    }
    let id = '';
    try{ id = (await r.json()).id || ''; }catch(e){}
    return { sent: true, id };
  }catch(e){
    return { sent: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network_error' };
  }finally{
    clearTimeout(timer);
  }
}

module.exports = { notifyFeedback, configured, buildSubject, buildText };

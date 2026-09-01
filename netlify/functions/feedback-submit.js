// ============================================================
// POST /.netlify/functions/feedback-submit   (CUSTOMER or STAFF session)
//
// Saves one piece of customer feedback, THEN notifies IDFL by e-mail.
// That order is the whole point: a mail outage must never lose feedback, so
// the response reports `saved` and `notificationSent` separately.
//
// Personal data (name / e-mail / phone) is written ONLY to the private
// idfl-feedback blob store. It never touches data/*.json, the repository, or
// any response a customer can read.
// ============================================================
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const M = require('./_media');
const S = require('./_stores');
const F = require('./_feedback');
const N = require('./_notify');

exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  if(event.httpMethod !== 'POST') return M.json(405, { error: 'method not allowed' });
  if(M.badOrigin(event)) return M.json(403, { error: 'invalid origin' });

  const role = A.roleFromCookies(event.headers.cookie) || 'PUBLIC';
  if(role !== 'CUSTOMER' && role !== 'STAFF') return M.json(401, { error: 'ログインが必要です。再度ログインしてください。' });

  const raw = event.body || '';
  if(Buffer.byteLength(raw, event.isBase64Encoded ? 'base64' : 'utf8') > F.MAX_BODY_BYTES) return M.json(413, { error: '送信内容が大きすぎます' });

  let body; try{ body = JSON.parse(raw || '{}'); }catch(e){ return M.json(400, { error: 'リクエストが不正です' }); }

  const v = F.validateSubmission(body);
  if(!v.ok) return M.json(400, { error: v.error });
  const sub = v.value;

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'anon';
  const limited = F.rateLimit(ip + '|' + sub.token);
  if(limited) return M.json(429, { error: limited });

  // --- the media must exist and be visible to this session ----------------
  let recStore, fbStore;
  try{ recStore = getStore(S.PROTECTED_STORE); fbStore = getStore(S.feedbackStoreName()); }
  catch(e){ return M.json(500, { error: 'ストレージに接続できません' }); }

  let meta;
  try{ const m = await recStore.getMetadata(sub.mediaId); meta = (m && m.metadata) || null; }catch(e){ meta = null; }
  if(!meta || !meta.role) return M.json(404, { error: '資料が見つかりません' });
  const need = meta.role === 'staff' ? 'STAFF' : 'CUSTOMER';
  if(!A.meets(role, need)) return M.json(403, { error: 'この資料へのフィードバック権限がありません' });
  if(meta.status === 'draft' && role !== 'STAFF') return M.json(404, { error: '資料が見つかりません' });

  // --- sequence number, per media -----------------------------------------
  let seq = 1;
  try{
    const l = await fbStore.list({ prefix: 'fb/' + sub.mediaId + '/' });
    seq = ((l && l.blobs) || []).length + 1;
  }catch(e){}

  const now = M.nowJst();
  const id = M.newId();
  const key = 'fb/' + sub.mediaId + '/' + id;
  const rec = {
    id, key,
    mediaId: sub.mediaId,
    mediaTitle: String(meta.title || meta.name || '').slice(0, 200),
    mediaVersion: parseInt(meta.version, 10) || sub.mediaVersion || 1,
    seq,
    type: sub.type,
    message: sub.message,
    anchor: sub.anchor,
    customer: sub.customer,
    token: sub.token,               // submitter handle; never returned to anyone
    status: 'new',                  // server-decided; a client may not set it
    staffReply: '',
    internalNote: '',
    publicVisible: false,
    submittedRole: role,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
  };

  try{ await fbStore.setJSON(key, rec); }
  catch(e){ return M.json(502, { error: 'フィードバックの保存に失敗しました。時間をおいて再度お試しください。' }); }

  // Saved. Everything below is best-effort and cannot fail the submission.
  const proto = event.headers['x-forwarded-proto'] || 'https';
  const siteUrl = process.env.URL || (proto + '://' + (event.headers.host || 'idfl-japan.com'));
  let note = { sent: false, reason: 'not_attempted' };
  try{ note = await N.notifyFeedback(rec, rec.mediaTitle, siteUrl); }catch(e){ note = { sent: false, reason: 'adapter_error' }; }

  return M.json(200, {
    ok: true,
    saved: true,
    notificationSent: !!note.sent,
    notificationReason: note.sent ? undefined : note.reason,
    feedback: F.projectCustomer(rec, sub.token),
  });
};

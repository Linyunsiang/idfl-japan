// ============================================================
// GET /.netlify/functions/feedback-list
//   ?mediaId=<id>&token=<submitter token>   customer view for one presentation
//   ?scope=all                               staff console (STAFF only)
//
// Role decides the projection, not the caller:
//   CUSTOMER -> only their own items plus anything staff marked public, with
//               every personal field, submitter token and internal note removed.
//   STAFF    -> full records.
//
// A customer is never handed the whole table, and never another customer's
// identity - they share one access password, so the response is the boundary.
// ============================================================
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const M = require('./_media');
const S = require('./_stores');
const F = require('./_feedback');

const MAX_SCAN = 2000;

async function readAll(store, prefix){
  const out = [];
  let keys = [];
  try{ const l = await store.list({ prefix }); keys = ((l && l.blobs) || []).map(b => b.key).slice(0, MAX_SCAN); }
  catch(e){ return out; }
  for(const k of keys){
    let r; try{ r = await store.get(k, { type: 'json' }); }catch(e){ continue; }
    if(r && r.id){ r.key = k; out.push(r); }
  }
  return out;
}

exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  const role = A.roleFromCookies(event.headers.cookie) || 'PUBLIC';
  if(role !== 'CUSTOMER' && role !== 'STAFF') return M.json(401, { error: 'ログインが必要です' });

  const q = event.queryStringParameters || {};
  let store; try{ store = getStore(S.feedbackStoreName()); }catch(e){ return M.json(200, { ok: true, role, items: [] }); }

  // ---------------------------------------------------------- staff: all
  if(String(q.scope || '') === 'all'){
    if(role !== 'STAFF') return M.json(403, { error: 'スタッフ権限が必要です' });
    const all = await readAll(store, 'fb/');
    all.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return M.json(200, { ok: true, role, items: all.map(F.projectStaff) });
  }

  // ------------------------------------------------- one media, either role
  const mediaId = String(q.mediaId || '');
  if(!F.ID_RE.test(mediaId)) return M.json(400, { error: '資料IDが不正です' });

  // Visibility of the media itself is re-checked here too, so feedback can
  // never be used to probe a record the caller may not read.
  try{
    const recStore = getStore(S.PROTECTED_STORE);
    const m = await recStore.getMetadata(mediaId);
    const meta = (m && m.metadata) || null;
    if(!meta || !meta.role) return M.json(404, { error: '資料が見つかりません' });
    const need = meta.role === 'staff' ? 'STAFF' : 'CUSTOMER';
    if(!A.meets(role, need)) return M.json(403, { error: '権限がありません' });
    if(meta.status === 'draft' && role !== 'STAFF') return M.json(404, { error: '資料が見つかりません' });
  }catch(e){ return M.json(500, { error: 'ストレージに接続できません' }); }

  const items = await readAll(store, 'fb/' + mediaId + '/');
  items.sort((a, b) => (a.seq || 0) - (b.seq || 0));

  if(role === 'STAFF'){
    return M.json(200, { ok: true, role, mediaId, items: items.map(F.projectStaff) });
  }

  const token = F.TOKEN_RE.test(String(q.token || '')) ? String(q.token) : '';
  const mine = items.filter(r => F.visibleToCustomer(r, token));
  return M.json(200, { ok: true, role, mediaId, items: mine.map(r => F.projectCustomer(r, token)) });
};

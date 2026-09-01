// ============================================================
// POST /.netlify/functions/feedback-manage   (STAFF session required)
//
// { action:'update', id, status?, staffReply?, internalNote?, publicVisible? }
// { action:'delete', id }
//
// Only staff reach this. Customer-owned content (message, anchor, contact
// details) is never rewritten here - staff may reply, annotate internally,
// move the status, publish an item to other customers, or delete it.
// ============================================================
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const M = require('./_media');
const S = require('./_stores');
const F = require('./_feedback');

exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  if(event.httpMethod !== 'POST') return M.json(405, { error: 'method not allowed' });
  if(M.badOrigin(event)) return M.json(403, { error: 'invalid origin' });
  if(A.roleFromCookies(event.headers.cookie) !== 'STAFF') return M.json(403, { error: 'スタッフ権限が必要です' });

  let body; try{ body = JSON.parse(event.body || '{}'); }catch(e){ return M.json(400, { error: 'リクエストが不正です' }); }

  let store; try{ store = getStore(S.feedbackStoreName()); }catch(e){ return M.json(500, { error: 'ストレージに接続できません' }); }

  const action = body.action === 'delete' ? 'delete' : 'update';
  const v = F.validateManage(body);
  if(!v.ok) return M.json(400, { error: v.error });
  const key = v.value.id;                       // full blob key: fb/<mediaId>/<id>
  if(key.indexOf('fb/') !== 0) return M.json(400, { error: 'IDが不正です' });

  let rec; try{ rec = await store.get(key, { type: 'json' }); }catch(e){ rec = null; }
  if(!rec || !rec.id) return M.json(404, { error: '該当のフィードバックが見つかりません' });

  if(action === 'delete'){
    try{ await store.delete(key); }catch(e){ return M.json(502, { error: '削除に失敗しました' }); }
    return M.json(200, { ok: true, deleted: key });
  }

  const patch = v.value.patch;
  if(patch.status != null){
    rec.status = patch.status;
    rec.resolvedAt = (patch.status === 'resolved' || patch.status === 'dismissed') ? M.nowJst() : null;
  }
  if(patch.staffReply != null) rec.staffReply = patch.staffReply;
  if(patch.internalNote != null) rec.internalNote = patch.internalNote;
  if(patch.publicVisible != null) rec.publicVisible = patch.publicVisible;
  rec.updatedAt = M.nowJst();

  try{ await store.setJSON(key, rec); }catch(e){ return M.json(502, { error: '更新に失敗しました' }); }
  return M.json(200, { ok: true, item: F.projectStaff(rec) });
};

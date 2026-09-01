// ============================================================
// GET /.netlify/functions/media-grant?id=<mediaId>
//
// Issues the short-lived, single-media token the viewer mounts the package
// under. Requires a real session; the token can never grant more than the
// session that asked for it, and never more than one media record.
// ============================================================
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const M = require('./_media');
const S = require('./_stores');

exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  const id = String((event.queryStringParameters || {}).id || '');
  if(!M.ID_RE.test(id) || id.indexOf('__') === 0) return M.json(400, { error: 'invalid id' });
  if(!process.env.SESSION_SECRET) return M.json(500, { error: 'サーバ設定エラー（環境変数未設定）' });

  const role = A.roleFromCookies(event.headers.cookie) || 'PUBLIC';
  if(role !== 'CUSTOMER' && role !== 'STAFF') return M.json(401, { error: 'ログインが必要です' });

  let store; try{ store = getStore(S.PROTECTED_STORE); }catch(e){ return M.json(500, { error: 'ストレージに接続できません' }); }
  let meta;
  try{ const m = await store.getMetadata(id); meta = (m && m.metadata) || null; }catch(e){ meta = null; }
  if(!meta || meta.kind !== 'html') return M.json(404, { error: '資料が見つかりません' });

  const need = meta.role === 'staff' ? 'STAFF' : 'CUSTOMER';
  if(!A.meets(role, need)) return M.json(403, { error: 'この資料を閲覧する権限がありません' });
  if(meta.status === 'draft' && role !== 'STAFF') return M.json(404, { error: '資料が見つかりません' });

  const version = parseInt(meta.version, 10) || 1;
  return M.json(200, {
    ok: true,
    id,
    token: M.signGrant(id, role),
    expiresIn: M.GRANT_TTL,
    entry: String(meta.entry || 'index.html'),
    version,
    title: meta.title || meta.name || '',
    description: meta.description || '',
    group: meta.group || '',
    status: meta.status === 'draft' ? 'draft' : 'published',
    updatedAt: meta.updatedAt || meta.uploadedAt || '',
  });
};

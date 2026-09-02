// ============================================================
// GET /.netlify/functions/customer-app?slug=<slug>   resolve one app
// GET /.netlify/functions/customer-app?list=1        apps the caller may open
//
// Resolves a friendly /customer/<slug> route to the protected media record it
// aliases. It grants nothing on its own: the shell still asks media-grant for a
// token and protected-media-asset still re-checks the session on every asset.
//
// Deliberately terse about failure. An unknown slug, an unpublished app and an
// app the caller may not open all answer the same way, so the route cannot be
// used to enumerate what exists.
// ============================================================
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const M = require('./_media');
const S = require('./_stores');
const APPS = require('./_apps');

const STORE = S.PROTECTED_STORE;

function resp(code, obj){
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

/** Walk the protected store once, yielding [{key, meta}] for HTML app records. */
async function appRecords(store){
  let keys = [];
  try{ const l = await store.list(); keys = ((l && l.blobs) || []).map(b => b.key); }
  catch(e){ return []; }
  const out = [];
  for(const key of keys){
    if(String(key).indexOf('__') === 0) continue;
    let m; try{ m = await store.getMetadata(key); }catch(e){ continue; }
    const meta = (m && m.metadata) || {};
    if(!meta.role || meta.kind !== 'html') continue;
    out.push({ key, meta });
  }
  return out;
}

exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  const q = event.queryStringParameters || {};
  const role = A.roleFromCookies(event.headers.cookie) || 'PUBLIC';

  // Every app route is behind the existing customer session. No new auth.
  if(role !== 'CUSTOMER' && role !== 'STAFF') return resp(401, { error: 'ログインが必要です' });

  let store; try{ store = getStore(STORE); }catch(e){ return resp(500, { error: 'ストレージに接続できません' }); }

  // ------------------------------------------------------------- list mode
  if(String(q.list || '') === '1'){
    const recs = await appRecords(store);
    const apps = [];
    for(const { key, meta } of recs){
      const v = APPS.appVisibility(meta);
      if(!v.isApp) continue;
      if(!A.meets(role, v.needRole)) continue;
      if(v.draft && role !== 'STAFF') continue;
      apps.push({
        slug: v.slug,
        title: meta.title || meta.name || v.slug,
        description: meta.appDescription || meta.description || '',
        icon: meta.appIcon || '',
        group: meta.group || '',
        status: v.draft ? 'draft' : 'published',
        role: meta.role,
        version: parseInt(meta.version, 10) || 1,
        updatedAt: meta.updatedAt || meta.uploadedAt || '',
      });
    }
    apps.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    return resp(200, { ok: true, role, apps });
  }

  // ---------------------------------------------------------- resolve mode
  const slug = APPS.normalizeSlug(q.slug);
  // Reject anything that is not slug-shaped before touching storage.
  if(!slug || !APPS.SLUG_RE.test(slug)) return resp(404, { error: 'not found' });

  const recs = await appRecords(store);
  let hit = null;
  for(const { key, meta } of recs){
    const v = APPS.appVisibility(meta);
    if(v.isApp && v.slug === slug){ hit = { key, meta, v }; break; }
  }
  // Unknown, unpublished, app-disabled and not-permitted all look identical.
  if(!hit) return resp(404, { error: 'not found' });
  if(!A.meets(role, hit.v.needRole)) return resp(404, { error: 'not found' });
  if(hit.v.draft && role !== 'STAFF') return resp(404, { error: 'not found' });

  return resp(200, {
    ok: true,
    role,
    id: hit.key,
    slug,
    title: hit.meta.title || hit.meta.name || slug,
    description: hit.meta.appDescription || hit.meta.description || '',
    icon: hit.meta.appIcon || '',
    entry: hit.meta.entry || 'index.html',
    version: parseInt(hit.meta.version, 10) || 1,
    status: hit.v.draft ? 'draft' : 'published',
    feedbackEnabled: hit.v.feedback,
    updatedAt: hit.meta.updatedAt || hit.meta.uploadedAt || '',
  });
};

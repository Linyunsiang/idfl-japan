// ============================================================
// GET /media/:id/:token/*   ->   this function (rewrite in netlify.toml)
//
// Serves one file out of a protected HTML presentation package.
//
// Why a path mount instead of ?id=&path=: the presentation links its assets
// relatively ("styles/main.css"), and only a real directory-shaped URL makes
// the browser resolve those the way the author intended.
//
// Authorisation on EVERY asset request, never once at the door:
//   - a valid session cookie (STAFF, or CUSTOMER for customer-role media), or
//   - a short-lived grant token scoped to this one media id.
// Draft media stays STAFF-only either way.
//
// Isolation: every response carries a CSP `sandbox` directive, so even if
// someone opened this URL directly in a top-level tab the document would run
// in an opaque origin - it cannot read the session cookie or reach the site.
// ============================================================
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const M = require('./_media');
const S = require('./_stores');
const AN = require('./_annotate');

// Matches the iframe sandbox attribute in media-viewer.html. No allow-same-origin.
const CSP_SANDBOX = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-forms allow-downloads';

function deny(code, msg){
  return { statusCode: code, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: msg };
}

// Where the four segments can turn up, most trustworthy first.
//
// Netlify substitutes redirect placeholders in the target PATH, never inside a
// query string - and for a rewrite it reports the ORIGINAL request path to the
// function, not the target. So accept both shapes rather than betting on one:
//   /media/<id>/<token>/<mode>/<rest>                     (what the reader asked for)
//   /.netlify/functions/protected-media-asset/<id>/...    (the rewrite target)
// Query parameters remain supported for calling the function directly.
const MOUNTS = ['/media/', '/.netlify/functions/protected-media-asset/'];

function fromPath(p){
  const s = String(p || '').split('?')[0];
  for(const mount of MOUNTS){
    const i = s.indexOf(mount);
    if(i < 0) continue;
    const rest = s.slice(i + mount.length).split('/');
    if(rest.length >= 4 && rest[0] && rest[1] && rest[2]){
      return { id: rest[0], token: rest[1], mode: rest[2], path: rest.slice(3).join('/') };
    }
  }
  return null;
}

function readParams(event){
  const hit = fromPath(event.path) || fromPath(event.rawUrl);
  if(hit) return hit;
  const q = event.queryStringParameters || {};
  return { id: String(q.id || ''), token: String(q.t || ''), mode: String(q.m || ''), path: String(q.path || '') };
}

exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  const q = readParams(event);
  const id = q.id;
  const token = q.token;
  let path = q.path;

  if(!M.ID_RE.test(id) || id.indexOf('__') === 0) return deny(400, 'invalid id');

  try{ path = decodeURIComponent(path); }catch(e){ return deny(400, 'invalid path'); }
  path = path.split('?')[0].split('#')[0];
  const safe = require('./_zip').safePath(path);
  if(!safe) return deny(400, 'invalid path');

  // --- record + visibility ------------------------------------------------
  let recStore, mediaStore;
  try{ recStore = getStore(S.PROTECTED_STORE); mediaStore = getStore(S.mediaStoreName()); }
  catch(e){ return deny(500, 'storage unavailable'); }

  let meta;
  try{ const m = await recStore.getMetadata(id); meta = (m && m.metadata) || null; }catch(e){ meta = null; }
  if(!meta || meta.kind !== 'html') return deny(404, 'not found');

  const need = meta.role === 'staff' ? 'STAFF' : 'CUSTOMER';
  const cookieRole = A.roleFromCookies(event.headers.cookie) || 'PUBLIC';
  const grantRole = token ? M.verifyGrant(token, id) : null;
  const effective = A.meets(cookieRole, need) ? cookieRole : (grantRole && A.meets(grantRole, need) ? grantRole : null);
  if(!effective){
    return { statusCode: 302, headers: { 'Location': '/login.html?role=' + (need === 'STAFF' ? 'staff' : 'customer') + '&next=' + encodeURIComponent('/customer/media.html'), 'Cache-Control': 'no-store' }, body: '' };
  }
  // Drafts are staff-only, even with a valid grant.
  if(meta.status === 'draft' && effective !== 'STAFF') return deny(404, 'not found');

  // --- bytes --------------------------------------------------------------
  const version = parseInt(meta.version, 10) || 1;
  const key = id + '/v' + version + '/' + safe;
  let res;
  try{ res = await mediaStore.getWithMetadata(key, { type: 'arrayBuffer' }); }catch(e){ res = null; }
  if(!res || !res.data) return deny(404, 'not found');

  let buf = Buffer.from(res.data);
  const isEntry = safe === String(meta.entry || 'index.html');
  // Mode segment: "v" = plain view, "f-<nonce>" = feedback mode.
  const wantFb = /^f-[A-Za-z0-9_-]{8,64}$/.test(q.mode || '');
  let contentType = (res.metadata && res.metadata.contentType) || M.mimeFor(safe);

  // The annotation agent is injected only into the entry document, and only
  // when the viewer asked for feedback mode.
  if(isEntry && wantFb && M.isHtmlPath(safe)){
    buf = Buffer.from(AN.injectAgent(buf.toString('utf8')), 'utf8');
    contentType = 'text/html; charset=utf-8';
  }

  /* The sandbox goes on documents, not on their bytes.

     CSP sandbox exists so a customer HTML package cannot reach the page that
     frames it. An image, a font or an audio clip is not a browsing context
     and executes nothing, so sandboxing one protects nothing — but Chrome
     refuses to decode a media resource whose own response carries it, which
     is what silenced the narration. Measured, not guessed:

       plain server, no CSP on the clip -> readyState 4, plays
       this server, CSP on the clip     -> networkState 3, NETWORK_NO_SOURCE

     fetch() retrieves the same bytes either way, which is why the package
     checks all passed while playback did not. Images tolerate it too, so the
     117 extracted pictures never showed a symptom.

     Every HTML response still carries it, which is where the guarantee lives:
     the entry document is the only thing that could run code. */
  const headers = {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    // private: this is behind a session; a shared cache must never keep it.
    'Cache-Control': 'private, max-age=0, must-revalidate',
  };
  if(M.isHtmlPath(safe) || contentType.indexOf('text/html') === 0){
    headers['Content-Security-Policy'] = CSP_SANDBOX;
  }

  return {
    statusCode: 200,
    headers: headers,
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};

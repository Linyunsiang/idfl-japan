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
//
// Byte ranges: a Netlify synchronous function cannot return more than
// 6,291,556 bytes, and this body is base64-encoded, so nothing above ~4.4 MB
// can leave here in ONE response. Video does not need one response. A media
// element always asks for byte ranges, so a 6.5 MB clip is delivered as a
// handful of 206s and the ceiling never comes into it. Answering ranges is
// also what makes the progress bar draggable: without Accept-Ranges the
// browser can only play what it has already downloaded from the start.
// ============================================================
const { getStore } = require('@netlify/blobs');
const B = require('./_blobs');
const A = require('./_auth');
const M = require('./_media');
const S = require('./_stores');
const AN = require('./_annotate');
const N = require('./_normalize');

// Matches the iframe sandbox attribute in media-viewer.html. No allow-same-origin.
const CSP_SANDBOX = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-forms allow-downloads';

/**
 * Parse a single byte range against a known total.
 *
 * Returns {start,end} inclusive, null when there is no Range header to honour,
 * or 'unsatisfiable'. Multi-range requests (`bytes=0-9,20-29`) are deliberately
 * treated as absent: answering them means multipart/byteranges, which no media
 * element asks for, and serving the whole file instead is always correct.
 */
function parseRange(header, total){
  const raw = String(header || '').trim();
  if(!raw) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(raw);
  if(!m) return null;                                   // multi-range or malformed
  const hasStart = m[1] !== '', hasEnd = m[2] !== '';
  if(!hasStart && !hasEnd) return null;

  let start, end;
  if(!hasStart){
    // Suffix range: the LAST n bytes. Safari uses this to read the MP4 moov atom.
    const n = parseInt(m[2], 10);
    if(!(n > 0)) return 'unsatisfiable';
    start = Math.max(0, total - n); end = total - 1;
  }else{
    start = parseInt(m[1], 10);
    end = hasEnd ? parseInt(m[2], 10) : total - 1;
    if(!(start >= 0) || start >= total) return 'unsatisfiable';
    if(!(end >= start)) return 'unsatisfiable';
    if(end > total - 1) end = total - 1;
  }
  return { start, end };
}

/** Never promise more in one response than the platform can carry. */
function capRange(r, total){
  const max = N.LIMITS.RANGE_SLICE_BYTES;
  const end = Math.min(r.end, r.start + max - 1, total - 1);
  return { start: r.start, end };
}

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
  B.connect(event);
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
  try{ recStore = B.readStore(S.PROTECTED_STORE); mediaStore = getStore(S.mediaStoreName()); }
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

  const total = buf.length;
  const ranged = M.isRangePath(safe);

  const base = {
    'Content-Type': contentType,
    'Content-Security-Policy': CSP_SANDBOX,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    // private: this is behind a session; a shared cache must never keep it.
    'Cache-Control': 'private, max-age=0, must-revalidate',
    // Advertised on everything: it costs nothing, and a client that knows it
    // may seek will not download a clip from the start to reach the middle.
    'Accept-Ranges': 'bytes',
  };

  // A HEAD is how a player asks "how big is it, and can I seek?" before it
  // fetches a single byte. Answer honestly and send no body.
  if(String(event.httpMethod || 'GET').toUpperCase() === 'HEAD'){
    return { statusCode: 200, headers: Object.assign({}, base, { 'Content-Length': String(total) }), body: '' };
  }

  const asked = parseRange(event.headers && event.headers.range, total);
  if(asked === 'unsatisfiable'){
    return {
      statusCode: 416,
      headers: Object.assign({}, base, { 'Content-Range': 'bytes */' + total }),
      body: '',
    };
  }

  // A whole-file 200 is still the right answer whenever it fits, and it is what
  // every existing package gets: HTML, CSS, images and fonts are unchanged.
  if(!asked && total <= N.LIMITS.SAFE_PROTECTED_ASSET){
    return { statusCode: 200, headers: base, body: buf.toString('base64'), isBase64Encoded: true };
  }

  // Past this point the file cannot be returned whole. Either the client asked
  // for a range, or it is a media file too large for one response - in which
  // case answering with the first slice, correctly labelled, is what lets the
  // player continue by asking for the rest. A truncated 200 would not: it would
  // claim to be the entire file and the clip would silently end early.
  if(!asked && !ranged){
    // Unreachable through the upload path - ingest refuses a non-media asset
    // this large - but if one ever exists, say so instead of returning a body
    // the platform will reject with an opaque 502.
    return deny(500, 'asset too large to serve: ' + safe + ' (' + M.human(total) + ')');
  }

  const r = capRange(asked || { start: 0, end: total - 1 }, total);
  const slice = buf.slice(r.start, r.end + 1);
  return {
    statusCode: 206,
    headers: Object.assign({}, base, {
      'Content-Range': 'bytes ' + r.start + '-' + r.end + '/' + total,
      'Content-Length': String(slice.length),
    }),
    body: slice.toString('base64'),
    isBase64Encoded: true,
  };
};

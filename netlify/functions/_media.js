// ============================================================
// IDFL - shared helpers for the customer Media Library.
//
// Media *records* live in the existing idfl-protected store (single source of
// truth for every customer-facing surface). Only the bytes of an HTML
// presentation package live in a separate store, one blob per asset, so the
// download list never has to page past them.
// ============================================================
const crypto = require('crypto');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Content types for package assets. Anything not listed is served as a
// download-safe octet-stream rather than guessed.
const MIME = {
  html:'text/html; charset=utf-8', htm:'text/html; charset=utf-8',
  css:'text/css; charset=utf-8', js:'text/javascript; charset=utf-8', mjs:'text/javascript; charset=utf-8',
  json:'application/json; charset=utf-8', map:'application/json; charset=utf-8',
  txt:'text/plain; charset=utf-8', csv:'text/csv; charset=utf-8', xml:'application/xml; charset=utf-8',
  png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp',
  avif:'image/avif', ico:'image/x-icon', bmp:'image/bmp', svg:'image/svg+xml',
  woff:'font/woff', woff2:'font/woff2', ttf:'font/ttf', otf:'font/otf', eot:'application/vnd.ms-fontobject',
  mp4:'video/mp4', webm:'video/webm', ogg:'audio/ogg', mp3:'audio/mpeg', wav:'audio/wav',
  m4v:'video/x-m4v', mov:'video/quicktime', ogv:'video/ogg',
  m4a:'audio/mp4', aac:'audio/aac', flac:'audio/flac',
  // Subtitle sidecars travel with the video clips in a teaching package.
  vtt:'text/vtt; charset=utf-8', srt:'text/plain; charset=utf-8',
  pdf:'application/pdf',
};

// Extensions served by byte range rather than in one response. A media element
// always asks for ranges, so these need never cross the wire whole - which is
// what lets a package carry a 6.5 MB video past a 6.29 MB response ceiling.
const RANGE_EXT = ['mp4','m4v','mov','webm','ogv','ogg','mp3','m4a','wav','aac','flac'];

function extOf(name){ return (String(name || '').split('.').pop() || '').toLowerCase(); }
function mimeFor(path){ return MIME[extOf(path)] || 'application/octet-stream'; }
function isHtmlPath(path){ const e = extOf(path); return e === 'html' || e === 'htm'; }
/** True for assets the protected asset server delivers by byte range. */
function isRangePath(path){ return RANGE_EXT.indexOf(extOf(path)) >= 0; }

/**
 * Run `fn` over `items` with at most `limit` in flight, preserving order.
 *
 * Why this exists: a synchronous Netlify function has ten seconds, and a
 * 147-file package meant 147 sequential round trips to Blobs - comfortably
 * over budget. Done a dozen at a time the same work lands in about a second.
 * The first rejection wins; nothing is retried here on purpose, because the
 * callers need to know exactly which keys they managed to write.
 */
async function mapPool(items, limit, fn){
  const list = Array.from(items || []);
  const out = new Array(list.length);
  const width = Math.max(1, Math.min(limit | 0 || 1, list.length));
  let next = 0;
  const workers = [];
  for(let w = 0; w < width; w++){
    workers.push((async () => {
      for(;;){
        const i = next++;
        if(i >= list.length) return;
        out[i] = await fn(list[i], i);
      }
    })());
  }
  await Promise.all(workers);
  return out;
}

/**
 * The media type shown in the library, derived from what is already stored so
 * existing download records need no migration.
 */
function mediaTypeOf(meta){
  const kind = (meta && meta.kind) || 'file';
  if(kind === 'link') return 'external';
  if(kind === 'html') return 'html';
  const e = extOf(meta && meta.name);
  if(e === 'pdf') return 'pdf';
  if(['png','jpg','jpeg','gif','webp','bmp'].indexOf(e) >= 0) return 'image';
  return 'document';
}

// The one shape a stored item is handed to a client in. protected-list builds
// every row with it, and protected-update answers an edit with it, so a saved
// row and a listed row can never disagree about what a record looks like.
function recordOf(id, meta){
  meta = meta || {};
  return {
    id,
    kind: meta.kind || 'file',
    url: (meta.kind === 'link' ? meta.url : undefined),
    name: meta.name,
    title: meta.title || meta.name,
    group: meta.group || '',
    role: meta.role,
    status: meta.status === 'draft' ? 'draft' : 'published',
    sizeLabel: meta.sizeLabel,
    contentType: meta.contentType,
    uploadedAt: meta.uploadedAt,
    updatedAt: meta.updatedAt || meta.uploadedAt,
    // Media Library fields. Derived where possible so existing records need
    // no migration; a client that does not know the extra fields ignores them.
    mediaType: mediaTypeOf(meta),
    description: meta.description || '',
    thumb: meta.thumb || '',
    version: meta.version ? (parseInt(meta.version, 10) || 1) : undefined,
    entry: meta.kind === 'html' ? (meta.entry || 'index.html') : undefined,
    assetCount: meta.kind === 'html' ? (parseInt(meta.files, 10) || 0) : undefined,
  };
}

function b64url(buf){ return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

// --------------------------------------------------------------------------
// Media grant tokens.
//
// A sandboxed iframe has an opaque origin; whether its subresource requests
// carry our session cookie is browser- and setting-dependent. Rather than bet
// the whole viewer on that, the viewer asks for a short-lived token scoped to
// ONE media id and mounts the package under /media/<id>/<token>/. Asset
// requests are then authorised by cookie OR token - never by neither.
// --------------------------------------------------------------------------
const GRANT_TTL = 45 * 60; // seconds

function grantSecret(){ return process.env.SESSION_SECRET || ''; }

function signGrant(mediaId, role){
  const exp = Math.floor(Date.now() / 1000) + GRANT_TTL;
  const body = mediaId + '.' + (role === 'STAFF' ? 's' : 'c') + '.' + exp;
  const sig = b64url(crypto.createHmac('sha256', grantSecret()).update(body).digest()).slice(0, 32);
  return (role === 'STAFF' ? 's' : 'c') + exp.toString(36) + '-' + sig;
}

/** Returns the granted role ('STAFF'|'CUSTOMER') or null. */
function verifyGrant(token, mediaId){
  if(!grantSecret()) return null;
  const m = /^([sc])([0-9a-z]{1,10})-([A-Za-z0-9_-]{32})$/.exec(String(token || ''));
  if(!m) return null;
  const role = m[1] === 's' ? 'STAFF' : 'CUSTOMER';
  const exp = parseInt(m[2], 36);
  if(!exp || exp < Math.floor(Date.now() / 1000)) return null;
  const body = mediaId + '.' + m[1] + '.' + exp;
  const expected = b64url(crypto.createHmac('sha256', grantSecret()).update(body).digest()).slice(0, 32);
  const a = Buffer.from(m[3]), b = Buffer.from(expected);
  if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return role;
}

function nowJst(){ const d = new Date(Date.now() + 9 * 3600 * 1000); return d.toISOString().replace('Z', '+09:00'); }
function human(b){ return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function newId(){ return Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex'); }

function json(code, obj){
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

/** Same-origin guard, matching the existing protected-* functions. */
function badOrigin(event){
  const origin = event.headers.origin || event.headers.referer || '';
  const host = event.headers.host || '';
  return !!(host && origin && origin.indexOf(host) < 0);
}

module.exports = {
  ID_RE, MIME, RANGE_EXT, extOf, mimeFor, isHtmlPath, isRangePath, mediaTypeOf, recordOf, mapPool,
  signGrant, verifyGrant, GRANT_TTL,
  nowJst, human, newId, json, badOrigin, b64url,
};

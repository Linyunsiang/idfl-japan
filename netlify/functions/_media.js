// ============================================================
// IDFL - shared helpers for the customer Media Library.
//
// Media *records* live in the existing idfl-protected store (single source of
// truth, same as /customer/downloads.html). Only the bytes of an HTML
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
  pdf:'application/pdf',
};

function extOf(name){ return (String(name || '').split('.').pop() || '').toLowerCase(); }
function mimeFor(path){ return MIME[extOf(path)] || 'application/octet-stream'; }
function isHtmlPath(path){ const e = extOf(path); return e === 'html' || e === 'htm'; }

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
  ID_RE, MIME, extOf, mimeFor, isHtmlPath, mediaTypeOf,
  signGrant, verifyGrant, GRANT_TTL,
  nowJst, human, newId, json, badOrigin, b64url,
};

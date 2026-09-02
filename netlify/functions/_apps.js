// ============================================================
// IDFL - customer app slugs.
//
// A "customer app" is nothing new: it is an existing protected HTML media
// record (same blob, same package, same feedback) given a friendly route.
//   /customer/<slug>  ->  the shell  ->  the same protected package
// There is one source of truth; the slug is only an alias.
//
// The reserved list is DERIVED from the repository so a real page under
// /customer/ can never be shadowed by a slug. Netlify also serves a matching
// static file before it reaches the router, so this is defence in depth: the
// admin console refuses the slug rather than letting staff create a route that
// silently does nothing.
// ============================================================
const fs = require('fs');
const path = require('path');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$|^[a-z0-9]$/;

// Routes that must never be an app slug, regardless of what is on disk.
const RESERVED_FIXED = [
  'media', 'media.html', 'media-viewer', 'media-viewer.html',
  'downloads', 'downloads.html', 'apps', 'apps.html', 'app', 'app.html',
  'login', 'admin', 'feedback', 'index', 'index.html',
  'api', 'assets', 'static', 'public', 'files', 'new', 'edit', 'delete',
];

let DISK_CACHE = null;

/** Every real page that already lives under /customer/, with and without .html. */
function reservedFromDisk(){
  if(DISK_CACHE) return DISK_CACHE;
  const found = new Set();
  // The bundled function runs from a different cwd than the repo root, so try
  // a few plausible roots and accept whichever resolves.
  const roots = [
    path.resolve(__dirname, '../../customer'),
    path.resolve(process.cwd(), 'customer'),
  ];
  for(const dir of roots){
    let names = [];
    try{ names = fs.readdirSync(dir); }catch(e){ continue; }
    for(const n of names){
      const base = String(n).toLowerCase();
      found.add(base);                                   // downloads.html
      found.add(base.replace(/\.html?$/, ''));           // downloads
    }
    if(names.length) break;
  }
  DISK_CACHE = [...found];
  return DISK_CACHE;
}

function reservedSlugs(){
  const all = new Set(RESERVED_FIXED);
  for(const r of reservedFromDisk()) all.add(r);
  return all;
}

/** Lowercase and trim; does not validate. */
function normalizeSlug(v){ return String(v == null ? '' : v).trim().toLowerCase(); }

/**
 * Validate a slug for storage.
 * Returns { ok:true, slug } or { ok:false, error } with a Japanese message.
 * An empty value is valid and means "no direct route".
 */
function validateSlug(raw){
  const slug = normalizeSlug(raw);
  if(!slug) return { ok: true, slug: '' };
  if(slug.length > 60) return { ok: false, error: 'URLが長すぎます（60文字以内）' };
  if(!SLUG_RE.test(slug)){
    return { ok: false, error: 'URLは半角英小文字・数字・ハイフンのみ使用できます（先頭と末尾はハイフン以外）' };
  }
  if(reservedSlugs().has(slug)) return { ok: false, error: 'このURLは既存のページで使用されています。' };
  return { ok: true, slug };
}

/**
 * Is this slug already taken by a DIFFERENT record?
 * `entries` is [{ id, appSlug }]; selfId is excluded so a record can keep its own.
 */
function slugTaken(entries, slug, selfId){
  const want = normalizeSlug(slug);
  if(!want) return false;
  return (entries || []).some(e => e && e.id !== selfId && normalizeSlug(e.appSlug) === want);
}

/** Only a published, app-enabled HTML record is reachable by a customer. */
function appVisibility(meta){
  const kind = meta && meta.kind;
  const enabled = String((meta && meta.appEnabled) || '') === '1';
  return {
    isApp: kind === 'html' && enabled && !!normalizeSlug(meta && meta.appSlug),
    slug: normalizeSlug(meta && meta.appSlug),
    needRole: (meta && meta.role) === 'staff' ? 'STAFF' : 'CUSTOMER',
    draft: (meta && meta.status) === 'draft',
    feedback: String((meta && meta.feedbackEnabled) || '') !== '0',   // on unless switched off
  };
}

module.exports = { SLUG_RE, RESERVED_FIXED, reservedSlugs, reservedFromDisk, normalizeSlug, validateSlug, slugTaken, appVisibility };

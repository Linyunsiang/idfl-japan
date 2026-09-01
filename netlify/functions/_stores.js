// ============================================================
// IDFL - Netlify Blobs store names.
//
// Netlify Blobs stores opened with getStore() are SITE-WIDE: a Deploy Preview
// and production share the same bucket. That is fine for the long-standing
// download store (staff expect a preview to show the real資料), but it is NOT
// acceptable for the new stores, which hold customer personal data and媒体
// packages: a preview must never write into production.
//
// So: the legacy store keeps its exact name, and the new stores are suffixed
// per deploy context.
// ============================================================

// Existing customer-download store. Name must NOT change.
const PROTECTED_STORE = 'idfl-protected';

function slug(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40); }

// '' on production; a context-specific suffix everywhere else.
function ctxSuffix(){
  const c = String(process.env.CONTEXT || '').toLowerCase();
  if(!c || c === 'production') return '';
  if(c === 'deploy-preview') return '-dp' + (process.env.REVIEW_ID ? '-'+slug(process.env.REVIEW_ID) : '');
  if(c === 'branch-deploy')  return '-br' + (process.env.BRANCH ? '-'+slug(process.env.BRANCH) : '');
  return '-' + (slug(c) || 'dev');
}

// Bytes of uploaded HTML presentation packages (one blob per asset).
function mediaStoreName(){ return 'idfl-media-html' + ctxSuffix(); }
// Customer feedback. Contains personal data - never mixed into the site content store.
function feedbackStoreName(){ return 'idfl-feedback' + ctxSuffix(); }

function isProduction(){ return String(process.env.CONTEXT||'production').toLowerCase() === 'production'; }

module.exports = { PROTECTED_STORE, mediaStoreName, feedbackStoreName, ctxSuffix, isProduction };

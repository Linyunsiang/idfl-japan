// ============================================================
// IDFL - Netlify Blobs connection, with reads that tell the truth.
//
// A blobs read defaults to `consistency: 'eventual'` and is served from a
// cached edge. That is why a staff edit looked like it never saved: the write
// returned ok, and the very next protected-list still handed back the old
// metadata - so the admin list redrew the old title, and /customer/media did
// not see the item go public. Worse, protected-update is a read-modify-write:
// reading stale metadata and writing it back silently undoes the edit before.
//
// Strong reads need `uncachedEdgeURL`. connectLambda() does not set it: in
// @netlify/blobs v8 it copies only `url` out of the Lambda blobs payload
// (node_modules/@netlify/blobs/dist/main.js). The payload also carries the
// uncached URL, so we build the context ourselves and hand it over.
//
// If that URL is ever absent the runtime keeps working exactly as before -
// STRONG stays false and every store is opened the old way, because a stale
// read beats a thrown BlobsConsistencyError.
// ============================================================
const { getStore, connectLambda, setEnvironmentContext } = require('@netlify/blobs');

let STRONG = false;

function decodeCtx(raw){
  try{
    if(!raw || typeof raw !== 'string') return null;
    const o = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    return (o && typeof o === 'object') ? o : null;
  }catch(e){ return null; }
}

// Call once at the top of every handler, in place of connectLambda().
function connect(event){
  STRONG = false;

  // The runtime may already have published a full context - newer Netlify
  // builds set NETLIFY_BLOBS_CONTEXT for every function, not just v2 ones.
  // When it carries the uncached URL it is the better context of the two, and
  // connectLambda() would overwrite it with a poorer one.
  const ambient = decodeCtx(globalThis.netlifyBlobsContext) || decodeCtx(process.env.NETLIFY_BLOBS_CONTEXT);
  if(ambient && ambient.uncachedEdgeURL && ambient.edgeURL && ambient.token){
    STRONG = true;
    return;
  }

  try{ connectLambda(event); }catch(e){}

  // Otherwise take it from the Lambda payload, which pairs the uncached URL
  // with the same token as the cached one.
  const d = decodeCtx(event && event.blobs);
  const uncached = d && (d.url_uncached || d.uncachedURL || d.uncachedEdgeURL);
  if(!d || !uncached || !d.url) return;
  const h = (event && event.headers) || {};
  try{
    setEnvironmentContext({
      deployID: h['x-nf-deploy-id'],
      edgeURL: d.url,
      uncachedEdgeURL: uncached,
      siteID: h['x-nf-site-id'],
      token: d.token,
    });
    STRONG = true;
  }catch(e){ STRONG = false; }
}

// For reads that back a decision: what the admin list shows, what a customer
// is allowed to see, and anything read in order to be written back.
function readStore(name){
  if(!STRONG) return getStore(name);
  try{ return getStore({ name, consistency: 'strong' }); }
  catch(e){ return getStore(name); }
}

// For writes, and for reads of immutable data (package assets live under a
// versioned key, so a cached copy is never the wrong content). Keeping these
// on the cached edge is what keeps video byte-range serving cheap.
function writeStore(name){ return getStore(name); }

// Reported to STAFF by protected-list so a stale-read problem is visible
// instead of being guessed at.
function mode(){ return STRONG ? 'strong' : 'eventual'; }

module.exports = { connect, readStore, writeStore, mode };

// ------------------------------------------------------------------
// Metadata budget.
//
// Blob metadata travels as a header: `b64;` + base64(JSON) plus the header
// name must fit in 2 KB (METADATA_MAX_SIZE in the client). Japanese costs
// three bytes a character, so the 600-character ceiling the edit API
// advertises for 説明 is nearly twice what actually fits, and the client
// throws "Metadata object exceeds the maximum size" on save. Check it here so
// the reply can say what to shorten instead of a bare 更新に失敗しました.
// ------------------------------------------------------------------
const METADATA_MAX = 2 * 1024;
const METADATA_HEADER = 'netlify-blobs-metadata';

function metadataSize(meta){
  const bytes = Buffer.byteLength(JSON.stringify(meta || {}), 'utf8');
  return METADATA_HEADER.length + 'b64;'.length + Math.ceil(bytes / 3) * 4;
}

// null when it fits; otherwise a message naming roughly how much to cut.
function metadataError(meta){
  const over = metadataSize(meta) - METADATA_MAX;
  if(over <= 0) return null;
  // Four base64 characters per three source bytes, three bytes per Japanese
  // character: one character of text per four characters of overflow.
  return 'タイトルと説明が長すぎて保存できません。合わせて' + Math.ceil(over / 4) + '文字ほど短くしてください。';
}

module.exports.metadataSize = metadataSize;
module.exports.metadataError = metadataError;

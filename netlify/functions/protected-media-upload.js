// ============================================================
// POST /.netlify/functions/protected-media-upload   (STAFF session required)
//
// Adds or replaces a protected HTML presentation.
// Body: { filename, contentBase64, role, title?, description?, group?, status?,
//         thumb?, replaceId? }
//
// Accepts a standalone .html OR a .zip package. The package is exploded here,
// one blob per asset, so the viewer can serve relative paths (styles/main.css,
// scripts/deck.js ...) exactly as authored.
//
// The record itself goes into the SAME idfl-protected store the customer
// download page already reads, so the Media Library and /customer/downloads.html
// share one source of truth. Only the asset bytes live elsewhere.
//
// Nothing here is ever written to the public repository.
// ============================================================
const { getStore, connectLambda } = require('@netlify/blobs');
const A = require('./_auth');
const M = require('./_media');
const P = require('./_package');
const S = require('./_stores');

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;   // matches the sync-function request ceiling

function human(b){ return M.human(b); }

exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  if(event.httpMethod !== 'POST') return M.json(405, { error: 'method not allowed' });
  if(M.badOrigin(event)) return M.json(403, { error: 'invalid origin' });
  if(A.roleFromCookies(event.headers.cookie) !== 'STAFF') return M.json(403, { error: 'スタッフ権限が必要です' });

  let body; try{ body = JSON.parse(event.body || '{}'); }catch(e){ return M.json(400, { error: 'invalid request' }); }

  const targetRole = body.role === 'staff' ? 'staff' : (body.role === 'customer' ? 'customer' : null);
  if(!targetRole) return M.json(400, { error: '公開区分（staff/customer）が不正です' });
  const status = body.status === 'published' ? 'published' : 'draft';   // new media defaults to draft

  const name = String(body.filename || '').split(/[\\/]/).pop().slice(0, 180);
  const ext = M.extOf(name);
  if(ext !== 'zip' && ext !== 'html' && ext !== 'htm') return M.json(400, { error: 'HTML資料は .html または .zip でアップロードしてください' });

  if(typeof body.contentBase64 !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/.test(body.contentBase64)) return M.json(400, { error: '不正なファイルデータです' });
  let buf; try{ buf = Buffer.from(body.contentBase64, 'base64'); }catch(e){ return M.json(400, { error: '復号に失敗しました' }); }
  if(!buf.length) return M.json(400, { error: '空のファイルです' });
  if(buf.length > MAX_UPLOAD_BYTES) return M.json(413, { error: 'サイズが上限（' + human(MAX_UPLOAD_BYTES) + '）を超えています' });

  // --- unpack -------------------------------------------------------------
  // Shared with the chunked path (_package.js): one extraction implementation,
  // one set of ZIP safety checks, one normalisation rule.
  let pkg;
  try{ pkg = P.buildPackage(buf, ext === 'htm' ? 'html' : ext); }
  catch(e){ return M.json(400, { error: (e && e.message) || '取り込みに失敗しました' }); }
  const files = pkg.files, entry = pkg.entry, skipped = pkg.skipped, rawBytes = pkg.rawBytes;

  // --- write --------------------------------------------------------------
  let recStore, mediaStore;
  try{ recStore = getStore(S.PROTECTED_STORE); mediaStore = getStore(S.mediaStoreName()); }
  catch(e){ return M.json(500, { error: 'ストレージに接続できません' }); }

  const replaceId = String(body.replaceId || '');
  let id, version = 1, prev = null;
  if(replaceId){
    if(!M.ID_RE.test(replaceId) || replaceId.indexOf('__') === 0) return M.json(400, { error: 'invalid id' });
    let cur; try{ cur = await recStore.getMetadata(replaceId); }catch(e){ cur = null; }
    const meta = (cur && cur.metadata) || null;
    if(!meta || meta.kind !== 'html') return M.json(404, { error: '置き換え対象のHTML資料が見つかりません' });
    id = replaceId; prev = meta;
    version = Math.min(9999, (parseInt(meta.version, 10) || 1) + 1);
  }else{
    id = M.newId();
  }

  // Assets are versioned in their key, so a replace never half-overwrites a
  // package that a customer is reading right now.
  const prefix = id + '/v' + version + '/';
  let written = 0;
  try{
    for(const f of files){
      const ab = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength);
      await mediaStore.set(prefix + f.path, ab, { metadata: { contentType: M.mimeFor(f.path), size: f.data.length } });
      written++;
    }
  }catch(e){
    // Roll back this version's assets so a partial package is never reachable.
    for(const f of files.slice(0, written)){ try{ await mediaStore.delete(prefix + f.path); }catch(_){} }
    return M.json(502, { error: 'パッケージの保存に失敗しました: ' + ((e && e.message) || '') });
  }

  const ts = M.nowJst();
  const metadata = {
    kind: 'html',
    role: targetRole,
    status,
    name,
    title: String(body.title != null ? body.title : (prev && prev.title) || name.replace(/\.[^.]+$/, '')).slice(0, 200),
    description: String(body.description != null ? body.description : (prev && prev.description) || '').slice(0, 600),
    group: String(body.group != null ? body.group : (prev && prev.group) || '').slice(0, 120),
    thumb: String(body.thumb != null ? body.thumb : (prev && prev.thumb) || '').slice(0, 300),
    entry,
    version,
    files: files.length,
    size: rawBytes,
    sizeLabel: human(rawBytes),
    contentType: 'text/html',
    packaged: ext === 'zip' ? 1 : 0,
    normalized: pkg.norm ? 1 : 0,
    sourceSize: buf.length,
    uploadedAt: (prev && prev.uploadedAt) || ts,
    updatedAt: ts,
    uploadedBy: 'staff',
  };

  // The blob value is a small manifest; the record is the metadata.
  try{ await recStore.setJSON(id, { entry, version, files: files.map(f => f.path) }, { metadata }); }
  catch(e){
    for(const f of files){ try{ await mediaStore.delete(prefix + f.path); }catch(_){} }
    return M.json(502, { error: '保存に失敗しました: ' + ((e && e.message) || '') });
  }

  // Best-effort cleanup of the superseded version's bytes.
  if(prev && version > 1){
    const old = id + '/v' + (version - 1) + '/';
    try{
      const l = await mediaStore.list({ prefix: old });
      for(const b of (l && l.blobs) || []){ try{ await mediaStore.delete(b.key); }catch(_){} }
    }catch(e){}
  }

  return M.json(200, { ok: true, id, version, entry, files: files.length, skipped, sizeLabel: human(rawBytes),
    normalized: !!pkg.norm,
    report: P.reportFor(pkg.norm) });
};

// ============================================================
// POST /.netlify/functions/protected-media-chunk   (STAFF session required)
//
// Chunked upload for protected HTML/ZIP media that cannot fit in one request.
//
// Why it exists, precisely: a Netlify synchronous function request is capped at
// roughly 6.29 MB after base64 expansion. The real TC manual package is
// 4,813,535 bytes, which is 6,418,048 bytes as base64 — 2% over the platform
// ceiling. No single request can carry it, so the bytes arrive in ~1 MB pieces
// and are assembled server-side.
//
//   { action:"start",    filename, totalBytes, totalChunks, sha256, ...meta }
//   { action:"chunk",    sid, index, dataBase64 }
//   { action:"complete", sid }
//   { action:"cancel",   sid }
//
// Chunks live in a private store of their own, keyed by a random session id,
// owned by the staff session that opened it, and swept after an hour. They are
// never reachable by URL: only this function reads them, and only to assemble.
// ============================================================
const { getStore, connectLambda } = require('@netlify/blobs');
const crypto = require('crypto');
const A = require('./_auth');
const M = require('./_media');
const S = require('./_stores');
const P = require('./_package');

// The default piece size the browser is told to use. 3 MB of raw bytes is
// ~4.0 MB as base64, comfortably inside the ~6.29 MB request ceiling once the
// JSON envelope and any proxy overhead are allowed for. At 1 MB a 48 MB
// package took 49 round trips; at 3 MB it takes 17.
const CHUNK_BYTES = 3 * 1024 * 1024;
// The browser may choose its own piece size - an older cached admin page still
// uses 1 MB - so the session records what it declared instead of assuming.
const MIN_CHUNK_BYTES = 256 * 1024;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
// A ceiling that is generous for a real teaching package and still bounded.
// The TC manual with its 14 clips is 48.6 MB; this leaves it room to grow by
// half again without anyone touching this file.
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_TOTAL_BYTES / MIN_CHUNK_BYTES) + 4;
// Reading the pieces back is network-bound; a few at once turns a serial wait
// into a parallel one, which is what keeps `complete` inside its ten seconds.
const READ_CONCURRENCY = 6;
const SESSION_TTL_MS = 60 * 60 * 1000;                     // one hour

const SID_RE = /^[a-f0-9]{32}$/;

function tempStore(){ return getStore(S.uploadStoreName()); }
const metaKey  = (sid) => 'up/' + sid + '/meta';
const chunkKey = (sid, i) => 'up/' + sid + '/c/' + String(i).padStart(5, '0');

/** Session owner is bound to the staff cookie that opened it. */
function ownerTag(event){
  const c = String(event.headers.cookie || '');
  const m = c.match(/idfl_session=([^;]+)/);
  return crypto.createHash('sha256').update(decodeURIComponent(m ? m[1] : '') + '|' + (process.env.SESSION_SECRET || '')).digest('hex').slice(0, 32);
}

async function readSession(store, sid, event){
  let s; try{ s = await store.get(metaKey(sid), { type: 'json' }); }catch(e){ s = null; }
  if(!s) return { err: M.json(404, { error: 'アップロードセッションが見つかりません。最初からやり直してください。' }) };
  if(Date.now() - s.startedAt > SESSION_TTL_MS){
    await sweep(store, sid);
    return { err: M.json(410, { error: 'アップロードセッションの有効期限が切れました。最初からやり直してください。' }) };
  }
  if(s.owner !== ownerTag(event)) return { err: M.json(403, { error: 'このアップロードセッションを操作する権限がありません' }) };
  return { s };
}

/** Remove every trace of a session, whatever state it is in. */
async function sweep(store, sid){
  try{
    const l = await store.list({ prefix: 'up/' + sid + '/' });
    await M.mapPool(((l && l.blobs) || []).map(b => b.key), READ_CONCURRENCY, async (k) => {
      try{ await store.delete(k); }catch(e){}
    });
  }catch(e){}
  try{ await store.delete(metaKey(sid)); }catch(e){}
}

/** Best-effort sweep of sessions nobody finished. Cheap, and keeps the store tidy. */
async function sweepExpired(store){
  let keys = [];
  try{ const l = await store.list({ prefix: 'up/' }); keys = ((l && l.blobs) || []).map(b => b.key); }catch(e){ return 0; }
  const metas = keys.filter(k => k.endsWith('/meta'));
  let n = 0;
  for(const k of metas){
    let s; try{ s = await store.get(k, { type: 'json' }); }catch(e){ continue; }
    if(s && Date.now() - s.startedAt > SESSION_TTL_MS){
      const sid = k.split('/')[1];
      await sweep(store, sid);
      n++;
    }
  }
  return n;
}

exports.handler = async (event) => {
  try{ connectLambda(event); }catch(e){}
  if(event.httpMethod !== 'POST') return M.json(405, { error: 'method not allowed' });
  if(M.badOrigin(event)) return M.json(403, { error: 'invalid origin' });
  if(A.roleFromCookies(event.headers.cookie) !== 'STAFF') return M.json(403, { error: 'スタッフ権限が必要です' });

  let body; try{ body = JSON.parse(event.body || '{}'); }catch(e){ return M.json(400, { error: 'リクエストが不正です' }); }

  let store; try{ store = tempStore(); }catch(e){ return M.json(500, { error: 'ストレージに接続できません' }); }

  // ------------------------------------------------------------------ start
  if(body.action === 'start'){
    const name = String(body.filename || '').split(/[\\/]/).pop().slice(0, 180);
    const ext = M.extOf(name);
    if(ext !== 'zip' && ext !== 'html' && ext !== 'htm') return M.json(400, { error: 'HTML資料は .html または .zip でアップロードしてください' });

    const totalBytes = parseInt(body.totalBytes, 10);
    const totalChunks = parseInt(body.totalChunks, 10);
    // The client declares the piece size it is about to use. Accepting it (within
    // bounds) instead of hard-coding one means a browser holding a cached copy of
    // the previous admin page keeps working across a deploy that changes CHUNK_BYTES.
    const chunkBytes = body.chunkBytes == null ? CHUNK_BYTES : parseInt(body.chunkBytes, 10);
    if(!(chunkBytes >= MIN_CHUNK_BYTES && chunkBytes <= MAX_CHUNK_BYTES)){
      return M.json(400, { error: '分割サイズが不正です' });
    }
    if(!(totalBytes > 0) || totalBytes > MAX_TOTAL_BYTES){
      return M.json(413, { error: 'サイズが上限（' + M.human(MAX_TOTAL_BYTES) + '）を超えています' });
    }
    if(!(totalChunks > 0) || totalChunks > MAX_CHUNKS) return M.json(400, { error: '分割数が不正です' });
    if(totalChunks !== Math.ceil(totalBytes / chunkBytes)) return M.json(400, { error: '分割数とサイズが一致しません' });
    if(body.sha256 != null && !/^[a-f0-9]{64}$/.test(String(body.sha256))) return M.json(400, { error: 'ハッシュの形式が不正です' });

    const targetRole = body.role === 'staff' ? 'staff' : (body.role === 'customer' ? 'customer' : null);
    if(!targetRole) return M.json(400, { error: '公開区分（staff/customer）が不正です' });

    await sweepExpired(store);

    const sid = crypto.randomBytes(16).toString('hex');
    const session = {
      sid, name, ext, totalBytes, totalChunks, chunkBytes,
      sha256: body.sha256 ? String(body.sha256) : '',
      owner: ownerTag(event),
      startedAt: Date.now(),
      received: [],
      meta: {
        role: targetRole,
        status: body.status === 'published' ? 'published' : 'draft',
        title: String(body.title || '').slice(0, 200),
        description: String(body.description || '').slice(0, 600),
        group: String(body.group || '').slice(0, 120),
        thumb: String(body.thumb || '').slice(0, 300),
        replaceId: String(body.replaceId || ''),
      },
    };
    try{ await store.setJSON(metaKey(sid), session); }catch(e){ return M.json(502, { error: 'アップロードの開始に失敗しました' }); }
    return M.json(200, { ok: true, sid, chunkBytes, totalChunks });
  }

  // ------------------------------------------------------------------ chunk
  if(body.action === 'chunk'){
    const sid = String(body.sid || '');
    if(!SID_RE.test(sid)) return M.json(400, { error: 'セッションIDが不正です' });
    const got = await readSession(store, sid, event);
    if(got.err) return got.err;
    const s = got.s;

    const index = parseInt(body.index, 10);
    if(!(index >= 0) || index >= s.totalChunks) return M.json(400, { error: 'チャンク番号が範囲外です' });

    if(typeof body.dataBase64 !== 'string' || !/^[A-Za-z0-9+/=\r\n]*$/.test(body.dataBase64)) return M.json(400, { error: '不正なチャンクデータです' });
    let buf; try{ buf = Buffer.from(body.dataBase64, 'base64'); }catch(e){ return M.json(400, { error: '復号に失敗しました' }); }
    if(!buf.length) return M.json(400, { error: '空のチャンクです' });

    // Every chunk is the session's declared size except the last, which is the
    // remainder. Sessions opened before this field existed used 1 MB.
    const size = s.chunkBytes || 1024 * 1024;
    const expected = (index === s.totalChunks - 1)
      ? (s.totalBytes - size * (s.totalChunks - 1))
      : size;
    if(buf.length !== expected) return M.json(400, { error: 'チャンクのサイズが想定と一致しません（' + buf.length + ' / ' + expected + '）' });

    // A retry of the same chunk is fine. A *different* body for an index we
    // already hold is not: that is a corrupted or interleaved upload.
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const prior = (s.received || []).find(r => r.i === index);
    if(prior && prior.sha !== sha) return M.json(409, { error: '同じ番号のチャンクが異なる内容で届きました。最初からやり直してください。' });

    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    try{ await store.set(chunkKey(sid, index), ab, { metadata: { sha, size: buf.length } }); }
    catch(e){ return M.json(502, { error: 'チャンクの保存に失敗しました' }); }

    if(!prior){
      s.received.push({ i: index, sha, n: buf.length });
      try{ await store.setJSON(metaKey(sid), s); }catch(e){}
    }
    return M.json(200, { ok: true, index, received: s.received.length, totalChunks: s.totalChunks });
  }

  // --------------------------------------------------------------- complete
  if(body.action === 'complete'){
    const sid = String(body.sid || '');
    if(!SID_RE.test(sid)) return M.json(400, { error: 'セッションIDが不正です' });
    const got = await readSession(store, sid, event);
    if(got.err) return got.err;
    const s = got.s;

    // Read the chunks back by key rather than trusting the session's own tally:
    // a listing can lag, but a keyed read is consistent.
    const idx = Array.from({ length: s.totalChunks }, (_, i) => i);
    const parts = await M.mapPool(idx, READ_CONCURRENCY, async (i) => {
      let d; try{ d = await store.get(chunkKey(sid, i), { type: 'arrayBuffer' }); }catch(e){ d = null; }
      return d ? Buffer.from(d) : null;
    });
    const missing = parts.findIndex(x => !x);
    if(missing >= 0) return M.json(409, { error: 'チャンク ' + (missing + 1) + '/' + s.totalChunks + ' が見つかりません。再送してください。' });
    const buf = Buffer.concat(parts);
    if(buf.length !== s.totalBytes){
      return M.json(409, { error: '結合後のサイズが一致しません（' + buf.length + ' / ' + s.totalBytes + '）' });
    }
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if(s.sha256 && sha !== s.sha256){
      await sweep(store, sid);
      return M.json(409, { error: '結合後のハッシュが一致しません。アップロードをやり直してください。' });
    }

    // From here the bytes are treated exactly like a single-request upload.
    let pkg;
    try{ pkg = P.buildPackage(buf, s.ext === 'htm' ? 'html' : s.ext); }
    catch(e){ await sweep(store, sid); return M.json(400, { error: (e && e.message) || '取り込みに失敗しました' }); }

    let recStore, mediaStore;
    try{ recStore = getStore(S.PROTECTED_STORE); mediaStore = getStore(S.mediaStoreName()); }
    catch(e){ return M.json(500, { error: 'ストレージに接続できません' }); }

    const replaceId = s.meta.replaceId;
    let id, version = 1, prev = null;
    if(replaceId){
      if(!M.ID_RE.test(replaceId) || replaceId.indexOf('__') === 0) return M.json(400, { error: 'invalid id' });
      let cur; try{ cur = await recStore.getMetadata(replaceId); }catch(e){ cur = null; }
      const pm = (cur && cur.metadata) || null;
      if(!pm || pm.kind !== 'html') return M.json(404, { error: '置き換え対象のHTML資料が見つかりません' });
      id = replaceId; prev = pm;
      version = Math.min(9999, (parseInt(pm.version, 10) || 1) + 1);
    }else{
      id = M.newId();
    }

    const prefix = id + '/v' + version + '/';
    // Shared with the single-request path: same concurrency, same rollback.
    try{ await P.writePackage(mediaStore, prefix, pkg.files); }
    catch(e){
      return M.json(502, { error: 'パッケージの保存に失敗しました: ' + ((e && e.message) || '') });
    }

    const ts = M.nowJst();
    const metadata = {
      kind: 'html',
      role: s.meta.role,
      status: s.meta.status,
      name: s.name,
      title: String(s.meta.title || (prev && prev.title) || s.name.replace(/\.[^.]+$/, '')).slice(0, 200),
      description: String(s.meta.description || (prev && prev.description) || '').slice(0, 600),
      group: String(s.meta.group || (prev && prev.group) || '').slice(0, 120),
      thumb: String(s.meta.thumb || (prev && prev.thumb) || '').slice(0, 300),
      entry: pkg.entry,
      version,
      files: pkg.files.length,
      size: pkg.rawBytes,
      sizeLabel: M.human(pkg.rawBytes),
      contentType: 'text/html',
      packaged: s.ext === 'zip' ? 1 : 0,
      normalized: pkg.norm ? 1 : 0,
      sourceSize: buf.length,
      sourceSha256: sha,
      uploadedAt: (prev && prev.uploadedAt) || ts,
      updatedAt: ts,
      uploadedBy: 'staff',
    };

    try{ await recStore.setJSON(id, { entry: pkg.entry, version, files: pkg.files.map(f => f.path) }, { metadata }); }
    catch(e){
      await P.removeKeys(mediaStore, pkg.files.map(f => prefix + f.path));
      return M.json(502, { error: '保存に失敗しました: ' + ((e && e.message) || '') });
    }

    // The version this one replaces keeps its bytes - a reader may still have it
    // open, and it is what a rollback restores. Only older ones are swept.
    let pruned = null;
    if(prev && version > 1) pruned = await P.pruneOldVersions(mediaStore, id, version);

    // The chunks have done their job.
    await sweep(store, sid);

    return M.json(200, {
      ok: true, id, version, entry: pkg.entry, files: pkg.files.length,
      sizeLabel: M.human(pkg.rawBytes), sourceSha256: sha,
      normalized: !!pkg.norm,
      keptVersions: pruned ? pruned.kept : 0,
      report: P.reportFor(pkg.norm),
    });
  }

  // ----------------------------------------------------------------- cancel
  if(body.action === 'cancel'){
    const sid = String(body.sid || '');
    if(!SID_RE.test(sid)) return M.json(400, { error: 'セッションIDが不正です' });
    const got = await readSession(store, sid, event);
    if(got.err) return got.err;
    await sweep(store, sid);
    return M.json(200, { ok: true, cancelled: sid });
  }

  return M.json(400, { error: '不明な操作です' });
};

module.exports.CHUNK_BYTES = CHUNK_BYTES;
module.exports.MAX_TOTAL_BYTES = MAX_TOTAL_BYTES;
module.exports.SESSION_TTL_MS = SESSION_TTL_MS;

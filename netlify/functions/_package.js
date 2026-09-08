// ============================================================
// IDFL - turning an uploaded file into a protected media package.
//
// One implementation, used by BOTH upload paths: the original single-request
// upload and the chunked upload for large files. They differ only in how the
// bytes arrive; what happens to those bytes afterwards must not diverge.
//
// A large self-contained HTML document is normalised here rather than being
// rejected. A Netlify synchronous function cannot return a response larger than
// 6,291,556 bytes (measured), and the asset server base64-encodes its body, so
// nothing above roughly 4.4 MB can be served whole. Extracting the embedded
// data URIs into real assets turns one unservable file into an ordinary
// package the existing architecture already knows how to serve.
// ============================================================
const M = require('./_media');
const Z = require('./_zip');
const N = require('./_normalize');

/** The per-file ceiling, which depends on how the asset will be served. */
function ceilingFor(path){
  return M.isRangePath(path) ? N.LIMITS.SAFE_RANGED_ASSET : N.LIMITS.SAFE_PROTECTED_ASSET;
}

/**
 * Build the package for an uploaded file.
 * Returns { files, entry, rawBytes, skipped, norm } or throws with a Japanese
 * message the caller can hand straight to the console.
 */
function buildPackage(buf, ext){
  if(ext === 'zip'){
    if(buf.slice(0, 2).toString('hex') !== '504b') throw new Error('ファイルの実体がZIPではありません');
    const r = Z.readZip(buf);                                   // traversal, CRC, zip-bomb and ZIP64 checks live here
    const files = Z.stripCommonRoot(r.files);
    const entry = Z.pickEntry(files);
    if(!entry) throw new Error('ZIP内にHTMLファイルが見つかりません（index.html を含めてください）');

    // A ZIP may still carry an asset too large to serve. Say so plainly rather
    // than storing something that would 502 on first view.
    //
    // The ceiling depends on how the asset will be delivered, not on taste.
    // Audio and video arrive by byte range, a slice at a time, so the response
    // limit never applies to the whole file; everything else has to come back
    // in one response and is held to the far lower whole-file ceiling.
    const over = files.filter(f => f.data.length > ceilingFor(f.path));
    if(over.length){
      const p0 = over[0].path;
      throw new Error('ZIP内の「' + p0 + '」が大きすぎます（' +
        (M.isRangePath(p0) ? '動画・音声は1ファイル ' : '動画・音声以外は1ファイル ') +
        M.human(ceilingFor(p0)) + ' まで）');
    }
    return { files, entry, rawBytes: r.totalBytes, skipped: r.skipped, norm: null };
  }

  const head = buf.slice(0, 1024).toString('utf8').toLowerCase();
  if(head.indexOf('<') < 0) throw new Error('ファイルの実体がHTMLではありません');

  // Small enough to serve as it is: leave it completely alone.
  if(buf.length <= N.LIMITS.SAFE_PROTECTED_ASSET){
    return { files: [{ path: 'index.html', data: buf }], entry: 'index.html', rawBytes: buf.length, skipped: 0, norm: null };
  }

  // Too large to serve whole. Normalise it into a package.
  const html = buf.toString('utf8');
  const { files, report } = N.normalize(html);

  if(report.oversized.length){
    throw new Error('埋め込みデータのうち ' + report.oversized.length +
      ' 件が単体で上限（' + M.human(N.LIMITS.SAFE_PROTECTED_ASSET) + '）を超えています。' +
      '画像を分割・軽量化してから再度お試しください。');
  }
  if(report.indexBytes > N.LIMITS.SAFE_PROTECTED_ASSET){
    throw new Error('埋め込みデータを取り出しても index.html が上限（' +
      M.human(N.LIMITS.SAFE_PROTECTED_ASSET) + '）を超えています（' + M.human(report.indexBytes) + '）。');
  }
  return { files, entry: 'index.html', rawBytes: report.expandedBytes, skipped: 0, norm: report };
}

/**
 * What the console is told about a normalisation. Both upload paths report the
 * same fields, so this lives here rather than being written out twice.
 * `remaining` is the honest one: anything above zero means payload is still
 * embedded in the entry document.
 */
function reportFor(norm){
  if(!norm) return null;
  return {
    sourceBytes: norm.sourceBytes,
    indexBytes: norm.indexBytes,
    extracted: norm.extracted,
    deduplicated: norm.deduplicated,
    remaining: norm.remaining,
    fileCount: norm.fileCount,
    largestAsset: norm.largestAsset,
    oversized: norm.oversized,
  };
}

// How many superseded versions of a package keep their bytes after a replace.
// One is the useful number: it is the version a customer may still have open,
// and the version to roll back to if the new upload turns out to be wrong.
// Anything older is dead weight and is swept on the next replace.
const KEEP_OLD_VERSIONS = 1;

// Blobs is a network round trip per key. A 147-file package done one at a time
// does not fit in a synchronous function's ten seconds; a dozen at a time does.
const WRITE_CONCURRENCY = 12;

/**
 * Write a package's assets under `prefix`, rolling back on failure.
 *
 * Rollback matters more than speed: a half-written version must never be
 * reachable, so every key that landed is removed before the error is reported.
 */
async function writePackage(mediaStore, prefix, files){
  const done = [];
  try{
    await M.mapPool(files, WRITE_CONCURRENCY, async (f) => {
      const ab = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength);
      await mediaStore.set(prefix + f.path, ab, { metadata: { contentType: M.mimeFor(f.path), size: f.data.length } });
      done.push(prefix + f.path);
    });
  }catch(e){
    await removeKeys(mediaStore, done);
    throw e;
  }
  return done.length;
}

/** Best-effort delete of a list of keys. Never throws. */
async function removeKeys(mediaStore, keys){
  await M.mapPool(keys, WRITE_CONCURRENCY, async (k) => {
    try{ await mediaStore.delete(k); }catch(e){}
  });
}

/**
 * Delete the bytes of versions older than the retention window.
 *
 * Best effort by design: Blobs lists eventually, so a key that has not appeared
 * yet is simply swept by the next replace. Never throws - a tidy-up failure
 * must not fail an upload that has already succeeded.
 */
async function pruneOldVersions(mediaStore, id, currentVersion){
  // The id is interpolated into a RegExp below, so insist on the id shape
  // rather than escaping: ID_RE admits no regular-expression metacharacters.
  if(!M.ID_RE.test(String(id || ''))) return { deleted: 0, kept: 0 };
  // Keep the current version and KEEP_OLD_VERSIONS behind it; everything at or
  // below the cutoff is dead. At v3 with a window of 1 that keeps v3 and v2.
  const cutoff = currentVersion - KEEP_OLD_VERSIONS - 1;
  if(cutoff < 1) return { deleted: 0, kept: currentVersion - 1 };
  let keys = [];
  try{
    const l = await mediaStore.list({ prefix: id + '/' });
    keys = ((l && l.blobs) || []).map(b => b.key);
  }catch(e){ return { deleted: 0, kept: currentVersion - 1 }; }
  const re = new RegExp('^' + id + '/v([0-9]+)/');
  const stale = keys.filter(k => {
    const m = re.exec(k);
    return !!m && parseInt(m[1], 10) <= cutoff;
  });
  await removeKeys(mediaStore, stale);
  return { deleted: stale.length, kept: Math.min(KEEP_OLD_VERSIONS, currentVersion - 1) };
}

module.exports = {
  buildPackage, reportFor, ceilingFor, LIMITS: N.LIMITS,
  writePackage, removeKeys, pruneOldVersions, KEEP_OLD_VERSIONS, WRITE_CONCURRENCY,
};

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

/**
 * Build the package for an uploaded file.
 * Returns { files, entry, rawBytes, skipped, norm } or throws with a Japanese
 * message the caller can hand straight to the console.
 */
function buildPackage(buf, ext){
  if(ext === 'zip'){
    if(buf.slice(0, 2).toString('hex') !== '504b') throw new Error('ファイルの実体がZIPではありません');
    const r = Z.readZip(buf);                                   // traversal, CRC, zip-bomb and ZIP64 checks live here
    let files = Z.stripCommonRoot(r.files);
    const entry = Z.pickEntry(files);
    if(!entry) throw new Error('ZIP内にHTMLファイルが見つかりません（index.html を含めてください）');

    // The entry document is allowed to be too large, because it is the one
    // file we know how to make smaller: the same normalisation the
    // single-file path uses turns its embedded data URIs into siblings. This
    // is what lets a presentation ship with a media folder — a self-contained
    // HTML plus its own audio/ or video/ — which is otherwise impossible,
    // since the HTML alone would exceed the per-asset serving limit.
    let norm = null;
    const entryFile = files.find(f => f.path === entry);
    if(entryFile && entryFile.data.length > N.LIMITS.SAFE_PROTECTED_ASSET){
      const res = N.normalize(entryFile.data.toString('utf8'));
      norm = res.report;
      if(norm.oversized.length){
        throw new Error('「' + entry + '」の埋め込みデータのうち ' + norm.oversized.length +
          ' 件が単体で上限（' + M.human(N.LIMITS.SAFE_PROTECTED_ASSET) + '）を超えています。');
      }
      if(norm.indexBytes > N.LIMITS.SAFE_PROTECTED_ASSET){
        throw new Error('埋め込みデータを取り出しても「' + entry + '」が上限（' +
          M.human(N.LIMITS.SAFE_PROTECTED_ASSET) + '）を超えています（' + M.human(norm.indexBytes) + '）。');
      }
      // The generated names must not quietly displace something the author
      // shipped. Refusing is better than serving one file under another's name.
      const taken = new Set(files.map(f => f.path));
      const clash = res.files.slice(1).map(f => f.path).find(p => taken.has(p));
      if(clash) throw new Error('ZIP内の「' + clash + '」と、埋め込みデータの取り出し先が衝突します。別の名前にしてください。');

      const rest = files.filter(f => f.path !== entry);
      files = [{ path: entry, data: res.files[0].data }]
        .concat(res.files.slice(1).map(f => ({ path: f.path, data: f.data })))
        .concat(rest);
    }

    // Anything else oversized cannot be helped: say so plainly rather than
    // storing something that would 502 on first view.
    const over = files.filter(f => f.data.length > N.LIMITS.SAFE_PROTECTED_ASSET);
    if(over.length){
      throw new Error('ZIP内の「' + over[0].path + '」が大きすぎます（1ファイル ' +
        M.human(N.LIMITS.SAFE_PROTECTED_ASSET) + ' まで）');
    }
    const rawBytes = files.reduce((n, f) => n + f.data.length, 0);
    return { files, entry, rawBytes, skipped: r.skipped, norm };
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

module.exports = { buildPackage, reportFor, LIMITS: N.LIMITS };

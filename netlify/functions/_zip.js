// ============================================================
// IDFL - minimal, dependency-free ZIP reader (Node zlib only).
//
// Used to explode an uploaded HTML-presentation package into individual blobs.
// Deliberately strict: it refuses anything it does not fully understand rather
// than guessing, because the input is an uploaded archive.
//
// Not supported on purpose: ZIP64, encrypted entries, and compression methods
// other than stored(0) / deflate(8). Those are reported as clear errors.
// ============================================================
const zlib = require('zlib');

const SIG_EOCD = 0x06054b50;
const SIG_CEN  = 0x02014b50;
const SIG_LOC  = 0x04034b50;
const SIG_EOCD64_LOC = 0x07064b50;

// Hard ceilings. A 4 MB archive that claims to expand to 2 GB is a zip bomb.
const LIMITS = { maxFiles: 300, maxTotalBytes: 24 * 1024 * 1024, maxEntryBytes: 12 * 1024 * 1024, maxNameLen: 180 };

let CRC_TABLE = null;
function crcTable(){
  if(CRC_TABLE) return CRC_TABLE;
  const t = new Int32Array(256);
  for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  CRC_TABLE = t; return t;
}
function crc32(buf){
  const t = crcTable(); let c = 0 ^ (-1);
  for(let i = 0; i < buf.length; i++) c = (c >>> 8) ^ t[(c ^ buf[i]) & 0xFF];
  return (c ^ (-1)) >>> 0;
}

function findEocd(buf){
  // The EOCD may be followed by a comment of up to 64 KB, so scan backwards.
  const min = Math.max(0, buf.length - (0xFFFF + 22));
  for(let i = buf.length - 22; i >= min; i--){
    if(buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

// Characters allowed in a package path segment: ASCII word chars, a few safe
// punctuation marks, and Japanese kana/kanji (asset names are sometimes JP).
const SEG_OK = new RegExp('^[\\w.\\-@()+ \\u3040-\\u30ff\\u4e00-\\u9fff]+$');

/** Normalise an archive path. Returns '' for anything we refuse to store. */
function safePath(raw){
  let p = String(raw || '').split('\\').join('/');
  if(p.slice(0, 2) === './') p = p.slice(2);
  if(!p || p.length > LIMITS.maxNameLen) return '';
  if(p.charAt(0) === '/') return '';                        // absolute
  if(/^[A-Za-z]:/.test(p)) return '';                       // windows drive
  if(p.indexOf('\u0000') >= 0) return '';
  const parts = p.split('/');
  for(const seg of parts){
    if(seg === '' || seg === '.' || seg === '..') return ''; // traversal / empty segment
    if(!SEG_OK.test(seg)) return '';
  }
  return parts.join('/');
}

/**
 * Read a ZIP buffer into { files:[{path,data}], skipped, totalBytes }.
 * Throws Error with a Japanese, user-facing message on refusal.
 */
function readZip(buf, limits){
  const L = Object.assign({}, LIMITS, limits || {});
  if(!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('ZIPファイルが不正です');

  // ZIP64 archives use a different central-directory layout; refuse rather than misread.
  for(let i = buf.length - 20; i >= Math.max(0, buf.length - 0xFFFF - 40); i--){
    if(buf.readUInt32LE(i) === SIG_EOCD64_LOC) throw new Error('ZIP64形式には対応していません。ファイル数を減らして再作成してください');
  }

  const eocd = findEocd(buf);
  if(eocd < 0) throw new Error('ZIPの終端レコードが見つかりません（壊れている可能性があります）');
  const total  = buf.readUInt16LE(eocd + 10);
  const cenLen = buf.readUInt32LE(eocd + 12);
  const cenOff = buf.readUInt32LE(eocd + 16);
  if(total > L.maxFiles) throw new Error('ZIP内のファイル数が上限（' + L.maxFiles + '）を超えています');
  if(cenOff + cenLen > buf.length) throw new Error('ZIPの中央ディレクトリが不正です');

  const out = []; let p = cenOff; let totalBytes = 0; let skipped = 0;
  for(let n = 0; n < total; n++){
    if(p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) throw new Error('ZIPの中央ディレクトリが不正です');
    const flags    = buf.readUInt16LE(p + 8);
    const method   = buf.readUInt16LE(p + 10);
    const crcExp   = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncSize  = buf.readUInt32LE(p + 24);
    const nameLen  = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen   = buf.readUInt16LE(p + 32);
    const locOff   = buf.readUInt32LE(p + 42);
    const rawName  = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + cmtLen;

    if(rawName.slice(-1) === '/') continue;                   // directory entry
    if(flags & 0x1) throw new Error('暗号化されたZIPには対応していません');
    if(uncSize === 0xFFFFFFFF || compSize === 0xFFFFFFFF) throw new Error('ZIP64形式には対応していません');
    if(uncSize > L.maxEntryBytes) throw new Error('ZIP内のファイル「' + rawName.slice(0, 60) + '」が大きすぎます');
    totalBytes += uncSize;
    if(totalBytes > L.maxTotalBytes) throw new Error('ZIPの展開後サイズが上限（' + Math.round(L.maxTotalBytes / 1048576) + 'MB）を超えています');

    const path = safePath(rawName);
    if(!path){ skipped++; continue; }                         // traversal / odd characters: drop it

    if(locOff + 30 > buf.length || buf.readUInt32LE(locOff) !== SIG_LOC) throw new Error('ZIPのローカルヘッダが不正です');
    const lNameLen  = buf.readUInt16LE(locOff + 26);
    const lExtraLen = buf.readUInt16LE(locOff + 28);
    const start = locOff + 30 + lNameLen + lExtraLen;
    if(start + compSize > buf.length) throw new Error('ZIPのデータ範囲が不正です');
    const raw = buf.slice(start, start + compSize);

    let data;
    if(method === 0) data = Buffer.from(raw);
    else if(method === 8){
      try{ data = zlib.inflateRawSync(raw, { maxOutputLength: L.maxEntryBytes }); }
      catch(e){ throw new Error('ZIPの展開に失敗しました（' + rawName.slice(0, 60) + '）'); }
    }
    else throw new Error('未対応の圧縮方式です（method ' + method + '）');

    if(data.length !== uncSize) throw new Error('ZIPの展開サイズが一致しません（' + rawName.slice(0, 60) + '）');
    if(crc32(data) !== crcExp) throw new Error('ZIPのCRCが一致しません（' + rawName.slice(0, 60) + '）');
    out.push({ path, data });
  }
  if(!out.length) throw new Error('ZIP内に取り込めるファイルがありません');
  return { files: out, skipped, totalBytes };
}

/**
 * Strip a redundant single top-level folder ("deck/index.html" -> "index.html"),
 * which is what you get when you zip a folder rather than its contents.
 */
function stripCommonRoot(files){
  if(files.length < 2) return files;
  if(files.some(f => f.path === 'index.html')) return files;
  const first = files[0].path.split('/')[0];
  if(!first) return files;
  if(!files.every(f => f.path.split('/').length > 1 && f.path.split('/')[0] === first)) return files;
  return files.map(f => ({ path: f.path.slice(first.length + 1), data: f.data }));
}

/** Pick the document to open: index.html at root, else the shallowest .html. */
function pickEntry(files){
  const htmls = files.filter(f => /\.html?$/i.test(f.path));
  if(!htmls.length) return '';
  const root = htmls.find(f => /^index\.html?$/i.test(f.path));
  if(root) return root.path;
  htmls.sort((a, b) => (a.path.split('/').length - b.path.split('/').length) || a.path.localeCompare(b.path));
  return htmls[0].path;
}

module.exports = { readZip, stripCommonRoot, pickEntry, safePath, crc32, LIMITS };

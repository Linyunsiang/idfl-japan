// ============================================================
// Normalise a large self-contained HTML application into a protected package.
//
//   big-self-contained.html  ->  index.html + assets/ (+ styles/ + scripts/)
//
// Why this exists: a Netlify synchronous function cannot return a response
// larger than 6,291,556 bytes, measured on the Deploy Preview, and the
// protected asset server base64-encodes its body, so the real per-asset ceiling
// is about 4.4 MB. A 7.2 MB single-file app therefore cannot be served at all,
// however it is uploaded. Splitting it into ordinary assets solves that with
// the architecture already in place: the same package format, the same
// protected-media-asset server, the same session and grant checks.
//
// The output is a normal package. Nothing downstream needs to know it was
// generated rather than authored.
// ============================================================
const crypto = require('crypto');

// Measured empirically against the Deploy Preview (see PR #8 discussion):
//   8.0 MB -> 502 Function.ResponseSizeTooLarge, "maximum allowed payload size
//   (6291556 bytes)". 4.5 MB -> 502. 4.3 MB -> 200. The gap is base64: the
//   asset server returns isBase64Encoded, inflating the body by 4/3.
const LIMITS = {
  FUNCTION_RESPONSE_HARD_LIMIT: 6291556,
  // Deliberately well under (6291556 / 4 * 3) = 4,718,667. Headroom covers the
  // JSON envelope, headers, and any future growth in the response wrapper.
  SAFE_PROTECTED_ASSET: 3.5 * 1024 * 1024,
};

// data:<mime>[;param…];base64,<payload>
//
// Only base64 URIs are matched, and the payload is matched as the base64
// alphabet itself rather than as "everything up to a delimiter". Both halves of
// that matter, and each was learned from a real failure in the TC manual:
//
//   Delimiter scanning is wrong for a payload whose own alphabet overlaps the
//   delimiters. An unencoded SVG — data:image/svg+xml,<svg xmlns='…'> — legally
//   contains spaces, quotes and angle brackets, so any terminator set either
//   cuts the URI short or runs past its end. Cutting it short is the dangerous
//   outcome: it decoded to a 4-byte "<svg", got stored as an asset, and left
//   the rest of the markup dangling in the attribute. Corruption, not a missed
//   extraction. Unencoded URIs are therefore left alone entirely; they are
//   inline SVG icons, small enough that extracting them buys nothing.
//
//   Matching the alphabet also handles the escaped-quote case for free. Inside
//   a JavaScript string the document writes src=\"data:…\", and a scan that
//   merely excluded quotes swallowed the backslash, failed the base64 check and
//   silently left six large PNGs embedded.
const DATA_URI_RE = /data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+)((?:;[a-zA-Z0-9.+-]+=?[a-zA-Z0-9.+-]*)*;base64),([A-Za-z0-9+/]+={0,2})/g;

const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
  'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/tiff': 'tiff',
  'font/woff': 'woff', 'font/woff2': 'woff2', 'font/ttf': 'ttf', 'font/otf': 'otf',
  'application/font-woff': 'woff', 'application/font-woff2': 'woff2',
  'application/x-font-ttf': 'ttf', 'application/x-font-otf': 'otf',
  'application/vnd.ms-fontobject': 'eot',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
  'video/mp4': 'mp4', 'video/webm': 'webm',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv',
  'application/json': 'json', 'text/xml': 'xml', 'application/xml': 'xml',
};

/** Extension for a MIME type, or '' when we do not recognise it. */
function extForMime(mime){
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  return EXT_BY_MIME[m] || '';
}

function decodeDataUri(payload){
  const buf = Buffer.from(payload, 'base64');
  if(!buf.length) return null;
  // Re-encode and compare: a payload the regex matched but base64 cannot
  // represent exactly would otherwise be stored silently truncated.
  if(buf.toString('base64').replace(/=+$/, '') !== payload.replace(/=+$/, '')) return null;
  return buf;
}

/**
 * Every decodable data URI in the document.
 * Returns [{ raw, mime, data, sha, start, end }] — malformed ones are skipped
 * and left in place rather than being mangled.
 */
function findDataUris(html){
  const out = [];
  DATA_URI_RE.lastIndex = 0;
  let m;
  while((m = DATA_URI_RE.exec(html)) !== null){
    const [raw, mime, , payload] = m;
    if(!payload) continue;
    const data = decodeDataUri(payload);
    if(!data || !data.length) continue;                 // malformed: leave untouched
    if(!extForMime(mime)) continue;                     // unknown type: leave untouched
    out.push({
      raw, mime, data,
      sha: crypto.createHash('sha256').update(data).digest('hex'),
      start: m.index, end: m.index + raw.length,
    });
  }
  return out;
}

/** Inline <style> and <script> blocks, plus counts of external references. */
function splitBlocks(html){
  const styles = [];
  const scripts = [];
  let externalScripts = 0, externalStyles = 0;

  const styleRe = /<style([^>]*)>([\s\S]*?)<\/style\s*>/gi;
  let m;
  while((m = styleRe.exec(html)) !== null){
    styles.push({ attrs: m[1].trim(), content: m[2], start: m.index, end: m.index + m[0].length });
  }
  const scriptRe = /<script([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  while((m = scriptRe.exec(html)) !== null){
    const attrs = m[1].trim();
    if(/\bsrc\s*=/i.test(attrs)){ externalScripts++; continue; }
    scripts.push({ attrs, content: m[2], start: m.index, end: m.index + m[0].length });
  }
  const linkRe = /<link\b[^>]*rel\s*=\s*["']?stylesheet["']?[^>]*>/gi;
  while((m = linkRe.exec(html)) !== null) externalStyles++;

  return { styles, scripts, externalScripts, externalStyles };
}

/** Replace byte ranges without disturbing the offsets of the ones still to come. */
function applyReplacements(text, reps){
  const sorted = reps.slice().sort((a, b) => a.start - b.start);
  let out = '', cursor = 0;
  for(const r of sorted){
    if(r.start < cursor) continue;                       // overlapping: skip
    out += text.slice(cursor, r.start) + r.with;
    cursor = r.end;
  }
  return out + text.slice(cursor);
}

/**
 * Normalise a self-contained document.
 *
 * opts.externalizeCss / externalizeJs are applied only when asked, because
 * moving an inline script changes its execution timing. The caller decides,
 * based on whether the document is still over the limit without it.
 *
 * Returns { files:[{path,data}], report }.
 */
function normalize(html, opts = {}){
  const report = {
    sourceBytes: Buffer.byteLength(html, 'utf8'),
    sourceSha256: crypto.createHash('sha256').update(html, 'utf8').digest('hex'),
    dataUris: 0, extracted: 0, deduplicated: 0, skipped: 0, remaining: 0,
    cssFiles: 0, jsFiles: 0, oversized: [],
  };
  const files = [];
  const reps = [];

  // ---------------------------------------------------------- data URIs
  const uris = findDataUris(html);
  report.dataUris = uris.length;
  const byHash = new Map();
  let seq = 0;
  for(const u of uris){
    if(u.data.length > LIMITS.SAFE_PROTECTED_ASSET){
      // Cannot be served whole and must not be silently mangled: leave it
      // embedded and report it, so a human decides.
      report.oversized.push({ mime: u.mime, bytes: u.data.length });
      report.skipped++;
      continue;
    }
    let p = byHash.get(u.sha);
    if(p){ report.deduplicated++; }
    else {
      seq++;
      p = 'assets/embedded-' + String(seq).padStart(3, '0') + '.' + extForMime(u.mime);
      byHash.set(u.sha, p);
      files.push({ path: p, data: u.data });
      report.extracted++;
    }
    reps.push({ start: u.start, end: u.end, with: p });
  }

  let out = applyReplacements(html, reps);

  // ---------------------------------------------------------------- CSS
  if(opts.externalizeCss){
    const blocks = splitBlocks(out);
    const cssReps = [];
    let n = 0;
    for(const b of blocks.styles){
      if(Buffer.byteLength(b.content, 'utf8') < (opts.minBlockBytes || 4096)) continue;
      n++;
      const p = 'styles/app-' + String(n).padStart(3, '0') + '.css';
      files.push({ path: p, data: Buffer.from(b.content, 'utf8') });
      // A <link> in the same document position preserves cascade order.
      cssReps.push({ start: b.start, end: b.end, with: '<link rel="stylesheet" href="' + p + '">' });
    }
    out = applyReplacements(out, cssReps);
    report.cssFiles = n;
  }

  // ----------------------------------------------------------------- JS
  if(opts.externalizeJs){
    const blocks = splitBlocks(out);
    const jsReps = [];
    let n = 0;
    for(const b of blocks.scripts){
      if(Buffer.byteLength(b.content, 'utf8') < (opts.minBlockBytes || 4096)) continue;
      // Only classic, attribute-free blocks are safe to move: async/defer/type
      // change execution timing, and document.currentScript changes meaning.
      if(b.attrs && !/^(\s*type\s*=\s*["']?(text\/javascript|application\/javascript)["']?\s*)$/i.test(b.attrs)) continue;
      if(/document\.currentScript/.test(b.content)) continue;
      n++;
      const p = 'scripts/app-' + String(n).padStart(3, '0') + '.js';
      files.push({ path: p, data: Buffer.from(b.content, 'utf8') });
      // No async/defer: a plain src script runs in document order, exactly
      // where the inline block used to run.
      jsReps.push({ start: b.start, end: b.end, with: '<script src="' + p + '"></' + 'script>' });
    }
    out = applyReplacements(out, jsReps);
    report.jsFiles = n;
  }

  // Trust nothing: count what is still embedded rather than assuming the scan
  // caught everything. A non-zero count here means the entry document is still
  // carrying payload, and the caller should treat that as a failed extraction
  // rather than a clean package.
  const leftover = /data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+[^,]{0,64};base64,[A-Za-z0-9+/=]{64,}/g;
  report.remaining = (out.match(leftover) || []).length;

  files.unshift({ path: 'index.html', data: Buffer.from(out, 'utf8') });
  report.indexBytes = Buffer.byteLength(out, 'utf8');
  report.fileCount = files.length;
  report.expandedBytes = files.reduce((a, f) => a + f.data.length, 0);
  report.largestAsset = files.reduce((a, f) => Math.max(a, f.data.length), 0);
  report.normalized = true;
  report.assetSha256s = files.map(f => ({ path: f.path, sha256: crypto.createHash('sha256').update(f.data).digest('hex'), bytes: f.data.length }));
  return { files, report };
}

/** Would this document be served fine as-is? Then leave it alone. */
function needsNormalizing(html){
  return Buffer.byteLength(html, 'utf8') > LIMITS.SAFE_PROTECTED_ASSET;
}

module.exports = { LIMITS, extForMime, findDataUris, splitBlocks, normalize, needsNormalizing };

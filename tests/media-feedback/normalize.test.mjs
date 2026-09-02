// ============================================================
// HTML app normalisation: turning a large self-contained document into a
// protected package of ordinary assets.
//
// The reason this exists is a measured hard limit, not a preference: a Netlify
// synchronous function cannot return more than 6,291,556 bytes, and the
// protected asset server base64-encodes, so nothing above ~4.4 MB can be served
// at all. Splitting the document is the only way a 7.2 MB app can live behind
// the existing protected architecture.
//
//   node tests/media-feedback/normalize.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalize, findDataUris, splitBlocks, extForMime, needsNormalizing, LIMITS } from '../../tools/normalize-html-app/normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let pass = 0, fail = 0;
function t(name, fn){
  try{ fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.message)); fail++; }
}
function G(n){ console.log('\n' + n); }

// A 1x1 PNG and a tiny GIF, as real base64.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

G('LIMITS');

t('documents the measured hard limit and a conservative safe limit', () => {
  assert.equal(LIMITS.FUNCTION_RESPONSE_HARD_LIMIT, 6291556, 'the measured Netlify ceiling');
  assert.ok(LIMITS.SAFE_PROTECTED_ASSET < LIMITS.FUNCTION_RESPONSE_HARD_LIMIT / 4 * 3,
    'the safe limit must sit below the base64-inflated hard limit');
  assert.ok(LIMITS.SAFE_PROTECTED_ASSET <= 4 * 1024 * 1024, 'the safe limit should leave real headroom');
});

t('a small document needs no normalising', () => {
  assert.equal(needsNormalizing('<html><body>hi</body></html>'), false);
  assert.equal(needsNormalizing('x'.repeat(LIMITS.SAFE_PROTECTED_ASSET + 1)), true);
});

G('DATA URI EXTRACTION');

t('finds a base64 data URI and decodes it', () => {
  const html = '<img src="data:image/png;base64,' + PNG + '">';
  const uris = findDataUris(html);
  assert.equal(uris.length, 1);
  assert.equal(uris[0].mime, 'image/png');
  assert.deepEqual(uris[0].data, Buffer.from(PNG, 'base64'));
});

t('leaves a percent-encoded (non-base64) data URI completely alone', () => {
  // Its payload legally contains spaces, quotes and angle brackets, so there is
  // no terminator that both ends the URI and stays inside it. Extracting one
  // truncated it to a 4-byte "<svg" and left the remaining markup dangling in
  // the attribute. These are inline SVG icons; leaving them embedded costs
  // nothing and cannot corrupt anything.
  const raw = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3C/svg%3E";
  const html = '<img src="' + raw + '">';
  assert.equal(findDataUris(html).length, 0);
  const { files, report } = normalize(html);
  assert.equal(report.extracted, 0);
  assert.equal(files.length, 1);
  assert.ok(files[0].data.toString('utf8').includes(raw), 'it must survive byte-identically');
});

t('handles an SVG data URI', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', 'utf8').toString('base64');
  const { files, report } = normalize('<img src="data:image/svg+xml;base64,' + svg + '">');
  assert.equal(report.extracted, 1);
  assert.ok(files.some(f => f.path.endsWith('.svg')));
});

t('leaves a malformed data URI untouched rather than mangling it', () => {
  const html = '<img src="data:image/png;base64,!!!not-base64!!!">';
  const { files, report } = normalize(html);
  assert.equal(report.extracted, 0);
  assert.equal(files.length, 1, 'only index.html');
  assert.ok(files[0].data.toString('utf8').includes('!!!not-base64!!!'), 'the original text must survive');
});

t('leaves an unknown MIME type untouched', () => {
  const html = '<img src="data:application/x-weird;base64,' + PNG + '">';
  const { report } = normalize(html);
  assert.equal(report.extracted, 0);
});

t('maps MIME types to sensible extensions', () => {
  assert.equal(extForMime('image/png'), 'png');
  assert.equal(extForMime('image/jpeg'), 'jpg');
  assert.equal(extForMime('image/webp'), 'webp');
  assert.equal(extForMime('image/svg+xml'), 'svg');
  assert.equal(extForMime('font/woff2'), 'woff2');
  assert.equal(extForMime('IMAGE/PNG'), 'png', 'should be case-insensitive');
  assert.equal(extForMime('application/x-nonsense'), '');
});

t('deduplicates identical embedded assets by content hash', () => {
  const uri = 'data:image/png;base64,' + PNG;
  const html = '<img src="' + uri + '"><img src="' + uri + '"><img src="' + uri + '">';
  const { files, report } = normalize(html);
  assert.equal(report.dataUris, 3);
  assert.equal(report.extracted, 1, 'one file on disk');
  assert.equal(report.deduplicated, 2);
  assert.equal(files.length, 2, 'index.html + one asset');
  const out = files[0].data.toString('utf8');
  assert.equal((out.match(/assets\/embedded-001\.png/g) || []).length, 3, 'all three references point at it');
});

t('two different assets are kept separate', () => {
  const html = '<img src="data:image/png;base64,' + PNG + '"><img src="data:image/gif;base64,' + GIF + '">';
  const { report } = normalize(html);
  assert.equal(report.extracted, 2);
  assert.equal(report.deduplicated, 0);
});

t('rewrites references and removes every data URI', () => {
  const html = '<html><body><img src="data:image/png;base64,' + PNG + '"><div style="background:url(data:image/gif;base64,' + GIF + ')"></div></body></html>';
  const { files, report } = normalize(html);
  const out = files[0].data.toString('utf8');
  assert.equal(report.extracted, 2);
  assert.equal(out.indexOf('data:image'), -1, 'no data URI should remain');
  assert.ok(out.includes('assets/embedded-001.png'));
  assert.ok(out.includes('assets/embedded-002.gif'));
  assert.ok(out.includes('background:url(assets/embedded-002.gif)'), 'a CSS url() must be rewritten in place');
});

t('extracts data URIs that live inside JavaScript strings', () => {
  // This is how MMS stores its images: not in markup, but in script literals.
  const html = '<script>var IMG = "data:image/png;base64,' + PNG + '"; document.body.innerHTML = "<img src=\'" + IMG + "\'>";</' + 'script>';
  const { files, report } = normalize(html);
  assert.equal(report.extracted, 1);
  const out = files[0].data.toString('utf8');
  assert.ok(out.includes('var IMG = "assets/embedded-001.png"'), 'the string literal should now hold the path');
});

t('an oversized embedded asset is reported and left in place, never split', () => {
  const big = Buffer.alloc(LIMITS.SAFE_PROTECTED_ASSET + 1024, 0x41).toString('base64');
  const { files, report } = normalize('<img src="data:image/png;base64,' + big + '">');
  assert.equal(report.extracted, 0);
  assert.equal(report.skipped, 1);
  assert.equal(report.oversized.length, 1);
  assert.equal(report.oversized[0].mime, 'image/png');
  assert.ok(files[0].data.toString('utf8').includes('data:image/png'), 'it must stay embedded, not be chopped up');
});

G('INLINE BLOCKS');

t('finds inline style and script blocks and counts external ones', () => {
  const html = '<style>a{}</style><script>1</' + 'script><script src="x.js"></' + 'script><link rel="stylesheet" href="y.css">';
  const b = splitBlocks(html);
  assert.equal(b.styles.length, 1);
  assert.equal(b.scripts.length, 1, 'a src script is not an inline block');
  assert.equal(b.externalScripts, 1);
  assert.equal(b.externalStyles, 1);
});

t('CSS is only externalised when asked, and keeps its document position', () => {
  const css = 'body{color:red}'.padEnd(5000, ' ');
  const html = '<head><style>' + css + '</style></head>';
  assert.equal(normalize(html).report.cssFiles, 0, 'off by default');
  const { files, report } = normalize(html, { externalizeCss: true });
  assert.equal(report.cssFiles, 1);
  const out = files[0].data.toString('utf8');
  assert.ok(out.includes('<link rel="stylesheet" href="styles/app-001.css">'));
  assert.ok(out.indexOf('<link') > out.indexOf('<head>'), 'the link must sit where the style block was');
});

t('a script with attributes that change timing is never externalised', () => {
  const body = 'var x=1;'.padEnd(5000, ' ');
  for(const attrs of ['defer', 'async', 'type="module"']){
    const html = '<script ' + attrs + '>' + body + '</' + 'script>';
    const { report } = normalize(html, { externalizeJs: true });
    assert.equal(report.jsFiles, 0, attrs + ' must be left inline');
  }
});

t('a script using document.currentScript is never externalised', () => {
  const html = '<script>' + 'var s=document.currentScript;'.padEnd(5000, ' ') + '</' + 'script>';
  assert.equal(normalize(html, { externalizeJs: true }).report.jsFiles, 0);
});

t('a plain script can be externalised without changing execution order', () => {
  const html = '<script>' + 'var a=1;'.padEnd(5000, ' ') + '</' + 'script>';
  const { files, report } = normalize(html, { externalizeJs: true });
  assert.equal(report.jsFiles, 1);
  const out = files[0].data.toString('utf8');
  assert.ok(out.includes('<script src="scripts/app-001.js">'));
  assert.equal(out.indexOf('async'), -1, 'no async/defer, so it still runs in document order');
});

G('MANIFEST');

t('reports a manifest with hashes for the source and every asset', () => {
  const html = '<img src="data:image/png;base64,' + PNG + '">';
  const { report } = normalize(html);
  assert.equal(report.sourceSha256, crypto.createHash('sha256').update(html, 'utf8').digest('hex'));
  assert.equal(report.normalized, true);
  assert.equal(report.fileCount, 2);
  assert.ok(report.assetSha256s.every(a => /^[0-9a-f]{64}$/.test(a.sha256) && a.path && a.bytes > 0));
  assert.equal(report.assetSha256s[0].path, 'index.html');
});

G('REGRESSION — small documents must be left alone');

t('a document with no data URIs comes out byte-identical', () => {
  const html = '<!doctype html><html><body><h1>hi</h1><script>var a=1;</' + 'script></body></html>';
  const { files, report } = normalize(html);
  assert.equal(files.length, 1);
  assert.equal(report.extracted, 0);
  assert.equal(files[0].data.toString('utf8'), html, 'nothing should change');
});

G('THE REAL MMS FILE');

const MMS = path.join(ROOT, 'customer/mms.html');
if(!fs.existsSync(MMS)){
  console.log('  (customer/mms.html not present — skipping)');
} else {
  const src = fs.readFileSync(MMS, 'utf8');
  const result = normalize(src);

  t('is too large to serve as one asset, and normalises below the limit', () => {
    assert.ok(Buffer.byteLength(src, 'utf8') > LIMITS.SAFE_PROTECTED_ASSET, 'the source should be over the limit');
    assert.ok(result.report.indexBytes <= LIMITS.SAFE_PROTECTED_ASSET,
      'normalised index.html is ' + result.report.indexBytes + ', over the safe limit');
  });

  t('extracts all 61 embedded assets with none skipped', () => {
    assert.equal(result.report.dataUris, 61);
    assert.equal(result.report.extracted, 61);
    assert.equal(result.report.skipped, 0);
    assert.equal(result.report.oversized.length, 0);
  });

  t('needs no CSS or JS externalisation, so execution semantics are untouched', () => {
    assert.equal(result.report.cssFiles, 0);
    assert.equal(result.report.jsFiles, 0);
  });

  t('every resulting asset is comfortably servable', () => {
    for(const a of result.report.assetSha256s){
      assert.ok(a.bytes <= LIMITS.SAFE_PROTECTED_ASSET, a.path + ' is ' + a.bytes + ' bytes');
    }
  });

  t('every extracted asset is byte-identical to the URI it replaced', () => {
    const uris = findDataUris(src);
    const out = result.files[0].data.toString('utf8');
    const refs = out.match(/assets\/embedded-\d+\.[a-z]+/g) || [];
    assert.equal(refs.length, uris.length, 'one reference per source URI, in order');
    const byPath = new Map(result.files.map(f => [f.path, f.data]));
    for(let i = 0; i < uris.length; i++){
      const data = byPath.get(refs[i]);
      assert.ok(data, 'missing asset for ' + refs[i]);
      assert.equal(crypto.createHash('sha256').update(data).digest('hex'), uris[i].sha, 'asset ' + i + ' differs');
    }
  });

  t('the document is unchanged apart from the URI substitutions', () => {
    const out = result.files[0].data.toString('utf8');
    const maskedSource = src.replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]+=?[a-zA-Z0-9.+-]*)*,[^"'\s)]*/g, '@@');
    const maskedOut = out.replace(/assets\/embedded-\d+\.[a-z]+/g, '@@');
    assert.equal(maskedOut, maskedSource, 'normalisation must change nothing else');
  });

  t('leaves no data URI behind', () => {
    assert.equal(result.files[0].data.toString('utf8').indexOf('data:image'), -1);
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

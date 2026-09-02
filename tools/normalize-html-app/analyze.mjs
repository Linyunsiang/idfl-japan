// ============================================================
// Composition analysis for a large self-contained HTML application.
//
// Answers the only question that matters before normalising: once the embedded
// data URIs are pulled out, is the remaining document below the protected-asset
// ceiling, or must CSS/JS come out too?
//
//   node tools/normalize-html-app/analyze.mjs <file.html>
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { LIMITS, findDataUris, splitBlocks } = await import('./normalize.mjs');

const file = process.argv[2];
if(!file){ console.error('usage: analyze.mjs <file.html>'); process.exit(2); }

const src = fs.readFileSync(file, 'utf8');
const bytes = Buffer.byteLength(src, 'utf8');
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

console.log('=== ' + path.basename(file) + ' ===');
console.log('  source size            : ' + mb(bytes) + '  (' + bytes.toLocaleString() + ' bytes)');

// ------------------------------------------------------------------ data URIs
const uris = findDataUris(src);
let uriBytes = 0, decodedBytes = 0;
const byType = new Map();
const seen = new Map();
for(const u of uris){
  uriBytes += u.raw.length;
  decodedBytes += u.data.length;
  const t = byType.get(u.mime) || { n: 0, bytes: 0 };
  t.n++; t.bytes += u.data.length; byType.set(u.mime, t);
  seen.set(u.sha, (seen.get(u.sha) || 0) + 1);
}
const dupes = [...seen.values()].filter(v => v > 1).length;
console.log('  data URIs              : ' + uris.length + '  occupying ' + mb(uriBytes) + ' of the document');
console.log('  decoded asset bytes    : ' + mb(decodedBytes) + '  (base64 overhead saved: ' + mb(uriBytes - decodedBytes) + ')');
console.log('  distinct by content    : ' + seen.size + '   duplicated: ' + dupes);
for(const [mime, t] of [...byType.entries()].sort((a, b) => b[1].bytes - a[1].bytes)){
  console.log('      ' + mime.padEnd(22) + t.n.toString().padStart(4) + '  ' + mb(t.bytes));
}

// ------------------------------------------------------------- inline blocks
const blocks = splitBlocks(src);
const styleBytes = blocks.styles.reduce((a, b) => a + Buffer.byteLength(b.content, 'utf8'), 0);
const scriptBytes = blocks.scripts.reduce((a, b) => a + Buffer.byteLength(b.content, 'utf8'), 0);
console.log('  inline <style> blocks  : ' + blocks.styles.length + '  ' + mb(styleBytes));
console.log('  inline <script> blocks : ' + blocks.scripts.length + '  ' + mb(scriptBytes));
if(blocks.scripts.length){
  const big = blocks.scripts.slice().sort((a, b) => b.content.length - a.content.length).slice(0, 5);
  for(const s of big) console.log('      script ' + (s.attrs || '(no attrs)').slice(0, 40).padEnd(42) + kb(Buffer.byteLength(s.content, 'utf8')));
}
console.log('  external <script src>  : ' + blocks.externalScripts);
console.log('  external stylesheets   : ' + blocks.externalStyles);

// ------------------------------------------------------------- what remains
const afterUris = bytes - uriBytes + uris.length * 32;                 // each URI becomes a short path
const afterUrisCss = afterUris - styleBytes;
const afterUrisCssJs = afterUrisCss - scriptBytes;
console.log('');
console.log('  index.html after extracting…');
console.log('      data URIs only     : ' + mb(afterUris) + (afterUris <= LIMITS.SAFE_PROTECTED_ASSET ? '  ✓ under the safe limit' : '  ✗ still too large'));
console.log('      + CSS              : ' + mb(afterUrisCss) + (afterUrisCss <= LIMITS.SAFE_PROTECTED_ASSET ? '  ✓' : '  ✗'));
console.log('      + CSS + JS         : ' + mb(afterUrisCssJs) + (afterUrisCssJs <= LIMITS.SAFE_PROTECTED_ASSET ? '  ✓' : '  ✗'));
console.log('');
console.log('  safe protected asset limit : ' + mb(LIMITS.SAFE_PROTECTED_ASSET));
console.log('  measured hard response limit: ' + LIMITS.FUNCTION_RESPONSE_HARD_LIMIT.toLocaleString() + ' bytes');

// ---------------------------------------------------- oversized single assets
const over = uris.filter(u => u.data.length > LIMITS.SAFE_PROTECTED_ASSET);
console.log('');
if(over.length){
  console.log('  *** ' + over.length + ' embedded asset(s) exceed the safe limit on their own:');
  for(const u of over) console.log('      ' + u.mime + '  ' + mb(u.data.length));
} else {
  const largest = uris.reduce((a, u) => (u.data.length > a ? u.data.length : a), 0);
  console.log('  largest single embedded asset: ' + kb(largest) + '  ✓ well under the limit');
}

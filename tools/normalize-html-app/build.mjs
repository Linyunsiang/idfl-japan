// Generate a normalized protected package from a self-contained HTML app.
// The source file is never modified.
//
//   node tools/normalize-html-app/build.mjs <src.html> <outDir> [--css] [--js]
import fs from 'node:fs';
import path from 'node:path';
import { normalize, LIMITS } from './normalize.mjs';

const [src, outDir] = process.argv.slice(2);
if(!src || !outDir){ console.error('usage: build.mjs <src.html> <outDir> [--css] [--js]'); process.exit(2); }
const opts = { externalizeCss: process.argv.includes('--css'), externalizeJs: process.argv.includes('--js') };

const html = fs.readFileSync(src, 'utf8');
const { files, report } = normalize(html, opts);

fs.rmSync(outDir, { recursive: true, force: true });
for(const f of files){
  const dest = path.join(outDir, f.path);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, f.data);
}
fs.writeFileSync(path.join(outDir, '.manifest.json'), JSON.stringify({
  entryFile: 'index.html',
  fileCount: report.fileCount,
  expandedSize: report.expandedBytes,
  sourceSize: report.sourceBytes,
  normalized: true,
  sourceSha256: report.sourceSha256,
  assetSha256s: report.assetSha256s,
}, null, 2));

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
console.log('source            : ' + mb(report.sourceBytes) + '   sha256 ' + report.sourceSha256.slice(0, 16) + '…');
console.log('index.html        : ' + mb(report.indexBytes) + (report.indexBytes <= LIMITS.SAFE_PROTECTED_ASSET ? '  ✓' : '  ✗ OVER LIMIT'));
console.log('data URIs found   : ' + report.dataUris);
console.log('  extracted       : ' + report.extracted);
console.log('  deduplicated    : ' + report.deduplicated);
console.log('  skipped         : ' + report.skipped);
console.log('css files         : ' + report.cssFiles);
console.log('js files          : ' + report.jsFiles);
console.log('total files       : ' + report.fileCount);
console.log('expanded size     : ' + mb(report.expandedBytes));
console.log('largest asset     : ' + mb(report.largestAsset) + (report.largestAsset <= LIMITS.SAFE_PROTECTED_ASSET ? '  ✓' : '  ✗ OVER LIMIT'));
if(report.oversized.length){
  console.log('*** oversized embedded assets left in place:');
  for(const o of report.oversized) console.log('    ' + o.mime + '  ' + mb(o.bytes));
  process.exitCode = 1;
}
console.log('written to        : ' + outDir);

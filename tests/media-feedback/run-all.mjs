// Runs the whole Media Library / feedback suite.
//   node tests/media-feedback/run-all.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITES = ['zip.test.mjs', 'api.test.mjs', 'anchor.test.mjs', 'admin.test.mjs', 'customer.test.mjs', 'upload.test.mjs', 'normalize.test.mjs'];

let failed = 0;
for(const s of SUITES){
  console.log('\n=== ' + s + ' ' + '='.repeat(Math.max(0, 60 - s.length)));
  const r = spawnSync(process.execPath, [path.join(HERE, s)], { stdio: 'inherit' });
  if(r.status !== 0) failed++;
}

console.log('\n' + (failed ? failed + ' suite(s) FAILED' : 'all suites passed'));
process.exit(failed ? 1 : 0);

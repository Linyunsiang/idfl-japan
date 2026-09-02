// node tests/qa/run-all.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITES = ['security.test.mjs', 'qa.test.mjs', 'admin-qa.test.mjs'];
let failed = 0;
for(const s of SUITES){
  console.log('=== ' + s + ' ' + '='.repeat(Math.max(0, 56 - s.length)));
  const r = spawnSync(process.execPath, [path.join(HERE, s)], { stdio: 'inherit' });
  if(r.status !== 0) failed++;
}
console.log(failed ? '\n' + failed + ' suite(s) failed' : '\nall suites passed');
process.exitCode = failed ? 1 : 0;

// Unit tests for netlify/functions/_zip.js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeZip, zipDir } from './zip-writer.mjs';
const require = createRequire(import.meta.url);
const Z = require('../../netlify/functions/_zip.js');

const PKG_DIR = process.env.IDFL_TEST_PKG || 'C:/Users/AldenLin/AppData/Local/Temp/claude/C--Users-AldenLin/28ad7c38-23a1-4aca-9a88-61f754d8c111/scratchpad/gots-pkg';
let pass=0, fail=0;
function t(name, fn){ try{ fn(); console.log('  ok   '+name); pass++; }catch(e){ console.log('  FAIL '+name+'\n       '+e.message); fail++; } }
async function ta(name, fn){ try{ await fn(); console.log('  ok   '+name); pass++; }catch(e){ console.log('  FAIL '+name+'\n       '+e.message); fail++; } }

console.log('_zip.js');

t('reads a deflate archive round-trip', () => {
  const zip = makeZip([{path:'index.html', data:'<h1>hi</h1>'.repeat(50)}, {path:'styles/main.css', data:'body{color:red}'}]);
  const r = Z.readZip(zip);
  assert.equal(r.files.length, 2);
  assert.equal(r.files[0].path, 'index.html');
  assert.equal(r.files[1].data.toString(), 'body{color:red}');
});

t('reads a stored (uncompressed) entry', () => {
  const r = Z.readZip(makeZip([{path:'a.txt', data:'plain', store:true}]));
  assert.equal(r.files[0].data.toString(), 'plain');
});

t('preserves nested relative paths', () => {
  const r = Z.readZip(makeZip([
    {path:'index.html', data:'x'}, {path:'assets/idfl/logo.png', data:'p'}, {path:'content/ja.js', data:'j'},
  ]));
  assert.deepEqual(r.files.map(f=>f.path).sort(), ['assets/idfl/logo.png','content/ja.js','index.html']);
});

t('drops path-traversal entries instead of writing outside the package', () => {
  const r = Z.readZip(makeZip([{path:'index.html',data:'ok'}, {path:'../../etc/passwd', data:'bad'}, {path:'a/../../b.txt', data:'bad'}]));
  assert.equal(r.files.length, 1);
  assert.equal(r.skipped, 2);
});

t('drops absolute and drive-letter paths', () => {
  const r = Z.readZip(makeZip([{path:'index.html',data:'ok'}, {path:'/etc/x', data:'bad'}, {path:'C:/win.ini', data:'bad'}]));
  assert.equal(r.files.length, 1);
});

t('rejects an unsupported compression method', () => {
  const zip = makeZip([{path:'a.txt', data:'hello'}]);
  zip.writeUInt16LE(99, 8);                       // local header method
  const cen = zip.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  zip.writeUInt16LE(99, cen + 10);                // central header method
  assert.throws(() => Z.readZip(zip), /未対応の圧縮方式/);
});

t('rejects a corrupted payload via CRC', () => {
  const zip = makeZip([{path:'a.txt', data:'hello world hello world', store:true}]);
  const at = zip.indexOf(Buffer.from('hello world','utf8'));
  zip[at] = 0x58;
  assert.throws(() => Z.readZip(zip), /CRC/);
});

t('rejects an encrypted entry', () => {
  const zip = makeZip([{path:'a.txt', data:'x'}]);
  const cen = zip.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  zip.writeUInt16LE(0x1, cen + 8);
  assert.throws(() => Z.readZip(zip), /暗号化/);
});

t('rejects garbage', () => assert.throws(() => Z.readZip(Buffer.from('not a zip at all, really not')), /ZIP/));

t('enforces the file-count ceiling', () => {
  const many = Array.from({length:12}, (_,i)=>({path:'f'+i+'.txt', data:'x'}));
  assert.throws(() => Z.readZip(makeZip(many), {maxFiles:5}), /ファイル数/);
});

t('enforces the expanded-size ceiling (zip-bomb guard)', () => {
  const zip = makeZip([{path:'big.txt', data:Buffer.alloc(400*1024, 0x41)}]);
  assert.ok(zip.length < 20*1024, 'fixture should compress small');
  assert.throws(() => Z.readZip(zip, {maxTotalBytes: 64*1024}), /展開後サイズ/);
});

t('stripCommonRoot removes a single wrapper folder', () => {
  const files = [{path:'deck/index.html',data:Buffer.from('a')},{path:'deck/css/a.css',data:Buffer.from('b')}];
  assert.deepEqual(Z.stripCommonRoot(files).map(f=>f.path), ['index.html','css/a.css']);
});

t('stripCommonRoot leaves a real root alone', () => {
  const files = [{path:'index.html',data:Buffer.from('a')},{path:'css/a.css',data:Buffer.from('b')}];
  assert.deepEqual(Z.stripCommonRoot(files).map(f=>f.path), ['index.html','css/a.css']);
});

t('pickEntry prefers root index.html', () => {
  assert.equal(Z.pickEntry([{path:'a/b.html'},{path:'index.html'}]), 'index.html');
  assert.equal(Z.pickEntry([{path:'sub/deep/x.html'},{path:'sub/y.html'}]), 'sub/y.html');
  assert.equal(Z.pickEntry([{path:'a.css'}]), '');
});

await ta('reads the real GOTS presentation package', async () => {
  const zip = await zipDir(PKG_DIR);
  const r = Z.readZip(zip);
  assert.equal(r.files.length, 14, 'expected 14 runtime files, got '+r.files.length);
  assert.equal(Z.pickEntry(r.files), 'index.html');
  const html = r.files.find(f=>f.path==='index.html').data.toString('utf8');
  assert.ok(html.includes('styles/main.css'));
  assert.ok(html.includes('scripts/deck.js'));
  for(const need of ['styles/main.css','styles/interactive.css','content/ja.js','content/en.js','content/zh-TW.js',
                     'scripts/icons.js','scripts/motion.js','scripts/render.js','scripts/interact.js','scripts/deck.js',
                     'assets/idfl/idfl-logo.png','assets/idfl/idfl-logo-white.png','assets/idfl/idfl-japan-qr.png']){
    assert.ok(r.files.some(f=>f.path===need), 'missing '+need);
  }
  assert.equal(r.totalBytes, 693187);
});

await ta('reads the same package zipped with a wrapper folder', async () => {
  const zip = await zipDir(PKG_DIR, 'gots-scope4-presentation');
  const r = Z.readZip(zip);
  const files = Z.stripCommonRoot(r.files);
  assert.equal(Z.pickEntry(files), 'index.html');
  assert.ok(files.some(f=>f.path==='scripts/deck.js'));
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail ? 1 : 0);

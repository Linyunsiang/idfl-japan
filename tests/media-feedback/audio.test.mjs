// ============================================================
// Audio in a protected package.
//
// The TC manual lost its narration on upload. Not a normalisation fault: the
// manual keeps its clips as ordinary files in audio/ beside the HTML and
// inlines none of them, so a single-file upload could never have carried them.
// A package upload can, but the entry document is larger than a single asset
// may be — which is why a ZIP now normalises its entry instead of refusing it.
//
//   node tests/media-feedback/audio.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { setEnv, invoke, resetStores, dumpStore, loadFn } from './harness.mjs';
import { makeZip } from './zip-writer.mjs';

const ENV = setEnv();
const P = loadFn('_package');
const N = loadFn('_normalize');
const M = loadFn('_media');
const CHUNK_BYTES = loadFn('protected-media-chunk').CHUNK_BYTES;
const TC_ZIP = process.env.IDFL_TC_ZIP || 'C:/Users/AldenLin/AppData/Local/Temp/claude/C--Users-AldenLin/28ad7c38-23a1-4aca-9a88-61f754d8c111/scratchpad/tc-manual.zip';

let pass = 0, fail = 0;
async function t(name, fn){
  try{ await fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.message)); fail++; }
}
function G(n){ console.log('\n' + n); }
process.on('exit', () => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if(fail) process.exitCode = 1;
});

const SAME = { host: 'localhost', origin: 'http://localhost' };
let ipSeq = 0;
async function login(role, password){
  const r = await invoke('auth-login', {
    httpMethod: 'POST', headers: Object.assign({}, SAME, { 'x-nf-client-connection-ip': '10.8.0.' + (++ipSeq) }),
    body: JSON.stringify({ role, password }),
  });
  return String((r.headers && r.headers['Set-Cookie']) || '').split(';')[0];
}
const as = (c) => Object.assign({ cookie: c }, SAME);
const J = (r) => { try{ return JSON.parse(r.body); }catch(e){ return {}; } };

/** A tiny but structurally valid RIFF/WAVE file. */
function wav(seed, samples){
  const data = Buffer.alloc(samples * 2);
  for(let i = 0; i < samples; i++) data.writeInt16LE(((i * seed) % 4096) - 2048, i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(22050, 24); h.writeUInt32LE(44100, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const mp3 = () => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(600, 0x55)]);

resetStores();
const STAFF = await login('staff', ENV.STAFF_ACCESS_PASSWORD);
const CUST  = await login('customer', ENV.CUSTOMER_ACCESS_PASSWORD);

async function uploadZip(zip, title){
  const totalChunks = Math.ceil(zip.length / CHUNK_BYTES);
  const call = async (p) => J(await invoke('protected-media-chunk', {
    httpMethod: 'POST', headers: as(STAFF), body: JSON.stringify(p),
  }));
  const st = await call({ action: 'start', filename: 'pkg.zip', totalBytes: zip.length, totalChunks,
    sha256: crypto.createHash('sha256').update(zip).digest('hex'), role: 'customer', status: 'published', title });
  if(!st.ok) return st;
  for(let i = 0; i < totalChunks; i++)
    await call({ action: 'chunk', sid: st.sid, index: i,
      dataBase64: zip.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).toString('base64') });
  return await call({ action: 'complete', sid: st.sid });
}
async function fetchAsset(id, token, path){
  return await invoke('protected-media-asset', {
    headers: SAME, path: '/media/' + id + '/' + token + '/v/' + path, queryStringParameters: {},
  });
}
const grantFor = async (id, cookie) => J(await invoke('media-grant', {
  headers: cookie ? as(cookie) : SAME, queryStringParameters: { id } }));

// ==========================================================================
G('AUDIO SURVIVES PACKAGING');

await t('a ZIP carrying an audio folder keeps every clip', async () => {
  const zip = makeZip([
    { path: 'index.html', data: '<html><body>manual</body></html>' },
    { path: 'audio/step01/a.wav', data: wav(3, 200) },
    { path: 'audio/step01/b.wav', data: wav(5, 200) },
    { path: 'audio/common/outro.mp3', data: mp3() },
  ]);
  const pkg = P.buildPackage(zip, 'zip');
  const paths = pkg.files.map(f => f.path);
  assert.ok(paths.includes('audio/step01/a.wav'), 'a.wav missing');
  assert.ok(paths.includes('audio/step01/b.wav'), 'b.wav missing');
  assert.ok(paths.includes('audio/common/outro.mp3'), 'outro.mp3 missing');
});

await t('the nested folder structure is preserved exactly', async () => {
  const zip = makeZip([
    { path: 'index.html', data: '<html></html>' },
    { path: 'audio/step10/deep/nested/clip.wav', data: wav(7, 100) },
  ]);
  const pkg = P.buildPackage(zip, 'zip');
  assert.ok(pkg.files.some(f => f.path === 'audio/step10/deep/nested/clip.wav'),
    'got: ' + pkg.files.map(f => f.path).join(', '));
});

await t('audio bytes are stored untouched', async () => {
  const clip = wav(11, 500);
  const zip = makeZip([{ path: 'index.html', data: '<html></html>' }, { path: 'audio/x.wav', data: clip }]);
  const pkg = P.buildPackage(zip, 'zip');
  const stored = pkg.files.find(f => f.path === 'audio/x.wav').data;
  assert.equal(stored.length, clip.length);
  assert.ok(stored.equals(clip), 'the clip was altered in packaging');
});

// ==========================================================================
G('AN OVERSIZED ENTRY IS NORMALISED, NOT REFUSED');

function bigHtmlWithAudioRefs(){
  // over the per-asset limit through embedded images, exactly like the manual
  const img = 'data:image/png;base64,' + Buffer.alloc(70 * 1024, 0x41).toString('base64');
  let h = '<!doctype html><html><body>';
  for(let i = 0; i < 60; i++) h += '<img src="' + img.replace('QUFB', 'QUF' + String.fromCharCode(66 + (i % 20))) + '">';
  h += '<script>var TC_NARR_BASE="audio/";var TC_AUDIO_FILES={"a":"step01/a.wav"};</' + 'script></body></html>';
  return Buffer.from(h, 'utf8');
}

await t('a ZIP whose index.html is too large is accepted and normalised', async () => {
  const html = bigHtmlWithAudioRefs();
  assert.ok(html.length > N.LIMITS.SAFE_PROTECTED_ASSET, 'fixture should be over the limit');
  const zip = makeZip([
    { path: 'index.html', data: html },
    { path: 'audio/step01/a.wav', data: wav(3, 300) },
  ]);
  const pkg = P.buildPackage(zip, 'zip');
  assert.ok(pkg.norm, 'it should report a normalisation');
  assert.ok(pkg.norm.indexBytes <= N.LIMITS.SAFE_PROTECTED_ASSET, 'index still over the limit');
  assert.ok(pkg.files.every(f => f.data.length <= N.LIMITS.SAFE_PROTECTED_ASSET), 'an asset is over the limit');
  assert.ok(pkg.files.some(f => f.path === 'audio/step01/a.wav'), 'the audio must survive normalisation');
  assert.equal(pkg.entry, 'index.html');
});

await t('the entry keeps its place as the first file', async () => {
  const zip = makeZip([
    { path: 'index.html', data: bigHtmlWithAudioRefs() },
    { path: 'audio/a.wav', data: wav(2, 100) },
  ]);
  const pkg = P.buildPackage(zip, 'zip');
  assert.equal(pkg.files[0].path, 'index.html');
});

await t('a small entry in a ZIP is still left completely alone', async () => {
  const html = '<html><body><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="></body></html>';
  const zip = makeZip([{ path: 'index.html', data: html }, { path: 'audio/a.wav', data: wav(1, 50) }]);
  const pkg = P.buildPackage(zip, 'zip');
  assert.equal(pkg.norm, null, 'a small entry must not be normalised');
  assert.equal(pkg.files.find(f => f.path === 'index.html').data.toString('utf8'), html);
});

await t('a non-entry file that is too large is still refused', async () => {
  const zip = makeZip([
    { path: 'index.html', data: '<html></html>' },
    { path: 'audio/huge.wav', data: Buffer.alloc(N.LIMITS.SAFE_PROTECTED_ASSET + 4096, 0x41) },
  ]);
  assert.throws(() => P.buildPackage(zip, 'zip'), /大きすぎます/);
});

await t('a generated asset name that would collide is refused, not overwritten', async () => {
  const zip = makeZip([
    { path: 'index.html', data: bigHtmlWithAudioRefs() },
    { path: 'assets/embedded-001.png', data: Buffer.from('the author shipped this') },
  ]);
  assert.throws(() => P.buildPackage(zip, 'zip'), /衝突/);
});

// ==========================================================================
G('MIME TYPES');

await t('every audio extension gets an audio content type', async () => {
  const want = { 'a.mp3':'audio/mpeg', 'a.wav':'audio/wav', 'a.ogg':'audio/ogg' };
  for(const [p, mime] of Object.entries(want)) assert.equal(M.mimeFor(p), mime, p);
});

await t('audio is never served as a generic download', async () => {
  for(const p of ['audio/x.wav','audio/x.mp3','audio/x.ogg'])
    assert.notEqual(M.mimeFor(p), 'application/octet-stream', p + ' fell through to octet-stream');
});

// ==========================================================================
G('SERVING AND AUTHORISATION');

let ID = null, TOKEN = null;
await t('a package with audio uploads and publishes', async () => {
  const zip = makeZip([
    { path: 'index.html', data: '<html><body>manual</body></html>' },
    { path: 'audio/step01/login_01.wav', data: wav(9, 4000) },
    { path: 'audio/common/outro.wav', data: wav(4, 2000) },
  ]);
  const done = await uploadZip(zip, 'Audio package');
  assert.equal(done.ok, true, JSON.stringify(done));
  ID = done.id;
  const g = await grantFor(ID, CUST);
  assert.equal(g.ok, true);
  TOKEN = g.token;
});

await t('a customer can play the audio', async () => {
  const r = await fetchAsset(ID, TOKEN, 'audio/step01/login_01.wav');
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['Content-Type'], 'audio/wav');
  const body = Buffer.from(r.body, 'base64');
  assert.ok(body.length > 0, 'empty body');
  assert.equal(body.slice(0, 4).toString('ascii'), 'RIFF', 'not a WAV');
});

await t('the served bytes are identical to what was uploaded', async () => {
  const original = wav(9, 4000);
  const r = await fetchAsset(ID, TOKEN, 'audio/step01/login_01.wav');
  assert.ok(Buffer.from(r.body, 'base64').equals(original), 'audio was altered in transit');
});

await t('an anonymous listener gets nothing', async () => {
  const noToken = await fetchAsset(ID, '', 'audio/step01/login_01.wav');
  assert.notEqual(noToken.statusCode, 200);
  const forged = await fetchAsset(ID, TOKEN.slice(0, -4) + 'AAAA', 'audio/step01/login_01.wav');
  assert.notEqual(forged.statusCode, 200, 'a forged grant played the audio');
  const noGrant = await invoke('media-grant', { headers: SAME, queryStringParameters: { id: ID } });
  assert.equal(noGrant.statusCode, 401);
});

await t("a grant for one item cannot play another item's audio", async () => {
  const other = await uploadZip(makeZip([
    { path: 'index.html', data: '<html></html>' },
    { path: 'audio/secret.wav', data: wav(1, 100) },
  ]), 'Other');
  const r = await fetchAsset(other.id, TOKEN, 'audio/secret.wav');
  assert.notEqual(r.statusCode, 200);
});

// ==========================================================================
G('THE REAL TC MANUAL PACKAGE');

if(!fs.existsSync(TC_ZIP)){
  console.log('  (package not built at ' + TC_ZIP + ' - skipping)');
} else {
  const zip = fs.readFileSync(TC_ZIP);
  let pkg = null;

  await t('packages into an index plus its images and all 66 clips', async () => {
    pkg = P.buildPackage(zip, 'zip');
    const audio = pkg.files.filter(f => /\.wav$/i.test(f.path));
    assert.equal(audio.length, 66, 'expected 66 clips, got ' + audio.length);
    assert.ok(pkg.norm, 'the entry should have been normalised');
    assert.ok(pkg.norm.indexBytes <= N.LIMITS.SAFE_PROTECTED_ASSET);
    assert.ok(pkg.files.every(f => f.data.length <= N.LIMITS.SAFE_PROTECTED_ASSET));
  });

  await t('every clip the manual asks for is in the package', async () => {
    const idx = pkg.files.find(f => f.path === 'index.html').data.toString('utf8');
    const map = JSON.parse(/var TC_AUDIO_FILES = (\{[\s\S]*?\});/.exec(idx)[1]);
    const have = new Set(pkg.files.map(f => f.path));
    const missing = [...new Set(Object.values(map))].map(v => 'audio/' + v).filter(p => !have.has(p));
    assert.equal(missing.length, 0, 'missing: ' + missing.slice(0, 3).join(', '));
  });

  await t('the audio base and clip map are untouched by normalisation', async () => {
    const idx = pkg.files.find(f => f.path === 'index.html').data.toString('utf8');
    assert.ok(/var TC_NARR_BASE = "audio\/"/.test(idx), 'the base path was rewritten');
    assert.equal(Object.keys(JSON.parse(/var TC_AUDIO_FILES = (\{[\s\S]*?\});/.exec(idx)[1])).length, 132);
  });

  await t('the clips are byte-identical to the recordings on disk', async () => {
    const base = 'C:/Users/AldenLin/Downloads/TC/';
    let checked = 0;
    for(const f of pkg.files.filter(f => /\.wav$/i.test(f.path)).slice(0, 8)){
      const disk = base + f.path;
      if(!fs.existsSync(disk)) continue;
      assert.ok(f.data.equals(fs.readFileSync(disk)), f.path + ' differs from the original');
      checked++;
    }
    assert.ok(checked >= 5, 'expected to compare several clips, compared ' + checked);
  });
}

// ==========================================================================
G('THE SANDBOX GOES ON DOCUMENTS, NOT ON THEIR BYTES');

// Chrome refuses to decode a media resource whose own response carries a CSP
// sandbox directive — measured against a live deploy: with it, an <audio>
// element reaches networkState 3 (NETWORK_NO_SOURCE); without it, readyState 4.
// fetch() succeeds either way, which is why every package check passed while
// the narration stayed silent.

await t('an audio response carries no sandbox directive', async () => {
  const zip = makeZip([
    { path: 'index.html', data: '<html></html>' },
    { path: 'audio/a.wav', data: wav(3, 500) },
  ]);
  const done = await uploadZip(zip, 'CSP scope');
  const g = await grantFor(done.id, CUST);
  const r = await fetchAsset(done.id, g.token, 'audio/a.wav');
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['Content-Security-Policy'], undefined,
    'a clip must not be sandboxed, or Chrome will not play it');
  assert.equal(r.headers['Content-Type'], 'audio/wav');
});

await t('the entry document still is sandboxed', async () => {
  const zip = makeZip([{ path: 'index.html', data: '<html>doc</html>' }, { path: 'audio/a.wav', data: wav(1, 50) }]);
  const done = await uploadZip(zip, 'CSP doc');
  const g = await grantFor(done.id, CUST);
  const r = await fetchAsset(done.id, g.token, 'index.html');
  assert.equal(r.statusCode, 200);
  assert.ok(/^sandbox /.test(r.headers['Content-Security-Policy'] || ''), 'the document must stay sandboxed');
  assert.ok(!/allow-same-origin/.test(r.headers['Content-Security-Policy']), 'allow-same-origin must never appear');
});

await t('images keep their protections without the sandbox', async () => {
  const zip = makeZip([
    { path: 'index.html', data: '<html></html>' },
    { path: 'assets/pic.png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUg==', 'base64') },
  ]);
  const done = await uploadZip(zip, 'CSP image');
  const g = await grantFor(done.id, CUST);
  const r = await fetchAsset(done.id, g.token, 'assets/pic.png');
  assert.equal(r.headers['Content-Security-Policy'], undefined);
  assert.equal(r.headers['X-Content-Type-Options'], 'nosniff', 'nosniff must remain');
  assert.equal(r.headers['Cache-Control'], 'private, max-age=0, must-revalidate', 'caching must stay private');
});

await t('dropping the sandbox does not open the door to anyone', async () => {
  const zip = makeZip([{ path: 'index.html', data: '<html></html>' }, { path: 'audio/a.wav', data: wav(2, 80) }]);
  const done = await uploadZip(zip, 'CSP auth');
  const anon = await fetchAsset(done.id, '', 'audio/a.wav');
  assert.notEqual(anon.statusCode, 200, 'authorisation is unchanged');
});

// ============================================================
// Chunked upload + large-HTML normalisation.
//
// The reason both exist is one measured number: a Netlify synchronous function
// request is capped near 6,291,556 bytes after base64 expansion, and its
// response at exactly that. So a large presentation can neither be uploaded in
// one request nor served as one file — it has to arrive in pieces and be stored
// as a package.
//
//   node tests/media-feedback/upload.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { setEnv, invoke, resetStores, dumpStore, storeNames, loadFn } from './harness.mjs';
import { zipDir, makeZip } from './zip-writer.mjs';

const ENV = setEnv();
const CHUNK = loadFn('protected-media-chunk');
const CHUNK_BYTES = CHUNK.CHUNK_BYTES;
const N = loadFn('_normalize');
const TC = process.env.IDFL_TC_MANUAL || 'C:/Users/AldenLin/Downloads/TC/IDFL_JAPAN_TC_Manual_v5.html';

let pass = 0, fail = 0;
async function t(name, fn){
  try{ await fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.message)); fail++; }
}
function G(n){ console.log('\n' + n); }

const SAME = { host: 'localhost', origin: 'http://localhost' };
let ipSeq = 0;
async function login(role, password){
  const r = await invoke('auth-login', {
    httpMethod: 'POST', headers: Object.assign({}, SAME, { 'x-nf-client-connection-ip': '10.7.0.' + (++ipSeq) }),
    body: JSON.stringify({ role, password }),
  });
  return String((r.headers && r.headers['Set-Cookie']) || '').split(';')[0];
}
const as = (c) => Object.assign({ cookie: c }, SAME);
const J = (r) => { try{ return JSON.parse(r.body); }catch(e){ return {}; } };

async function chunkCall(cookie, payload){
  const r = await invoke('protected-media-chunk', {
    httpMethod: 'POST', headers: cookie ? as(cookie) : SAME, body: JSON.stringify(payload),
  });
  return { status: r.statusCode, body: J(r) };
}

/** Drive a whole upload the way the console does. */
async function upload(cookie, buf, filename, meta){
  const totalChunks = Math.ceil(buf.length / CHUNK_BYTES);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const started = await chunkCall(cookie, Object.assign({
    action: 'start', filename, totalBytes: buf.length, totalChunks, sha256: sha,
    role: 'customer', status: 'published',
  }, meta || {}));
  if(started.status !== 200) return { started, failed: true };
  const sid = started.body.sid;
  for(let i = 0; i < totalChunks; i++){
    const part = buf.slice(i * CHUNK_BYTES, Math.min(buf.length, (i + 1) * CHUNK_BYTES));
    const c = await chunkCall(cookie, { action: 'chunk', sid, index: i, dataBase64: part.toString('base64') });
    if(c.status !== 200) return { chunk: c, failed: true, sid };
  }
  const done = await chunkCall(cookie, { action: 'complete', sid });
  return { sid, sha, totalChunks, done };
}

// ==========================================================================
G('SETUP');
resetStores();
const STAFF = await login('staff', ENV.STAFF_ACCESS_PASSWORD);
const CUST = await login('customer', ENV.CUSTOMER_ACCESS_PASSWORD);

// A body that needs several chunks. Random bytes so it cannot be compressed
// away and the chunk arithmetic is real.
function bigHtml(bytes){
  const filler = crypto.randomBytes(Math.max(0, bytes - 200)).toString('base64').slice(0, Math.max(0, bytes - 200));
  return Buffer.from('<!doctype html><html><body><h1>big</h1><!--' + filler + '--></body></html>', 'utf8');
}

G('SESSION CONTROL');

await t('a customer cannot start an upload', async () => {
  const r = await chunkCall(CUST, { action: 'start', filename: 'x.html', totalBytes: 10, totalChunks: 1, role: 'customer' });
  assert.equal(r.status, 403);
});

await t('an anonymous caller cannot start an upload', async () => {
  const r = await chunkCall('', { action: 'start', filename: 'x.html', totalBytes: 10, totalChunks: 1, role: 'customer' });
  assert.equal(r.status, 403);
});

await t('a cross-origin start is refused (CSRF guard)', async () => {
  const r = await invoke('protected-media-chunk', {
    httpMethod: 'POST', headers: { cookie: STAFF, host: 'localhost', origin: 'https://evil.example' },
    body: JSON.stringify({ action: 'start', filename: 'x.html', totalBytes: 10, totalChunks: 1, role: 'customer' }),
  });
  assert.equal(r.statusCode, 403);
});

await t('start returns a random session id and the chunk size', async () => {
  const r = await chunkCall(STAFF, { action: 'start', filename: 'a.html', totalBytes: 10, totalChunks: 1, role: 'customer' });
  assert.equal(r.status, 200);
  assert.match(r.body.sid, /^[a-f0-9]{32}$/);
  assert.equal(r.body.chunkBytes, CHUNK_BYTES);
  const again = await chunkCall(STAFF, { action: 'start', filename: 'a.html', totalBytes: 10, totalChunks: 1, role: 'customer' });
  assert.notEqual(again.body.sid, r.body.sid, 'session ids must not repeat');
});

await t('start rejects a mismatched chunk count', async () => {
  const r = await chunkCall(STAFF, { action: 'start', filename: 'a.html', totalBytes: 5 * CHUNK_BYTES, totalChunks: 2, role: 'customer' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /分割数/);
});

await t('start rejects an oversized total', async () => {
  const big = CHUNK.MAX_TOTAL_BYTES + 1;
  const r = await chunkCall(STAFF, { action: 'start', filename: 'a.html', totalBytes: big, totalChunks: Math.ceil(big / CHUNK_BYTES), role: 'customer' });
  assert.equal(r.status, 413);
});

await t('start rejects a file type that is not html or zip', async () => {
  const r = await chunkCall(STAFF, { action: 'start', filename: 'a.pdf', totalBytes: 10, totalChunks: 1, role: 'customer' });
  assert.equal(r.status, 400);
});

await t('an unknown session id is refused', async () => {
  const r = await chunkCall(STAFF, { action: 'chunk', sid: 'f'.repeat(32), index: 0, dataBase64: 'AAAA' });
  assert.equal(r.status, 404);
});

await t('a malformed session id is refused', async () => {
  assert.equal((await chunkCall(STAFF, { action: 'chunk', sid: '../etc', index: 0, dataBase64: 'AA' })).status, 400);
});

G('CHUNK VALIDATION');

let SID;
await t('chunks are accepted and counted', async () => {
  const buf = bigHtml(Math.floor(CHUNK_BYTES * 2.5));
  const started = await chunkCall(STAFF, {
    action: 'start', filename: 'multi.html', totalBytes: buf.length,
    totalChunks: Math.ceil(buf.length / CHUNK_BYTES), role: 'customer', status: 'published', title: 'chunked',
  });
  assert.equal(started.status, 200);
  SID = started.body.sid;
  const c0 = await chunkCall(STAFF, { action: 'chunk', sid: SID, index: 0, dataBase64: buf.slice(0, CHUNK_BYTES).toString('base64') });
  assert.equal(c0.status, 200, JSON.stringify(c0.body));
  assert.equal(c0.body.received, 1);
  assert.equal(c0.body.totalChunks, 3);
});

await t('a chunk index beyond the declared count is refused', async () => {
  const r = await chunkCall(STAFF, { action: 'chunk', sid: SID, index: 99, dataBase64: 'AAAA' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /範囲外/);
});

await t('a chunk of the wrong size is refused', async () => {
  const r = await chunkCall(STAFF, { action: 'chunk', sid: SID, index: 1, dataBase64: Buffer.alloc(1234).toString('base64') });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /サイズ/);
});

await t('a non-base64 chunk is refused', async () => {
  const r = await chunkCall(STAFF, { action: 'chunk', sid: SID, index: 1, dataBase64: '!!!not base64!!!' });
  assert.equal(r.status, 400);
});

await t('re-sending an identical chunk is fine (retry)', async () => {
  const buf = Buffer.alloc(CHUNK_BYTES, 0x41);
  const a = await chunkCall(STAFF, { action: 'chunk', sid: SID, index: 1, dataBase64: buf.toString('base64') });
  assert.equal(a.status, 200);
  const b = await chunkCall(STAFF, { action: 'chunk', sid: SID, index: 1, dataBase64: buf.toString('base64') });
  assert.equal(b.status, 200, 'an identical retry must be accepted');
  assert.equal(b.body.received, a.body.received, 'a retry must not be counted twice');
});

await t('the SAME index with DIFFERENT bytes is a conflict', async () => {
  const other = Buffer.alloc(CHUNK_BYTES, 0x42);
  const r = await chunkCall(STAFF, { action: 'chunk', sid: SID, index: 1, dataBase64: other.toString('base64') });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /異なる内容/);
});

await t('complete refuses while a chunk is missing', async () => {
  const r = await chunkCall(STAFF, { action: 'complete', sid: SID });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /チャンク/);
});

await t('a different staff session cannot touch someone else\'s upload', async () => {
  const A = loadFn('_auth');
  const realNow = Date.now;
  Date.now = () => realNow() + 5000;                    // a session opened later
  const other = A.COOKIE + '=' + A.sign('staff');
  Date.now = realNow;
  const r = await chunkCall(other, { action: 'chunk', sid: SID, index: 2, dataBase64: 'AAAA' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /権限/);
});

await t('cancel removes the session and every chunk it held', async () => {
  const store = dumpStore('idfl-upload-tmp-dev');
  assert.ok([...store.keys()].some(k => k.indexOf('up/' + SID + '/') === 0), 'chunks should exist before cancel');
  const r = await chunkCall(STAFF, { action: 'cancel', sid: SID });
  assert.equal(r.status, 200);
  const after = dumpStore('idfl-upload-tmp-dev');
  assert.equal([...after.keys()].filter(k => k.indexOf('up/' + SID + '/') === 0).length, 0, 'chunks left behind after cancel');
  assert.equal((await chunkCall(STAFF, { action: 'complete', sid: SID })).status, 404);
});

await t('an expired session is refused and swept', async () => {
  const buf = bigHtml(1000);
  const started = await chunkCall(STAFF, { action: 'start', filename: 'old.html', totalBytes: buf.length, totalChunks: 1, role: 'customer' });
  const sid = started.body.sid;
  // age the session past its hour
  const store = dumpStore('idfl-upload-tmp-dev');
  const key = 'up/' + sid + '/meta';
  const rec = JSON.parse(store.get(key).buf.toString('utf8'));
  rec.startedAt = Date.now() - (CHUNK.SESSION_TTL_MS + 60000);
  store.get(key).buf = Buffer.from(JSON.stringify(rec), 'utf8');
  const r = await chunkCall(STAFF, { action: 'chunk', sid, index: 0, dataBase64: buf.toString('base64') });
  assert.equal(r.status, 410);
  assert.match(r.body.error, /有効期限/);
  assert.equal([...dumpStore('idfl-upload-tmp-dev').keys()].filter(k => k.indexOf('up/' + sid + '/') === 0).length, 0);
});

G('ASSEMBLY');

let MULTI_ID, MULTI_SID;
await t('a multi-chunk upload assembles, verifies and publishes', async () => {
  const buf = bigHtml(Math.floor(CHUNK_BYTES * 2.4));
  const r = await upload(STAFF, buf, 'assembled.html', { title: 'Assembled', status: 'published' });
  assert.ok(!r.failed, JSON.stringify(r));
  assert.equal(r.totalChunks, 3);
  assert.equal(r.done.status, 200, JSON.stringify(r.done.body));
  assert.equal(r.done.body.sourceSha256, r.sha, 'the assembled bytes must hash to the source');
  MULTI_ID = r.done.body.id; MULTI_SID = r.sid;
});

await t('the assembled file is what a customer is served', async () => {
  const g = J(await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id: MULTI_ID } }));
  assert.equal(g.ok, true);
  const got = await invoke('protected-media-asset', {
    headers: SAME, path: '/media/' + MULTI_ID + '/' + g.token + '/v/index.html', queryStringParameters: {},
  });
  assert.equal(got.statusCode, 200);
  assert.ok(Buffer.from(got.body, 'base64').toString('utf8').includes('<h1>big</h1>'));
});

await t('chunks are swept once the upload completes', async () => {
  const left = [...dumpStore('idfl-upload-tmp-dev').keys()].filter(k => k.indexOf('up/' + MULTI_SID + '/') === 0);
  assert.equal(left.length, 0, 'the completed upload still holds: ' + left.slice(0, 3).join(', '));
  // and nothing anywhere keeps chunk bodies around
  const bodies = [...dumpStore('idfl-upload-tmp-dev').keys()].filter(k => k.indexOf('/c/') > 0);
  assert.equal(bodies.length, 0, 'chunk bodies left behind: ' + bodies.slice(0, 3).join(', '));
});

await t('a corrupted assembly is rejected on the hash', async () => {
  const buf = bigHtml(Math.floor(CHUNK_BYTES * 1.5));
  const totalChunks = Math.ceil(buf.length / CHUNK_BYTES);
  const started = await chunkCall(STAFF, {
    action: 'start', filename: 'corrupt.html', totalBytes: buf.length, totalChunks,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'), role: 'customer',
  });
  const sid = started.body.sid;
  for(let i = 0; i < totalChunks; i++){
    let part = Buffer.from(buf.slice(i * CHUNK_BYTES, Math.min(buf.length, (i + 1) * CHUNK_BYTES)));
    if(i === 0) part[10] = part[10] ^ 0xff;                 // one flipped byte
    await chunkCall(STAFF, { action: 'chunk', sid, index: i, dataBase64: part.toString('base64') });
  }
  const done = await chunkCall(STAFF, { action: 'complete', sid });
  assert.equal(done.status, 409);
  assert.match(done.body.error, /ハッシュ/);
  assert.equal([...dumpStore('idfl-upload-tmp-dev').keys()].filter(k => k.indexOf('up/' + sid) === 0).length, 0, 'a failed upload must not leave chunks');
});

G('NORMALISATION THROUGH THE PIPELINE');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

await t('a small HTML file is stored untouched (regression)', async () => {
  const html = Buffer.from('<!doctype html><html><body><img src="data:image/png;base64,' + PNG + '"></body></html>', 'utf8');
  const r = await invoke('protected-media-upload', {
    httpMethod: 'POST', headers: as(STAFF),
    body: JSON.stringify({ filename: 'small.html', contentBase64: html.toString('base64'), role: 'customer', status: 'published', title: 'Small' }),
  });
  assert.equal(r.statusCode, 200, r.body);
  const j = J(r);
  assert.equal(j.files, 1, 'a small document must not be split');
  assert.equal(j.normalized, false);
});

await t('a ZIP package still works (regression)', async () => {
  const zip = makeZip([{ path: 'index.html', data: '<h1>zip</h1>' }, { path: 'styles/a.css', data: 'body{}' }]);
  const r = await invoke('protected-media-upload', {
    httpMethod: 'POST', headers: as(STAFF),
    body: JSON.stringify({ filename: 'pkg.zip', contentBase64: zip.toString('base64'), role: 'customer', status: 'published', title: 'Zip' }),
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(J(r).files, 2);
});

await t('a large self-contained HTML is normalised into a package', async () => {
  // one document, over the serving limit, mostly embedded images
  const img = 'data:image/png;base64,' + Buffer.alloc(60 * 1024, 0x41).toString('base64');
  let html = '<!doctype html><html><body>';
  for(let i = 0; i < 70; i++) html += '<img src="' + img.replace('QUFB', 'QUF' + String.fromCharCode(66 + (i % 20))) + '">';
  html += '</body></html>';
  const buf = Buffer.from(html, 'utf8');
  assert.ok(buf.length > N.LIMITS.SAFE_PROTECTED_ASSET, 'fixture should exceed the serving limit');

  const r = await upload(STAFF, buf, 'huge.html', { title: 'Huge', status: 'published' });
  assert.ok(!r.failed, JSON.stringify(r));
  assert.equal(r.done.status, 200, JSON.stringify(r.done.body));
  const j = r.done.body;
  assert.equal(j.normalized, true, 'it should have been normalised');
  assert.ok(j.files > 1, 'expected a package, got ' + j.files + ' file(s)');
  assert.ok(j.report.indexBytes <= N.LIMITS.SAFE_PROTECTED_ASSET, 'index.html is still over the limit');
  assert.ok(j.report.largestAsset <= N.LIMITS.SAFE_PROTECTED_ASSET);
  assert.equal(j.report.remaining, 0, 'no payload should be left embedded');
  assert.equal(j.report.sourceBytes, buf.length);
});

await t('an embedded asset that is too big on its own is refused, not split', async () => {
  const huge = 'data:image/png;base64,' + Buffer.alloc(N.LIMITS.SAFE_PROTECTED_ASSET + 4096, 0x41).toString('base64');
  const buf = Buffer.from('<html><body><img src="' + huge + '"></body></html>', 'utf8');
  const r = await upload(STAFF, buf, 'toobig.html', { title: 'Too big' });
  assert.equal(r.done.status, 400);
  assert.match(r.done.body.error, /上限/);
});

await t('a data URI inside an escaped JS string is extracted, not skipped', async () => {
  // exactly the shape the TC manual uses: markup built in a JS string
  const png = 'data:image/png;base64,' + Buffer.alloc(40 * 1024, 0x53).toString('base64');
  const html = '<html><body><script>var s = "<img src=\\"' + png + '\\">";' +
    'document.body.innerHTML = s;</' + 'script></body></html>';
  const found = N.findDataUris(html);
  assert.equal(found.length, 1, 'the escaped-quote form must be found');
  assert.equal(found[0].mime, 'image/png');
  assert.equal(found[0].data.length, 40 * 1024, 'the payload must not include the escape');
  const { files, report } = N.normalize(html);
  assert.equal(report.extracted, 1);
  assert.equal(report.remaining, 0);
  assert.equal(files.length, 2);
  // the replacement has to land inside the string literal, intact
  const idx = files[0].data.toString('utf8');
  assert.ok(idx.includes('src=\\"assets/embedded-001.png\\"'), 'the rewritten path broke the string literal');
});

G('THE REAL TC MANUAL');

if(!fs.existsSync(TC)){
  console.log('  (TC manual not present at ' + TC + ' - skipping)');
} else {
  const src = fs.readFileSync(TC);
  let TCID;

  await t('is too large for a single request, and for a single asset', async () => {
    assert.ok(src.length > 3 * 1024 * 1024, 'source is ' + src.length);
    assert.ok(Math.ceil(src.length / 3) * 4 > 6291556, 'base64 of the source should exceed the request ceiling');
  });

  await t('uploads in chunks and normalises', async () => {
    const r = await upload(STAFF, src, 'IDFL_JAPAN_TC_Manual_v5.html', {
      title: 'IDFL JAPAN TC申請マニュアル', status: 'published', group: 'IDFL Guide',
      description: 'TC申請・Trackit操作・審査時の注意点をまとめたインタラクティブマニュアルです。',
    });
    assert.ok(!r.failed, JSON.stringify(r));
    assert.ok(r.totalChunks >= 8, 'expected several chunks, got ' + r.totalChunks);
    assert.equal(r.done.status, 200, JSON.stringify(r.done.body));
    const j = r.done.body;
    TCID = j.id;
    assert.equal(j.sourceSha256, r.sha);
    assert.equal(j.normalized, true);
    assert.ok(j.report.indexBytes <= N.LIMITS.SAFE_PROTECTED_ASSET,
      'normalised index is ' + j.report.indexBytes);
    assert.ok(j.report.largestAsset <= N.LIMITS.SAFE_PROTECTED_ASSET);
    assert.equal(j.report.remaining, 0, 'the entry document still carries embedded payload');
    assert.equal(j.report.oversized.length, 0);
    console.log('         source ' + (j.report.sourceBytes / 1048576).toFixed(2) + ' MB  ->  index ' +
      (j.report.indexBytes / 1048576).toFixed(2) + ' MB + ' + (j.report.fileCount - 1) + ' assets, largest ' +
      (j.report.largestAsset / 1024).toFixed(0) + ' KB');
  });

  await t('the entry document serves, and keeps the FAQ and the information date', async () => {
    const g = J(await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id: TCID } }));
    const got = await invoke('protected-media-asset', {
      headers: SAME, path: '/media/' + TCID + '/' + g.token + '/v/index.html', queryStringParameters: {},
    });
    assert.equal(got.statusCode, 200);
    const html = Buffer.from(got.body, 'base64').toString('utf8');
    assert.ok(html.length < 6291556, 'the served body must stay under the response ceiling');
    assert.ok(html.includes('よくある質問'), 'the FAQ tab should survive normalisation');
    assert.ok(html.includes('2026年8月13日'), 'the information date must be untouched');
    assert.ok(html.includes('"faq"'), 'the FAQ tab key should be present');
    assert.equal(html.indexOf('data:image'), -1, 'no data URI should remain in the entry');
  });

  await t('every extracted asset is reachable and correctly typed', async () => {
    const g = J(await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id: TCID } }));
    const manifest = await (async () => {
      const rec = dumpStore('idfl-protected').get(TCID);
      return JSON.parse(rec.buf.toString('utf8'));
    })();
    assert.ok(manifest.files.length > 100, 'expected many assets, got ' + manifest.files.length);
    // sample across the package rather than fetching all of them
    const sample = manifest.files.filter((_, i) => i % 20 === 0).slice(0, 8);
    for(const p of sample){
      const r = await invoke('protected-media-asset', {
        headers: SAME, path: '/media/' + TCID + '/' + g.token + '/v/' + p, queryStringParameters: {},
      });
      assert.equal(r.statusCode, 200, 'asset not served: ' + p);
      assert.ok(Buffer.from(r.body, 'base64').length > 0, 'empty asset: ' + p);
      assert.ok(r.headers['Content-Type'], 'no content type for ' + p);
    }
  });

  await t('anonymous callers get none of it', async () => {
    const g = J(await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id: TCID } }));
    const anon = await invoke('protected-media-asset', {
      headers: SAME, path: '/media/' + TCID + '//v/index.html', queryStringParameters: {},
    });
    assert.notEqual(anon.statusCode, 200);
    const noGrant = await invoke('media-grant', { headers: SAME, queryStringParameters: { id: TCID } });
    assert.equal(noGrant.statusCode, 401);
    // a forged grant must not work either
    const forged = await invoke('protected-media-asset', {
      headers: SAME, path: '/media/' + TCID + '/' + g.token.slice(0, -4) + 'AAAA/v/index.html', queryStringParameters: {},
    });
    assert.equal(forged.statusCode, 302, 'a forged grant should be sent to login, not served');
  });

  await t('the package lands in the media store, never in the record store', async () => {
    const media = [...dumpStore('idfl-media-html-dev').keys()].filter(k => k.indexOf(TCID + '/') === 0);
    assert.ok(media.length > 100, 'expected the package in the media store');
    const rec = [...dumpStore('idfl-protected').keys()];
    assert.equal(rec.filter(k => k.indexOf('/') >= 0).length, 0, 'no asset keys belong in the record store');
  });
}

G('STORE ISOLATION');

await t('the temp store is context-scoped and separate from everything else', async () => {
  const S = loadFn('_stores');
  const saved = process.env.CONTEXT;
  process.env.CONTEXT = 'production';
  assert.equal(S.uploadStoreName(), 'idfl-upload-tmp');
  process.env.CONTEXT = 'deploy-preview'; process.env.REVIEW_ID = '9';
  assert.equal(S.uploadStoreName(), 'idfl-upload-tmp-dp-9');
  process.env.CONTEXT = saved; delete process.env.REVIEW_ID;
  assert.ok(storeNames().indexOf('idfl-upload-tmp-dev') >= 0);
  assert.notEqual(S.uploadStoreName(), S.PROTECTED_STORE);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

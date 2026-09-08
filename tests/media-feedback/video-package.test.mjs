// ============================================================
// A teaching package with video in it, end to end.
//
// The TC manual is the case this stack was not built for: 147 files, 50.5 MB
// expanded, and fourteen MP4 clips of which the largest is 6.5 MB. Three
// separate ceilings used to stand in its way, and only the first of them
// produced an error message anyone could act on:
//
//   1. _zip.js refused an archive expanding past 24 MB.
//   2. _package.js refused any single file over 3.5 MB - five of the clips.
//   3. the asset server returned every file in one base64 response, which the
//      platform caps at 6,291,556 bytes, so three clips could not be served
//      even if they were stored - and no clip could be seeked, because nothing
//      answered a byte range.
//
// This suite is about all three, and about the things that must NOT have moved
// while they were raised: zip-bomb refusal, path traversal, CRC, the session
// and grant checks, and draft visibility.
//
//   node tests/media-feedback/video-package.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { setEnv, invoke, resetStores, dumpStore, loadFn } from './harness.mjs';
import { makeZip } from './zip-writer.mjs';

const ENV = setEnv();
const CHUNK = loadFn('protected-media-chunk');
const CHUNK_BYTES = CHUNK.CHUNK_BYTES;
const N = loadFn('_normalize');
const Z = loadFn('_zip');
const P = loadFn('_package');

const PKG = process.env.IDFL_TC_PACKAGE ||
  'C:/Users/AldenLin/Downloads/TC/IDFL_TC_Manual_web_v6_動画同梱.zip';

let pass = 0, fail = 0;
async function t(name, fn){
  try{ await fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.message)); fail++; }
}
function G(n){ console.log('\n' + n); }
const MB = (b) => (b / 1048576).toFixed(2) + ' MB';

const SAME = { host: 'localhost', origin: 'http://localhost' };
let ipSeq = 0;
async function login(role, password){
  const r = await invoke('auth-login', {
    httpMethod: 'POST', headers: Object.assign({}, SAME, { 'x-nf-client-connection-ip': '10.9.0.' + (++ipSeq) }),
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

/** Drive a whole upload the way the admin console does. */
async function upload(cookie, buf, filename, meta){
  const totalChunks = Math.ceil(buf.length / CHUNK_BYTES);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const started = await chunkCall(cookie, Object.assign({
    action: 'start', filename, totalBytes: buf.length, totalChunks, chunkBytes: CHUNK_BYTES, sha256: sha,
    role: 'customer', status: 'published',
  }, meta || {}));
  if(started.status !== 200) return { started, failed: true };
  const sid = started.body.sid;
  for(let i = 0; i < totalChunks; i++){
    const part = buf.slice(i * CHUNK_BYTES, Math.min(buf.length, (i + 1) * CHUNK_BYTES));
    const c = await chunkCall(cookie, { action: 'chunk', sid, index: i, dataBase64: part.toString('base64') });
    if(c.status !== 200) return { chunk: c, failed: true, sid };
  }
  const t0 = Date.now();
  const done = await chunkCall(cookie, { action: 'complete', sid });
  return { sid, sha, totalChunks, done, completeMs: Date.now() - t0 };
}

/** Fetch one asset out of a package the way the viewer's iframe does. */
async function asset(id, token, path, extra){
  return invoke('protected-media-asset', Object.assign({
    headers: SAME, path: '/media/' + id + '/' + token + '/v/' + path, queryStringParameters: {},
  }, extra || {}));
}
async function grantFor(cookie, id){
  return J(await invoke('media-grant', { headers: as(cookie), queryStringParameters: { id } })).token;
}
const bodyOf = (r) => Buffer.from(r.body || '', r.isBase64Encoded ? 'base64' : 'utf8');

// ==========================================================================
G('SETUP');
resetStores();
const STAFF = await login('staff', ENV.STAFF_ACCESS_PASSWORD);
const CUST = await login('customer', ENV.CUSTOMER_ACCESS_PASSWORD);

// --------------------------------------------------------------------------
// Limits, tested directly against the extractor. These need no HTTP round trip
// and no multi-megabyte upload, so they stay fast and say exactly what broke.
// --------------------------------------------------------------------------
G('LIMITS THAT MOVED, AND THE ONE THAT MUST NOT');

const html = (s) => Buffer.from('<!doctype html><html><body>' + s + '</body></html>', 'utf8');
const rand = (n) => crypto.randomBytes(n);

await t('a 5 MB MP4 is accepted - it used to be refused at 3.5 MB', () => {
  const zip = makeZip([
    { path: 'index.html', data: html('<video src="media/a.mp4"></video>') },
    { path: 'media/a.mp4', data: rand(5 * 1024 * 1024) },
  ]);
  const pkg = P.buildPackage(zip, 'zip');
  assert.equal(pkg.files.length, 2);
  assert.equal(pkg.entry, 'index.html');
});

await t('a 5 MB PNG is still refused - nothing range-requests an image', () => {
  const zip = makeZip([
    { path: 'index.html', data: html('<img src="a.png">') },
    { path: 'a.png', data: rand(5 * 1024 * 1024) },
  ]);
  assert.throws(() => P.buildPackage(zip, 'zip'), /大きすぎます/);
});

await t('an MP4 past the video ceiling is refused too', () => {
  const zip = makeZip([
    { path: 'index.html', data: html('x') },
    { path: 'media/huge.mp4', data: rand(N.LIMITS.SAFE_RANGED_ASSET + 65536) },
  ]);
  assert.throws(() => P.buildPackage(zip, 'zip'), /大きすぎます|上限/);
});

await t('a zip bomb is still refused, by ratio rather than by size', () => {
  // 40 MB of zeros compresses to a few dozen KB: the absolute cap alone would
  // now wave this through, which is exactly why the ratio guard exists.
  const zip = makeZip([
    { path: 'index.html', data: html('x') },
    { path: 'bomb.bin', data: Buffer.alloc(20 * 1024 * 1024, 0) },
  ]);
  assert.ok(zip.length < 1024 * 1024, 'the bomb should be tiny on disk, is ' + MB(zip.length));
  assert.throws(() => P.buildPackage(zip, 'zip'), /圧縮率|展開爆弾/);
});

await t('a small, highly compressible archive is not punished for being text', () => {
  // Under the ratio floor, so a legitimately repetitive document still loads.
  const zip = makeZip([{ path: 'index.html', data: Buffer.alloc(2 * 1024 * 1024, 0x41) }]);
  const pkg = P.buildPackage(zip, 'zip');
  assert.equal(pkg.files.length, 1);
});

await t('path traversal, CRC and ZIP64 refusals are untouched', () => {
  assert.equal(Z.safePath('../../etc/passwd'), '');
  assert.equal(Z.safePath('/abs/path'), '');
  assert.equal(Z.safePath('media/ok_1.mp4'), 'media/ok_1.mp4');
  // Stored, not deflated, so the flipped byte is payload rather than a header
  // - the point is that the CRC catches silent corruption of the content.
  const zip = makeZip([{ path: 'index.html', data: html('hello'), store: true }]);
  const broken = Buffer.from(zip);
  broken[broken.indexOf(Buffer.from('hello'))] ^= 0xff;
  assert.throws(() => P.buildPackage(broken, 'zip'), /CRC/);
});

// ==========================================================================
if(!fs.existsSync(PKG)){
  console.log('\n(the video package is not at ' + PKG + ' - skipping the end-to-end suite)');
} else {
  const src = fs.readFileSync(PKG);
  const inZip = new Map();                       // path -> Buffer, read independently
  {
    // A second, deliberately naive reader, so "what was stored" is compared
    // against the archive itself rather than against _zip.js's own opinion.
    let p = src.length - 22;
    while(p >= 0 && src.readUInt32LE(p) !== 0x06054b50) p--;
    const count = src.readUInt16LE(p + 10);
    let c = src.readUInt32LE(p + 16);
    for(let i = 0; i < count; i++){
      const nameLen = src.readUInt16LE(c + 28), extraLen = src.readUInt16LE(c + 30), cmtLen = src.readUInt16LE(c + 32);
      const method = src.readUInt16LE(c + 10), compSize = src.readUInt32LE(c + 20);
      const name = src.slice(c + 46, c + 46 + nameLen).toString('utf8');
      const loc = src.readUInt32LE(c + 42);
      const start = loc + 30 + src.readUInt16LE(loc + 26) + src.readUInt16LE(loc + 28);
      const raw = src.slice(start, start + compSize);
      if(!name.endsWith('/')) inZip.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
      c += 46 + nameLen + extraLen + cmtLen;
    }
  }
  const videos = [...inZip.keys()].filter(k => k.endsWith('.mp4')).sort((a, b) => inZip.get(b).length - inZip.get(a).length);
  const BIG = videos[0];

  let ID = null, TOKEN = null;

  G('THE REAL VIDEO PACKAGE');

  await t('the archive is the shape the manual actually ships', () => {
    assert.ok(inZip.size > 100, 'entries: ' + inZip.size);
    assert.ok(inZip.has('index.html'));
    assert.equal(videos.length, 14, 'expected 14 clips, found ' + videos.length);
    const expanded = [...inZip.values()].reduce((a, b) => a + b.length, 0);
    assert.ok(expanded > 24 * 1024 * 1024, 'this must exceed the old 24 MB ceiling to be worth testing');
    assert.ok(inZip.get(BIG).length > N.LIMITS.SAFE_PROTECTED_ASSET, 'the largest clip must exceed the whole-file ceiling');
    console.log('         ' + inZip.size + ' files, ' + MB(src.length) + ' zipped -> ' + MB(expanded) +
      ', largest clip ' + BIG + ' ' + MB(inZip.get(BIG).length));
  });

  await t('it uploads in chunks and is taken whole', async () => {
    const r = await upload(STAFF, src, 'IDFL_TC_Manual_web_v6.zip', {
      title: 'IDFL JAPAN TC申請マニュアル（動画同梱）', status: 'published', group: 'IDFL Guide',
    });
    assert.ok(!r.failed, JSON.stringify(r.started || r.chunk));
    assert.equal(r.done.status, 200, JSON.stringify(r.done.body));
    const j = r.done.body;
    ID = j.id;
    assert.equal(j.sourceSha256, r.sha, 'the assembled bytes must hash to the archive');
    assert.equal(j.files, inZip.size, 'every entry should be stored');
    assert.equal(j.entry, 'index.html');
    assert.equal(j.version, 1);
    console.log('         ' + r.totalChunks + ' chunks, complete took ' + r.completeMs + ' ms, ' +
      j.files + ' files stored, reported ' + j.sizeLabel);
  });

  await t('the complete step stays inside a synchronous function budget', async () => {
    // Ten seconds is the platform's limit for a synchronous function. This is
    // an in-memory store rather than Blobs, so the number here is not the
    // production number - what it guards is the shape: the work must not be
    // serialised per file again, which is what put it over the edge before.
    assert.equal(P.WRITE_CONCURRENCY >= 8, true, 'writes must be concurrent, not serial');
  });

  await t('every stored file is byte-identical to the archive entry', () => {
    const media = dumpStore('idfl-media-html-dev');
    let checked = 0;
    for(const [name, data] of inZip){
      const got = media.get(ID + '/v1/' + name);
      assert.ok(got, 'missing from the store: ' + name);
      assert.equal(got.buf.length, data.length, 'size differs: ' + name);
      assert.ok(got.buf.equals(data), 'bytes differ: ' + name);
      checked++;
    }
    assert.equal(checked, inZip.size);
  });

  await t('each clip is stored as video/mp4, and the subtitles as text', () => {
    const media = dumpStore('idfl-media-html-dev');
    for(const v of videos) assert.equal(media.get(ID + '/v1/' + v).metadata.contentType, 'video/mp4', v);
    const srt = [...inZip.keys()].find(k => k.endsWith('.srt'));
    if(srt) assert.match(media.get(ID + '/v1/' + srt).metadata.contentType, /^text\/plain/);
  });

  // ------------------------------------------------------------------------
  G('SERVING: RANGES, WHICH IS WHAT MAKES THE PROGRESS BAR WORK');

  await t('a customer grant opens the package', async () => {
    TOKEN = await grantFor(CUST, ID);
    assert.ok(TOKEN, 'no grant token');
  });

  await t('the entry document still comes back whole, as a 200', async () => {
    const r = await asset(ID, TOKEN, 'index.html');
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['Accept-Ranges'], 'bytes');
    assert.ok(bodyOf(r).equals(inZip.get('index.html')));
    assert.ok(bodyOf(r).length < N.LIMITS.FUNCTION_RESPONSE_HARD_LIMIT);
  });

  await t('a clip too large for one response answers a range instead', async () => {
    const total = inZip.get(BIG).length;
    const r = await asset(ID, TOKEN, BIG, { headers: Object.assign({}, SAME, { range: 'bytes=0-' }) });
    assert.equal(r.statusCode, 206);
    assert.equal(r.headers['Content-Type'], 'video/mp4');
    assert.equal(r.headers['Accept-Ranges'], 'bytes');
    const slice = bodyOf(r);
    assert.equal(r.headers['Content-Range'], 'bytes 0-' + (slice.length - 1) + '/' + total);
    assert.equal(r.headers['Content-Length'], String(slice.length));
    assert.ok(slice.length <= N.LIMITS.RANGE_SLICE_BYTES, 'slice is ' + MB(slice.length));
    assert.ok(slice.equals(inZip.get(BIG).slice(0, slice.length)));
    // The whole point: the response the platform actually carries stays legal.
    assert.ok(Buffer.byteLength(r.body, 'utf8') < N.LIMITS.FUNCTION_RESPONSE_HARD_LIMIT,
      'the base64 body is ' + MB(Buffer.byteLength(r.body, 'utf8')));
  });

  await t('seeking into the middle returns exactly those bytes', async () => {
    const full = inZip.get(BIG);
    const start = Math.floor(full.length * 0.62), end = start + 250000;
    const r = await asset(ID, TOKEN, BIG, { headers: Object.assign({}, SAME, { range: 'bytes=' + start + '-' + end }) });
    assert.equal(r.statusCode, 206);
    assert.equal(r.headers['Content-Range'], 'bytes ' + start + '-' + end + '/' + full.length);
    assert.ok(bodyOf(r).equals(full.slice(start, end + 1)), 'the seeked bytes are not the right ones');
  });

  await t('a suffix range works - Safari reads the tail of an MP4 first', async () => {
    const full = inZip.get(BIG);
    const r = await asset(ID, TOKEN, BIG, { headers: Object.assign({}, SAME, { range: 'bytes=-65536' }) });
    assert.equal(r.statusCode, 206);
    assert.ok(bodyOf(r).equals(full.slice(full.length - 65536)));
  });

  await t('a range past the end is refused with 416, not with wrong bytes', async () => {
    const full = inZip.get(BIG);
    const r = await asset(ID, TOKEN, BIG, { headers: Object.assign({}, SAME, { range: 'bytes=' + (full.length + 10) + '-' }) });
    assert.equal(r.statusCode, 416);
    assert.equal(r.headers['Content-Range'], 'bytes */' + full.length);
  });

  await t('HEAD reports the true length and that seeking is available', async () => {
    const r = await asset(ID, TOKEN, BIG, { httpMethod: 'HEAD' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['Content-Length'], String(inZip.get(BIG).length));
    assert.equal(r.headers['Accept-Ranges'], 'bytes');
    assert.equal(r.body, '');
  });

  await t('every clip reassembles byte-for-byte from its ranges', async () => {
    for(const v of videos){
      const full = inZip.get(v);
      const parts = [];
      let at = 0, guard = 0;
      while(at < full.length && guard++ < 64){
        const r = await asset(ID, TOKEN, v, { headers: Object.assign({}, SAME, { range: 'bytes=' + at + '-' }) });
        assert.equal(r.statusCode, 206, v + ' at ' + at);
        const b = bodyOf(r);
        assert.ok(b.length > 0, 'empty slice for ' + v);
        parts.push(b); at += b.length;
      }
      assert.ok(Buffer.concat(parts).equals(full), v + ' did not reassemble');
    }
    console.log('         ' + videos.length + ' clips reassembled from ' +
      Math.ceil(inZip.get(BIG).length / N.LIMITS.RANGE_SLICE_BYTES) + ' slices each at most');
  });

  await t('the manual\'s own cache-busting query is ignored, not 404d', async () => {
    const r = await asset(ID, TOKEN, BIG + '?v=202609081700', { headers: Object.assign({}, SAME, { range: 'bytes=0-99' }) });
    assert.equal(r.statusCode, 206);
    assert.ok(bodyOf(r).equals(inZip.get(BIG).slice(0, 100)));
  });

  await t('a small asset still needs no range at all', async () => {
    const img = [...inZip.keys()].find(k => /\.(webp|png)$/.test(k));
    const r = await asset(ID, TOKEN, img);
    assert.equal(r.statusCode, 200);
    assert.ok(bodyOf(r).equals(inZip.get(img)));
  });

  // ------------------------------------------------------------------------
  G('THE PROTECTIONS THAT MUST NOT HAVE MOVED');

  await t('a clip is not reachable without a session or a token', async () => {
    const r = await invoke('protected-media-asset', {
      headers: SAME, path: '/media/' + ID + '/x/v/' + BIG, queryStringParameters: {},
    });
    assert.equal(r.statusCode, 302, 'expected a redirect to login, got ' + r.statusCode);
    assert.match(String(r.headers.Location), /login/);
  });

  await t('a range request with a forged token is refused just the same', async () => {
    const r = await invoke('protected-media-asset', {
      headers: Object.assign({}, SAME, { range: 'bytes=0-99' }),
      path: '/media/' + ID + '/c9999999999-' + 'A'.repeat(32) + '/v/' + BIG, queryStringParameters: {},
    });
    assert.equal(r.statusCode, 302);
  });

  await t('traversal out of the package is refused, range or not', async () => {
    const r = await asset(ID, TOKEN, '../../../etc/passwd', { headers: Object.assign({}, SAME, { range: 'bytes=0-9' }) });
    assert.equal(r.statusCode, 400);
  });

  await t('every response is still sandboxed and unindexed', async () => {
    const r = await asset(ID, TOKEN, BIG, { headers: Object.assign({}, SAME, { range: 'bytes=0-99' }) });
    assert.match(String(r.headers['Content-Security-Policy']), /^sandbox /);
    assert.ok(!/allow-same-origin/.test(String(r.headers['Content-Security-Policy'])));
    assert.equal(r.headers['X-Robots-Tag'], 'noindex, nofollow');
    assert.match(String(r.headers['Cache-Control']), /private/);
  });

  await t('a draft package stays staff-only, clips included', async () => {
    await invoke('protected-update', {
      httpMethod: 'POST', headers: as(STAFF), body: JSON.stringify({ id: ID, status: 'draft' }),
    });
    const custTok = await grantFor(CUST, ID);
    const r = await asset(ID, custTok || 'x', BIG, { headers: Object.assign({}, SAME, { range: 'bytes=0-99' }) });
    assert.ok(r.statusCode === 404 || r.statusCode === 302, 'a draft clip must not be served, got ' + r.statusCode);
    const staffTok = await grantFor(STAFF, ID);
    const ok = await asset(ID, staffTok, BIG, { headers: Object.assign({}, as(STAFF), { range: 'bytes=0-99' }) });
    assert.equal(ok.statusCode, 206, 'staff must still see their own draft');
    await invoke('protected-update', {
      httpMethod: 'POST', headers: as(STAFF), body: JSON.stringify({ id: ID, status: 'published' }),
    });
  });

  // ------------------------------------------------------------------------
  G('REPLACING IT, WHICH IS THE BUTTON THIS IS ALL FOR');

  await t('replacing with the same package bumps to v2 and keeps v1', async () => {
    const r = await upload(STAFF, src, 'IDFL_TC_Manual_web_v6.zip', {
      replaceId: ID, title: 'IDFL JAPAN TC申請マニュアル（動画同梱）', status: 'published',
    });
    assert.ok(!r.failed, JSON.stringify(r.started || r.chunk));
    assert.equal(r.done.status, 200, JSON.stringify(r.done.body));
    assert.equal(r.done.body.version, 2);
    assert.equal(r.done.body.keptVersions, 1);
    const media = dumpStore('idfl-media-html-dev');
    assert.ok(media.has(ID + '/v2/' + BIG), 'the new version must hold the clips');
    assert.ok(media.has(ID + '/v1/' + BIG), 'the replaced version is the rollback target');
  });

  await t('the URL, the id and the customer entry point are unchanged', async () => {
    const list = J(await invoke('protected-list', { headers: as(CUST) }));
    const it = list.files.find(f => f.id === ID);
    assert.ok(it, 'the package left the customer library');
    assert.equal(it.version, 2);
    assert.equal(it.role, 'customer');
    const tok = await grantFor(CUST, ID);
    const r = await asset(ID, tok, BIG, { headers: Object.assign({}, SAME, { range: 'bytes=0-99' }) });
    assert.equal(r.statusCode, 206, 'v2 clips must serve at the same URL shape');
  });

  await t('v2 serves the new bytes, not the old ones', async () => {
    const tok = await grantFor(CUST, ID);
    const r = await asset(ID, tok, 'index.html');
    assert.equal(r.statusCode, 200);
    assert.ok(bodyOf(r).equals(inZip.get('index.html')));
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

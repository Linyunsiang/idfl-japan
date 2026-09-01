// ============================================================
// End-to-end tests for the Media Library + feedback stack.
// Runs the real functions against the in-memory blob store in harness.mjs.
//
//   node tests/media-feedback/api.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import { setEnv, invoke, resetStores, dumpStore, storeNames, loadFn, ROOT } from './harness.mjs';
import { zipDir, makeZip } from './zip-writer.mjs';
import path from 'node:path';

const ENV = setEnv();
const F = loadFn('_feedback');
const PKG_DIR = process.env.IDFL_TEST_PKG || 'C:/Users/AldenLin/AppData/Local/Temp/claude/C--Users-AldenLin/28ad7c38-23a1-4aca-9a88-61f754d8c111/scratchpad/gots-pkg';

let pass = 0, fail = 0, group = '';
function G(n){ group = n; console.log('\n' + n); }
async function t(name, fn){
  try{ await fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.message)); fail++; }
}

// ------------------------------------------------------------------ helpers
const SAME_ORIGIN = { host: 'localhost', origin: 'http://localhost' };

function cookieOf(res){
  const raw = (res.headers && res.headers['Set-Cookie']) || '';
  return String(raw).split(';')[0];
}
// auth-login rate-limits per client IP and that state is module-level, so each
// caller gets its own address unless a test is deliberately exercising the limit.
let ipSeq = 0;
async function login(role, password, ip){
  const headers = Object.assign({}, SAME_ORIGIN, { 'x-nf-client-connection-ip': ip || ('10.0.0.' + (++ipSeq)) });
  const r = await invoke('auth-login', { httpMethod: 'POST', headers, body: JSON.stringify({ role, password }) });
  return { status: r.statusCode, body: JSON.parse(r.body), cookie: cookieOf(r) };
}
function as(cookie, extra){ return Object.assign({ cookie }, SAME_ORIGIN, extra || {}); }
function J(res){ try{ return JSON.parse(res.body); }catch(e){ return {}; } }

async function uploadPackage(cookie, zipBuf, over){
  const r = await invoke('protected-media-upload', {
    httpMethod: 'POST', headers: as(cookie),
    body: JSON.stringify(Object.assign({
      filename: 'gots-scope4-presentation.zip',
      contentBase64: zipBuf.toString('base64'),
      role: 'customer', status: 'published',
      title: 'GOTS Scope 4 意見交換会',
      description: 'GOTS 8.0 スコープ4 化学品承認の解説資料。',
      group: '2026 大阪セミナー',
    }, over || {})),
  });
  return { status: r.statusCode, body: J(r) };
}

async function submit(cookie, over){
  const r = await invoke('feedback-submit', {
    httpMethod: 'POST', headers: as(cookie),
    body: JSON.stringify(Object.assign({
      mediaId: 'x', mediaVersion: 1, type: 'question', message: 'テストの質問です。',
      token: 'AAAAAAAAAAAAAAAAAAAAAAAA',
      customer: { name: 'QA FIXTURE - NOT A REAL PERSON', email: 'qa-fixture-a@example.invalid', phone: '+81-00-0000-0000' },
    }, over || {})),
  });
  return { status: r.statusCode, body: J(r) };
}

// ==========================================================================
let CUST, STAFF, ZIP, MEDIA_ID;

G('AUTH');
resetStores();

await t('wrong customer password is rejected', async () => {
  const r = await login('customer', 'nope');
  assert.equal(r.status, 401);
  assert.ok(!r.cookie);
});

await t('correct customer password (CUSTOMER_ACCESS_PASSWORD) issues a session', async () => {
  const r = await login('customer', ENV.CUSTOMER_ACCESS_PASSWORD);
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'CUSTOMER');
  assert.ok(/^idfl_session=/.test(r.cookie));
  CUST = r.cookie;
});

await t('staff password issues a STAFF session', async () => {
  const r = await login('staff', 'harness-staff-password');
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'STAFF');
  STAFF = r.cookie;
});

await t('the customer password does not open a staff session', async () => {
  assert.equal((await login('staff', ENV.CUSTOMER_ACCESS_PASSWORD)).status, 401);
});

await t('auth-status reflects the session', async () => {
  assert.equal(J(await invoke('auth-status', { headers: as(CUST) })).role, 'CUSTOMER');
  assert.equal(J(await invoke('auth-status', { headers: as(STAFF) })).role, 'STAFF');
  assert.equal(J(await invoke('auth-status', { headers: SAME_ORIGIN })).role, 'PUBLIC');
});

await t('logout clears the cookie', async () => {
  const r = await invoke('auth-logout', { httpMethod: 'POST', headers: as(CUST) });
  assert.ok(/Max-Age=0/.test(r.headers['Set-Cookie']));
});

await t('an expired session is not accepted', async () => {
  const A = loadFn('_auth');
  const realNow = Date.now;
  Date.now = () => realNow() - 9 * 3600 * 1000;      // sign 9h ago; CUSTOMER TTL is 8h
  const stale = 'idfl_session=' + encodeURIComponent(A.sign('CUSTOMER'));
  Date.now = realNow;
  assert.equal(J(await invoke('auth-status', { headers: as(stale) })).role, 'PUBLIC');
});

await t('a tampered session signature is rejected', async () => {
  const bad = CUST.slice(0, -3) + 'AAA';
  assert.equal(J(await invoke('auth-status', { headers: as(bad) })).role, 'PUBLIC');
});

await t('login rate limiting locks out after repeated failures', async () => {
  const ip = '203.0.113.9';                       // its own address: the lockout is per IP
  for(let i = 0; i < 5; i++) await login('customer', 'wrong' + i, ip);
  const r = await login('customer', 'wrong-again', ip);
  assert.equal(r.status, 429);
  // ...and a different client is unaffected.
  assert.equal((await login('customer', ENV.CUSTOMER_ACCESS_PASSWORD)).status, 200);
});

await t('cross-origin login is refused (CSRF guard)', async () => {
  const r = await invoke('auth-login', {
    httpMethod: 'POST', headers: { host: 'localhost', origin: 'https://evil.example' },
    body: JSON.stringify({ role: 'customer', password: ENV.CUSTOMER_ACCESS_PASSWORD }),
  });
  assert.equal(r.statusCode, 403);
});

// ==========================================================================
G('MEDIA');
resetStores();
CUST = (await login('customer', ENV.CUSTOMER_ACCESS_PASSWORD)).cookie;
STAFF = (await login('staff', 'harness-staff-password')).cookie;
ZIP = await zipDir(PKG_DIR);

await t('a customer may not upload media', async () => {
  const r = await uploadPackage(CUST, ZIP);
  assert.equal(r.status, 403);
});

await t('staff uploads the GOTS package (14 assets, entry index.html)', async () => {
  const r = await uploadPackage(STAFF, ZIP);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.files, 14);
  assert.equal(r.body.entry, 'index.html');
  assert.equal(r.body.version, 1);
  MEDIA_ID = r.body.id;
});

await t('package bytes land in the media store, not the download store', async () => {
  const media = dumpStore('idfl-media-html-dev');
  assert.ok(media.has(MEDIA_ID + '/v1/index.html'));
  assert.ok(media.has(MEDIA_ID + '/v1/scripts/deck.js'));
  assert.ok(media.has(MEDIA_ID + '/v1/assets/idfl/idfl-logo.png'));
  const rec = dumpStore('idfl-protected');
  assert.equal([...rec.keys()].filter(k => k.indexOf('/') >= 0).length, 0, 'no asset keys in the download store');
});

await t('the record appears in protected-list with Media Library fields', async () => {
  const j = J(await invoke('protected-list', { headers: as(CUST) }));
  const it = j.files.find(f => f.id === MEDIA_ID);
  assert.ok(it, 'media missing from the customer list');
  assert.equal(it.mediaType, 'html');
  assert.equal(it.version, 1);
  assert.equal(it.entry, 'index.html');
  assert.equal(it.group, '2026 大阪セミナー');
  assert.ok(it.description.length > 0);
});

await t('existing download records still derive a media type', async () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n', 'ascii'), Buffer.alloc(400, 0x20)]);
  const up = await invoke('protected-upload', {
    httpMethod: 'POST', headers: as(STAFF),
    body: JSON.stringify({ filename: 'guide.pdf', contentBase64: pdf.toString('base64'), role: 'customer', title: 'ガイド', group: 'IDFL Guide' }),
  });
  assert.equal(up.statusCode, 200, up.body);
  const link = await invoke('protected-addlink', {
    httpMethod: 'POST', headers: as(STAFF),
    body: JSON.stringify({ url: 'https://example.com/deck', title: '外部資料', role: 'customer', group: 'IDFL Guide' }),
  });
  assert.equal(link.statusCode, 200, link.body);
  const j = J(await invoke('protected-list', { headers: as(CUST) }));
  assert.equal(j.files.find(f => f.title === 'ガイド').mediaType, 'pdf');
  assert.equal(j.files.find(f => f.title === '外部資料').mediaType, 'external');
});

await t('a grant token is issued to a customer and mounts the entry', async () => {
  const g = J(await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id: MEDIA_ID } }));
  assert.equal(g.ok, true);
  assert.equal(g.entry, 'index.html');
  const r = await invoke('protected-media-asset', { headers: SAME_ORIGIN, queryStringParameters: { id: MEDIA_ID, t: g.token, m: 'v', path: 'index.html' } });
  assert.equal(r.statusCode, 200);
  const html = Buffer.from(r.body, 'base64').toString('utf8');
  assert.ok(html.includes('styles/main.css'));
  assert.ok(html.includes('scripts/deck.js'));
  assert.ok(/sandbox/.test(r.headers['Content-Security-Policy']));
  assert.ok(!/allow-same-origin/.test(r.headers['Content-Security-Policy']));
});

await t('every relative asset the deck asks for resolves', async () => {
  const g = J(await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id: MEDIA_ID } }));
  const want = ['styles/main.css','styles/interactive.css','content/ja.js','content/en.js','content/zh-TW.js',
                'scripts/icons.js','scripts/motion.js','scripts/render.js','scripts/interact.js','scripts/deck.js',
                'assets/idfl/idfl-logo.png','assets/idfl/idfl-logo-white.png','assets/idfl/idfl-japan-qr.png'];
  for(const p of want){
    const r = await invoke('protected-media-asset', { headers: SAME_ORIGIN, queryStringParameters: { id: MEDIA_ID, t: g.token, m: 'v', path: p } });
    assert.equal(r.statusCode, 200, 'missing ' + p);
    assert.ok(Buffer.from(r.body, 'base64').length > 0, 'empty ' + p);
  }
});

await t('content types are correct per asset', async () => {
  const g = J(await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id: MEDIA_ID } }));
  const check = { 'styles/main.css': /text\/css/, 'scripts/deck.js': /javascript/, 'assets/idfl/idfl-logo.png': /image\/png/ };
  for(const p in check){
    const r = await invoke('protected-media-asset', { headers: SAME_ORIGIN, queryStringParameters: { id: MEDIA_ID, t: g.token, m: 'v', path: p } });
    assert.match(r.headers['Content-Type'], check[p]);
  }
});

await t('feedback mode injects the annotation agent into the entry only', async () => {
  const g = J(await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id: MEDIA_ID } }));
  const entry = await invoke('protected-media-asset', { headers: SAME_ORIGIN, queryStringParameters: { id: MEDIA_ID, t: g.token, m: 'f-abcdefgh1234', path: 'index.html' } });
  const html = Buffer.from(entry.body, 'base64').toString('utf8');
  assert.ok(html.includes('__idflfb'), 'agent not injected');
  assert.ok(html.lastIndexOf('__idflfb') > html.lastIndexOf('scripts/deck.js'), 'agent must come after the deck scripts');
  const plain = await invoke('protected-media-asset', { headers: SAME_ORIGIN, queryStringParameters: { id: MEDIA_ID, t: g.token, m: 'v', path: 'index.html' } });
  assert.ok(!Buffer.from(plain.body, 'base64').toString('utf8').includes('__idflfb'));
  const css = await invoke('protected-media-asset', { headers: SAME_ORIGIN, queryStringParameters: { id: MEDIA_ID, t: g.token, m: 'f-abcdefgh1234', path: 'styles/main.css' } });
  assert.ok(!Buffer.from(css.body, 'base64').toString('utf8').includes('__idflfb'));
});

await t('assets are unreachable with no session and no token', async () => {
  const r = await invoke('protected-media-asset', { headers: SAME_ORIGIN, queryStringParameters: { id: MEDIA_ID, t: '', m: 'v', path: 'index.html' } });
  assert.equal(r.statusCode, 302);
  assert.match(r.headers.Location, /^\/login\.html/);
});

await t('a forged or foreign grant token is refused', async () => {
  const g = J(await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id: MEDIA_ID } }));
  const forged = g.token.slice(0, -4) + 'AAAA';
  let r = await invoke('protected-media-asset', { headers: SAME_ORIGIN, queryStringParameters: { id: MEDIA_ID, t: forged, m: 'v', path: 'index.html' } });
  assert.equal(r.statusCode, 302);
  // A token minted for another media id must not unlock this one.
  const other = (await uploadPackage(STAFF, ZIP, { title: 'other' })).body.id;
  const g2 = J(await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id: other } }));
  r = await invoke('protected-media-asset', { headers: SAME_ORIGIN, queryStringParameters: { id: MEDIA_ID, t: g2.token, m: 'v', path: 'index.html' } });
  assert.equal(r.statusCode, 302);
});

await t('path traversal out of the package is refused', async () => {
  const g = J(await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id: MEDIA_ID } }));
  for(const p of ['../../netlify/functions/_auth.js', '..%2f..%2fadmin.html', '/etc/passwd', 'a/../../b']){
    const r = await invoke('protected-media-asset', { headers: SAME_ORIGIN, queryStringParameters: { id: MEDIA_ID, t: g.token, m: 'v', path: p } });
    assert.ok(r.statusCode === 400 || r.statusCode === 404, p + ' returned ' + r.statusCode);
  }
});

await t('a draft presentation is staff-only end to end', async () => {
  const up = await uploadPackage(STAFF, ZIP, { title: '下書きデッキ', status: 'draft' });
  const id = up.body.id;
  assert.ok(!J(await invoke('protected-list', { headers: as(CUST) })).files.some(f => f.id === id), 'draft leaked to the customer list');
  assert.ok(J(await invoke('protected-list', { headers: as(STAFF) })).files.some(f => f.id === id), 'draft missing from the staff list');
  assert.equal((await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id } })).statusCode, 404);
  const g = J(await invoke('media-grant', { headers: as(STAFF), queryStringParameters: { id } }));
  assert.equal(g.ok, true);
  // Even a valid staff-minted grant must not serve a draft to a customer session.
  const r = await invoke('protected-media-asset', { headers: as(CUST), queryStringParameters: { id, t: '', m: 'v', path: 'index.html' } });
  assert.equal(r.statusCode, 404);
});

await t('a staff-only presentation is hidden from customers', async () => {
  const up = await uploadPackage(STAFF, ZIP, { title: '社内用', role: 'staff', status: 'published' });
  const id = up.body.id;
  assert.ok(!J(await invoke('protected-list', { headers: as(CUST) })).files.some(f => f.id === id));
  assert.equal((await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id } })).statusCode, 403);
});

await t('replacing a package bumps the version and retires the old bytes', async () => {
  const before = dumpStore('idfl-media-html-dev').size;
  const r = await uploadPackage(STAFF, ZIP, { replaceId: MEDIA_ID, title: 'GOTS Scope 4 意見交換会' });
  assert.equal(r.status, 200);
  assert.equal(r.body.version, 2);
  const media = dumpStore('idfl-media-html-dev');
  assert.ok(media.has(MEDIA_ID + '/v2/index.html'));
  assert.ok(!media.has(MEDIA_ID + '/v1/index.html'), 'v1 bytes were not cleaned up');
  assert.equal(media.size, before, 'asset count should be stable after a replace');
  const it = J(await invoke('protected-list', { headers: as(CUST) })).files.find(f => f.id === MEDIA_ID);
  assert.equal(it.version, 2);
});

await t('a standalone .html presentation is accepted', async () => {
  const html = Buffer.from('<!doctype html><html><body><h1>Standalone</h1></body></html>', 'utf8');
  const r = await invoke('protected-media-upload', {
    httpMethod: 'POST', headers: as(STAFF),
    body: JSON.stringify({ filename: 'solo.html', contentBase64: html.toString('base64'), role: 'customer', status: 'published', title: '単体HTML' }),
  });
  assert.equal(r.statusCode, 200, r.body);
  const b = J(r);
  assert.equal(b.files, 1);
  const g = J(await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id: b.id } }));
  const got = await invoke('protected-media-asset', { headers: SAME_ORIGIN, queryStringParameters: { id: b.id, t: g.token, m: 'v', path: 'index.html' } });
  assert.ok(Buffer.from(got.body, 'base64').toString('utf8').includes('Standalone'));
});

await t('a zip with no HTML is refused', async () => {
  const r = await uploadPackage(STAFF, makeZip([{ path: 'a.css', data: 'body{}' }]));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /HTML/);
});

await t('a non-zip, non-html upload is refused', async () => {
  const r = await uploadPackage(STAFF, Buffer.from('hello'), { filename: 'notes.txt' });
  assert.equal(r.status, 400);
});

await t('deleting a presentation removes its assets too', async () => {
  const up = await uploadPackage(STAFF, ZIP, { title: '削除テスト' });
  const id = up.body.id;
  assert.ok(dumpStore('idfl-media-html-dev').has(id + '/v1/index.html'));
  const d = await invoke('protected-delete', { httpMethod: 'POST', headers: as(STAFF), body: JSON.stringify({ id }) });
  assert.equal(d.statusCode, 200);
  assert.equal(J(d).assetsRemoved, 14);
  assert.ok(!dumpStore('idfl-media-html-dev').has(id + '/v1/index.html'));
});

await t('a customer cannot delete media', async () => {
  const r = await invoke('protected-delete', { httpMethod: 'POST', headers: as(CUST), body: JSON.stringify({ id: MEDIA_ID }) });
  assert.equal(r.statusCode, 403);
});

// ==========================================================================
G('FEEDBACK');
F._resetRateLimit();
const TOK_A = 'AAAAAAAAAAAAAAAAAAAAAAAA';
const TOK_B = 'BBBBBBBBBBBBBBBBBBBBBBBB';
const ANCHOR = { selector: 'body > main:nth-of-type(1) > h1:nth-of-type(1)', textQuote: 'GOTS 8.0 スコープ4', position: { x: .1, y: .2, w: .5, h: .1 }, section: '3 / 25 · 化学品承認' };

await t('a question is saved and echoed back without personal data', async () => {
  F._resetRateLimit();
  const r = await submit(CUST, { mediaId: MEDIA_ID, mediaVersion: 2, type: 'question', message: '対象範囲について質問です。', anchor: ANCHOR, token: TOK_A });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.saved, true);
  assert.equal(r.body.feedback.type, 'question');
  assert.equal(r.body.feedback.mine, true);
  assert.equal(r.body.feedback.customer, undefined);
  assert.equal(r.body.feedback.token, undefined);
});

await t('comment and correction types are accepted', async () => {
  F._resetRateLimit();
  let r = await submit(CUST, { mediaId: MEDIA_ID, type: 'comment', message: '補足コメントです。', anchor: ANCHOR, token: TOK_A });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  F._resetRateLimit();
  r = await submit(CUST, { mediaId: MEDIA_ID, type: 'correction', message: 'ここを修正してください。', anchor: ANCHOR, token: TOK_A });
  assert.equal(r.status, 200);
  assert.equal(r.body.feedback.seq, 3);
});

await t('an unknown feedback type is rejected', async () => {
  F._resetRateLimit();
  assert.equal((await submit(CUST, { mediaId: MEDIA_ID, type: 'praise', token: TOK_A })).status, 400);
});

await t('contact fields are validated', async () => {
  for(const [over, why] of [
    [{ customer: { name: '', email: 'qa-fixture-a@example.invalid', phone: '+81-00-0000-0000' } }, 'name'],
    [{ customer: { name: 'T', email: 'not-an-email', phone: '+81-00-0000-0000' } }, 'email'],
    [{ customer: { name: 'T', email: 'a@b.co', phone: '12' } }, 'phone'],
  ]){
    F._resetRateLimit();
    const r = await submit(CUST, Object.assign({ mediaId: MEDIA_ID, token: TOK_A }, over));
    assert.equal(r.status, 400, why + ' should be rejected');
  }
});

await t('an empty message is rejected', async () => {
  F._resetRateLimit();
  assert.equal((await submit(CUST, { mediaId: MEDIA_ID, message: '', token: TOK_A })).status, 400);
});

await t('an oversized payload is rejected before parsing', async () => {
  F._resetRateLimit();
  const r = await invoke('feedback-submit', { httpMethod: 'POST', headers: as(CUST), body: 'x'.repeat(40 * 1024) });
  assert.equal(r.statusCode, 413);
});

await t('feedback on a nonexistent media id is refused', async () => {
  F._resetRateLimit();
  assert.equal((await submit(CUST, { mediaId: 'doesnotexist', token: TOK_A })).status, 404);
});

await t('an unauthenticated caller cannot submit feedback', async () => {
  F._resetRateLimit();
  const r = await invoke('feedback-submit', { httpMethod: 'POST', headers: SAME_ORIGIN, body: JSON.stringify({ mediaId: MEDIA_ID }) });
  assert.equal(r.statusCode, 401);
});

await t('cross-origin submission is refused (CSRF guard)', async () => {
  F._resetRateLimit();
  const r = await invoke('feedback-submit', {
    httpMethod: 'POST', headers: { cookie: CUST, host: 'localhost', origin: 'https://evil.example' },
    body: JSON.stringify({ mediaId: MEDIA_ID }),
  });
  assert.equal(r.statusCode, 403);
});

await t('rapid repeat submissions are rate limited', async () => {
  F._resetRateLimit();
  const a = await submit(CUST, { mediaId: MEDIA_ID, message: '一件目', token: TOK_A });
  assert.equal(a.status, 200);
  const b = await submit(CUST, { mediaId: MEDIA_ID, message: '二件目', token: TOK_A });
  assert.equal(b.status, 429);
});

await t('a client cannot set status, reply, internal note or public flag', async () => {
  F._resetRateLimit();
  const r = await submit(CUST, {
    mediaId: MEDIA_ID, message: '権限昇格の試み', token: TOK_A,
    status: 'resolved', staffReply: 'fake reply', internalNote: 'fake note', publicVisible: true, seq: 999,
  });
  assert.equal(r.status, 200);
  const all = J(await invoke('feedback-list', { headers: as(STAFF), queryStringParameters: { scope: 'all' } })).items;
  const rec = all.find(x => x.message === '権限昇格の試み');
  assert.equal(rec.status, 'new');
  assert.equal(rec.staffReply, '');
  assert.equal(rec.internalNote, '');
  assert.equal(rec.publicVisible, false);
  assert.notEqual(rec.seq, 999);
});

await t('timestamps are generated server-side', async () => {
  F._resetRateLimit();
  await submit(CUST, { mediaId: MEDIA_ID, message: '時刻の確認', token: TOK_A, createdAt: '1999-01-01T00:00:00+09:00' });
  const all = J(await invoke('feedback-list', { headers: as(STAFF), queryStringParameters: { scope: 'all' } })).items;
  const rec = all.find(x => x.message === '時刻の確認');
  assert.ok(!String(rec.createdAt).startsWith('1999'));
});

await t('a customer sees only their own items, never another customer\'s', async () => {
  F._resetRateLimit();
  await submit(CUST, { mediaId: MEDIA_ID, message: 'B社からの質問', token: TOK_B, customer: { name: 'QA FIXTURE B - NOT A REAL PERSON', email: 'qa-fixture-b@example.invalid', phone: '+81-00-0000-0001' } });
  const mine = J(await invoke('feedback-list', { headers: as(CUST), queryStringParameters: { mediaId: MEDIA_ID, token: TOK_A } })).items;
  assert.ok(mine.length > 0);
  assert.ok(!mine.some(x => x.message === 'B社からの質問'), 'another customer\'s feedback leaked');
  const raw = JSON.stringify(mine);
  for(const secret of ['qa-fixture-b@example.invalid', 'QA FIXTURE B - NOT A REAL PERSON', '+81-00-0000-0001', TOK_A, TOK_B]){
    assert.ok(raw.indexOf(secret) < 0, 'leaked ' + secret);
  }
});

await t('an empty or wrong token yields no feedback at all', async () => {
  const none = J(await invoke('feedback-list', { headers: as(CUST), queryStringParameters: { mediaId: MEDIA_ID, token: 'ZZZZZZZZZZZZZZZZZZZZZZZZ' } })).items;
  assert.equal(none.length, 0);
});

await t('a customer cannot request the whole feedback table', async () => {
  const r = await invoke('feedback-list', { headers: as(CUST), queryStringParameters: { scope: 'all' } });
  assert.equal(r.statusCode, 403);
});

await t('an unauthenticated caller cannot list feedback', async () => {
  assert.equal((await invoke('feedback-list', { headers: SAME_ORIGIN, queryStringParameters: { mediaId: MEDIA_ID } })).statusCode, 401);
});

await t('staff see every record with the contact details', async () => {
  const all = J(await invoke('feedback-list', { headers: as(STAFF), queryStringParameters: { scope: 'all' } })).items;
  const b = all.find(x => x.message === 'B社からの質問');
  assert.equal(b.customer.email, 'qa-fixture-b@example.invalid');
  assert.equal(b.mediaTitle, 'GOTS Scope 4 意見交換会');
  assert.ok(b.anchor === null || typeof b.anchor === 'object');
});

let TARGET;
await t('staff can reply and change status', async () => {
  const all = J(await invoke('feedback-list', { headers: as(STAFF), queryStringParameters: { scope: 'all' } })).items;
  TARGET = all.find(x => x.message === '対象範囲について質問です。');
  const r = await invoke('feedback-manage', {
    httpMethod: 'POST', headers: as(STAFF),
    body: JSON.stringify({ action: 'update', id: TARGET.key, status: 'in_progress', staffReply: '確認のうえご連絡します。', internalNote: '担当: 大阪' }),
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(J(r).item.status, 'in_progress');
});

await t('the owner sees the reply but never the internal note', async () => {
  const mine = J(await invoke('feedback-list', { headers: as(CUST), queryStringParameters: { mediaId: MEDIA_ID, token: TOK_A } })).items;
  const it = mine.find(x => x.message === '対象範囲について質問です。');
  assert.equal(it.staffReply, '確認のうえご連絡します。');
  assert.equal(it.statusLabel, '確認中');
  assert.equal(it.internalNote, undefined);
  assert.ok(JSON.stringify(mine).indexOf('担当: 大阪') < 0, 'internal note leaked to the customer');
});

await t('resolving stamps resolvedAt and shows the customer 対応済み', async () => {
  await invoke('feedback-manage', { httpMethod: 'POST', headers: as(STAFF), body: JSON.stringify({ action: 'update', id: TARGET.key, status: 'resolved' }) });
  const staffItem = J(await invoke('feedback-list', { headers: as(STAFF), queryStringParameters: { scope: 'all' } })).items.find(x => x.key === TARGET.key);
  assert.equal(staffItem.status, 'resolved');
  assert.ok(staffItem.resolvedAt);
  const mine = J(await invoke('feedback-list', { headers: as(CUST), queryStringParameters: { mediaId: MEDIA_ID, token: TOK_A } })).items;
  assert.equal(mine.find(x => x.key === TARGET.key || x.message === '対象範囲について質問です。').statusLabel, '対応済み');
});

await t('publishing an item shares it with other customers, still anonymously', async () => {
  await invoke('feedback-manage', { httpMethod: 'POST', headers: as(STAFF), body: JSON.stringify({ action: 'update', id: TARGET.key, publicVisible: true }) });
  const other = J(await invoke('feedback-list', { headers: as(CUST), queryStringParameters: { mediaId: MEDIA_ID, token: TOK_B } })).items;
  const shared = other.find(x => x.message === '対象範囲について質問です。');
  assert.ok(shared, 'published item not visible to the other customer');
  assert.equal(shared.mine, false);
  assert.equal(shared.customer, undefined);
  assert.ok(JSON.stringify(other).indexOf('QA FIXTURE') < 0);
});

await t('a customer cannot call the staff management API', async () => {
  const r = await invoke('feedback-manage', { httpMethod: 'POST', headers: as(CUST), body: JSON.stringify({ action: 'update', id: TARGET.key, status: 'dismissed' }) });
  assert.equal(r.statusCode, 403);
});

await t('an unauthenticated caller cannot call the staff management API', async () => {
  const r = await invoke('feedback-manage', { httpMethod: 'POST', headers: SAME_ORIGIN, body: JSON.stringify({ action: 'delete', id: TARGET.key }) });
  assert.equal(r.statusCode, 403);
});

await t('management rejects a key outside the feedback namespace', async () => {
  const r = await invoke('feedback-manage', { httpMethod: 'POST', headers: as(STAFF), body: JSON.stringify({ action: 'delete', id: '__order__' }) });
  assert.ok(r.statusCode === 400 || r.statusCode === 404);
});

await t('staff can delete a record', async () => {
  const r = await invoke('feedback-manage', { httpMethod: 'POST', headers: as(STAFF), body: JSON.stringify({ action: 'delete', id: TARGET.key }) });
  assert.equal(r.statusCode, 200);
  assert.ok(!J(await invoke('feedback-list', { headers: as(STAFF), queryStringParameters: { scope: 'all' } })).items.some(x => x.key === TARGET.key));
});

await t('feedback survives a version replace and remembers its version', async () => {
  F._resetRateLimit();
  await submit(CUST, { mediaId: MEDIA_ID, mediaVersion: 2, message: 'v2 へのコメント', token: TOK_A });
  const before = J(await invoke('feedback-list', { headers: as(STAFF), queryStringParameters: { mediaId: MEDIA_ID } })).items.length;
  const up = await uploadPackage(STAFF, ZIP, { replaceId: MEDIA_ID });
  assert.equal(up.body.version, 3);
  const after = J(await invoke('feedback-list', { headers: as(STAFF), queryStringParameters: { mediaId: MEDIA_ID } })).items;
  assert.equal(after.length, before, 'feedback was lost on replace');
  assert.equal(after.find(x => x.message === 'v2 へのコメント').mediaVersion, 2);
});

// ==========================================================================
G('SECURITY');

await t('an XSS payload is stored verbatim and never as markup', async () => {
  F._resetRateLimit();
  const payload = '<img src=x onerror=alert(1)><script>alert(2)</' + 'script>';
  const r = await submit(CUST, { mediaId: MEDIA_ID, message: payload, token: TOK_A, customer: { name: '<b>QA FIXTURE - NOT A REAL PERSON</b>', email: 'qa-fixture-a@example.invalid', phone: '+81-00-0000-0000' } });
  assert.equal(r.status, 200);
  const rec = J(await invoke('feedback-list', { headers: as(STAFF), queryStringParameters: { scope: 'all' } })).items.find(x => x.message === payload);
  assert.ok(rec, 'payload should round-trip as plain text');
  assert.equal(F.esc(rec.message).indexOf('<'), -1, 'esc() must neutralise it for rendering');
  assert.equal(F.esc(rec.customer.name), '&lt;b&gt;QA FIXTURE - NOT A REAL PERSON&lt;/b&gt;');
});

await t('an anchor is reduced to plain strings, never markup', async () => {
  F._resetRateLimit();
  await submit(CUST, {
    mediaId: MEDIA_ID, message: 'アンカー検証', token: TOK_A,
    anchor: { selector: '<script>x</' + 'script>', textQuote: 'ok', position: { x: 99, y: -5, w: 'nope', h: .3 }, section: 'a', extra: 'dropped' },
  });
  const rec = J(await invoke('feedback-list', { headers: as(STAFF), queryStringParameters: { scope: 'all' } })).items.find(x => x.message === 'アンカー検証');
  assert.equal(rec.anchor.extra, undefined);
  assert.equal(rec.anchor.position.x, 1);
  assert.equal(rec.anchor.position.y, 0);
  assert.equal(rec.anchor.position.w, 0);
  assert.equal(typeof rec.anchor.selector, 'string');
});

await t('a javascript: URL cannot be stored as an external resource', async () => {
  const r = await invoke('protected-addlink', {
    httpMethod: 'POST', headers: as(STAFF),
    body: JSON.stringify({ url: 'javascript:alert(1)', title: 'bad', role: 'customer' }),
  });
  assert.equal(r.statusCode, 400);
  const r2 = await invoke('protected-addlink', {
    httpMethod: 'POST', headers: as(STAFF),
    body: JSON.stringify({ url: 'http://insecure.example', title: 'bad', role: 'customer' }),
  });
  assert.equal(r2.statusCode, 400);
});

await t('control characters cannot be smuggled into a mail subject', async () => {
  const N = loadFn('_notify');
  const subj = N.buildSubject({ type: 'question', mediaId: 'x' }, 'Deck\r\nBcc: attacker@example.com');
  assert.equal(subj.indexOf('\n'), -1);
  assert.equal(subj.indexOf('\r'), -1);
});

await t('personal data lives only in the private feedback store', async () => {
  const names = storeNames();
  assert.ok(names.indexOf('idfl-feedback-dev') >= 0);
  const publicish = names.filter(n => n !== 'idfl-feedback-dev');
  for(const n of publicish){
    const dump = JSON.stringify([...dumpStore(n).entries()].map(([k, v]) => [k, v.metadata, v.buf.toString('utf8').slice(0, 4000)]));
    for(const secret of ['qa-fixture-a@example.invalid', 'qa-fixture-b@example.invalid', '+81-00-0000-0000', 'QA FIXTURE']){
      assert.ok(dump.indexOf(secret) < 0, secret + ' found in store ' + n);
    }
  }
});

await t('the preview context uses different stores from production', async () => {
  const S = loadFn('_stores');
  const saved = { c: process.env.CONTEXT, r: process.env.REVIEW_ID };
  process.env.CONTEXT = 'production'; delete process.env.REVIEW_ID;
  assert.equal(S.feedbackStoreName(), 'idfl-feedback');
  process.env.CONTEXT = 'deploy-preview'; process.env.REVIEW_ID = '7';
  assert.equal(S.feedbackStoreName(), 'idfl-feedback-dp-7');
  assert.equal(S.mediaStoreName(), 'idfl-media-html-dp-7');
  assert.equal(S.PROTECTED_STORE, 'idfl-protected');
  process.env.CONTEXT = saved.c; if(saved.r) process.env.REVIEW_ID = saved.r; else delete process.env.REVIEW_ID;
});

// ==========================================================================
G('EMAIL');

await t('with no provider configured, feedback still saves', async () => {
  F._resetRateLimit();
  const r = await submit(CUST, { mediaId: MEDIA_ID, message: 'メール未設定の確認', token: TOK_A });
  assert.equal(r.status, 200);
  assert.equal(r.body.saved, true);
  assert.equal(r.body.notificationSent, false);
  assert.equal(r.body.notificationReason, 'not_configured');
});

await t('with a provider configured, a notification is sent', async () => {
  F._resetRateLimit();
  const realFetch = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, json: async () => ({ id: 'mail_test_1' }) }; };
  Object.assign(process.env, { RESEND_API_KEY: 'test_key_not_real', FEEDBACK_NOTIFY_TO: 'ops@example.com', FEEDBACK_FROM: 'IDFL <noreply@example.com>' });
  try{
    const r = await submit(CUST, { mediaId: MEDIA_ID, type: 'correction', message: '数値の修正をお願いします。', anchor: ANCHOR, token: TOK_A });
    assert.equal(r.status, 200);
    assert.equal(r.body.notificationSent, true);
    assert.equal(seen.url, 'https://api.resend.com/emails');
    const body = JSON.parse(seen.opts.body);
    assert.match(body.subject, /^\[IDFL Media Feedback\] GOTS Scope 4 意見交換会 – 修正依頼$/);
    assert.match(body.text, /GOTS Scope 4 意見交換会/);
    assert.match(body.text, /修正依頼/);
    assert.match(body.text, /化学品承認/);            // the anchor's section
    // Plain substring checks: the fixture contact details contain regex
    // metacharacters, and what matters is that they reach the notification.
    assert.ok(body.text.includes('QA FIXTURE - NOT A REAL PERSON'), 'name missing from the mail');
    assert.ok(body.text.includes('qa-fixture-a@example.invalid'), 'e-mail missing from the mail');
    assert.ok(body.text.includes('+81-00-0000-0000'), 'phone missing from the mail');
    assert.match(body.text, /数値の修正をお願いします。/);
    assert.match(body.text, /\/admin$/m);
    assert.equal(seen.opts.headers.Authorization, 'Bearer test_key_not_real');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY; delete process.env.FEEDBACK_NOTIFY_TO; delete process.env.FEEDBACK_FROM;
  }
});

await t('a provider failure does not lose the feedback', async () => {
  F._resetRateLimit();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  Object.assign(process.env, { RESEND_API_KEY: 'test_key_not_real', FEEDBACK_NOTIFY_TO: 'ops@example.com', FEEDBACK_FROM: 'IDFL <noreply@example.com>' });
  try{
    const r = await submit(CUST, { mediaId: MEDIA_ID, message: 'メール障害時の保存確認', token: TOK_A });
    assert.equal(r.status, 200);
    assert.equal(r.body.saved, true);
    assert.equal(r.body.notificationSent, false);
    const all = J(await invoke('feedback-list', { headers: as(STAFF), queryStringParameters: { scope: 'all' } })).items;
    assert.ok(all.some(x => x.message === 'メール障害時の保存確認'), 'feedback lost when mail failed');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY; delete process.env.FEEDBACK_NOTIFY_TO; delete process.env.FEEDBACK_FROM;
  }
});

// ==========================================================================
G('REGRESSION - existing customer downloads');

await t('protected-list still returns the original fields', async () => {
  const j = J(await invoke('protected-list', { headers: as(CUST) }));
  const pdf = j.files.find(f => f.title === 'ガイド');
  for(const k of ['id','kind','name','title','group','role','status','sizeLabel','contentType','uploadedAt','updatedAt']){
    assert.ok(k in pdf, 'missing legacy field ' + k);
  }
  assert.equal(pdf.kind, 'file');
});

await t('a protected file still downloads as an attachment', async () => {
  const j = J(await invoke('protected-list', { headers: as(CUST) }));
  const pdf = j.files.find(f => f.title === 'ガイド');
  const r = await invoke('protected-file', { headers: as(CUST), queryStringParameters: { id: pdf.id } });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['Content-Disposition'], /^attachment/);
  assert.equal(r.headers['Content-Type'], 'application/pdf');
});

await t('an external link still redirects', async () => {
  const j = J(await invoke('protected-list', { headers: as(CUST) }));
  const link = j.files.find(f => f.title === '外部資料');
  const r = await invoke('protected-file', { headers: as(CUST), queryStringParameters: { id: link.id } });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.Location, 'https://example.com/deck');
});

await t('an image can be served inline for a thumbnail, other types cannot', async () => {
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(200)]);
  const up = J(await invoke('protected-upload', {
    httpMethod: 'POST', headers: as(STAFF),
    body: JSON.stringify({ filename: 'thumb.png', contentBase64: png.toString('base64'), role: 'customer', title: 'サムネイル' }),
  }));
  const img = await invoke('protected-file', { headers: as(CUST), queryStringParameters: { id: up.id, inline: '1' } });
  assert.match(img.headers['Content-Disposition'], /^inline/);
  const j = J(await invoke('protected-list', { headers: as(CUST) }));
  const pdf = j.files.find(f => f.title === 'ガイド');
  const notImg = await invoke('protected-file', { headers: as(CUST), queryStringParameters: { id: pdf.id, inline: '1' } });
  assert.match(notImg.headers['Content-Disposition'], /^attachment/, 'inline must be images-only');
});

await t('an unauthenticated download still redirects to login', async () => {
  const j = J(await invoke('protected-list', { headers: as(CUST) }));
  const pdf = j.files.find(f => f.title === 'ガイド');
  const r = await invoke('protected-file', { headers: SAME_ORIGIN, queryStringParameters: { id: pdf.id } });
  assert.equal(r.statusCode, 302);
  assert.match(r.headers.Location, /login\.html/);
});

await t('reorder and metadata edit still work', async () => {
  const j = J(await invoke('protected-list', { headers: as(STAFF) }));
  const ids = j.files.map(f => f.id);
  const r = await invoke('protected-update', { httpMethod: 'POST', headers: as(STAFF), body: JSON.stringify({ orderIds: ids.slice().reverse() }) });
  assert.equal(r.statusCode, 200);
  const pdf = j.files.find(f => f.title === 'ガイド');
  const e = await invoke('protected-update', { httpMethod: 'POST', headers: as(STAFF), body: JSON.stringify({ id: pdf.id, title: 'ガイド 改', description: '説明を追加', status: 'draft' }) });
  assert.equal(e.statusCode, 200);
  const after = J(await invoke('protected-list', { headers: as(STAFF) })).files.find(f => f.id === pdf.id);
  assert.equal(after.title, 'ガイド 改');
  assert.equal(after.description, '説明を追加');
  assert.equal(after.status, 'draft');
  assert.ok(!J(await invoke('protected-list', { headers: as(CUST) })).files.some(f => f.id === pdf.id), 'draft still visible to the customer');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

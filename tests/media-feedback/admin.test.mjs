// ============================================================
// Admin console tests: the real /admin page, its real inline JavaScript, and
// the real functions behind it, over real HTTP.
//
// Covers the two new tabs (メディアライブラリ / メディアフィードバック) and checks
// that the tabs that were already there still work.
//
// Needs jsdom:  npm install --no-save jsdom
//   node tests/media-feedback/admin.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer, setEnv, invoke, ROOT, setReadStale } from './harness.mjs';
import { seedAll } from './seed.mjs';

const require_ = createRequire(import.meta.url);
let JSDOM;
try{ ({ JSDOM } = require_('jsdom')); }
catch(e){
  console.log('admin tests skipped: jsdom is not installed (npm install --no-save jsdom)');
  process.exit(0);
}

const PKG = process.env.IDFL_TEST_PKG || 'C:/Users/AldenLin/AppData/Local/Temp/claude/C--Users-AldenLin/28ad7c38-23a1-4aca-9a88-61f754d8c111/scratchpad/gots-pkg';
const ENV = setEnv();

let pass = 0, fail = 0;
async function t(name, fn){
  try{ await fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.message)); fail++; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/** Let the page's in-flight fetch chains settle. */
const settle = async (n = 12) => { for(let i = 0; i < n; i++) await sleep(25); };

// --------------------------------------------------------------------------
const seeded = await seedAll(PKG);
const server = createServer();
await new Promise(res => server.listen(0, res));
const PORT = server.address().port;
const BASE = 'http://localhost:' + PORT;

// One shared cookie jar, so the page behaves like a real browser session.
const jar = new Map();
function cookieHeader(){ return [...jar.entries()].map(([k, v]) => k + '=' + v).join('; '); }
function absorb(res){
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for(const c of set){
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    const k = pair.slice(0, i), v = pair.slice(i + 1);
    if(/Max-Age=0/i.test(c)) jar.delete(k); else jar.set(k, v);
  }
}

async function loadAdmin(){
  const html = await (await fetch(BASE + '/admin')).text();
  const dom = new JSDOM(html, {
    url: BASE + '/admin',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w){
      w.fetch = async (url, opts) => {
        const abs = String(url).startsWith('http') ? String(url) : BASE + url;
        const o = Object.assign({}, opts);
        o.headers = Object.assign({ Origin: BASE, cookie: cookieHeader() }, (opts && opts.headers) || {});
        const res = await fetch(abs, o);
        absorb(res);
        return res;
      };
      // The console uses XHR for uploads with progress; the tests here do not
      // exercise upload, but the constructor must exist for the page to load.
      w.XMLHttpRequest = class { open(){} setRequestHeader(){} send(){} };
      w.confirm = () => true;
      w.alert = () => {};
      w.scrollTo = () => {};
    },
  });
  await settle();
  return dom;
}

console.log('admin console (real page, real functions, real HTTP)');

const dom = await loadAdmin();
const w = dom.window, d = w.document;
const $ = (s) => d.querySelector(s);
const txt = (s) => (($(s) || {}).textContent || '').replace(/\s+/g, ' ').trim();

await t('the console gate rejects a wrong password', async () => {
  $('#pw').value = 'not-the-password';
  await w.doLogin();
  await settle();
  assert.ok(txt('#loginErr').length > 0, 'expected an error message');
  assert.notEqual($('#app').style.display, 'block');
});

await t('the console opens with the admin password', async () => {
  $('#pw').value = ENV.ADMIN_PASSWORD;
  await w.doLogin();
  await settle();
  assert.equal($('#app').style.display, 'block');
});

await t('every pre-existing tab is still registered', async () => {
  const labels = [...d.querySelectorAll('.tab')].map(t => t.textContent.replace(/\s+/g, ' ').trim());
  for(const need of ['お知らせ', '展示会・セミナー', '資料ダウンロード', '認証工場・企業', 'よくある質問', 'ファイル管理', 'ダウンロード資料管理']){
    assert.ok(labels.some(l => l.indexOf(need) >= 0), 'lost tab: ' + need + ' (have: ' + labels.join(' | ') + ')');
  }
});

await t('the two new tabs are added, not substituted', async () => {
  const keys = [...d.querySelectorAll('.tab')].map(t => t.dataset.k);
  assert.ok(keys.indexOf('media') >= 0, 'メディアライブラリ tab missing');
  assert.ok(keys.indexOf('feedback') >= 0, 'フィードバック tab missing');
  assert.ok(keys.indexOf('protected') >= 0, 'the existing protected tab must remain');
  assert.equal(keys.length, 9);
});

await t('an existing tab still loads its data', async () => {
  await w.switchTab('news');
  await settle();
  assert.equal($('#genericPanel').style.display, '');
  assert.equal($('#mediaPanel').style.display, 'none');
  assert.ok(txt('#count').length > 0, 'news tab rendered no count');
});

// ---------------------------------------------------------------- media tab
await t('the media tab is gated behind staff authentication', async () => {
  await w.switchTab('media');
  await settle();
  assert.equal($('#mediaPanel').style.display, '');
  assert.equal($('#mGate').style.display, 'block', 'staff gate should be visible');
  assert.equal($('#mMain').style.display, 'none', 'management UI must stay hidden');
});

await t('a wrong staff password is refused with a message', async () => {
  $('#mPw').value = 'wrong-staff-password';
  w.mLogin();
  await settle(20);
  assert.ok(txt('#mGateErr').length > 0, 'expected an error');
  assert.equal($('#mMain').style.display, 'none');
});

await t('the staff password opens the media library', async () => {
  $('#mPw').value = ENV.STAFF_ACCESS_PASSWORD;
  w.mLogin();
  await settle(30);
  assert.equal($('#mGate').style.display, 'none');
  assert.equal($('#mMain').style.display, 'block');
});

await t('every media record is listed, drafts included', async () => {
  const rows = [...d.querySelectorAll('.mrow')];
  assert.ok(rows.length >= 4, 'expected the seeded records, got ' + rows.length);
  const titles = rows.map(r => r.querySelector('.pttl').textContent);
  assert.ok(titles.some(t => t.indexOf('GOTS 8.0 スコープ4 化学品承認') >= 0), 'presentation missing');
  assert.ok(titles.some(t => t.indexOf('（下書き）') >= 0), 'draft not shown to staff');
  assert.ok(titles.some(t => t.indexOf('準備チェックリスト') >= 0), 'PDF missing');
  assert.ok(titles.some(t => t.indexOf('GOTS 公式サイト') >= 0), 'link missing');
});

await t('each row is badged with its media type and state', async () => {
  const deck = [...d.querySelectorAll('.mrow')].find(r => r.textContent.indexOf('GOTS 8.0 スコープ4') >= 0);
  assert.ok(deck.querySelector('.chip.html'), 'no HTML badge');
  assert.ok(deck.textContent.indexOf('v1') >= 0, 'no version badge');
  assert.ok(deck.textContent.indexOf('14 ファイル') >= 0, 'asset count missing');
  const draft = [...d.querySelectorAll('.mrow')].find(r => r.textContent.indexOf('（下書き）') >= 0);
  assert.ok(draft.querySelector('.chip.pend'), 'draft not badged');
});

await t('only an HTML presentation offers 置換', async () => {
  const deck = [...d.querySelectorAll('.mrow')].find(r => r.textContent.indexOf('GOTS 8.0 スコープ4') >= 0);
  const pdf = [...d.querySelectorAll('.mrow')].find(r => r.textContent.indexOf('準備チェックリスト') >= 0);
  assert.ok([...deck.querySelectorAll('button')].some(b => b.textContent === '置換'));
  assert.ok(![...pdf.querySelectorAll('button')].some(b => b.textContent === '置換'), 'a PDF must not offer package replace');
});

await t('editing a record writes description and thumbnail through', async () => {
  w.mEdit(seeded.mediaId);
  await settle(4);
  assert.equal($('#pov').className.indexOf('open') >= 0, true, 'edit modal did not open');
  d.getElementById('me_desc').value = '編集テスト：説明を更新しました。';
  d.getElementById('me_thumb').value = 'https://example.com/thumb.png';
  w.mSaveEdit(seeded.mediaId);
  await settle(30);
  const j = JSON.parse((await invoke('protected-list', { headers: { cookie: cookieHeader(), host: 'localhost', origin: BASE } })).body);
  const rec = j.files.find(f => f.id === seeded.mediaId);
  assert.equal(rec.description, '編集テスト：説明を更新しました。');
  assert.equal(rec.thumb, 'https://example.com/thumb.png');
});

await t('publish / unpublish toggles the customer-visible state', async () => {
  w.mToggle(seeded.draftId);                       // draft -> published
  await settle(30);
  let j = JSON.parse((await invoke('protected-list', { headers: { cookie: cookieHeader(), host: 'localhost', origin: BASE } })).body);
  assert.equal(j.files.find(f => f.id === seeded.draftId).status, 'published');
  w.mToggle(seeded.draftId);                       // and back
  await settle(30);
  j = JSON.parse((await invoke('protected-list', { headers: { cookie: cookieHeader(), host: 'localhost', origin: BASE } })).body);
  assert.equal(j.files.find(f => f.id === seeded.draftId).status, 'draft');
});

await t('the type filter narrows the list', async () => {
  w.mSetFilter('html');
  await settle(3);
  const rows = [...d.querySelectorAll('.mrow')];
  assert.ok(rows.length >= 1);
  assert.ok(rows.every(r => r.querySelector('.chip.html')), 'non-HTML rows survived the filter');
  w.mSetFilter('all');
  await settle(3);
});

await t('search narrows the list', async () => {
  $('#mSearch').value = 'チェックリスト';
  w.mRender();
  const rows = [...d.querySelectorAll('.mrow')];
  assert.equal(rows.length, 1);
  assert.ok(rows[0].textContent.indexOf('準備チェックリスト') >= 0);
  $('#mSearch').value = '';
  w.mRender();
});

// ------------------------------------------------------------- feedback tab
// Give the console something to manage.
const TOKENS = { a: 'ADMINTESTTOKENAAAAAAAAAA', b: 'ADMINTESTTOKENBBBBBBBBBB' };
async function seedFeedback(){
  const F = require_(ROOT + '/netlify/functions/_feedback.js');
  const custRes = await invoke('auth-login', {
    httpMethod: 'POST', headers: { host: 'localhost', origin: BASE, 'x-nf-client-connection-ip': '10.9.9.9' },
    body: JSON.stringify({ role: 'customer', password: ENV.CUSTOMER_ACCESS_PASSWORD }),
  });
  const cust = String(custRes.headers['Set-Cookie']).split(';')[0];
  const items = [
    { type: 'question', message: '適用範囲について質問です。', token: TOKENS.a, customer: { name: 'QA FIXTURE - NOT A REAL PERSON', email: 'qa-fixture-a@example.invalid', phone: '+81-00-0000-0000' } },
    { type: 'correction', message: '数値の修正をお願いします。', token: TOKENS.b, customer: { name: 'QA FIXTURE B - NOT A REAL PERSON', email: 'qa-fixture-b@example.invalid', phone: '+81-00-0000-0001' } },
  ];
  for(const it of items){
    F._resetRateLimit();
    const r = await invoke('feedback-submit', {
      httpMethod: 'POST', headers: { cookie: cust, host: 'localhost', origin: BASE },
      body: JSON.stringify(Object.assign({ mediaId: seeded.mediaId, mediaVersion: 1, anchor: { selector: '#slide-title > h1:nth-of-type(1)', textQuote: 'GOTS Version 8.0', section: '1 / 38 · イントロダクション' } }, it)),
    });
    assert.equal(r.statusCode, 200, r.body);
  }
}
await seedFeedback();

await t('the feedback tab is gated behind staff authentication too', async () => {
  // Drop the session so the gate is exercised, not skipped.
  const out = await invoke('auth-logout', { httpMethod: 'POST' });
  jar.delete('idfl_session');
  await w.switchTab('feedback');
  await settle(20);
  assert.equal($('#fbPanel').style.display, '');
  assert.equal($('#qGate').style.display, 'block', 'expected the staff gate');
  assert.equal($('#qMain').style.display, 'none', 'personal data must stay behind the gate');
});

await t('staff sign-in opens the feedback console', async () => {
  $('#qPw').value = ENV.STAFF_ACCESS_PASSWORD;
  w.qLogin();
  await settle(30);
  assert.equal($('#qGate').style.display, 'none');
  assert.equal($('#qMain').style.display, 'block');
});

await t('records show media, anchor, type, contact details and status', async () => {
  const rows = [...d.querySelectorAll('.fbrow')];
  assert.equal(rows.length, 2, 'expected 2 records, got ' + rows.length);
  const q = rows.find(r => r.textContent.indexOf('適用範囲について質問です') >= 0);
  assert.ok(q, 'question row missing');
  assert.ok(q.textContent.indexOf('GOTS 8.0 スコープ4 化学品承認') >= 0, 'media title missing');
  assert.ok(q.textContent.indexOf('イントロダクション') >= 0, 'anchor section missing');
  assert.ok(q.querySelector('.chip.q'), 'type badge missing');
  assert.ok(q.querySelector('.chip.new'), 'status badge missing');
  assert.ok(q.textContent.indexOf('QA FIXTURE - NOT A REAL PERSON') >= 0, 'staff should see the name');
  assert.ok(q.textContent.indexOf('qa-fixture-a@example.invalid') >= 0, 'staff should see the e-mail');
  assert.ok(q.textContent.indexOf('+81-00-0000-0000') >= 0, 'staff should see the phone');
  assert.ok(q.textContent.indexOf('Version 1') >= 0, 'media version missing');
});

await t('the counter breaks the queue down by status', async () => {
  assert.ok(txt('#qCount').indexOf('新規 2') >= 0, 'got: ' + txt('#qCount'));
});

await t('the status filter works', async () => {
  w.qSetFilter('resolved');
  await settle(3);
  assert.equal(d.querySelectorAll('.fbrow').length, 0);
  w.qSetFilter('new');
  await settle(3);
  assert.equal(d.querySelectorAll('.fbrow').length, 2);
  w.qSetFilter('all');
  await settle(3);
});

await t('search covers the customer contact fields', async () => {
  $('#qSearch').value = 'qa-fixture-b@example.invalid';
  w.qRender();
  const rows = [...d.querySelectorAll('.fbrow')];
  assert.equal(rows.length, 1);
  assert.ok(rows[0].textContent.indexOf('数値の修正') >= 0);
  $('#qSearch').value = '';
  w.qRender();
});

let key;
await t('replying and resolving in one step works', async () => {
  const all = JSON.parse((await invoke('feedback-list', { headers: { cookie: cookieHeader(), host: 'localhost' }, queryStringParameters: { scope: 'all' } })).body).items;
  key = all.find(x => x.message.indexOf('適用範囲') >= 0).key;
  w.qReply(key);
  await settle(4);
  d.getElementById('q_reply').value = 'スコープ4は化学品配合事業者が対象です。ご連絡ありがとうございます。';
  d.getElementById('q_resolve').checked = true;
  w.qSaveReply(key);
  await settle(30);
  const rec = JSON.parse((await invoke('feedback-list', { headers: { cookie: cookieHeader(), host: 'localhost' }, queryStringParameters: { scope: 'all' } })).body).items.find(x => x.key === key);
  assert.equal(rec.status, 'resolved');
  assert.ok(rec.resolvedAt, 'resolvedAt not stamped');
  assert.ok(rec.staffReply.indexOf('化学品配合事業者が対象です') >= 0);
});

await t('an internal note is saved and shown only in the console', async () => {
  w.qNote(key);
  await settle(4);
  d.getElementById('q_note').value = '担当: 大阪オフィス。技術チームに確認済み。';
  w.qSaveNote(key);
  await settle(30);
  const row = [...d.querySelectorAll('.fbrow')].find(r => r.textContent.indexOf('適用範囲') >= 0);
  assert.ok(row.querySelector('.note'), 'internal note not rendered for staff');
  assert.ok(row.textContent.indexOf('お客様には表示されません') >= 0, 'note is not labelled as internal');
  // ...and the customer view still does not carry it.
  const mine = JSON.parse((await invoke('feedback-list', {
    headers: { cookie: (await (async () => {
      const r = await invoke('auth-login', { httpMethod: 'POST', headers: { host: 'localhost', origin: BASE, 'x-nf-client-connection-ip': '10.9.9.10' }, body: JSON.stringify({ role: 'customer', password: ENV.CUSTOMER_ACCESS_PASSWORD }) });
      return String(r.headers['Set-Cookie']).split(';')[0];
    })()), host: 'localhost' },
    queryStringParameters: { mediaId: seeded.mediaId, token: TOKENS.a },
  })).body).items;
  assert.ok(JSON.stringify(mine).indexOf('大阪オフィス') < 0, 'internal note leaked to the customer');
  assert.ok(JSON.stringify(mine).indexOf('化学品配合事業者が対象です') >= 0, 'the reply should reach the author');
});

await t('status buttons move a record through the queue', async () => {
  w.qStatus(key, 'in_progress');
  await settle(30);
  let rec = JSON.parse((await invoke('feedback-list', { headers: { cookie: cookieHeader(), host: 'localhost' }, queryStringParameters: { scope: 'all' } })).body).items.find(x => x.key === key);
  assert.equal(rec.status, 'in_progress');
  w.qStatus(key, 'dismissed');
  await settle(30);
  rec = JSON.parse((await invoke('feedback-list', { headers: { cookie: cookieHeader(), host: 'localhost' }, queryStringParameters: { scope: 'all' } })).body).items.find(x => x.key === key);
  assert.equal(rec.status, 'dismissed');
});

await t('publishing a record to other customers is staff-controlled', async () => {
  w.qPublic(key, true);
  await settle(30);
  const rec = JSON.parse((await invoke('feedback-list', { headers: { cookie: cookieHeader(), host: 'localhost' }, queryStringParameters: { scope: 'all' } })).body).items.find(x => x.key === key);
  assert.equal(rec.publicVisible, true);
  const row = [...d.querySelectorAll('.fbrow')].find(r => r.textContent.indexOf('適用範囲') >= 0);
  assert.ok(row.textContent.indexOf('お客様に公開中') >= 0, 'public state not surfaced in the console');
});

await t('the deep link to the annotation carries media and feedback id', async () => {
  const opened = [];
  w.open = (url) => { opened.push(url); return null; };
  const rec = JSON.parse((await invoke('feedback-list', { headers: { cookie: cookieHeader(), host: 'localhost' }, queryStringParameters: { scope: 'all' } })).body).items.find(x => x.key === key);
  w.qOpenMedia(rec.mediaId, rec.id);
  assert.equal(opened.length, 1);
  assert.ok(opened[0].indexOf('/customer/media-viewer.html?id=' + rec.mediaId) === 0, 'bad url: ' + opened[0]);
  assert.ok(opened[0].indexOf('fb=' + rec.id) > 0, 'feedback id not in the deep link');
});

await t('an XSS payload in feedback renders as text in the console', async () => {
  const F = require_(ROOT + '/netlify/functions/_feedback.js');
  F._resetRateLimit();
  const custRes = await invoke('auth-login', { httpMethod: 'POST', headers: { host: 'localhost', origin: BASE, 'x-nf-client-connection-ip': '10.9.9.11' }, body: JSON.stringify({ role: 'customer', password: ENV.CUSTOMER_ACCESS_PASSWORD }) });
  const cust = String(custRes.headers['Set-Cookie']).split(';')[0];
  const payload = '<img src=x onerror="window.__pwned=1">';
  await invoke('feedback-submit', {
    httpMethod: 'POST', headers: { cookie: cust, host: 'localhost', origin: BASE },
    body: JSON.stringify({ mediaId: seeded.mediaId, mediaVersion: 1, type: 'comment', message: payload, token: TOKENS.a, customer: { name: payload, email: 'qa-fixture-a@example.invalid', phone: '+81-00-0000-0000' } }),
  });
  w.qLoad();
  await settle(30);
  const row = [...d.querySelectorAll('.fbrow')].find(r => r.textContent.indexOf('onerror') >= 0);
  assert.ok(row, 'payload row not found');
  assert.equal(row.querySelectorAll('img').length, 0, 'payload was parsed as markup');
  assert.equal(w.__pwned, undefined, 'payload executed');
  assert.ok(row.textContent.indexOf(payload) >= 0, 'payload should be visible as literal text');
});

// --------------------------------------------------------------------------
// Stale reads. Netlify Blobs can serve a record without a field that was just
// written, so feedback-manage's read-modify-write used to lose it: on the live
// preview, saving a reply and then pressing 解決済み two seconds later wiped the
// reply permanently. Every mutation now carries the whole staff-field set.
// --------------------------------------------------------------------------
await t('a status change straight after a reply does not wipe the reply', async () => {
  const all = JSON.parse((await invoke('feedback-list', { headers: { cookie: cookieHeader(), host: 'localhost' }, queryStringParameters: { scope: 'all' } })).body).items;
  const target = all.find(x => x.message.indexOf('数値の修正') >= 0) || all[0];
  w.qLoad();
  await settle(30);
  // 1) save a reply and an internal note
  w.qReply(target.key);
  await settle(4);
  d.getElementById('q_reply').value = '確認のうえご連絡します。';
  d.getElementById('q_resolve').checked = false;
  w.qSaveReply(target.key);
  await settle(30);
  w.qNote(target.key);
  await settle(4);
  d.getElementById('q_note').value = '担当: 大阪オフィス';
  w.qSaveNote(target.key);
  await settle(30);
  // 2) now every subsequent read is stale for a while, as production was
  setReadStale(60000, 'idfl-feedback');
  try{
    w.qStatus(target.key, 'resolved');
    await settle(30);
  } finally { setReadStale(0); }
  const after = JSON.parse((await invoke('feedback-list', { headers: { cookie: cookieHeader(), host: 'localhost' }, queryStringParameters: { scope: 'all' } })).body).items.find(x => x.key === target.key);
  assert.equal(after.status, 'resolved', 'the status change did not apply');
  assert.equal(after.staffReply, '確認のうえご連絡します。', 'the staff reply was lost by the status change');
  assert.equal(after.internalNote, '担当: 大阪オフィス', 'the internal note was lost by the status change');
});

await t('deleting removes the record and its personal data', async () => {
  const before = JSON.parse((await invoke('feedback-list', { headers: { cookie: cookieHeader(), host: 'localhost' }, queryStringParameters: { scope: 'all' } })).body).items;
  w.qDelete(key);
  await settle(30);
  const after = JSON.parse((await invoke('feedback-list', { headers: { cookie: cookieHeader(), host: 'localhost' }, queryStringParameters: { scope: 'all' } })).body).items;
  assert.equal(after.length, before.length - 1);
  assert.ok(!after.some(x => x.key === key));
});

server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

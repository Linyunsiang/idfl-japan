// ============================================================
// Customer-facing tests: /customer/media.html and /customer/media-viewer.html,
// their real inline JavaScript, against the real functions over real HTTP.
//
// The emphasis is on what a customer must NOT be able to see: another
// customer's identity, a draft, or a staff internal note.
//
// Needs jsdom:  npm install --no-save jsdom
//   node tests/media-feedback/customer.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer, setEnv, invoke, ROOT, setListLag } from './harness.mjs';
import { seedAll } from './seed.mjs';

const require_ = createRequire(import.meta.url);
let JSDOM;
try{ ({ JSDOM } = require_('jsdom')); }
catch(e){
  console.log('customer tests skipped: jsdom is not installed (npm install --no-save jsdom)');
  process.exit(0);
}

const PKG = process.env.IDFL_TEST_PKG || 'C:/Users/AldenLin/AppData/Local/Temp/claude/C--Users-AldenLin/28ad7c38-23a1-4aca-9a88-61f754d8c111/scratchpad/gots-pkg';
const ENV = setEnv();
const F = require_(ROOT + '/netlify/functions/_feedback.js');

let pass = 0, fail = 0;
async function t(name, fn){
  try{ await fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.message)); fail++; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const settle = async (n = 14) => { for(let i = 0; i < n; i++) await sleep(25); };

// The agent that normally lives inside the sandboxed presentation cannot run in
// jsdom, so speak its protocol directly: read the nonce out of the frame mount
// and post the message the agent would post when the reader clicks something.
function pickInFrame(dom, anchor){
  const w = dom.window, frame = w.document.getElementById('frame');
  if(!frame) { w.startPick(); return; }                  // non-HTML media: general feedback
  const m = new RegExp('/f-([A-Za-z0-9_-]+)/').exec(frame.src);
  if(!m) throw new Error('no nonce in frame mount: ' + frame.src);
  w.startPick();
  w.dispatchEvent(new w.MessageEvent('message', {
    data: { __idflfb: 1, nonce: m[1], evt: 'picked', anchor: anchor || null },
    source: frame.contentWindow,
  }));
}

const seeded = await seedAll(PKG);
const server = createServer();
await new Promise(res => server.listen(0, res));
const BASE = 'http://localhost:' + server.address().port;

// --------------------------------------------------------------------------
// A browser: its own cookie jar and its own localStorage/sessionStorage, so two
// "customers" are genuinely independent.
// --------------------------------------------------------------------------
function makeBrowser(){
  const jar = new Map();
  const local = new Map(), session = new Map();
  function cookieHeader(){ return [...jar.entries()].map(([k, v]) => k + '=' + v).join('; '); }
  function absorb(res){
    for(const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])){
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if(/Max-Age=0/i.test(c)) jar.delete(pair.slice(0, i)); else jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  function storage(map){
    return { getItem: k => (map.has(String(k)) ? map.get(String(k)) : null), setItem: (k, v) => map.set(String(k), String(v)), removeItem: k => map.delete(String(k)), clear: () => map.clear() };
  }
  async function login(role, password, ip){
    const r = await fetch(BASE + '/.netlify/functions/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, 'x-nf-client-connection-ip': ip },
      body: JSON.stringify({ role, password }),
    });
    absorb(r);
    return r.status;
  }
  async function open(path){
    const html = await (await fetch(BASE + path, { headers: { cookie: cookieHeader() } })).text();
    const dom = new JSDOM(html, {
      url: BASE + path, runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(w){
        w.fetch = async (url, opts) => {
          const o = Object.assign({}, opts);
          o.headers = Object.assign({ Origin: BASE, cookie: cookieHeader() }, (opts && opts.headers) || {});
          const res = await fetch(String(url).startsWith('http') ? String(url) : BASE + url, o);
          absorb(res);
          return res;
        };
        Object.defineProperty(w, 'localStorage', { value: storage(local), configurable: true });
        Object.defineProperty(w, 'sessionStorage', { value: storage(session), configurable: true });
        w.scrollTo = () => {};
        w.alert = () => {};
        // The viewer only mounts an iframe for HTML media; jsdom will not run it,
        // which is fine - the drawer and the submission path are what we test here.
      },
    });
    await settle();
    return dom;
  }
  return { login, open, cookieHeader, local, session, jar };
}

console.log('customer pages (real pages, real functions, real HTTP)');

// ============================================================== media library
const A = makeBrowser();

await t('the library sends an unauthenticated visitor to the login page', async () => {
  const dom = await A.open('/customer/media.html');
  const d = dom.window.document;
  // location.replace is inert in jsdom, so assert on what matters: the page
  // never reveals its contents without a session.
  assert.equal(d.getElementById('app').style.display, 'none');
  assert.equal(d.querySelectorAll('.card').length, 0);
});

await t('a customer session opens the library', async () => {
  assert.equal(await A.login('customer', ENV.CUSTOMER_ACCESS_PASSWORD, '10.1.0.1'), 200);
  const dom = await A.open('/customer/media.html');
  const d = dom.window.document;
  assert.equal(d.getElementById('app').style.display, 'block');
  assert.equal(d.getElementById('roleBadge').textContent, 'お客様専用');
  A.dom = dom;
});

await t('published records are shown and the draft is not', async () => {
  const d = A.dom.window.document;
  const titles = [...d.querySelectorAll('.card .t')].map(e => e.textContent);
  assert.equal(titles.length, 3, 'got: ' + titles.join(' | '));
  assert.ok(titles.some(t => t.indexOf('GOTS 8.0 スコープ4 化学品承認') >= 0));
  assert.ok(!titles.some(t => t.indexOf('（下書き）') >= 0), 'a draft was shown to a customer');
});

await t('each card carries a media-type badge and the right action', async () => {
  const d = A.dom.window.document;
  const cards = [...d.querySelectorAll('.card')];
  const deck = cards.find(c => c.textContent.indexOf('GOTS 8.0 スコープ4') >= 0);
  assert.ok(deck.querySelector('.chip.t-html'), 'no presentation badge');
  assert.equal(deck.querySelector('.ft a').textContent, '閲覧する');
  assert.ok(deck.querySelector('.ft a').getAttribute('href').indexOf('/customer/media-viewer.html?id=') === 0);

  const pdf = cards.find(c => c.textContent.indexOf('準備チェックリスト') >= 0);
  assert.ok(pdf.querySelector('.chip.t-pdf'));
  assert.equal(pdf.querySelector('.ft a').textContent, 'ダウンロード');
  assert.ok(pdf.querySelector('.ft a').hasAttribute('download'));

  const link = cards.find(c => c.textContent.indexOf('GOTS 公式サイト') >= 0);
  assert.ok(link.querySelector('.chip.t-external'));
  assert.ok(link.querySelector('.ft a').textContent.indexOf('開く') >= 0);
  assert.equal(link.querySelector('.ft a').getAttribute('rel'), 'noopener');
});

await t('an external link is proxied, never exposed as a raw URL', async () => {
  const d = A.dom.window.document;
  const link = [...d.querySelectorAll('.card')].find(c => c.textContent.indexOf('GOTS 公式サイト') >= 0);
  const href = link.querySelector('.ft a').getAttribute('href');
  assert.ok(href.indexOf('/.netlify/functions/protected-file?id=') === 0, 'got: ' + href);
  assert.equal(d.body.innerHTML.indexOf('global-standard.org'), -1, 'the destination URL leaked into the page');
});

await t('search and the category filter narrow the grid', async () => {
  const w = A.dom.window, d = w.document;
  d.getElementById('search').value = 'チェックリスト';
  w.renderList();
  assert.equal(d.querySelectorAll('.card').length, 1);
  d.getElementById('search').value = '';
  d.getElementById('groupSel').value = '2026 大阪セミナー';
  w.renderList();
  const titles = [...d.querySelectorAll('.card .t')].map(e => e.textContent);
  assert.equal(titles.length, 1);
  assert.ok(titles[0].indexOf('GOTS 8.0') >= 0);
  d.getElementById('groupSel').value = '';
  w.renderList();
});

await t('the media-type filter narrows the grid', async () => {
  const w = A.dom.window, d = w.document;
  w.setType('pdf');
  assert.equal(d.querySelectorAll('.card').length, 1);
  assert.ok(d.querySelector('.card').textContent.indexOf('準備チェックリスト') >= 0);
  w.setType('external');
  assert.equal(d.querySelectorAll('.card').length, 1);
  w.setType('all');
  assert.equal(d.querySelectorAll('.card').length, 3);
});

await t('the category dropdown lists every group present', async () => {
  const d = A.dom.window.document;
  const opts = [...d.querySelectorAll('#groupSel option')].map(o => o.value);
  assert.ok(opts.indexOf('IDFL Guide') >= 0);
  assert.ok(opts.indexOf('2026 大阪セミナー') >= 0);
});

// ==================================================================== viewer
await t('the viewer loads the presentation record and asks for a grant', async () => {
  const dom = await A.open('/customer/media-viewer.html?id=' + seeded.mediaId);
  const d = dom.window.document;
  assert.ok(d.getElementById('mTitle').textContent.indexOf('GOTS 8.0 スコープ4') >= 0);
  assert.equal(d.getElementById('mVer').textContent, 'Version 1');
  assert.equal(d.getElementById('fbToggle').style.display, 'inline-flex');
  const frame = d.getElementById('frame');
  assert.ok(frame, 'no iframe was mounted');
  A.viewer = dom;
});

await t('the presentation frame is sandboxed without allow-same-origin', async () => {
  const frame = A.viewer.window.document.getElementById('frame');
  const sandbox = frame.getAttribute('sandbox');
  assert.ok(sandbox, 'the iframe carries no sandbox attribute');
  assert.ok(sandbox.indexOf('allow-scripts') >= 0, 'the deck needs scripts');
  assert.equal(sandbox.indexOf('allow-same-origin'), -1, 'allow-same-origin would hand the deck our origin');
  assert.equal(sandbox.indexOf('allow-top-navigation'), -1);
  assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
});

await t('the frame is mounted under a scoped, tokenised path', async () => {
  const src = A.viewer.window.document.getElementById('frame').src;
  assert.ok(/\/media\/[^/]+\/[^/]+\/f-[A-Za-z0-9_-]+\/index\.html$/.test(src), 'unexpected mount: ' + src);
  assert.ok(src.indexOf(seeded.mediaId) > 0);
});

await t('a submitter token is minted locally and is not an e-mail address', async () => {
  const tok = A.local.get('idflFbToken');
  assert.ok(tok, 'no token stored');
  assert.ok(/^[A-Za-z0-9_-]{16,64}$/.test(tok), 'bad token shape: ' + tok);
  assert.equal(tok.indexOf('@'), -1);
});

await t('the drawer starts empty with the privacy explanation', async () => {
  const d = A.viewer.window.document;
  const body = d.getElementById('fbList').textContent;
  assert.ok(body.indexOf('まだフィードバックはありません') >= 0);
  assert.ok(body.indexOf('IDFLが共有として公開した内容のみ') >= 0, 'visibility rule not explained');
});

const ANCHOR = { selector: '#slide-title > div:nth-of-type(1) > h1:nth-of-type(1)', textQuote: 'GOTS Version 8.0 スコープ4 化学品承認', position: { x: .08, y: .3, w: .5, h: .12 }, section: '1 / 38 · イントロダクション · slide-title' };

await t('picking a spot in the presentation opens the form with the target named', async () => {
  const w = A.viewer.window, d = w.document;
  pickInFrame(A.viewer, ANCHOR);
  await settle(3);
  assert.ok(d.getElementById('ov').className.indexOf('open') >= 0, 'form did not open');
  assert.ok(d.getElementById('ovLead').textContent.indexOf('イントロダクション') >= 0, 'target not named: ' + d.getElementById('ovLead').textContent);
  assert.equal(d.getElementById('addBtn').textContent, 'コメントを追加', 'pick mode should have ended');
});

await t('the form states why contact details are collected', async () => {
  const w = A.viewer.window, d = w.document;
  await settle(2);
  assert.ok(d.getElementById('ov').className.indexOf('open') >= 0, 'form did not open');
  assert.ok(d.getElementById('ovBody').textContent.indexOf('本資料に関するご質問・ご連絡への対応のために使用します') >= 0);
  assert.ok(d.getElementById('ovBody').textContent.indexOf('他のお客様に表示されることはありません') >= 0);
  for(const id of ['fType', 'fMsg', 'fName', 'fEmail', 'fPhone']) assert.ok(d.getElementById(id), 'missing field ' + id);
});

await t('the form validates before anything is sent', async () => {
  const w = A.viewer.window, d = w.document;
  const err = d.getElementById('ovErr');
  d.getElementById('fMsg').value = '';
  w.submitFeedback(); assert.ok(err.textContent.indexOf('内容') >= 0, 'empty message accepted');
  d.getElementById('fMsg').value = 'テストの質問です。';
  d.getElementById('fName').value = '';
  w.submitFeedback(); assert.ok(err.textContent.indexOf('お名前') >= 0, 'empty name accepted');
  d.getElementById('fName').value = 'QA FIXTURE - NOT A REAL PERSON';
  d.getElementById('fEmail').value = 'not-an-email';
  w.submitFeedback(); assert.ok(err.textContent.indexOf('メール') >= 0, 'bad e-mail accepted');
  d.getElementById('fEmail').value = 'qa-fixture-a@example.invalid';
  d.getElementById('fPhone').value = '12';
  w.submitFeedback(); assert.ok(err.textContent.indexOf('電話') >= 0, 'bad phone accepted');
});

await t('a valid submission is saved and appears in the drawer', async () => {
  const w = A.viewer.window, d = w.document;
  F._resetRateLimit();
  d.getElementById('fPhone').value = '+81-00-0000-0000';
  w.submitFeedback();
  await settle(30);
  assert.equal(d.getElementById('ov').className.indexOf('open'), -1, 'form stayed open');
  const items = [...d.querySelectorAll('.fbitem')];
  assert.equal(items.length, 1, 'drawer did not update');
  assert.ok(items[0].textContent.indexOf('テストの質問です。') >= 0);
  assert.ok(items[0].textContent.indexOf('質問') >= 0);
  assert.ok(items[0].textContent.indexOf('受付済み') >= 0);
  assert.ok(items[0].textContent.indexOf('対象箇所') >= 0, 'the anchored target should be shown');
  assert.ok(items[0].textContent.indexOf('イントロダクション') >= 0);
});

await t('contact details are remembered for the session but never put in a URL', async () => {
  const saved = JSON.parse(A.session.get('idflFbContact'));
  assert.equal(saved.name, 'QA FIXTURE - NOT A REAL PERSON');
  assert.equal(saved.email, 'qa-fixture-a@example.invalid');
  assert.equal(A.viewer.window.location.search.indexOf('qa-fixture-a@example.invalid'), -1);
  assert.equal(A.viewer.window.location.href.indexOf('TEST'), -1);
  // The durable token lives in localStorage; contact details deliberately do not.
  assert.equal(A.local.get('idflFbContact'), undefined);
});

await t('reopening the viewer restores the customer\'s own feedback', async () => {
  const dom = await A.open('/customer/media-viewer.html?id=' + seeded.mediaId);
  await settle(20);
  const items = [...dom.window.document.querySelectorAll('.fbitem')];
  assert.equal(items.length, 1, 'feedback did not survive a reload');
  assert.ok(items[0].textContent.indexOf('テストの質問です。') >= 0);
  A.viewer = dom;
});

await t('the remembered contact details prefill the next form', async () => {
  const w = A.viewer.window, d = w.document;
  pickInFrame(A.viewer, ANCHOR);
  await settle(3);
  assert.equal(d.getElementById('fName').value, 'QA FIXTURE - NOT A REAL PERSON');
  assert.equal(d.getElementById('fEmail').value, 'qa-fixture-a@example.invalid');
  assert.equal(d.getElementById('fPhone').value, '+81-00-0000-0000');
  w.closeModal();
});

// --------------------------------------------------------------------------
// Eventual consistency. Netlify Blobs reads a key strongly but lists a prefix
// eventually, so the record a customer just submitted is missing from the
// listing for a while. Caught live on the Deploy Preview, where the drawer
// came back empty right after a successful submission.
// --------------------------------------------------------------------------
await t('a just-submitted item stays visible while the listing lags', async () => {
  setListLag(60000, 'idfl-feedback');   // nothing new appears in list() at all
  try{
    const dom = await A.open('/customer/media-viewer.html?id=' + seeded.mediaId);
    await settle(20);
    const w = dom.window, d = w.document;
    const before = d.querySelectorAll('.fbitem').length;
    pickInFrame(dom, ANCHOR);
    await settle(3);
    F._resetRateLimit();
    d.getElementById('fMsg').value = '一覧の反映が遅れても表示されることの確認です。';
    d.getElementById('fName').value = 'QA FIXTURE - NOT A REAL PERSON';
    d.getElementById('fEmail').value = 'qa-fixture-a@example.invalid';
    d.getElementById('fPhone').value = '+81-00-0000-0000';
    w.submitFeedback();
    await settle(40);
    const items = [...d.querySelectorAll('.fbitem')];
    assert.equal(items.length, before + 1, 'the submitted item vanished while the listing lagged');
    assert.ok(items.some(i => i.textContent.indexOf('一覧の反映が遅れても') >= 0), 'the new item is not the one shown');
  } finally { setListLag(0); }
});

await t('it is not duplicated once the listing catches up', async () => {
  const dom = await A.open('/customer/media-viewer.html?id=' + seeded.mediaId);
  await settle(25);
  const texts = [...dom.window.document.querySelectorAll('.fbitem .msg')].map(e => e.textContent);
  const dupes = texts.filter(t => t.indexOf('一覧の反映が遅れても') >= 0);
  assert.equal(dupes.length, 1, 'the item appears ' + dupes.length + ' times after the listing caught up');
});

// ========================================================= a second customer
const B = makeBrowser();
await t('a different customer with the same password sees none of it', async () => {
  assert.equal(await B.login('customer', ENV.CUSTOMER_ACCESS_PASSWORD, '10.2.0.2'), 200);
  const dom = await B.open('/customer/media-viewer.html?id=' + seeded.mediaId);
  await settle(20);
  const d = dom.window.document;
  assert.equal(d.querySelectorAll('.fbitem').length, 0, 'another customer\'s feedback was visible');
  const html = d.body.innerHTML;
  for(const secret of ['QA FIXTURE', 'qa-fixture-a@example.invalid', '+81-00-0000-0000', A.local.get('idflFbToken')]){
    assert.equal(html.indexOf(secret), -1, 'leaked: ' + secret);
  }
  B.viewer = dom;
});

await t('a staff-published item becomes visible to others, still anonymous', async () => {
  const staff = await invoke('auth-login', { httpMethod: 'POST', headers: { host: 'localhost', origin: BASE, 'x-nf-client-connection-ip': '10.3.0.3' }, body: JSON.stringify({ role: 'staff', password: ENV.STAFF_ACCESS_PASSWORD }) });
  const cookie = String(staff.headers['Set-Cookie']).split(';')[0];
  const all = JSON.parse((await invoke('feedback-list', { headers: { cookie, host: 'localhost' }, queryStringParameters: { scope: 'all' } })).body).items;
  const target = all.find(x => x.message.indexOf('テストの質問です') >= 0);
  await invoke('feedback-manage', { httpMethod: 'POST', headers: { cookie, host: 'localhost', origin: BASE }, body: JSON.stringify({ action: 'update', id: target.key, publicVisible: true, staffReply: '公開回答です。', internalNote: '社内メモ：担当は大阪。' }) });

  const dom = await B.open('/customer/media-viewer.html?id=' + seeded.mediaId);
  await settle(20);
  const d = dom.window.document;
  const items = [...d.querySelectorAll('.fbitem')];
  assert.equal(items.length, 1, 'published item not shared');
  assert.ok(items[0].textContent.indexOf('テストの質問です。') >= 0);
  assert.ok(items[0].textContent.indexOf('公開回答です。') >= 0, 'the public reply should be shown');
  const html = d.body.innerHTML;
  assert.equal(html.indexOf('社内メモ'), -1, 'internal note leaked to a customer');
  for(const secret of ['QA FIXTURE', 'qa-fixture-a@example.invalid', '+81-00-0000-0000']){
    assert.equal(html.indexOf(secret), -1, 'leaked: ' + secret);
  }
});

await t('an XSS payload in feedback renders as text in the viewer', async () => {
  F._resetRateLimit();
  const w = B.viewer.window, d = w.document;
  const dom2 = await B.open('/customer/media-viewer.html?id=' + seeded.mediaId);
  const w2 = dom2.window, d2 = w2.document;
  pickInFrame(dom2, ANCHOR);
  await settle(3);
  const payload = '<img src=x onerror="window.__pwned=1">';
  d2.getElementById('fMsg').value = payload;
  d2.getElementById('fName').value = 'QA FIXTURE B - NOT A REAL PERSON';
  d2.getElementById('fEmail').value = 'qa-fixture-b@example.invalid';
  d2.getElementById('fPhone').value = '+81-00-0000-0001';
  w2.submitFeedback();
  await settle(30);
  const row = [...d2.querySelectorAll('.fbitem')].find(r => r.textContent.indexOf('onerror') >= 0);
  assert.ok(row, 'payload not listed');
  assert.equal(row.querySelectorAll('img').length, 0, 'payload parsed as markup');
  assert.equal(w2.__pwned, undefined, 'payload executed');
});

await t('the viewer refuses a media id the customer may not read', async () => {
  const dom = await B.open('/customer/media-viewer.html?id=' + seeded.draftId);
  await settle(20);
  const d = dom.window.document;
  assert.ok(d.getElementById('stage').textContent.indexOf('見つからない') >= 0, 'draft was not refused: ' + d.getElementById('stage').textContent.slice(0, 120));
  assert.equal(d.getElementById('frame'), null, 'a draft must not be mounted for a customer');
});

await t('staff can preview the same draft through the same viewer', async () => {
  const S = makeBrowser();
  assert.equal(await S.login('staff', ENV.STAFF_ACCESS_PASSWORD, '10.4.0.4'), 200);
  const dom = await S.open('/customer/media-viewer.html?id=' + seeded.draftId);
  await settle(20);
  const d = dom.window.document;
  assert.ok(d.getElementById('frame'), 'staff preview did not mount');
  assert.equal(d.getElementById('mDraft').style.display, 'inline-block', 'draft badge not shown');
  assert.ok(d.getElementById('mVer').textContent.indexOf('Version') >= 0, 'version badge missing for staff preview');
});

server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

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
let JSDOM, requestInterceptor;
try{ ({ JSDOM, requestInterceptor } = require_('jsdom')); }
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
      // The pages load /js/library-shell.js, and jsdom fetches no subresource
      // unless told to. Allow same-origin ones so the shared shell really runs,
      // and answer everything else locally so the suite never reaches the
      // network (the pages also link Google Fonts, which a test must not need).
      resources: {
        interceptors: [requestInterceptor((request) => {
          if(String(request.url).indexOf(BASE) !== 0) return new Response('', { status: 204 });
        })],
      },
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
  assert.equal(d.querySelectorAll('.lib-row').length, 0);
  assert.equal(d.getElementById('libRole').hidden, true, 'the role badge showed without a session');
  assert.equal(d.getElementById('libLogout').hidden, true);
});

await t('a customer session opens the console', async () => {
  assert.equal(await A.login('customer', ENV.CUSTOMER_ACCESS_PASSWORD, '10.1.0.1'), 200);
  const dom = await A.open('/customer/media.html');
  const d = dom.window.document;
  assert.equal(d.getElementById('libRole').hidden, false);
  assert.equal(d.getElementById('libRole').textContent, 'お客様専用');
  assert.ok(d.querySelectorAll('.lib-row').length > 0, 'the list stayed empty');
  A.dom = dom;
});

await t('published records are shown and the draft is not', async () => {
  const d = A.dom.window.document;
  const titles = [...d.querySelectorAll('.lib-row__t')].map(e => e.textContent);
  assert.equal(titles.length, 3, 'got: ' + titles.join(' | '));
  assert.ok(titles.some(t => t.indexOf('GOTS 8.0 スコープ4 化学品承認') >= 0));
  assert.ok(!titles.some(t => t.indexOf('（下書き）') >= 0), 'a draft was shown to a customer');
});

await t('every row names its type in words, not by icon alone', async () => {
  const d = A.dom.window.document;
  const rows = [...d.querySelectorAll('.lib-row')];
  assert.equal(rows.length, 3);
  for(const b of rows){
    assert.ok(b.dataset.id, 'a row carries no record id');
    assert.ok(b.dataset.type, 'a row carries no media type');
    assert.ok(b.querySelector('.lib-row__m').textContent.trim().length > 0);
  }
  assert.equal(rows.find(b => b.textContent.indexOf('GOTS 8.0 スコープ4') >= 0).dataset.type, 'html');
  assert.equal(rows.find(b => b.textContent.indexOf('準備チェックリスト') >= 0).dataset.type, 'pdf');
  assert.equal(rows.find(b => b.textContent.indexOf('GOTS 公式サイト') >= 0).dataset.type, 'external');
});

await t('choosing a row fills the inspector and starts nothing', async () => {
  const w = A.dom.window, d = w.document;
  const pdf = [...d.querySelectorAll('.lib-row')].find(b => b.dataset.type === 'pdf');
  pdf.dispatchEvent(new w.Event('click', { bubbles: true }));
  await settle();
  assert.equal(pdf.getAttribute('aria-current'), 'true', 'the row was not marked current');
  const insp = d.getElementById('libInsp');
  assert.ok(insp.textContent.indexOf('準備チェックリスト') >= 0, 'the inspector did not follow the selection');
  assert.equal(w.location.pathname, '/customer/media.html', 'selecting must not navigate');
  assert.ok(w.location.search.indexOf('id=') >= 0, 'the selection is not in the URL');
});

await t('a record the browser can render offers reading, not a download', async () => {
  const w = A.dom.window, d = w.document;
  const pick = (type) => {
    [...d.querySelectorAll('.lib-row')].find(b => b.dataset.type === type)
      .dispatchEvent(new w.Event('click', { bubbles: true }));
    return d.getElementById('libInsp');
  };
  const pdf = pick('pdf');
  assert.equal(pdf.querySelector('[data-dl]'), null, 'a PDF must not offer a download');
  const read = pdf.querySelector('a.lib-btn--primary');
  assert.ok(read.getAttribute('href').indexOf('inline=1') > 0, 'the primary action should open it for reading');
  assert.ok(pdf.textContent.indexOf('閲覧のみ') >= 0, 'the page should say so plainly');

  // The other half of the rule - that a spreadsheet stays downloadable - is
  // covered at the gate itself in api.test.mjs, where the fixture set has one.
});

await t('a row says how to open it, and opening it is one press away', async () => {
  const d = A.dom.window.document;
  const row = d.querySelector('.lib-row');
  const go = row.querySelector('.lib-row__go');
  assert.ok(go, 'a row carries no visible way to open it');
  assert.ok(go.textContent.indexOf('開く') >= 0, 'the affordance does not say what it does');
  const hint = d.querySelector('.lib-listhint');
  assert.ok(hint && hint.textContent.indexOf('ダブルクリック') >= 0,
    'the list never tells anyone the gesture exists');
});

await t('the first press shows a record, the second opens it', async () => {
  const w = A.dom.window, d = w.document;
  // jsdom will not navigate; it reports the attempt instead, and that report is
  // the only evidence available that the page tried to leave.
  A.dom.virtualConsole.removeAllListeners('jsdomError');
  const went = [];
  A.dom.virtualConsole.on('jsdomError', (e) => {
    // The same channel carries unrelated complaints, a blocked web font among
    // them. Only a navigation is evidence that the page tried to leave.
    if (/navigation/.test(String(e.message))) went.push(String(e.message));
  });

  const row = [...d.querySelectorAll('.lib-row')].find(b => b.dataset.type === 'pdf');
  // Start from somewhere else, so this row is not already the current one.
  [...d.querySelectorAll('.lib-row')].find(b => b.dataset.type !== 'pdf')
    .dispatchEvent(new w.Event('click', { bubbles: true }));
  await settle();

  row.dispatchEvent(new w.Event('click', { bubbles: true }));
  await settle();
  assert.equal(row.getAttribute('aria-current'), 'true', 'the first press did not show the record');
  assert.deepEqual(went, [], 'the first press must never open anything');

  row.dispatchEvent(new w.Event('click', { bubbles: true }));
  await settle();
  assert.equal(went.length, 1, 'the second press on the same row did not open it');
  assert.match(went[0], /navigation/, 'something other than a navigation happened');

  // Where it goes is asserted directly, because jsdom will not say.
  assert.equal(w.IDFLLib.viewerUrl(row.dataset.id),
    '/customer/media-viewer.html?id=' + encodeURIComponent(row.dataset.id));
});

await t('pressing a row’s own open control skips the selection step', async () => {
  const w = A.dom.window, d = w.document;
  const went = [];
  A.dom.virtualConsole.removeAllListeners('jsdomError');
  A.dom.virtualConsole.on('jsdomError', (e) => {
    if (/navigation/.test(String(e.message))) went.push(String(e.message));
  });

  const row = [...d.querySelectorAll('.lib-row')].find(
    b => b.getAttribute('aria-current') !== 'true' && b.dataset.type !== 'external');
  row.querySelector('.lib-row__go').dispatchEvent(new w.Event('click', { bubbles: true }));
  await settle();
  assert.equal(went.length, 1, 'the open control did not open the record');
});

await t('a link opens where it lives, not inside the portal', async () => {
  const w = A.dom.window, d = w.document;
  const opened = [];
  const realOpen = w.open;
  w.open = (url, target, features) => { opened.push([url, target, features]); return null; };
  try {
    const link = [...d.querySelectorAll('.lib-row')].find(b => b.dataset.type === 'external');
    link.querySelector('.lib-row__go').dispatchEvent(new w.Event('click', { bubbles: true }));
    await settle();
  } finally { w.open = realOpen; }
  assert.equal(opened.length, 1, 'the link did not open');
  assert.equal(opened[0][1], '_blank');
  assert.equal(opened[0][2], 'noopener', 'a new tab must not keep a handle on this one');
  // Still through the gate, so the destination is never in the page's markup.
  assert.ok(opened[0][0].indexOf('protected-file') > 0, 'the raw URL leaked into the page');
});

await t('the inspector offers the right primary action per type', async () => {
  const w = A.dom.window, d = w.document;
  const pick = (type) => {
    const b = [...d.querySelectorAll('.lib-row')].find(x => x.dataset.type === type);
    b.dispatchEvent(new w.Event('click', { bubbles: true }));
    return d.getElementById('libInsp');
  };
  const open = pick('html').querySelector('a.lib-btn--primary');
  assert.ok(open.getAttribute('href').indexOf('/customer/media-viewer.html?id=') === 0,
    'a presentation should open in the viewer');

  const go = pick('external').querySelector('a.lib-btn--primary');
  assert.ok(go.getAttribute('href').indexOf('/.netlify/functions/protected-file?id=') === 0,
    'an external link must be proxied');
  assert.equal(go.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(go.getAttribute('target'), '_blank');
});

await t('an external link is never exposed as a raw URL', async () => {
  const d = A.dom.window.document;
  assert.equal(d.body.innerHTML.indexOf('global-standard.org'), -1, 'the destination URL leaked into the page');
});

await t('STAFF ONLY is a label on a decision the server already made', async () => {
  const d = A.dom.window.document;
  assert.equal(d.querySelectorAll('.lib-tag--staff').length, 0, 'a customer was shown a STAFF ONLY row');
  const j = await (await fetch(BASE + '/.netlify/functions/protected-list', { headers: { cookie: A.cookieHeader() } })).json();
  assert.equal(j.files.filter(f => f.role === 'staff').length, 0, 'the API sent a customer a staff record');
});

await t('the header counts what is really there', async () => {
  const d = A.dom.window.document;
  const cards = [...d.querySelectorAll('#libCards .lib-card')];
  assert.equal(cards.length, 3, 'expected three stat cards');
  const txt = cards.map(c => c.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(txt[0].indexOf('閲覧可能な資料') >= 0, 'got: ' + txt.join(' | '));
  assert.ok(/^0?3/.test(txt[0]), 'the count is not the real one: ' + txt[0]);
  assert.ok(txt[1].indexOf('コレクション') >= 0);
  assert.ok(txt[2].indexOf('最終更新') >= 0);
  // Dates read as the console spells them, from the record's own value.
  assert.ok(/\d{4}\.\d{2}\.\d{2}/.test(txt[2]), 'got: ' + txt[2]);
});

await t('search narrows the list, and clearing it restores every record', async () => {
  const w = A.dom.window, d = w.document;
  w.IDFLLib.setQuery('チェックリスト');
  assert.equal(d.querySelectorAll('.lib-row').length, 1);
  assert.ok(d.querySelector('.lib-row').textContent.indexOf('準備チェックリスト') >= 0);
  w.IDFLLib.setQuery('');
  assert.equal(d.querySelectorAll('.lib-row').length, 3);
});

await t('a search that matches nothing explains itself and offers a way back', async () => {
  const w = A.dom.window, d = w.document;
  w.IDFLLib.setQuery('この語はどの資料にもありません');
  assert.equal(d.querySelectorAll('.lib-row').length, 0);
  assert.ok(d.getElementById('libList').textContent.indexOf('該当する資料がありません') >= 0);
  assert.ok(d.getElementById('libReset'), 'no way to clear the filter');
  d.getElementById('libReset').dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.equal(d.querySelectorAll('.lib-row').length, 3);
});

await t('the media-type filter narrows the list and reports it', async () => {
  const w = A.dom.window, d = w.document;
  w.IDFLLib.setType('pdf');
  assert.equal(d.querySelectorAll('.lib-row').length, 1);
  assert.equal(d.querySelector('.lib-types__btn[data-type="pdf"]').getAttribute('aria-pressed'), 'true');
  const head = d.getElementById('libListHead').textContent.replace(/\s+/g, ' ');
  assert.ok(head.indexOf('PDF') >= 0, 'the table head does not name the filter: ' + head);
  assert.ok(head.indexOf('1件を表示中') >= 0, 'got: ' + head);
  w.IDFLLib.setType('all');
  assert.equal(d.querySelectorAll('.lib-row').length, 3);
});

await t('the table can be reordered, and says which order it is in', async () => {
  const w = A.dom.window, d = w.document;
  const names = () => [...d.querySelectorAll('.lib-row__t')].map(e => e.textContent);
  assert.ok(d.getElementById('libListHead').textContent.indexOf('更新日の新しい順') >= 0);
  const byDate = names();
  d.getElementById('libSort').dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.ok(d.getElementById('libListHead').textContent.indexOf('名前順') >= 0);
  const byName = names();
  assert.equal(byName.length, byDate.length);
  assert.deepEqual(byName, byDate.slice().sort((a, b) => a.localeCompare(b, 'ja')));
  d.getElementById('libSort').dispatchEvent(new w.Event('click', { bubbles: true }));
});

await t('the ACCESS column reports what the record actually is', async () => {
  const d = A.dom.window.document;
  const cell = (type) => [...d.querySelectorAll('.lib-row')]
    .find(b => b.dataset.type === type).querySelector('.lib-access').textContent.trim();
  assert.equal(cell('pdf'), 'CUSTOMER');
  assert.equal(cell('external'), 'PUBLIC');
});

await t('the collections tree lists every group and the records inside it', async () => {
  const d = A.dom.window.document;
  const names = [...d.querySelectorAll('.lib-tree__btn')].map(b => b.dataset.coll);
  assert.ok(names.indexOf('IDFL Guide') >= 0, 'got: ' + names.join(' | '));
  assert.ok(names.indexOf('2026 大阪セミナー') >= 0);
  // Each group carries its records, so the rail is a directory rather than a
  // list of folder names.
  const guide = [...d.querySelectorAll('.lib-tree__grp')]
    .find(g => g.querySelector('.lib-tree__btn').dataset.coll === 'IDFL Guide');
  const titles = [...guide.querySelectorAll('.lib-tree__item')].map(b => b.textContent.trim());
  assert.equal(titles.length, 2, 'got: ' + titles.join(' | '));
  assert.ok(titles.some(t => t.indexOf('準備チェックリスト') >= 0));
});

await t('a group scopes the table, and a record inside it selects', async () => {
  const w = A.dom.window, d = w.document;
  const grp = [...d.querySelectorAll('.lib-tree__btn')].find(b => b.dataset.coll === '2026 大阪セミナー');
  grp.dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.equal(d.querySelectorAll('.lib-row').length, 1);
  assert.ok(d.getElementById('libListHead').textContent.indexOf('2026 大阪セミナー') >= 0);
  // Pressing the scoped group again releases the scope.
  d.querySelector('.lib-tree__btn[data-coll="2026 大阪セミナー"]').dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.equal(d.querySelectorAll('.lib-row').length, 3);

  const item = d.querySelector('.lib-tree__item');
  const id = item.dataset.id;
  item.dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.equal(w.IDFLLib.state.activeId, id, 'a record in the tree did not select');
  assert.ok(d.getElementById('libInsp').textContent.trim().length > 0);
});

await t('the retired downloads page is gone from the toolbar', async () => {
  const d = A.dom.window.document;
  assert.equal(d.querySelector('a[href*="downloads.html"]'), null,
    'the library still advertises the retired download page');
});

await t('the fullscreen control degrades where the API is absent', async () => {
  const w = A.dom.window, d = w.document;
  const btn = d.getElementById('libFs');
  assert.ok(btn, 'no fullscreen control');
  assert.ok(btn.getAttribute('aria-label'), 'the icon button has no label');
  // jsdom implements no Fullscreen API, which is exactly the unsupported case:
  // the control disables itself and explains why, rather than throwing.
  assert.equal(btn.disabled, true, 'an unsupported browser must not offer it');
  assert.equal(btn.getAttribute('aria-disabled'), 'true');
  assert.ok(String(btn.title).indexOf('対応していません') >= 0, 'no explanation: ' + btn.title);
  btn.dispatchEvent(new w.Event('click', { bubbles: true }));
});

// ==================================================================== viewer
await t('the viewer loads the presentation record and asks for a grant', async () => {
  const dom = await A.open('/customer/media-viewer.html?id=' + seeded.mediaId);
  const d = dom.window.document;
  assert.ok(d.getElementById('mTitle').textContent.indexOf('GOTS 8.0 スコープ4') >= 0);
  assert.equal(d.getElementById('mVer').textContent, 'Version 1');
  assert.equal(d.getElementById('fbToggle').hidden, false, 'the feedback control stayed hidden');
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

await t('autoplay is delegated to the frame, and nothing else is', async () => {
  // A package with narration cannot turn its own sound on without this: its
  // clips sit in a nested frame that is cross-origin to the package, so the
  // user's click never reaches the frame owning the <video> and Chrome refuses
  // to unmute. Delegation widens nothing else - the sandbox above still
  // withholds allow-same-origin, so the package keeps its opaque origin.
  const allow = String(A.viewer.window.document.getElementById('frame').getAttribute('allow') || '');
  // Parsed as a feature list rather than matched as a substring, so a
  // future 'autoplay-something' cannot pass this by accident.
  const features = allow.split(';').map(x => x.trim()).filter(Boolean);
  assert.ok(features.includes('autoplay'), 'autoplay must be delegated: ' + allow);
  assert.ok(features.includes('fullscreen'), 'fullscreen must stay delegated: ' + allow);
  for(const risky of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'display-capture']){
    assert.equal(allow.indexOf(risky), -1, risky + ' must never be delegated to an uploaded package');
  }
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
  const items = [...d.querySelectorAll('.lib-fbitem')];
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
  const items = [...dom.window.document.querySelectorAll('.lib-fbitem')];
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
    const before = d.querySelectorAll('.lib-fbitem').length;
    pickInFrame(dom, ANCHOR);
    await settle(3);
    F._resetRateLimit();
    d.getElementById('fMsg').value = '一覧の反映が遅れても表示されることの確認です。';
    d.getElementById('fName').value = 'QA FIXTURE - NOT A REAL PERSON';
    d.getElementById('fEmail').value = 'qa-fixture-a@example.invalid';
    d.getElementById('fPhone').value = '+81-00-0000-0000';
    w.submitFeedback();
    await settle(40);
    const items = [...d.querySelectorAll('.lib-fbitem')];
    assert.equal(items.length, before + 1, 'the submitted item vanished while the listing lagged');
    assert.ok(items.some(i => i.textContent.indexOf('一覧の反映が遅れても') >= 0), 'the new item is not the one shown');
  } finally { setListLag(0); }
});

await t('it is not duplicated once the listing catches up', async () => {
  const dom = await A.open('/customer/media-viewer.html?id=' + seeded.mediaId);
  await settle(25);
  const texts = [...dom.window.document.querySelectorAll('.lib-fbitem .lib-fbitem__msg')].map(e => e.textContent);
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
  assert.equal(d.querySelectorAll('.lib-fbitem').length, 0, 'another customer\'s feedback was visible');
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
  const items = [...d.querySelectorAll('.lib-fbitem')];
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
  const row = [...d2.querySelectorAll('.lib-fbitem')].find(r => r.textContent.indexOf('onerror') >= 0);
  assert.ok(row, 'payload not listed');
  assert.equal(row.querySelectorAll('img').length, 0, 'payload parsed as markup');
  assert.equal(w2.__pwned, undefined, 'payload executed');
});

await t('the viewer refuses a media id the customer may not read', async () => {
  const dom = await B.open('/customer/media-viewer.html?id=' + seeded.draftId);
  await settle(20);
  const d = dom.window.document;
  assert.ok(d.getElementById('stage').textContent.indexOf('表示できません') >= 0, 'draft was not refused: ' + d.getElementById('stage').textContent.slice(0, 120));
  assert.equal(d.getElementById('frame'), null, 'a draft must not be mounted for a customer');
});

await t('staff can preview the same draft through the same viewer', async () => {
  const S = makeBrowser();
  assert.equal(await S.login('staff', ENV.STAFF_ACCESS_PASSWORD, '10.4.0.4'), 200);
  const dom = await S.open('/customer/media-viewer.html?id=' + seeded.draftId);
  await settle(20);
  const d = dom.window.document;
  assert.ok(d.getElementById('frame'), 'staff preview did not mount');
  assert.ok(d.querySelector('.lib-badge--draft'), 'draft badge not shown');
  assert.ok(d.getElementById('vwTags').textContent.indexOf('下書き') >= 0);
  assert.ok(d.getElementById('mVer').textContent.indexOf('Version') >= 0, 'version badge missing for staff preview');
});

server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

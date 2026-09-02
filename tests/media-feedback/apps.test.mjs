// ============================================================
// Customer Apps Platform: /customer/<slug> direct routes.
//
// The slug is only an alias for an existing protected media record, so the
// tests care most about the boundaries: a slug must never shadow a real page,
// two records must never share one, and an app that is draft, disabled or
// above the caller's role must be indistinguishable from one that never
// existed.
//
//   node tests/media-feedback/apps.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createServer, setEnv, invoke, resetStores, loadFn, ROOT } from './harness.mjs';
import { zipDir, makeZip } from './zip-writer.mjs';

const require_ = createRequire(import.meta.url);
const PKG = process.env.IDFL_TEST_PKG || 'C:/Users/AldenLin/AppData/Local/Temp/claude/C--Users-AldenLin/28ad7c38-23a1-4aca-9a88-61f754d8c111/scratchpad/gots-pkg';
const ENV = setEnv();
const APPS = loadFn('_apps');

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
    httpMethod: 'POST', headers: Object.assign({}, SAME, { 'x-nf-client-connection-ip': '10.5.0.' + (++ipSeq) }),
    body: JSON.stringify({ role, password }),
  });
  return String((r.headers && r.headers['Set-Cookie']) || '').split(';')[0];
}
const as = (c) => Object.assign({ cookie: c }, SAME);
const J = (r) => { try{ return JSON.parse(r.body); }catch(e){ return {}; } };

async function upload(cookie, over){
  const zip = await zipDir(PKG);
  const r = await invoke('protected-media-upload', {
    httpMethod: 'POST', headers: as(cookie),
    body: JSON.stringify(Object.assign({
      filename: 'deck.zip', contentBase64: zip.toString('base64'),
      role: 'customer', status: 'published', title: 'Test App', group: 'Apps',
    }, over || {})),
  });
  return { status: r.statusCode, body: J(r) };
}
async function update(cookie, body){
  const r = await invoke('protected-update', { httpMethod: 'POST', headers: as(cookie), body: JSON.stringify(body) });
  return { status: r.statusCode, body: J(r) };
}
async function resolve(cookie, slug){
  const r = await invoke('customer-app', { headers: cookie ? as(cookie) : SAME, queryStringParameters: { slug } });
  return { status: r.statusCode, body: J(r) };
}

// ==========================================================================
G('SLUG RULES (_apps.js)');

await t('accepts the documented shapes', () => {
  // 'mms' is deliberately absent: customer/mms.html exists, so it is reserved.
  for(const s of ['gots-scope4', 'tc-helper', 'rds-training', 'material-calculator', 'a', 'app2026', 'x-1']){
    const v = APPS.validateSlug(s);
    assert.equal(v.ok, true, s + ' should be valid: ' + (v.error || ''));
    assert.equal(v.slug, s);
  }
});

await t('normalises case and surrounding space', () => {
  assert.equal(APPS.validateSlug('  TC-Helper  ').slug, 'tc-helper');
  assert.equal(APPS.validateSlug('GOTS-Scope4').slug, 'gots-scope4');
  // Normalisation happens before the reserved check, so a cased reserved name is still refused.
  assert.equal(APPS.validateSlug('MMS').ok, false);
});

await t('an empty slug is valid and means "no direct route"', () => {
  const v = APPS.validateSlug('');
  assert.equal(v.ok, true);
  assert.equal(v.slug, '');
});

await t('rejects every shape the brief called out', () => {
  const bad = ['MMS Guide', '../admin', 'media.html', '<script>', 'ガイド', 'a/b', 'x?y=1',
               '-lead', 'trail-', 'a_b', 'a.b', 'x y', '%2e%2e', 'a'.repeat(61)];
  for(const s of bad){
    const v = APPS.validateSlug(s);
    assert.equal(v.ok, false, JSON.stringify(s) + ' should be rejected');
    assert.ok(v.error && v.error.length > 0);
  }
});

await t('a traversal attempt cannot survive normalisation', () => {
  for(const s of ['../admin', '..', '../../etc/passwd', './x', '/customer/media']){
    assert.equal(APPS.validateSlug(s).ok, false, s);
  }
});

await t('reserves the fixed route names', () => {
  for(const s of ['media', 'media-viewer', 'downloads', 'apps', 'app', 'login', 'admin', 'feedback']){
    const v = APPS.validateSlug(s);
    assert.equal(v.ok, false, s + ' should be reserved');
    assert.equal(v.error, 'このURLは既存のページで使用されています。');
  }
});

await t('derives reservations from the real pages under /customer/', () => {
  const onDisk = fs.readdirSync(path.join(ROOT, 'customer')).filter(f => /\.html?$/i.test(f));
  assert.ok(onDisk.length >= 4, 'expected several customer pages, found ' + onDisk.length);
  for(const f of onDisk){
    const bare = f.replace(/\.html?$/i, '').toLowerCase();
    const v = APPS.validateSlug(bare);
    assert.equal(v.ok, false, '/customer/' + f + ' must reserve the slug "' + bare + '"');
  }
  // and specifically the big pre-existing apps
  for(const s of ['mms', 'fsc', 'gots-v8']) assert.equal(APPS.validateSlug(s).ok, false, s + ' must be reserved while ' + s + '.html exists');
});

await t('the reserved list would free a slug if its page were removed', () => {
  // The list is derived, not hard-coded, so deleting customer/mms.html would
  // make "mms" available with no code change.
  const derived = APPS.reservedFromDisk();
  assert.ok(derived.indexOf('mms') >= 0, 'mms should currently be derived from disk');
  assert.ok(APPS.RESERVED_FIXED.indexOf('mms') < 0, 'mms must NOT be hard-coded, or removing the page could never free it');
});

// ==========================================================================
G('SERVER-SIDE ENFORCEMENT');
resetStores();
const CUST = await login('customer', ENV.CUSTOMER_ACCESS_PASSWORD);
const STAFF = await login('staff', ENV.STAFF_ACCESS_PASSWORD);
let APP_A, APP_B;

await t('staff can attach a slug at upload time', async () => {
  const r = await upload(STAFF, { title: 'GOTS Scope 4', appSlug: 'gots-scope4', appEnabled: true, appDescription: 'Interactive Training', appIcon: '🧪' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  APP_A = r.body.id;
  const list = J(await invoke('protected-list', { headers: as(STAFF) })).files.find(f => f.id === APP_A);
  assert.equal(list.appSlug, 'gots-scope4');
  assert.equal(list.appEnabled, true);
  assert.equal(list.appDescription, 'Interactive Training');
  assert.equal(list.appIcon, '🧪');
  assert.equal(list.feedbackEnabled, true, 'feedback should default on');
});

await t('a reserved slug is refused by the SERVER, not just the console', async () => {
  const r = await upload(STAFF, { title: 'Bad', appSlug: 'downloads', appEnabled: true });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'このURLは既存のページで使用されています。');
});

await t('an existing customer page name is refused', async () => {
  for(const s of ['mms', 'media', 'media-viewer']){
    const r = await upload(STAFF, { title: 'Bad', appSlug: s, appEnabled: true });
    assert.equal(r.status, 400, s + ' should be refused');
  }
});

await t('a malformed slug is refused server-side', async () => {
  const r = await upload(STAFF, { title: 'Bad', appSlug: '../admin', appEnabled: true });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /半角英小文字/);
});

await t('a duplicate slug is refused server-side', async () => {
  const r = await upload(STAFF, { title: 'Clash', appSlug: 'gots-scope4', appEnabled: true });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'このURLは別のメディアで使用されています。');
});

await t('a second app with its own slug is fine', async () => {
  const r = await upload(STAFF, { title: 'TC Helper', appSlug: 'tc-helper', appEnabled: true, appDescription: 'TC Support Tool' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  APP_B = r.body.id;
});

await t('a record may keep its own slug when edited', async () => {
  const r = await update(STAFF, { id: APP_A, appSlug: 'gots-scope4', appEnabled: true, title: 'GOTS Scope 4 (edited)' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

await t('editing onto another record\'s slug is refused', async () => {
  const r = await update(STAFF, { id: APP_A, appSlug: 'tc-helper' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'このURLは別のメディアで使用されています。');
});

await t('enabling a direct route without a slug is refused', async () => {
  const r = await upload(STAFF, { title: 'No slug', appEnabled: true });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /URLを入力してください/);
});

await t('a customer cannot set app fields', async () => {
  const r = await update(CUST, { id: APP_A, appSlug: 'hijack' });
  assert.equal(r.status, 403);
});

// ==========================================================================
G('RESOLUTION');

await t('a customer resolves a published app', async () => {
  const r = await resolve(CUST, 'gots-scope4');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.id, APP_A);
  assert.equal(r.body.slug, 'gots-scope4');
  assert.equal(r.body.entry, 'index.html');
  assert.equal(r.body.feedbackEnabled, true);
});

await t('resolution is case-insensitive on the way in', async () => {
  assert.equal((await resolve(CUST, 'GOTS-Scope4')).status, 200);
});

await t('an unknown slug is a plain 404 that leaks nothing', async () => {
  const r = await resolve(CUST, 'not-real');
  assert.equal(r.status, 404);
  assert.deepEqual(Object.keys(r.body), ['error']);
  assert.equal(r.body.error, 'not found');
});

await t('an anonymous visitor gets 401, never the app', async () => {
  const r = await resolve('', 'gots-scope4');
  assert.equal(r.status, 401);
  assert.equal(r.body.id, undefined);
  assert.equal(r.body.entry, undefined);
});

await t('appEnabled=false removes the route but keeps the media', async () => {
  await update(STAFF, { id: APP_B, appEnabled: false });
  assert.equal((await resolve(CUST, 'tc-helper')).status, 404);
  // ...and the record is still a normal Media Library item
  const still = J(await invoke('protected-list', { headers: as(CUST) })).files.find(f => f.id === APP_B);
  assert.ok(still, 'the media record must survive losing its direct route');
  assert.equal(still.mediaType, 'html');
  await update(STAFF, { id: APP_B, appEnabled: true });
  assert.equal((await resolve(CUST, 'tc-helper')).status, 200);
});

await t('a draft app is staff-only and invisible to a customer', async () => {
  await update(STAFF, { id: APP_B, status: 'draft' });
  assert.equal((await resolve(CUST, 'tc-helper')).status, 404, 'a draft must not resolve for a customer');
  assert.equal((await resolve(STAFF, 'tc-helper')).status, 200, 'staff should still preview it');
  await update(STAFF, { id: APP_B, status: 'published' });
});

await t('unpublishing takes the route away from customers', async () => {
  await update(STAFF, { id: APP_A, status: 'draft' });
  assert.equal((await resolve(CUST, 'gots-scope4')).status, 404);
  await update(STAFF, { id: APP_A, status: 'published' });
  assert.equal((await resolve(CUST, 'gots-scope4')).status, 200);
});

await t('a staff-only app is invisible to a customer', async () => {
  const r = await upload(STAFF, { title: 'Internal', appSlug: 'internal-tool', appEnabled: true, role: 'staff' });
  assert.equal(r.status, 200);
  assert.equal((await resolve(CUST, 'internal-tool')).status, 404);
  assert.equal((await resolve(STAFF, 'internal-tool')).status, 200);
});

await t('staff can open a customer app', async () => {
  assert.equal((await resolve(STAFF, 'gots-scope4')).status, 200);
});

await t('changing a slug moves the route and frees the old one', async () => {
  await update(STAFF, { id: APP_A, appSlug: 'gots-scope4-v2' });
  assert.equal((await resolve(CUST, 'gots-scope4-v2')).status, 200);
  const old = await resolve(CUST, 'gots-scope4');
  assert.equal(old.status, 404, 'the old route must not point at anything');
  await update(STAFF, { id: APP_A, appSlug: 'gots-scope4' });
});

await t('feedbackEnabled=false is reported to the shell', async () => {
  await update(STAFF, { id: APP_B, feedbackEnabled: false });
  assert.equal((await resolve(CUST, 'tc-helper')).body.feedbackEnabled, false);
  await update(STAFF, { id: APP_B, feedbackEnabled: true });
  assert.equal((await resolve(CUST, 'tc-helper')).body.feedbackEnabled, true);
});

await t('a standalone .html app resolves the same way', async () => {
  const html = Buffer.from('<!doctype html><html><body><h1>Solo</h1></body></html>', 'utf8');
  const r = await invoke('protected-media-upload', {
    httpMethod: 'POST', headers: as(STAFF),
    body: JSON.stringify({ filename: 'solo.html', contentBase64: html.toString('base64'), role: 'customer',
      status: 'published', title: 'Solo App', appSlug: 'solo-app', appEnabled: true }),
  });
  assert.equal(r.statusCode, 200, r.body);
  const got = await resolve(CUST, 'solo-app');
  assert.equal(got.status, 200);
  assert.equal(got.body.entry, 'index.html');
});

// ==========================================================================
G('APPS LIST');

await t('the dashboard lists only what the caller may open', async () => {
  const r = J(await invoke('customer-app', { headers: as(CUST), queryStringParameters: { list: '1' } }));
  const slugs = r.apps.map(a => a.slug);
  assert.ok(slugs.indexOf('gots-scope4') >= 0);
  assert.ok(slugs.indexOf('tc-helper') >= 0);
  assert.ok(slugs.indexOf('solo-app') >= 0);
  assert.equal(slugs.indexOf('internal-tool'), -1, 'a staff-only app leaked into the customer list');
  for(const a of r.apps){ assert.ok(a.slug && a.title); assert.equal(a.id, undefined, 'the list must not expose blob ids'); }
});

await t('staff see the staff-only app too', async () => {
  const r = J(await invoke('customer-app', { headers: as(STAFF), queryStringParameters: { list: '1' } }));
  assert.ok(r.apps.map(a => a.slug).indexOf('internal-tool') >= 0);
});

await t('an anonymous visitor gets no list at all', async () => {
  const r = await invoke('customer-app', { headers: SAME, queryStringParameters: { list: '1' } });
  assert.equal(r.statusCode, 401);
  assert.equal(J(r).apps, undefined);
});

await t('a media record with no slug never appears as an app', async () => {
  const r = await upload(STAFF, { title: 'Library only' });
  assert.equal(r.status, 200);
  const apps = J(await invoke('customer-app', { headers: as(CUST), queryStringParameters: { list: '1' } })).apps;
  assert.ok(!apps.some(a => a.title === 'Library only'));
  // ...but it is in the Media Library
  assert.ok(J(await invoke('protected-list', { headers: as(CUST) })).files.some(f => f.title === 'Library only'));
});

// ==========================================================================
G('MEDIA LIBRARY COMPATIBILITY');

await t('an app is ALSO still a Media Library item', async () => {
  const files = J(await invoke('protected-list', { headers: as(CUST) })).files;
  const it = files.find(f => f.id === APP_A);
  assert.ok(it, 'the app disappeared from the Media Library');
  assert.equal(it.mediaType, 'html');
  assert.equal(it.appSlug, 'gots-scope4');
  assert.equal(it.appEnabled, true);
});

await t('the viewer route still works for the same record', async () => {
  const g = J(await invoke('media-grant', { headers: as(CUST), queryStringParameters: { id: APP_A } }));
  assert.equal(g.ok, true);
  const r = await invoke('protected-media-asset', {
    headers: SAME,
    path: '/media/' + APP_A + '/' + g.token + '/v/index.html',
    queryStringParameters: {},
  });
  assert.equal(r.statusCode, 200);
  assert.ok(Buffer.from(r.body, 'base64').toString('utf8').includes('scripts/deck.js'));
});

await t('the package is served from the SAME blobs, not a copy', async () => {
  const { dumpStore } = await import('./harness.mjs');
  const media = dumpStore('idfl-media-html-dev');
  const mine = [...media.keys()].filter(k => k.indexOf(APP_A + '/') === 0);
  assert.equal(mine.length, 14, 'expected exactly one package for the record, got ' + mine.length);
});

// ==========================================================================
G('ROUTING (mirrors netlify.toml)');
const server = createServer();
await new Promise(r => server.listen(0, r));
const BASE = 'http://localhost:' + server.address().port;

await t('/customer/<slug> serves the app shell', async () => {
  const r = await fetch(BASE + '/customer/gots-scope4');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('customer-app?slug='), 'the shell should resolve the slug itself');
  assert.ok(html.includes('IDFL お客様専用システム'));
});

await t('a real page under /customer/ still wins over the router', async () => {
  for(const [url, marker] of [
    ['/customer/downloads.html', 'お客様専用ダウンロード'],
    ['/customer/media.html', 'IDFL メディアライブラリ'],
    ['/customer/media-viewer.html', '資料ビューア'],
  ]){
    const r = await fetch(BASE + url);
    assert.equal(r.status, 200, url);
    assert.ok((await r.text()).includes(marker), url + ' was shadowed by the app shell');
  }
});

await t('the extensionless form of a real page is not the shell either', async () => {
  const r = await fetch(BASE + '/customer/downloads');
  assert.equal(r.status, 200);
  assert.ok((await r.text()).includes('お客様専用ダウンロード'), '/customer/downloads must be the download page');
});

await t('/customer and /customer/ land on the apps dashboard', async () => {
  for(const u of ['/customer', '/customer/']){
    const r = await fetch(BASE + u);
    assert.equal(r.status, 200, u);
    assert.ok((await r.text()).includes('IDFL お客様専用システム'), u);
  }
});

await t('an unknown slug still serves the shell, which shows the not-found state', async () => {
  const r = await fetch(BASE + '/customer/not-real');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('お探しのシステムが見つかりませんでした'));
  assert.ok(html.includes('お客様専用システムへ') && html.includes('IDFL JAPAN トップへ'));
});

await t('the shell returns the customer to the app after login', async () => {
  const html = await (await fetch(BASE + '/customer/gots-scope4')).text();
  assert.ok(html.includes("'/login.html?role=customer&next='+encodeURIComponent(SELF)"),
    'the shell must send the customer back to the app, not the Media Library');
  assert.ok(html.includes('var SELF=location.pathname'));
});

await t('login accepts an app path as its return target', async () => {
  const login = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8');
  assert.ok(login.includes("if(!/^\\/[^\\/]/.test(next) || /^\\/\\//.test(next)) next='/';"),
    'the existing local-path guard should be unchanged');
  // /customer/mms passes that guard; //evil.example does not.
  const ok = (n) => /^\/[^\/]/.test(n) && !/^\/\//.test(n);
  assert.equal(ok('/customer/gots-scope4'), true);
  assert.equal(ok('//evil.example'), false);
  assert.equal(ok('https://evil.example'), false);
});

await t('the shell never embeds the blob id or a grant in its markup', async () => {
  const html = await (await fetch(BASE + '/customer/gots-scope4')).text();
  assert.equal(html.indexOf(APP_A), -1, 'the media id leaked into the shell HTML');
  assert.ok(!/idfl-media-html|idfl-protected|idfl-feedback/.test(html), 'a store name leaked into the shell');
});

await t('the shell sandboxes the app without allow-same-origin', async () => {
  const html = await (await fetch(BASE + '/customer/gots-scope4')).text();
  const m = /setAttribute\('sandbox','([^']+)'\)/.exec(html);
  assert.ok(m, 'no sandbox attribute is set on the iframe');
  const flags = m[1].split(/\s+/);
  assert.ok(flags.indexOf('allow-scripts') >= 0, 'the app needs scripts');
  // Checked on the attribute VALUE, not the whole file: the surrounding comment
  // legitimately mentions the flag it is there to exclude.
  assert.equal(flags.indexOf('allow-same-origin'), -1, 'allow-same-origin would hand the app our origin');
  assert.equal(flags.indexOf('allow-top-navigation'), -1);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
// Set the code and let the loop drain instead of calling process.exit(): forcing
// exit while the listener is still tearing down trips a libuv assertion on
// Windows and reports a false suite failure.
process.exitCode = fail ? 1 : 0;
server.close();
server.unref();

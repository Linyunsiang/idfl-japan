// ============================================================
// The bug this file exists for:
//
// /admin saved an edit, the toast said 保存しました, and the row snapped back
// to its old title. Publishing had the same shape - the item never turned up
// on /customer/media. Nothing had failed: protected-update wrote the record
// and answered 200. The list that redrew right afterwards was served from the
// blobs edge cache, which had not caught up.
//
// Worse than showing the wrong row: the editor then saved again from the stale
// values still on screen, and protected-update - a read-modify-write - read
// the stale record and wrote it back over the good one. The first edit was
// genuinely gone by then.
//
//   node tests/media-feedback/stale-read.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import { setEnv, invoke, resetStores, setReadStale, setListLag } from './harness.mjs';

setEnv();

let pass = 0, fail = 0;
function G(n){ console.log('\n' + n); }
async function t(name, fn){
  try{ await fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.message)); fail++; }
}

const SAME_ORIGIN = { host: 'localhost', origin: 'http://localhost' };
let ipSeq = 0;
function J(res){ try{ return JSON.parse(res.body); }catch(e){ return {}; } }
function as(cookie){ return Object.assign({ cookie }, SAME_ORIGIN); }

async function login(role, password){
  const headers = Object.assign({}, SAME_ORIGIN, { 'x-nf-client-connection-ip': '10.9.0.' + (++ipSeq) });
  const r = await invoke('auth-login', { httpMethod: 'POST', headers, body: JSON.stringify({ role, password }) });
  return String((r.headers && r.headers['Set-Cookie']) || '').split(';')[0];
}
async function addLink(cookie, over){
  const r = await invoke('protected-addlink', { httpMethod: 'POST', headers: as(cookie),
    body: JSON.stringify(Object.assign({
      url: 'https://example.com/deck.pdf', title: '旧タイトル', role: 'customer',
      status: 'draft', group: '2026 大阪セミナー',
    }, over || {})) });
  return J(r);
}
async function update(cookie, body){
  const r = await invoke('protected-update', { httpMethod: 'POST', headers: as(cookie), body: JSON.stringify(body) });
  return { status: r.statusCode, body: J(r) };
}
async function list(cookie){
  const r = await invoke('protected-list', { httpMethod: 'GET', headers: as(cookie) });
  return J(r);
}
function find(listed, id){ return ((listed && listed.files) || []).find(f => f.id === id); }

// Every read in this file happens inside the window where the edge is still
// serving the previous copy. That is the whole point: 3 seconds of staleness,
// and no test waits it out.
const STALE_MS = 3000;

async function main(){
  resetStores();
  setReadStale(STALE_MS, 'idfl-protected');
  setListLag(0);

  const staff = await login('staff', 'harness-staff-password');
  const customer = await login('customer', 'test-customer-password');
  assert.ok(staff && customer, 'both sessions are needed');

  G('A SAVE, READ BACK BEFORE THE EDGE HAS CAUGHT UP');

  let id;
  await t('the edit is answered with the row that was written, not a promise', async () => {
    id = (await addLink(staff)).id;
    assert.ok(id, 'the link was stored');
    const r = await update(staff, { id, title: '新タイトル', description: 'セミナー当日の配布資料です。' });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.item, 'protected-update answers with the saved record');
    assert.equal(r.body.item.title, '新タイトル');
    assert.equal(r.body.item.description, 'セミナー当日の配布資料です。');
    assert.equal(r.body.item.id, id);
  });

  await t('the staff list shows the new title immediately, not the old one', async () => {
    const f = find(await list(staff), id);
    assert.ok(f, 'the record is listed');
    assert.equal(f.title, '新タイトル');
  });

  await t('a second edit builds on the first instead of reverting it', async () => {
    const r = await update(staff, { id, group: '2026 東京セミナー' });
    assert.equal(r.status, 200);
    assert.equal(r.body.item.group, '2026 東京セミナー');
    assert.equal(r.body.item.title, '新タイトル', 'the earlier edit survived the read-modify-write');
    const f = find(await list(staff), id);
    assert.equal(f.title, '新タイトル');
    assert.equal(f.group, '2026 東京セミナー');
  });

  G('PUBLISHING REACHES /customer/media WITHOUT A WAIT');

  await t('a draft is not visible to a customer', async () => {
    assert.equal(find(await list(customer), id), undefined);
  });

  await t('publishing shows up on the customer list right away', async () => {
    const r = await update(staff, { id, status: 'published' });
    assert.equal(r.status, 200);
    assert.equal(r.body.item.status, 'published');
    const f = find(await list(customer), id);
    assert.ok(f, 'the customer library sees the item it was just given');
    assert.equal(f.title, '新タイトル');
  });

  await t('un-publishing takes it away again, just as promptly', async () => {
    await update(staff, { id, status: 'draft' });
    assert.equal(find(await list(customer), id), undefined);
  });

  G('THE READ MODE IS REPORTED, SO A STALE LIST IS NEVER A GUESS');

  await t('staff are told which consistency their list was served with', async () => {
    assert.equal((await list(staff)).consistency, 'strong');
  });

  await t('customers are told nothing of the sort', async () => {
    assert.equal('consistency' in (await list(customer)), false);
  });

  G('METADATA IS A 2 KB HEADER, AND JAPANESE COSTS THREE BYTES A CHARACTER');

  await t('a 説明 the form allows but the store cannot hold is refused, with a length', async () => {
    const r = await update(staff, { id, description: 'あ'.repeat(600) });
    assert.equal(r.status, 413);
    assert.match(r.body.error, /短くして/);
    assert.match(r.body.error, /[0-9]+文字/, 'it says how much to cut');
  });

  await t('the refused edit changed nothing', async () => {
    const f = find(await list(staff), id);
    assert.equal(f.title, '新タイトル');
    assert.equal(f.description, 'セミナー当日の配布資料です。');
  });

  await t('a 説明 that does fit is still accepted', async () => {
    const r = await update(staff, { id, description: 'あ'.repeat(200) });
    assert.equal(r.status, 200);
    assert.equal(r.body.item.description.length, 200);
  });

  setReadStale(0);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main();

// ============================================================
// The Q&A editor inside /admin: the category dropdown, the image list, the
// NEW toggle, validation, and what actually gets written back to a record.
//
// admin.html is gated by a password before its UI appears, so these tests
// load the page and drive its real functions directly rather than clicking
// through the gate.
//
//   node tests/qa/admin-qa.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const SECTIONS_JS = fs.readFileSync(path.join(ROOT, 'js/qa-sections.js'), 'utf8');
const REAL_DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/qa.json'), 'utf8'));

let pass = 0, fail = 0;
async function t(name, fn){
  try{ await fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.message)); fail++; }
}
function G(n){ console.log('\n' + n); }

async function boot(records){
  const html = ADMIN.replace(/<script src="\/js\/qa-sections\.js"><\/script>/, '<script>' + SECTIONS_JS + '</script>');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://idfl-japan.com/admin',
    beforeParse(w){
      w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      w.confirm = () => true;
      w.alert = () => {};
    },
  });
  const w = dom.window;
  await new Promise(r => w.setTimeout(r, 0));
  // PW, CUR and DATA are top-level let/const in the page's classic script, so
  // they live in the global lexical environment and are not window properties.
  // A direct global eval is the only way in from outside.
  w.eval('PW = "test-password-not-real"; CUR = "qa";');
  w.DATA = w.eval('DATA');
  w.SCHEMAS = w.eval('SCHEMAS');
  w.DATA.qa = (records || []).map(r => JSON.parse(JSON.stringify(r)));
  return w;
}
/** Open the editor on a record (or -1 for a new one) and return the window. */
async function edit(records, idx){
  const w = await boot(records);
  w.openEdit(idx == null ? 0 : idx);
  return w;
}
const val = (w, k) => w.document.getElementById('fld_' + k).value;
const toasts = (w) => w.document.getElementById('toast').textContent;

// ==========================================================================
G('SCHEMA');

await t('the Q&A fields are in the order staff were asked to fill them', async () => {
  const w = await boot([]);
  const keys = w.SCHEMAS.qa.fields.map(f => f.k);
  assert.equal(keys.join(','), 'id,section,q,a,images,isNew,newUntil,link,linkLabel');
});

await t('section, question and answer are marked required', async () => {
  const w = await boot([]);
  const req = w.SCHEMAS.qa.fields.filter(f => f.req).map(f => f.k);
  for(const k of ['section','q','a']) assert.ok(req.includes(k), k + ' should be required');
});

// ==========================================================================
G('CATEGORY DROPDOWN');

await t('the free-text box is gone and a dropdown took its place', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A' }]);
  const el = w.document.getElementById('fld_section');
  assert.equal(el.tagName, 'SELECT', 'the section field must not be a text input any more');
});

await t('it offers every category, labelled in Japanese', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A' }]);
  const opts = [...w.document.getElementById('fld_section').options];
  assert.equal(opts.length, w.QA_SECTION_DEFS.keys().length);
  assert.equal(opts.map(o => o.value).join(','), w.QA_SECTION_DEFS.keys().join(','));
  const byKey = Object.fromEntries(opts.map(o => [o.value, o.textContent]));
  assert.equal(byKey.audit, '監査・認証編');
  assert.equal(byKey.tc, 'TC（取引証明書）編');
  assert.equal(byKey.chemical, 'ケミカル編');
  assert.equal(byKey.other, 'その他編');
});

await t('an existing record opens with its own category selected', async () => {
  for(const k of ['audit','tc','logo','other']){
    const w = await edit([{ id:'a', section:k, q:'Q', a:'A' }]);
    assert.equal(val(w, 'section'), k, 'wrong selection for ' + k);
  }
});

await t('a legacy free-text category falls back and says so', async () => {
  const w = await edit([{ id:'a', section:'むかしの自由入力', q:'Q', a:'A' }]);
  assert.equal(val(w, 'section'), 'other', 'it should preselect その他');
  const body = w.document.getElementById('mBody').textContent;
  assert.ok(body.includes('むかしの自由入力'), 'the old value should be shown to the editor');
  assert.ok(body.includes('選択肢にない'), 'and explained');
});

await t('saving normalises whatever is chosen', async () => {
  const w = await edit([{ id:'a', section:'AUDIT', q:'Q', a:'A' }]);
  w.saveModal();
  assert.equal(w.DATA.qa[0].section, 'audit');
});

// ==========================================================================
G('VALIDATION');

async function expectRefusal(w, mutate, phrase){
  mutate(w);
  const before = JSON.stringify(w.DATA.qa);
  w.saveModal();
  assert.equal(JSON.stringify(w.DATA.qa), before, 'the record must not be saved');
  assert.ok(toasts(w).includes(phrase), 'expected a message about ' + phrase + ', got: ' + toasts(w));
  assert.ok(w.document.getElementById('ov').classList.contains('open'), 'the editor should stay open');
}

await t('an empty question is refused, in Japanese', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A' }]);
  await expectRefusal(w, () => { w.document.getElementById('fld_q').value = '   '; }, '質問を入力');
});

await t('an empty answer is refused, in Japanese', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A' }]);
  await expectRefusal(w, () => { w.document.getElementById('fld_a').value = ''; }, '回答を入力');
});

await t('a category outside the list is refused', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A' }]);
  await expectRefusal(w, () => {
    const s = w.document.getElementById('fld_section');
    const o = w.document.createElement('option');
    o.value = 'not-a-real-section'; s.appendChild(o); s.value = 'not-a-real-section';
    w.QA_SECTION_DEFS.normalize = (x) => x;          // bypass the silent fix to reach the check
  }, '種類');
});

await t('a broken NEW end-date is refused', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A' }]);
  await expectRefusal(w, () => {
    w.document.getElementById('fld_isNew').checked = true;
    // <input type=date> refuses to hold an invalid value, which is the first
    // line of defence. Swap it to text to reach the validator behind it —
    // the case that matters is a bad date arriving from stored data.
    const d = w.document.getElementById('fld_newUntil');
    d.setAttribute('type', 'text');
    d.value = '2026-99-99';
  }, 'NEW表示の終了日');
});

await t('a valid record saves and closes the editor', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A' }]);
  w.document.getElementById('fld_q').value = '新しい質問';
  w.saveModal();
  assert.equal(w.DATA.qa[0].q, '新しい質問');
  assert.ok(!w.document.getElementById('ov').classList.contains('open'), 'the editor should close');
});

// ==========================================================================
G('IMAGES');

const IMGS = [{src:'/files/one.png',caption:'図1'},{src:'/files/two.png',caption:''},{src:'/files/three.png',caption:''}];

await t('existing images are listed with a preview and their path', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A', images:IMGS }]);
  const rows = w.document.querySelectorAll('#fld_images_list .imgrow');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].querySelector('img').getAttribute('src'), '/files/one.png');
  assert.ok(rows[0].textContent.includes('/files/one.png'), 'the path should be visible');
  assert.equal(rows[0].querySelector('input[type=text]').value, '図1', 'the caption should be editable');
});

await t('a record with no images shows a plain empty state', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A' }]);
  assert.equal(w.document.querySelectorAll('#fld_images_list .imgrow').length, 0);
  assert.ok(w.document.getElementById('fld_images_list').textContent.includes('画像はまだありません'));
});

await t('images can be reordered, and the order is what gets saved', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A', images:IMGS }]);
  w.qaImgMove('fld_images', 0, 1);                   // one <-> two
  w.saveModal();
  assert.equal(w.DATA.qa[0].images.map(i => i.src).join(','), '/files/two.png,/files/one.png,/files/three.png');
});

await t('the first image cannot move up and the last cannot move down', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A', images:IMGS }]);
  const rows = w.document.querySelectorAll('#fld_images_list .imgrow');
  assert.ok(rows[0].querySelectorAll('button')[0].disabled, 'first ↑ should be disabled');
  assert.ok(rows[2].querySelectorAll('button')[1].disabled, 'last ↓ should be disabled');
  w.qaImgMove('fld_images', 0, -1);                  // a no-op, not a crash
  assert.equal(w.qaImgRead('fld_images').length, 3);
});

await t('an image can be removed', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A', images:IMGS }]);
  w.qaImgRemove('fld_images', 1);
  w.saveModal();
  assert.equal(w.DATA.qa[0].images.map(i => i.src).join(','), '/files/one.png,/files/three.png');
});

await t('removing every image drops the field rather than storing an empty list', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A', images:[{src:'/files/only.png'}] }]);
  w.qaImgRemove('fld_images', 0);
  w.saveModal();
  assert.ok(!('images' in w.DATA.qa[0]), 'an empty images array should not be written');
});

await t('captions are saved', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A', images:[{src:'/files/a.png',caption:''}] }]);
  w.qaImgCaption('fld_images', 0, '図2：確認画面');
  w.saveModal();
  assert.equal(w.DATA.qa[0].images[0].caption, '図2：確認画面');
});

await t('a legacy img is shown in the new list so it can be managed', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A', img:'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }]);
  const list = w.qaImageList(w.DATA.qa[0]);
  assert.equal(list.length, 1, 'the old field should be read as one image');
  assert.equal(list[0].src.slice(0, 10), 'data:image');
});

await t('once real images exist the legacy field is dropped, so nothing doubles up', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A', img:'data:image/gif;base64,OLD' }]);
  w.qaImgWrite('fld_images', [{src:'/files/new.png',caption:''}]);
  w.saveModal();
  assert.equal(w.DATA.qa[0].images[0].src, '/files/new.png');
  assert.ok(!('img' in w.DATA.qa[0]), 'the old img field should be removed on save');
});

await t('a record untouched by the editor keeps its legacy image', async () => {
  const w = await boot([{ id:'a', section:'audit', q:'Q', a:'A', img:'data:image/gif;base64,KEEP' }]);
  assert.equal(w.DATA.qa[0].img, 'data:image/gif;base64,KEEP');
});

await t('only PNG / JPG / WebP are offered, and the size cap is 4MB', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A' }]);
  const accept = w.document.getElementById('fld_images_file').getAttribute('accept');
  for(const ty of ['image/png','image/jpeg','image/webp']) assert.ok(accept.includes(ty), 'missing ' + ty);
  assert.equal(w.eval('QA_IMG_MAX_BYTES'), 4*1024*1024);
});

await t('a wrong file type is rejected with a Japanese reason, before any upload', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A' }]);
  let called = false; w.fetch = () => { called = true; return Promise.reject(new Error('should not be reached')); };
  const r = await w.qaImgUploadOne({ name:'evil.svg', type:'image/svg+xml', size:1000 });
  assert.ok(r.error && r.error.includes('対応していない形式'), 'got: ' + JSON.stringify(r));
  assert.ok(r.error.includes('evil.svg'), 'the message should name the file');
  assert.equal(called, false, 'an invalid file must never be sent to the server');
});

await t('an oversized file is rejected with its actual size, before any upload', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A' }]);
  let called = false; w.fetch = () => { called = true; return Promise.reject(new Error('should not be reached')); };
  const r = await w.qaImgUploadOne({ name:'big.png', type:'image/png', size:9*1024*1024 });
  assert.ok(r.error && r.error.includes('大きすぎます'), 'got: ' + JSON.stringify(r));
  assert.ok(r.error.includes('9.0MB'), 'the message should state the size');
  assert.equal(called, false);
});

await t('an image is stored as a path, never inlined into the record', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A' }]);
  w.qaImgWrite('fld_images', [{src:'/files/uploaded.png',caption:''}]);
  w.saveModal();
  const json = JSON.stringify(w.DATA.qa[0]);
  assert.ok(json.includes('/files/uploaded.png'));
  assert.ok(!json.includes('data:image'), 'no data URI may be written into the record');
});

// ==========================================================================
G('NEW BADGE');

const future = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
const past   = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

await t('the toggle saves', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A' }]);
  w.document.getElementById('fld_isNew').checked = true;
  w.saveModal();
  assert.equal(w.DATA.qa[0].isNew, true);
});

await t('turning it off clears the end date too', async () => {
  const w = await edit([{ id:'a', section:'audit', q:'Q', a:'A', isNew:true, newUntil:future }]);
  w.document.getElementById('fld_isNew').checked = false;
  w.saveModal();
  assert.ok(!('isNew' in w.DATA.qa[0]));
  assert.ok(!('newUntil' in w.DATA.qa[0]), 'a stale end date should not linger');
});

await t('an end date in the future counts as NEW, one in the past does not', async () => {
  const w = await boot([]);
  assert.equal(w.qaIsNewNow({ isNew:true }), true);
  assert.equal(w.qaIsNewNow({ isNew:true, newUntil:future }), true);
  assert.equal(w.qaIsNewNow({ isNew:true, newUntil:past }), false);
  assert.equal(w.qaIsNewNow({ isNew:false, newUntil:future }), false);
  assert.equal(w.qaIsNewNow({}), false);
});

await t('the admin list shows NEW, the category and the image count', async () => {
  const w = await boot([]);
  const sub = w.SCHEMAS.qa.sub({ section:'tc', isNew:true, images:[{src:'/files/a.png'},{src:'/files/b.png'}] });
  assert.ok(sub.includes('NEW'), 'the badge should be visible in the list');
  assert.ok(sub.includes('TC（取引証明書）編'), 'the Japanese label, not the raw key');
  assert.ok(sub.includes('画像2枚'));
});

await t('an expired NEW is not advertised in the admin list either', async () => {
  const w = await boot([]);
  assert.ok(!w.SCHEMAS.qa.sub({ section:'audit', isNew:true, newUntil:past }).includes('NEW'));
});

// ==========================================================================
G('THE PUBLISHED DATA SURVIVES A ROUND TRIP');

await t('opening and saving each real record changes nothing but the timestamp', async () => {
  const w = await boot(REAL_DATA);
  let changed = 0;
  for(let i = 0; i < REAL_DATA.length; i++){
    const before = REAL_DATA[i];
    w.openEdit(i);
    w.saveModal();
    const after = w.DATA.qa[i];
    for(const k of ['id','q','a','link','linkLabel']){
      if((before[k] || '') !== (after[k] || '')) { changed++; console.log('       ' + before.id + ': ' + k + ' changed'); }
    }
    // the image must still be there in one form or the other
    const hadImg = !!before.img, hasImg = !!after.img || (Array.isArray(after.images) && after.images.length);
    if(hadImg && !hasImg) { changed++; console.log('       ' + before.id + ': lost its image'); }
    if(w.QA_SECTION_DEFS.normalize(before.section) !== after.section) { changed++; console.log('       ' + before.id + ': section moved'); }
  }
  assert.equal(changed, 0, changed + ' field(s) changed unexpectedly');
});

await t('no record loses its question or answer', async () => {
  const w = await boot(REAL_DATA);
  for(let i = 0; i < REAL_DATA.length; i++){ w.openEdit(i); w.saveModal(); }
  assert.equal(w.DATA.qa.length, REAL_DATA.length);
  for(const r of w.DATA.qa){ assert.ok(r.q, r.id + ' lost its question'); assert.ok(r.a, r.id + ' lost its answer'); }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;

// ============================================================
// Q&A: section taxonomy, image handling, NEW badge.
//
// The page is a static file with inline script, so the tests load the real
// qa.html into jsdom and drive its real functions against the real
// data/qa.json. Anything that passes here passes for the 57 records that are
// actually published.
//
//   node tests/qa/qa.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QA_HTML = fs.readFileSync(path.join(ROOT, 'qa.html'), 'utf8');
const SECTIONS_JS = fs.readFileSync(path.join(ROOT, 'js/qa-sections.js'), 'utf8');
const REAL_DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/qa.json'), 'utf8'));

let pass = 0, fail = 0;
function t(name, fn){
  try{ fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.message)); fail++; }
}
function G(n){ console.log('\n' + n); }

/** A page with the real markup and script, serving the given records.
 *  fetch is stubbed BEFORE the page scripts run: qaBoot() fetches
 *  /data/qa.json on load and would otherwise overwrite whatever we set here.
 *  localStorage is cleared for the same reason — a leftover admin draft wins
 *  over published data by design. */
async function boot(records){
  // strip the CDN tag: jsdom must not reach the network, and Tailwind is not
  // needed to exercise logic
  const html = QA_HTML.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '')
                      .replace(/<script src="\/js\/qa-sections\.js"><\/script>/, '<script>' + SECTIONS_JS + '</script>');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://idfl-japan.com/qa.html',
    beforeParse(w){
      w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(records) });
    },
  });
  const w = dom.window;
  try{ w.localStorage.clear(); }catch(e){}
  // qaBoot() is what actually populates the page; give it its turn
  await new Promise(r => w.setTimeout(r, 0));
  await new Promise(r => w.setTimeout(r, 0));
  w.qaRender();
  return w;
}
const rendered = (w) => w.document.getElementById('qaContainer').innerHTML;

// ==========================================================================
G('SECTION TAXONOMY');

const defsWin = new JSDOM('<!doctype html>', { runScripts: 'dangerously' }).window;
defsWin.eval(SECTIONS_JS);
const D = defsWin.QA_SECTION_DEFS;

await t('every requested category exists with a Japanese label', async () => {
  for(const k of ['audit','standards','tc','chemical','scope-certificate','factory','fees','seminar','other']){
    assert.ok(D.has(k), 'missing section: ' + k);
    assert.ok(D.label(k) && /[ぁ-んァ-ン一-龥A-Z]/.test(D.label(k)), 'no label for ' + k);
  }
});

await t('the sections already in use are all preserved', async () => {
  const used = [...new Set(REAL_DATA.map(r => r.section))];
  for(const k of used) assert.ok(D.has(k), 'live section would be lost: ' + k);
});

await t('keys are stable, lowercase and free of duplicates', async () => {
  const keys = D.keys();
  assert.equal(keys.length, new Set(keys).size, 'duplicate key');
  for(const k of keys) assert.match(k, /^[a-z][a-z-]*$/, 'bad key: ' + k);
});

await t('an unknown or empty value normalises to その他 rather than vanishing', async () => {
  assert.equal(D.normalize('does-not-exist'), 'other');
  assert.equal(D.normalize(''), 'other');
  assert.equal(D.normalize(null), 'other');
  assert.equal(D.normalize(undefined), 'other');
  assert.equal(D.label('does-not-exist'), 'その他編');
});

await t('normalising is forgiving about case and stray whitespace', async () => {
  assert.equal(D.normalize('  AUDIT '), 'audit');
  assert.equal(D.normalize('Tc'), 'tc');
});

await t('a known value is never rewritten', async () => {
  for(const k of D.keys()) assert.equal(D.normalize(k), k);
});

// ==========================================================================
G('BACKWARD COMPATIBILITY WITH THE PUBLISHED DATA');

await t('all 57 published records still render', async () => {
  const w = await boot(REAL_DATA);
  const html = rendered(w);
  let missing = 0;
  for(const r of REAL_DATA){
    const q = String(r.q).slice(0, 24).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if(html.indexOf(q) < 0) missing++;
  }
  assert.equal(missing, 0, missing + ' record(s) disappeared from the page');
});

await t('every published record lands in a real section', async () => {
  const w = await boot(REAL_DATA);
  for(const r of REAL_DATA){
    const k = w.qaSectionOf(r);
    assert.ok(D.has(k), r.id + ' resolved to a non-existent section: ' + k);
  }
});

await t('a record with only the old fields still works', async () => {
  const w = await boot([{ id:'legacy-1', section:'audit', q:'古い形式の質問', a:'古い形式の回答' }]);
  const html = rendered(w);
  assert.ok(html.includes('古い形式の質問'));
  assert.ok(html.includes('古い形式の回答'));
  assert.ok(!html.includes('qa-new'), 'a record without isNew must not get a badge');
  assert.ok(!html.includes('qa-figs'), 'a record without images must not get a figure block');
});

await t('the legacy single img field still displays', async () => {
  const w = await boot([{ id:'legacy-2', section:'tc', q:'旧画像', a:'回答', img:'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }]);
  const html = rendered(w);
  assert.ok(html.includes('qa-figs'), 'legacy img should render through the new figure markup');
  assert.ok(html.includes('data:image/gif;base64'), 'the legacy image itself must still appear');
});

await t('the 4 records that carry a legacy data-URI image still show it', async () => {
  const legacy = REAL_DATA.filter(r => r.img && !r.images);
  assert.equal(legacy.length, 4, 'expected the 4 known legacy images, found ' + legacy.length);
  const w = await boot(legacy);
  const figs = (rendered(w).match(/class="qa-figs"/g) || []).length;
  assert.equal(figs, 4, 'all four legacy images should render');
});

await t('an unknown section is shown under その他 instead of being dropped', async () => {
  const w = await boot([{ id:'x', section:'legacy-free-text', q:'見えるべき質問', a:'回答' }]);
  const html = rendered(w);
  assert.ok(html.includes('見えるべき質問'), 'the record must not disappear');
  assert.ok(html.includes('id="qa-sec-other"'), 'it should land in その他');
});

// ==========================================================================
G('IMAGES');

await t('images[] renders in the given order', async () => {
  const w = await boot([{ id:'i1', section:'audit', q:'Q', a:'A',
    images:[{src:'/files/one.png'},{src:'/files/two.png'},{src:'/files/three.png'}] }]);
  const html = rendered(w);
  const order = ['one','two','three'].map(x => html.indexOf('/files/' + x + '.png'));
  assert.ok(order.every(i => i >= 0), 'all three images should render');
  assert.equal(order.slice().sort((a,b)=>a-b).join(','), order.join(','), 'order must be preserved');
});

await t('captions render and are used as alt text', async () => {
  const w = await boot([{ id:'i2', section:'audit', q:'Q', a:'A',
    images:[{src:'/files/a.png', caption:'図1：申請画面'}] }]);
  const html = rendered(w);
  assert.ok(html.includes('<figcaption>図1：申請画面</figcaption>'));
  assert.ok(html.includes('alt="図1：申請画面"'), 'the caption should double as alt text');
});

await t('an image without a caption gets no empty figcaption', async () => {
  const w = await boot([{ id:'i3', section:'audit', q:'Q', a:'A', images:[{src:'/files/a.png'}] }]);
  assert.ok(!rendered(w).includes('<figcaption>'));
});

await t('plain string entries are accepted too', async () => {
  const w = await boot([{ id:'i4', section:'audit', q:'Q', a:'A', images:['/files/plain.png'] }]);
  assert.ok(rendered(w).includes('/files/plain.png'));
});

await t('empty and malformed entries are skipped, not rendered broken', async () => {
  const w = await boot([{ id:'i5', section:'audit', q:'Q', a:'A',
    images:[{src:''}, null, {caption:'説明だけ'}, {src:'/files/ok.png'}] }]);
  const html = rendered(w);
  assert.equal((html.match(/<figure/g) || []).length, 1, 'only the one valid image should render');
  assert.ok(html.includes('/files/ok.png'));
  assert.ok(!html.includes('src=""'), 'no empty src may be emitted');
});

await t('images[] wins over a leftover img on the same record', async () => {
  const w = await boot([{ id:'i6', section:'audit', q:'Q', a:'A',
    img:'data:image/gif;base64,OLD', images:[{src:'/files/new.png'}] }]);
  const html = rendered(w);
  assert.ok(html.includes('/files/new.png'));
  assert.ok(!html.includes('base64,OLD'), 'the old field must not render a second copy');
});

await t('the image count drives the layout hint', async () => {
  const one = await boot([{ id:'a', section:'audit', q:'Q', a:'A', images:[{src:'/files/a.png'}] }]);
  assert.ok(rendered(one).includes('data-count="1"'));
  const three = await boot([{ id:'b', section:'audit', q:'Q', a:'A',
    images:[{src:'/f/1.png'},{src:'/f/2.png'},{src:'/f/3.png'}] }]);
  assert.ok(rendered(three).includes('data-count="3"'));
});

await t('a quote in a caption cannot break out of the attribute', async () => {
  const w = await boot([{ id:'x1', section:'audit', q:'Q', a:'A',
    images:[{src:'/files/a.png', caption:'"><script>alert(1)</script>'}] }]);
  const cont = w.document.getElementById('qaContainer');
  assert.equal(cont.querySelectorAll('script').length, 0, 'a caption must never create an element');
  assert.equal(cont.querySelector('figcaption').textContent, '"><script>alert(1)</script>', 'it should survive as literal text');
});

// ==========================================================================
G('NEW BADGE');

const future = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
const past   = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

await t('isNew shows the badge', async () => {
  const w = await boot([{ id:'n1', section:'audit', q:'新着の質問', a:'A', isNew:true }]);
  assert.ok(rendered(w).includes('<span class="qa-new">NEW</span>'));
});

await t('no isNew, no badge', async () => {
  const w = await boot([{ id:'n2', section:'audit', q:'Q', a:'A' }]);
  assert.ok(!rendered(w).includes('qa-new'));
});

await t('isNew:false does not show the badge', async () => {
  const w = await boot([{ id:'n3', section:'audit', q:'Q', a:'A', isNew:false }]);
  assert.ok(!rendered(w).includes('qa-new'));
});

await t('a future newUntil keeps the badge', async () => {
  const w = await boot([{ id:'n4', section:'audit', q:'Q', a:'A', isNew:true, newUntil:future }]);
  assert.ok(rendered(w).includes('qa-new'));
});

await t('a past newUntil hides it automatically', async () => {
  const w = await boot([{ id:'n5', section:'audit', q:'Q', a:'A', isNew:true, newUntil:past }]);
  assert.ok(!rendered(w).includes('qa-new'), 'the badge should expire on its own');
});

await t('newUntil is inclusive of the day itself', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const w = await boot([{ id:'n6', section:'audit', q:'Q', a:'A', isNew:true, newUntil:today }]);
  assert.ok(rendered(w).includes('qa-new'), 'the badge should last until the end of the chosen day');
});

await t('a malformed newUntil does not silently hide the badge', async () => {
  const w = await boot([{ id:'n7', section:'audit', q:'Q', a:'A', isNew:true, newUntil:'not-a-date' }]);
  assert.ok(rendered(w).includes('qa-new'));
});

await t('newUntil alone, without isNew, shows nothing', async () => {
  const w = await boot([{ id:'n8', section:'audit', q:'Q', a:'A', newUntil:future }]);
  assert.ok(!rendered(w).includes('qa-new'));
});

// ==========================================================================
G('SECTIONS ON THE PAGE');

await t('a section with no questions is not rendered at all', async () => {
  const w = await boot([{ id:'s1', section:'audit', q:'Q', a:'A' }]);
  const html = rendered(w);
  assert.ok(html.includes('id="qa-sec-audit"'));
  for(const k of D.keys()) if(k !== 'audit') assert.ok(!html.includes('id="qa-sec-' + k + '"'), k + ' should not render');
});

await t('part numbers run consecutively over the sections actually shown', async () => {
  const w = await boot([
    { id:'a', section:'audit', q:'Q1', a:'A' },
    { id:'b', section:'logo',  q:'Q2', a:'A' },   // several defined sections sit between these two
    { id:'c', section:'other', q:'Q3', a:'A' },
  ]);
  const parts = (rendered(w).match(/Part \d+/g) || []);
  assert.equal(parts.join(','), 'Part 1,Part 2,Part 3', 'numbering must not leave gaps');
});

await t('the anchor nav lists exactly the sections on the page', async () => {
  const w = await boot([
    { id:'a', section:'audit', q:'Q1', a:'A' },
    { id:'c', section:'other', q:'Q3', a:'A' },
  ]);
  const nav = w.document.getElementById('qaAnchorNav').innerHTML;
  assert.equal((nav.match(/qa-anchor-pill/g) || []).length, 2);
  assert.ok(nav.includes('data-sec="audit"'));
  assert.ok(nav.includes('data-sec="other"'));
  assert.ok(!nav.includes('data-sec="tc"'), 'an empty section must not appear in the nav');
});

await t('every anchor pill points at a section that exists', async () => {
  const w = await boot(REAL_DATA);
  const doc = w.document;
  for(const a of doc.querySelectorAll('.qa-anchor-pill')){
    const id = 'qa-sec-' + a.getAttribute('data-sec');
    assert.ok(doc.getElementById(id), 'dead anchor: ' + id);
  }
});

await t('the editor category dropdown offers every section', async () => {
  const w = await boot(REAL_DATA);
  w.qaPaintSectionSelect();
  const opts = [...w.document.getElementById('qaEditSection').options].map(o => o.value);
  assert.equal(opts.join(','), D.keys().join(','));
});

// ==========================================================================
G('SEARCH AND FILTERING STILL WORK');

await t('search narrows to matching questions', async () => {
  const w = await boot(REAL_DATA);
  w.document.getElementById('qaSearch').value = 'オンライン監査';
  w.qaRender();
  const html = rendered(w);
  const shown = (html.match(/<details/g) || []).length;
  assert.ok(shown > 0, 'the search should find something');
  assert.ok(shown < REAL_DATA.length, 'the search should actually narrow the list');
});

await t('a search matching nothing shows the empty message', async () => {
  const w = await boot(REAL_DATA);
  w.document.getElementById('qaSearch').value = 'ぜったいに一致しない文字列xyzzy';
  w.qaRender();
  assert.equal(w.document.getElementById('qaEmpty').style.display, 'block');
});

await t('search still works alongside images and NEW', async () => {
  const w = await boot([
    { id:'a', section:'audit', q:'画像つきの質問', a:'回答', images:[{src:'/files/a.png'}], isNew:true },
    { id:'b', section:'audit', q:'別の質問', a:'回答' },
  ]);
  w.document.getElementById('qaSearch').value = '画像つき';
  w.qaRender();
  const html = rendered(w);
  assert.ok(html.includes('画像つきの質問'));
  assert.ok(!html.includes('別の質問'));
  assert.ok(html.includes('qa-figs') && html.includes('qa-new'));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;

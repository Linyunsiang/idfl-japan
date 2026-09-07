// ============================================================
// 資料ダウンロード: the Monday bulk-publish workflow inside /admin.
//
// The crawler lands candidates as published:false. The operator ticks the
// ones that may go live, presses 「選択した資料を公開」, confirms, and the
// working copy is saved through the existing publish Function in ONE request.
//
// These tests load admin.html in jsdom, seed DATA.downloads with the real
// production shape (13 public records + 24 drafts) and drive the real
// functions. fetch is stubbed so nothing is ever sent anywhere.
//
//   node tests/qa/admin-bulk-publish.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const DOWNLOAD_PAGE = fs.readFileSync(path.join(ROOT, 'download.html'), 'utf8');
const SECTIONS_JS = fs.readFileSync(path.join(ROOT, 'js/qa-sections.js'), 'utf8');

let pass = 0, fail = 0;
async function t(name, fn){
  try{ await fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); fail++; }
}
function G(n){ console.log('\n' + n); }

/* ---------- fixture: 13 live records (one legacy without `published`) + 24 drafts ---------- */
function fixture(){
  const live = [];
  for(let i = 0; i < 13; i++){
    const r = { id:'live-' + i, title:'既存資料 ' + i, category: i % 2 ? 'GOTS' : '参考資料', ftype:'PDF',
                url:'https://example.com/live-' + i + '.pdf', size:'', date:'2026-0' + (1 + i % 8), isNew:false, expiry:'' };
    if(i === 0) { /* legacy: no published key at all */ }
    else r.published = true;
    live.push(r);
  }
  const drafts = [];
  for(let i = 0; i < 24; i++){
    drafts.push({ id:'ref-draft-' + i, title:'下書き資料 ' + i, category:'参考資料', ftype: i % 3 ? 'LINK' : 'PDF',
                  url:'https://example.com/draft-' + i, size:'', date:'2026-09', isNew:true, expiry:'',
                  createdAt:'2026-09-07T00:00:00.000Z', updatedAt:'2026-09-07T00:00:00.000Z', updatedBy:'weekly-crawl', published:false });
  }
  return live.concat(drafts);
}
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Boot admin.html with a scripted publish endpoint. `server` decides each POST. */
async function boot(records, server){
  const calls = [];
  const html = ADMIN.replace(/<script src="\/js\/qa-sections\.js"><\/script>/, '<script>' + SECTIONS_JS + '</script>');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://idfl-japan.com/admin',
    beforeParse(w){
      w.fetch = (url, opt) => {
        if(String(url).includes('/publish') && opt && opt.method === 'POST'){
          const body = JSON.parse(opt.body);
          calls.push(body);
          const res = server ? server(body, calls.length) : { status: 200, json: { ok: true, count: body.data.length } };
          if(res.throw) return Promise.reject(new Error(res.throw));
          return Promise.resolve({ ok: res.status >= 200 && res.status < 300, status: res.status, json: () => Promise.resolve(res.json) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      };
      w.confirm = () => true;
      w.alert = () => {};
    },
  });
  const w = dom.window;
  await new Promise(r => w.setTimeout(r, 0));
  w.eval('PW = "test-password-not-real"; CUR = "downloads";');
  w.DATA = w.eval('DATA');
  w.DIRTY = w.eval('DIRTY');
  w.BULK = w.eval('BULK');
  w.DATA.downloads = clone(records);
  w.render();
  w.calls = calls;
  return w;
}
const $ = (w, sel) => w.document.querySelector(sel);
const $$ = (w, sel) => [...w.document.querySelectorAll(sel)];
const drafts = (w) => w.DATA.downloads.filter(e => e.published === false);
const settle = (w) => new Promise(r => w.setTimeout(r, 5));

/** What /download.html really shows: its own filter, lifted from the page. */
function publicFilter(){
  const m = DOWNLOAD_PAGE.match(/docs\.filter\(function\(d\)\s*\{\s*return\s*\(d\.published\s*!==\s*false\)/);
  assert.ok(m, 'download.html must hide published===false');
  return (arr) => arr.filter(d => d.published !== false);
}

// ==========================================================================
G('A / J. 下書きは公開ページに出ない');

await t('A. all 24 drafts are hidden on the customer page, the 13 live ones show', async () => {
  const shown = publicFilter()(fixture());
  assert.equal(shown.length, 13);
  assert.ok(shown.every(d => d.published !== false));
});

await t('J. download.html filters with d.published !== false (legacy records stay visible)', async () => {
  const shown = publicFilter()([{ id:'x', title:'legacy' }, { id:'y', published:false }, { id:'z', published:true }]);
  assert.deepEqual(shown.map(d => d.id), ['x', 'z']);
});

// ==========================================================================
G('DRAFT FILTER');

await t('the 下書き pill exists for downloads and carries the count', async () => {
  const w = await boot(fixture());
  const pills = $$(w, '#tools .fpill').map(b => b.textContent);
  assert.ok(pills.some(p => p === 'すべて'), 'すべて');
  assert.ok(pills.some(p => p === '公開中'), '公開中');
  assert.ok(pills.some(p => p === '下書き 24'), 'expected 「下書き 24」, got ' + JSON.stringify(pills));
});

await t('selecting the 下書き filter lists exactly the 24 drafts', async () => {
  const w = await boot(fixture());
  w.setFilter('draft');
  assert.equal($$(w, '#list .row').length, 24);
  assert.equal($(w, '#count').textContent, '24 / 37 件');
});

await t('公開中 lists the 13 live records, including the legacy one without the key', async () => {
  const w = await boot(fixture());
  w.setFilter('pub');
  assert.equal($$(w, '#list .row').length, 13);
});

// ==========================================================================
G('MULTI SELECT');

await t('every draft row has a selection checkbox, live rows have none', async () => {
  const w = await boot(fixture());
  const rows = $$(w, '#list .row');
  assert.equal(rows.length, 37);
  const withBox = rows.filter(r => r.querySelector('input.selbox'));
  assert.equal(withBox.length, 24);
});

await t('E. with nothing selected the publish button is disabled and says 選択中：0件', async () => {
  const w = await boot(fixture());
  w.setFilter('draft');
  assert.equal($(w, '#bulkCnt').textContent, '選択中：0件');
  assert.equal($(w, '#bulkPubBtn').disabled, true);
  assert.equal($(w, '#bulkPubBtn').textContent, '選択した資料を公開');
});

await t('ticking two rows enables the button and counts 2', async () => {
  const w = await boot(fixture());
  w.setFilter('draft');
  const boxes = $$(w, '#list .row input.selbox');
  boxes[0].checked = true; boxes[0].dispatchEvent(new w.Event('change'));
  const boxes2 = $$(w, '#list .row input.selbox');
  boxes2[3].checked = true; boxes2[3].dispatchEvent(new w.Event('change'));
  assert.equal($(w, '#bulkCnt').textContent, '選択中：2件');
  assert.equal($(w, '#bulkPubBtn').disabled, false);
  assert.equal(Object.keys(w.BULK.sel).length, 2);
});

await t('すべて選択 selects all visible drafts, and again clears them', async () => {
  const w = await boot(fixture());
  w.setFilter('draft');
  const all = $(w, '#bulkAll');
  all.checked = true; all.dispatchEvent(new w.Event('change'));
  assert.equal($(w, '#bulkCnt').textContent, '選択中：24件');
  const all2 = $(w, '#bulkAll');
  assert.equal(all2.checked, true);
  all2.checked = false; all2.dispatchEvent(new w.Event('change'));
  assert.equal($(w, '#bulkCnt').textContent, '選択中：0件');
  assert.equal($(w, '#bulkPubBtn').disabled, true);
});

await t('the selection checkbox is not the record\'s published flag', async () => {
  const w = await boot(fixture());
  w.setFilter('draft');
  const box = $$(w, '#list .row input.selbox')[0];
  box.checked = true; box.dispatchEvent(new w.Event('change'));
  assert.equal(drafts(w).length, 24, 'selecting must not publish anything');
  assert.equal(w.calls.length, 0, 'selecting must not call the server');
});

// ==========================================================================
G('CONFIRM DIALOG');

await t('the publish button opens a confirmation listing the selected titles and sends nothing', async () => {
  const w = await boot(fixture());
  w.setFilter('draft');
  w.bulkToggle(13, true); w.bulkToggle(20, true);
  w.bulkOpen();
  const ov = $(w, '#bov');
  assert.ok(ov.classList.contains('open'));
  assert.equal($(w, '#bovTitle').textContent, '選択した資料を公開しますか？');
  const body = $(w, '#bovBody').textContent;
  assert.ok(body.includes('2 件'));
  assert.ok(body.includes('下書き資料 0'));
  assert.ok(body.includes('下書き資料 7'));
  assert.ok(body.includes('お客様から閲覧できるようになります'));
  assert.equal($(w, '#bovGo').textContent, '2件を公開する');
  assert.equal(w.calls.length, 0);
});

await t('F. cancel closes the dialog and changes nothing', async () => {
  const w = await boot(fixture());
  const before = clone(w.DATA.downloads);
  w.bulkToggle(13, true); w.bulkToggle(20, true);
  w.bulkOpen();
  w.bulkClose();
  assert.equal($(w, '#bov').classList.contains('open'), false);
  assert.deepEqual(w.DATA.downloads, before);
  assert.equal(w.calls.length, 0);
  assert.equal(Object.keys(w.BULK.sel).length, 2, 'the selection survives a cancel');
});

await t('the per-row 公開 button opens the same dialog for that one record', async () => {
  const w = await boot(fixture());
  w.setFilter('draft');
  const btn = $$(w, '#list .btn-mini-pub')[5];
  btn.click();
  assert.ok($(w, '#bov').classList.contains('open'));
  assert.ok($(w, '#bovBody').textContent.includes('下書き資料 5'));
  assert.equal($(w, '#bovGo').textContent, '1件を公開する');
});

// ==========================================================================
G('BULK PUBLISH');

await t('B/C/D. confirming publishes exactly the two selected; 22 drafts and 13 live records untouched', async () => {
  const w = await boot(fixture());
  const before = clone(w.DATA.downloads);
  w.bulkToggle(13, true); w.bulkToggle(20, true);
  w.bulkOpen(); await w.bulkPublish(); await settle(w);
  const after = w.DATA.downloads;
  assert.equal(after.length, 37);
  assert.equal(after[13].published, true);
  assert.equal(after[20].published, true);
  assert.equal(drafts(w).length, 22, 'C. the other 22 stay drafts');
  // D. the 13 live records are byte-identical
  for(let i = 0; i < 13; i++) assert.deepEqual(after[i], before[i], 'live record ' + i + ' changed');
  // B. every other field of the two published records is unchanged
  for(const i of [13, 20]){
    const { published: _a, ...restA } = after[i];
    const { published: _b, ...restB } = before[i];
    assert.deepEqual(restA, restB, 'fields other than published changed on ' + i);
  }
  // the untouched drafts are byte-identical too
  for(let i = 13; i < 37; i++) if(i !== 13 && i !== 20) assert.deepEqual(after[i], before[i]);
});

await t('one publish request carries the whole working copy, not one per item', async () => {
  const w = await boot(fixture());
  w.bulkToggle(13, true); w.bulkToggle(14, true); w.bulkToggle(15, true);
  w.bulkOpen(); await w.bulkPublish(); await settle(w);
  assert.equal(w.calls.length, 1, 'exactly one POST');
  assert.equal(w.calls[0].type, 'downloads');
  assert.equal(w.calls[0].data.length, 37);
  assert.equal(w.calls[0].data.filter(e => e.published === false).length, 21);
});

await t('the request does not touch the schedule / news / other types', async () => {
  const w = await boot(fixture());
  w.bulkToggle(13, true);
  w.bulkOpen(); await w.bulkPublish(); await settle(w);
  assert.ok(w.calls.every(c => c.type === 'downloads'));
});

await t('success shows the count, the deploy note and a link to the public page; selection cleared', async () => {
  const w = await boot(fixture());
  w.bulkToggle(13, true); w.bulkToggle(20, true); w.bulkToggle(21, true);
  w.bulkOpen(); await w.bulkPublish(); await settle(w);
  assert.equal($(w, '#bovTitle').textContent, '公開しました');
  const body = $(w, '#bovBody').textContent;
  assert.ok(body.includes('3件を公開しました'));
  assert.ok(body.includes('通常 1〜2 分で公開ページに反映されます'));
  const link = $(w, '#bovActs a');
  assert.equal(link.getAttribute('href'), '/download.html');
  assert.equal(link.textContent, '公開ページを確認');
  assert.equal(Object.keys(w.BULK.sel).length, 0);
  assert.equal(w.DIRTY.downloads, false);
  assert.equal($(w, '#tools').textContent.includes('下書き 21'), true, 'pill count updates');
});

await t('I. a legacy record without `published` is treated as live: no checkbox, counted as public, never modified', async () => {
  const w = await boot(fixture());
  assert.equal(w.DATA.downloads[0].published, undefined);
  w.setFilter('pub');
  assert.equal($$(w, '#list .row').length, 13);
  w.setFilter('all');
  const rows = $$(w, '#list .row');
  assert.equal(rows[0].querySelector('input.selbox'), null);
  assert.ok(rows[0].querySelector('.st-pub'), 'shown as 公開中');
  w.bulkToggle(0, true);            // must be a no-op
  assert.equal(Object.keys(w.BULK.sel).length, 0);
  w.bulkToggle(13, true);
  w.bulkOpen(); await w.bulkPublish(); await settle(w);
  assert.equal(w.DATA.downloads[0].published, undefined, 'the legacy record must not gain a key');
  assert.equal(w.calls[0].data[0].published, undefined);
});

// ==========================================================================
G('FAILURE');

await t('G. a server error shows the failure message, no success, data unchanged, retry offered', async () => {
  const w = await boot(fixture(), () => ({ status: 502, json: { error: 'GitHub error 502' } }));
  const before = clone(w.DATA.downloads);
  w.bulkToggle(13, true); w.bulkToggle(20, true);
  w.bulkOpen(); await w.bulkPublish(); await settle(w);
  assert.deepEqual(w.DATA.downloads, before, 'DATA must not change on failure');
  assert.equal(drafts(w).length, 24);
  assert.equal($(w, '#bovTitle').textContent, '公開に失敗しました');
  const body = $(w, '#bovBody').textContent;
  assert.ok(body.includes('公開に失敗しました。変更は公開されていません。'));
  assert.ok(!body.includes('公開しました。'), 'must not read like a success');
  assert.ok(body.includes('GitHub error 502'));
  assert.equal($(w, '#bovGo').textContent, '再試行（2件を公開する）');
  assert.equal(Object.keys(w.BULK.sel).length, 2, 'selection kept for retry');
});

await t('G. a network failure (fetch throws) is handled the same way', async () => {
  const w = await boot(fixture(), () => ({ throw: 'Failed to fetch' }));
  w.bulkToggle(13, true);
  w.bulkOpen(); await w.bulkPublish(); await settle(w);
  assert.equal(drafts(w).length, 24);
  assert.ok($(w, '#bovBody').textContent.includes('変更は公開されていません'));
});

await t('a wrong password (401) is a failure, not a success', async () => {
  const w = await boot(fixture(), () => ({ status: 401, json: { error: 'パスワードが正しくありません' } }));
  w.bulkToggle(13, true);
  w.bulkOpen(); await w.bulkPublish(); await settle(w);
  assert.equal(drafts(w).length, 24);
  assert.ok($(w, '#bovBody').textContent.includes('パスワードが正しくありません'));
});

await t('retry after a failure sends the same set once more and then succeeds', async () => {
  let n = 0;
  const w = await boot(fixture(), () => (++n === 1 ? { status: 502, json: { error: 'first try fails' } } : { status: 200, json: { ok: true } }));
  w.bulkToggle(13, true); w.bulkToggle(20, true);
  w.bulkOpen(); await w.bulkPublish(); await settle(w);
  assert.equal(drafts(w).length, 24);
  await w.bulkPublish(); await settle(w);          // the 再試行 button
  assert.equal(w.calls.length, 2);
  assert.deepEqual(w.calls[0].data, w.calls[1].data, 'identical payload on retry');
  assert.equal(drafts(w).length, 22);
  assert.equal($(w, '#bovTitle').textContent, '公開しました');
});

// ==========================================================================
G('DOUBLE CLICK');

await t('H. two clicks while a request is in flight produce one request', async () => {
  let release;
  const w = await boot(fixture(), () => ({ status: 200, json: { ok: true } }));
  // slow server: hold the first response until we release it
  const realFetch = w.fetch;
  w.fetch = (url, opt) => new Promise((resolve) => { release = () => resolve(realFetch(url, opt)); });
  w.bulkToggle(13, true); w.bulkToggle(20, true);
  w.bulkOpen();
  const p1 = w.bulkPublish();
  const p2 = w.bulkPublish();           // second click while busy
  const p3 = w.bulkPublish();           // and a third
  assert.equal(w.BULK.busy, true);
  assert.equal($(w, '#bovGo').disabled, true, 'the button is disabled while publishing');
  assert.ok($(w, '#bovGo').textContent.includes('公開しています…'));
  assert.ok($(w, '#bovGo').querySelector('.spin'), 'spinner shown');
  release();
  await Promise.all([p1, p2, p3]); await settle(w);
  assert.equal(w.calls.length, 1, 'exactly one request despite three clicks');
  assert.equal(drafts(w).length, 22);
  assert.equal(w.BULK.busy, false);
});

await t('H. the dialog cannot be closed and the list button is disabled while in flight', async () => {
  let release;
  const w = await boot(fixture());
  const realFetch = w.fetch;
  w.fetch = (url, opt) => new Promise((resolve) => { release = () => resolve(realFetch(url, opt)); });
  w.setFilter('draft');
  w.bulkToggle(13, true);
  w.bulkOpen();
  const p = w.bulkPublish();
  w.bulkClose();
  assert.ok($(w, '#bov').classList.contains('open'), 'close is ignored while busy');
  assert.equal($(w, '#bulkPubBtn').disabled, true);
  release(); await p; await settle(w);
});

// ==========================================================================
G('EDIT FORM (PR #15 part 1 still intact)');

await t('the edit form keeps its own 公開する checkbox, unchecked for a draft, checked for legacy', async () => {
  const w = await boot(fixture());
  w.openEdit(13);
  assert.equal($(w, '#fld_published').checked, false);
  w.openEdit(0);
  assert.equal($(w, '#fld_published').checked, true, 'legacy record renders as published');
});

// ==========================================================================
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;

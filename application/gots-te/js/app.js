/**
 * Wizard shell: state, navigation, autosave, validation painting.
 *
 * Phase 2 scope — no document generation, no network, no backend.
 */

import { STEPS, COUNTRY_SUGGESTIONS, TEMPLATE_VERSION } from './schema.js';
import {
  createEmptyApplication, hydrate, validate, completion, visibleSteps,
  getPath, setPath,
} from './engine.js';
import { LocalDraftStore, exportDraftFile, importDraftFile } from './storage.js';
import { el, STEP_RENDERERS } from './render.js';
import { stepReview } from './review.js';

const RENDERERS = { ...STEP_RENDERERS, review: stepReview };

const state = {
  data: createEmptyApplication(),
  touched: new Set(),
  stepId: 'applicant',
  validation: null,
  current: null,          // { node, refresh }
  repeats: new Map(),     // path -> re-render fn for the current step
  restored: false,
};

const $ = (sel) => document.querySelector(sel);
let saveTimer = null;

/* ------------------------------------------------------------------ *
 * Context handed to renderers
 * ------------------------------------------------------------------ */

const ctx = {
  get data() { return state.data; },

  onChange(path, value) {
    setPath(state.data, path, value);
    // Editing a field the user has already been told about should clear the message
    // immediately rather than waiting for blur.
    if (state.touched.has(path)) repaintOne(path);
    afterChange();
  },

  onBlur(path) {
    state.touched.add(path);
    repaintOne(path);
  },

  addItem(path, item) {
    const list = getPath(state.data, path);
    list.push(item);
    rerenderRepeat(path);
    afterChange();
  },

  removeItem(path, index) {
    const list = getPath(state.data, path);
    list.splice(index, 1);
    // indices shift, so path-keyed touched marks are no longer meaningful
    for (const t of [...state.touched]) if (t.startsWith(path + '.')) state.touched.delete(t);
    rerenderRepeat(path);
    afterChange();
  },

  duplicateItem(path, index) {
    const list = getPath(state.data, path);
    list.splice(index + 1, 0, structuredClone(list[index]));
    rerenderRepeat(path);
    afterChange();
  },

  registerRepeat(path, fn) { state.repeats.set(path, fn); },

  getValidation() { return state.validation; },

  goToStep(id) { showStep(id); },

  goToField(stepId, path) {
    showStep(stepId);
    requestAnimationFrame(() => {
      const target = $(`[data-path="${CSS.escape(path)}"]`) ||
        document.querySelector(`[data-path^="${CSS.escape(path)}"]`);
      if (!target) return;
      state.touched.add(path);
      repaintAll();
      target.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'center' });
      target.classList.add('is-flash');
      setTimeout(() => target.classList.remove('is-flash'), 1200);
      const input = target.querySelector('input, select, textarea');
      if (input) input.focus({ preventScroll: true });
    });
  },
};

const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function rerenderRepeat(path) {
  const fn = state.repeats.get(path);
  if (fn) { fn(); repaintAll(); }
}

/* ------------------------------------------------------------------ *
 * Change pipeline
 * ------------------------------------------------------------------ */

function afterChange() {
  state.validation = validate(state.data);
  state.current?.refresh(state.data);
  paintProgress();
  paintRail();
  repaintAll();
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  setSaveStatus('saving');
  saveTimer = setTimeout(() => {
    const res = LocalDraftStore.save(state.data);
    if (res.ok) {
      state.data.meta.savedAt = res.savedAt;
      setSaveStatus('saved', res.savedAt);
    } else {
      setSaveStatus('error', null, res.error);
    }
  }, 800);
}

function setSaveStatus(kind, savedAt, error) {
  const n = $('#saveStatus');
  if (!n) return;
  n.className = `save-status is-${kind}`;
  if (kind === 'saving') n.textContent = '保存中…';
  else if (kind === 'saved') {
    const t = new Date(savedAt);
    n.textContent = `下書きを保存しました（${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}）`;
  } else {
    n.textContent = error === 'quota'
      ? '保存できません（ブラウザの保存容量が不足しています）'
      : '保存できません（ブラウザの設定でローカル保存が無効になっています）';
  }
}

/* ------------------------------------------------------------------ *
 * Validation painting
 * ------------------------------------------------------------------ */

function errorsByPath() {
  const map = new Map();
  for (const e of state.validation?.errors || []) if (!map.has(e.path)) map.set(e.path, e);
  return map;
}

function repaintAll() {
  const map = errorsByPath();
  for (const wrap of document.querySelectorAll('.f[data-path]')) paintField(wrap, map);
}

function repaintOne(path) {
  const map = errorsByPath();
  const wrap = document.querySelector(`.f[data-path="${CSS.escape(path)}"]`);
  if (wrap) paintField(wrap, map);
}

function paintField(wrap, map) {
  const path = wrap.dataset.path;
  const err = map.get(path);
  const slot = wrap.querySelector(`[data-err-for]`);
  const show = !!err && state.touched.has(path);
  wrap.classList.toggle('has-error', show);
  if (slot) slot.textContent = show ? err.message : '';
  const input = wrap.querySelector('input, select, textarea');
  if (input) input.setAttribute('aria-invalid', show ? 'true' : 'false');
}

/** Mark every field of the current step touched — used when Next is pressed. */
function touchCurrentStep() {
  for (const wrap of document.querySelectorAll('.f[data-path]')) {
    if (wrap.closest('[hidden]')) continue;
    state.touched.add(wrap.dataset.path);
  }
  repaintAll();
}

/* ------------------------------------------------------------------ *
 * Chrome: progress + rail + nav
 * ------------------------------------------------------------------ */

function paintProgress() {
  const pct = completion(state.validation);
  $('#progressBar').style.width = `${pct}%`;
  $('#progressPct').textContent = `${pct}%`;
  $('#progressBar').parentElement.setAttribute('aria-valuenow', String(pct));
}

function stepStatus(id) {
  const v = state.validation;
  const errs = v.byStep[id]?.errors?.length || 0;
  const warns = v.byStep[id]?.warnings?.length || 0;
  if (id === 'review') return 'neutral';
  if (errs) return 'todo';
  if (warns) return 'warn';
  return 'done';
}

function paintRail() {
  const rail = $('#rail');
  const visible = visibleSteps(state.data);
  rail.replaceChildren();
  STEPS.filter((s) => visible.includes(s.id)).forEach((s, i) => {
    const status = stepStatus(s.id);
    const btn = el('button', {
      type: 'button',
      class: `rail-item is-${status}${s.id === state.stepId ? ' is-current' : ''}`,
      'aria-current': s.id === state.stepId ? 'step' : null,
      onClick: () => showStep(s.id),
    },
      el('span', { class: 'rail-no', text: String(i + 1) }),
      el('span', { class: 'rail-text' },
        el('span', { class: 'rail-title', text: s.title }),
        el('span', { class: 'rail-en', text: s.titleEn })),
      el('span', { class: 'rail-mark', 'aria-hidden': 'true' }));
    rail.append(btn);
  });
}

function showStep(id) {
  const visible = visibleSteps(state.data);
  if (!visible.includes(id)) id = visible[0];
  state.stepId = id;
  state.repeats.clear();

  const meta = STEPS.find((s) => s.id === id);
  const host = $('#stepHost');
  const built = RENDERERS[id](state.data, ctx);
  state.current = built;

  $('#stepTitle').textContent = meta.title;
  $('#stepTitleEn').textContent = meta.titleEn;
  $('#stepSection').textContent = meta.section === '—' ? '' : `公式様式 ${meta.section}`;
  const idx = visible.indexOf(id);
  $('#stepCounter').textContent = `ステップ ${idx + 1} / ${visible.length}`;

  host.replaceChildren(built.node);
  built.refresh(state.data);
  repaintAll();
  paintRail();

  $('#btnBack').disabled = idx === 0;
  $('#btnNext').textContent = idx === visible.length - 1 ? '完了' : '次へ →';
  $('#btnNext').disabled = idx === visible.length - 1;

  if (!prefersReduced()) {
    host.classList.remove('fade-in');
    void host.offsetWidth;
    host.classList.add('fade-in');
  }
  document.querySelector('.main-scroll').scrollTop = 0;
  $('#stepTitle').focus({ preventScroll: true });
}

function move(delta) {
  const visible = visibleSteps(state.data);
  const idx = visible.indexOf(state.stepId);
  if (delta > 0) touchCurrentStep();
  const next = visible[idx + delta];
  if (next) showStep(next);
}

/* ------------------------------------------------------------------ *
 * Draft controls
 * ------------------------------------------------------------------ */

function clearDraft() {
  const ok = confirm(
    '入力内容をすべて消去します。\n\n' +
    'この操作は取り消せません。保存済みの下書きも削除されます。\n' +
    '続行してよろしいですか？'
  );
  if (!ok) return;
  LocalDraftStore.clear();
  state.data = createEmptyApplication();
  state.touched.clear();
  state.validation = validate(state.data);
  showStep('applicant');
  paintProgress();
  setSaveStatus('saved', new Date().toISOString());
  announce('入力内容をクリアしました');
}

function announce(msg) {
  const n = $('#live');
  n.textContent = '';
  setTimeout(() => { n.textContent = msg; }, 30);
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function boot() {
  window.__idflAppBooted = true;

  // country suggestions
  const dl = document.createElement('datalist');
  dl.id = 'country-list';
  for (const c of COUNTRY_SUGGESTIONS) dl.append(el('option', { value: c }));
  document.body.append(dl);

  $('#templateVersion').textContent = TEMPLATE_VERSION;

  const saved = LocalDraftStore.load();
  if (saved?.data) {
    state.data = hydrate(saved.data);
    state.restored = true;
  }
  if (!LocalDraftStore.available()) {
    $('#storageWarning').hidden = false;
  }

  state.validation = validate(state.data);
  paintProgress();
  showStep('applicant');

  if (state.restored) {
    const banner = $('#restoreBanner');
    banner.hidden = false;
    $('#restoreTime').textContent = new Date(saved.savedAt).toLocaleString('ja-JP');
    $('#restoreDismiss').addEventListener('click', () => { banner.hidden = true; });
    announce('前回の下書きを復元しました');
  }

  $('#btnBack').addEventListener('click', () => move(-1));
  $('#btnNext').addEventListener('click', () => move(1));
  $('#btnClear').addEventListener('click', clearDraft);
  $('#btnExport').addEventListener('click', () => exportDraftFile(state.data));
  $('#fileImport').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const loaded = await importDraftFile(file);
      state.data = hydrate(loaded.data || loaded);
      state.touched.clear();
      afterChange();
      showStep('applicant');
      announce('下書きファイルを読み込みました');
    } catch (err) {
      alert(err.message);
    } finally {
      e.target.value = '';
    }
  });

  // Mobile rail toggle
  $('#railToggle').addEventListener('click', () => {
    const open = document.body.classList.toggle('rail-open');
    $('#railToggle').setAttribute('aria-expanded', String(open));
  });
  $('#rail').addEventListener('click', (e) => {
    if (e.target.closest('.rail-item')) document.body.classList.remove('rail-open');
  });

  window.addEventListener('beforeunload', () => {
    if (saveTimer) { clearTimeout(saveTimer); LocalDraftStore.save(state.data); }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

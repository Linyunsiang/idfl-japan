/**
 * Schema-driven renderer.
 *
 * Each step renderer returns `{ node, refresh(data) }`. `refresh` re-evaluates conditional
 * visibility in place, so typing never causes a re-render and never loses caret position.
 * Only structural changes (add/remove/duplicate a repeated item) rebuild a subtree.
 */

import {
  STANDARDS, CURRENCIES, PRODUCT_CATEGORIES, PRODUCT_OTHER_MAX, UNIT_TYPES,
  FACILITY_ACTIVITIES, FACILITY_INSTRUCTIONS, FACILITY_MASTER_ROWS,
  OTHER_CERTIFICATIONS, RECYCLED_MATERIAL_TYPES, RDS_SCOPES, RDS_TABLES, RDS_MASTER_ROWS,
  COUNTRY_SUGGESTIONS, PARTY_FIELDS,
} from './schema.js';
import {
  getPath, isSelected, showsRecycling, showsRds, rdsScopeActive,
  showsGotsChemicals, showsGrsChemicals, anyPriorCert,
  emptyFacility, emptyProductOther, emptyRdsItem,
} from './engine.js';

/* ------------------------------------------------------------------ *
 * DOM helpers
 * ------------------------------------------------------------------ */

export function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

let uid = 0;
const nextId = () => `f${++uid}`;

/** Collapsible official instructions. Wording is never altered — only hidden by default. */
export function helpBlock(summary, body) {
  const d = el('details', { class: 'help' }, el('summary', { text: summary }));
  const p = el('div', { class: 'help-body' });
  for (const line of String(body).split('\n')) p.append(el('p', { text: line }));
  d.append(p);
  return d;
}

/**
 * One labelled field. `ctx.onChange(path, value)` is called on every edit,
 * `ctx.onBlur(path)` marks the field touched so its error may surface.
 */
export function field(def, path, value, ctx) {
  const id = nextId();
  const wrap = el('div', { class: 'f', dataset: { path } });

  const label = el('label', { class: 'f-label', for: id }, def.label);
  if (def.required) label.append(el('span', { class: 'req', text: '必須' }));
  if (def.labelEn) label.append(el('span', { class: 'f-en', text: def.labelEn }));
  wrap.append(label);

  if (def.note) wrap.append(el('p', { class: 'f-note', text: def.note }));

  const commit = (v) => ctx.onChange(path, v);
  let input;

  switch (def.type) {
    case 'textarea':
      input = el('textarea', { id, rows: def.rows || 3, placeholder: def.placeholder || '', autocomplete: 'off' });
      input.value = value || '';
      input.addEventListener('input', () => commit(input.value));
      break;

    case 'country': {
      input = el('input', { id, type: 'text', list: 'country-list', autocomplete: 'country-name', placeholder: def.placeholder || '' });
      input.value = value || '';
      input.addEventListener('input', () => commit(input.value));
      break;
    }

    case 'select':
      input = el('select', { id, autocomplete: 'off' });
      input.append(el('option', { value: '' }, def.placeholder || '選択してください'));
      for (const o of def.options) input.append(el('option', { value: o.value }, o.label));
      input.value = value || '';
      input.addEventListener('change', () => commit(input.value));
      break;

    case 'yesno':
    case 'radio': {
      const opts = def.type === 'yesno'
        ? [{ value: 'yes', label: 'はい' }, { value: 'no', label: 'いいえ' }]
        : def.options;
      input = el('div', { class: 'radio-row', role: 'radiogroup', 'aria-labelledby': id });
      label.id = id;
      for (const o of opts) {
        const rid = nextId();
        const r = el('input', { type: 'radio', id: rid, name: path, value: o.value, autocomplete: 'off' });
        r.checked = value === o.value;
        r.addEventListener('change', () => { if (r.checked) commit(o.value); });
        input.append(el('label', { class: 'radio', for: rid }, r, el('span', { text: o.label })));
      }
      break;
    }

    case 'checkbox': {
      input = el('div', { class: 'check-single' });
      const c = el('input', { type: 'checkbox', id, autocomplete: 'off' });
      c.checked = !!value;
      c.addEventListener('change', () => commit(c.checked));
      label.remove();
      const lab = el('label', { class: 'check', for: id }, c, el('span', { text: def.label }));
      if (def.required) lab.append(el('span', { class: 'req', text: '必須' }));
      input.append(lab);
      break;
    }

    case 'checkgroup': {
      input = el('div', { class: 'check-grid' });
      const cur = Array.isArray(value) ? value : [];
      for (const o of def.options) {
        const cid = nextId();
        const c = el('input', { type: 'checkbox', id: cid, value: o.value, autocomplete: 'off' });
        c.checked = cur.includes(o.value);
        c.addEventListener('change', () => {
          const set = new Set(Array.isArray(getPath(ctx.data, path)) ? getPath(ctx.data, path) : []);
          c.checked ? set.add(o.value) : set.delete(o.value);
          commit([...set]);
        });
        input.append(el('label', { class: 'check', for: cid }, c, el('span', { text: o.label })));
      }
      break;
    }

    default:
      input = el('input', { id, type: def.type || 'text', placeholder: def.placeholder || '', inputmode: def.inputmode || null, autocomplete: def.autocomplete || 'off' });
      input.value = value || '';
      input.addEventListener('input', () => commit(input.value));
  }

  input.addEventListener('blur', () => ctx.onBlur(path), true);
  wrap.append(input);
  if (def.help) wrap.append(helpBlock(def.helpSummary || '詳細を見る', def.help));
  wrap.append(el('p', { class: 'f-err', dataset: { errFor: path } }));
  return wrap;
}

/** A section card. */
function card(title, ...body) {
  return el('section', { class: 'card' },
    title ? el('h3', { class: 'card-title', text: title }) : null, ...body);
}

/** Conditional wrapper — `test(data)` decides visibility on every refresh. */
function conditional(test, node, refreshers) {
  const box = el('div', { class: 'cond' }, node);
  refreshers.push((d) => { box.hidden = !test(d); });
  return box;
}

const partyFields = (base, data, ctx) =>
  PARTY_FIELDS.map((f) => field(f, `${base}.${f.key}`, getPath(data, `${base}.${f.key}`), ctx));

/* ------------------------------------------------------------------ *
 * Step 1 — §1 applicant
 * ------------------------------------------------------------------ */
export function stepApplicant(data, ctx) {
  const refreshers = [];
  const node = el('div', {},
    card('申請者の情報', el('div', { class: 'grid-2' }, ...partyFields('applicant', data, ctx))));
  return { node, refresh: (d) => refreshers.forEach((r) => r(d)) };
}

/* ------------------------------------------------------------------ *
 * Step 2 — §2 payment
 * ------------------------------------------------------------------ */
export function stepPayment(data, ctx) {
  const refreshers = [];

  const currency = field(
    { label: '支払いの通貨', type: 'radio', required: true, options: CURRENCIES.map((c) => ({ value: c.value, label: c.value })) },
    'payment.currency', data.payment.currency, ctx);

  const currencyOther = conditional(
    (d) => d.payment.currency === 'OTHER',
    field({ label: 'その他の通貨', type: 'text', required: true }, 'payment.currencyOther', data.payment.currencyOther, ctx),
    refreshers);

  const rushHelp =
    '緊急サービスは監査の特定のフェーズにのみ適用され、それより前のフェーズが完了している場合にのみ適用できます。' +
    '緊急サービスはオフィスのキャパシティにより、ご利用いただけない場合もございます。\n' +
    '注：IDFL は、お支払いが確認されて全ての事前審査書類が提出され、承認された後に現地訪問／監査の日程を決定します。' +
    '急ぎの場合は急な手配のため旅費が高くなることがあります。\n' +
    '注：IDFL は、是正措置の評価および承認後に認証決定を行います。';

  const sameAsApplicant = field(
    { label: '支払企業は申請者と同じ', type: 'checkbox' },
    'payment.sameAsApplicant', data.payment.sameAsApplicant, ctx);

  const mirrorNote = el('p', { class: 'inline-note', text: '申請者情報がそのまま支払企業情報として使用されます。別の企業が支払う場合はチェックを外してください。' });
  const companyBox = conditional(
    (d) => !d.payment.sameAsApplicant,
    card('支払企業の情報', el('div', { class: 'grid-2' }, ...partyFields('payment.company', data, ctx))),
    refreshers);
  refreshers.push((d) => { mirrorNote.hidden = !d.payment.sameAsApplicant; });

  const node = el('div', {},
    card('支払情報',
      currency, currencyOther,
      field({ label: 'Tax ID #', type: 'text', required: true }, 'payment.taxId', data.payment.taxId, ctx)),
    card('Rush Service Fees（緊急対応のサービス料金）',
      helpBlock('なぜこの情報が必要ですか？', rushHelp),
      field({ label: 'ラッシュ 現場訪問 / 評価（7 営業日以内）', type: 'checkbox' }, 'payment.rush.siteVisit', data.payment.rush.siteVisit, ctx),
      field({ label: 'ラッシュ認証決定（3 営業日以内）', type: 'checkbox' }, 'payment.rush.certificationDecision', data.payment.rush.certificationDecision, ctx)),
    card('支払企業', sameAsApplicant, mirrorNote),
    companyBox);

  return { node, refresh: (d) => refreshers.forEach((r) => r(d)) };
}

/* ------------------------------------------------------------------ *
 * Step 3 — §3 standards
 * ------------------------------------------------------------------ */
export function stepStandards(data, ctx) {
  const refreshers = [];
  const node = el('div', {},
    el('p', { class: 'step-intro', text: '申請する認証規格を選択してください。ここでの選択によって、以降のステップで表示される質問が決まります。' }),
    el('div', { class: 'std-note' },
      el('strong', { text: '重要：' }),
      'SC（Scope Certificate）に関する TC（Transaction Certificates）発行ポリシー：IDFL は SC 発行前に行われた発送取引に関しては TC を発行いたしません。'));

  for (const s of STANDARDS) {
    const b = data.standards[s.key];
    const box = el('section', { class: 'std', dataset: { std: s.key } });

    const head = el('div', { class: 'std-head' });
    const cid = nextId();
    const cb = el('input', { type: 'checkbox', id: cid, autocomplete: 'off' });
    cb.checked = b.selected;
    cb.addEventListener('change', () => ctx.onChange(`standards.${s.key}.selected`, cb.checked));
    head.append(el('label', { class: 'std-pick', for: cid }, cb,
      el('span', {}, el('strong', { text: s.name }), el('span', { class: 'std-ja', text: s.nameJa || '' }))));
    box.append(head);

    if (s.note) box.append(helpBlock('この規格について', s.note + (s.conflictNote ? '\n' + s.conflictNote : '')));

    const detail = el('div', { class: 'std-detail' });

    if (s.subStandards) {
      detail.append(field({
        label: '対象規格', type: 'checkgroup', required: true,
        options: s.subStandards.map((x) => ({ value: x.key, label: x.label })),
      }, `standards.${s.key}.subStandards`, b.subStandards, ctx));
    }

    detail.append(field({
      label: '認証状態', type: 'radio', required: true,
      options: [{ value: 'initial', label: 'Initial Certification（初期認証）' },
                { value: 'renewal', label: 'Renewal Certification（更新認証）' }],
    }, `standards.${s.key}.certificationStatus`, b.certificationStatus, ctx));

    const priorWrap = el('div', { class: 'prior' },
      el('p', { class: 'f-label', text: '他認証機関での認証歴' }));
    for (const p of s.prior) {
      priorWrap.append(field({ label: p.label, type: 'checkbox' },
        `standards.${s.key}.priorCertifications.${p.key}`, b.priorCertifications[p.key], ctx));
    }
    detail.append(priorWrap);

    const prevBox = el('div', { class: 'grid-2' },
      field({ label: '前回のプロジェクト / ライセンス番号', type: 'text' }, `standards.${s.key}.previousLicenceNo`, b.previousLicenceNo, ctx),
      field({ label: '以前の認証機関', type: 'text' }, `standards.${s.key}.previousCertifier`, b.previousCertifier, ctx),
      field({ label: '認証更新日', type: 'text', placeholder: '例：2025-04-01' }, `standards.${s.key}.certificationRenewalDate`, b.certificationRenewalDate, ctx));
    detail.append(prevBox);

    box.append(detail);
    node.append(box);

    refreshers.push((d) => {
      const sel = d.standards[s.key].selected;
      detail.hidden = !sel;
      box.classList.toggle('is-on', sel);
      // licence fields become required once a prior certification is declared
      const need = anyPriorCert(d, s.key);
      prevBox.querySelectorAll('.f').forEach((f, i) => {
        const badge = f.querySelector('.req');
        if (i < 2 && need && !badge) f.querySelector('.f-label')?.append(el('span', { class: 'req', text: '必須' }));
        if (i < 2 && !need && badge) badge.remove();
      });
    });
  }

  return { node, refresh: (d) => refreshers.forEach((r) => r(d)) };
}

/* ------------------------------------------------------------------ *
 * Step 4 — §4 products
 * ------------------------------------------------------------------ */
export function stepProducts(data, ctx) {
  const refreshers = [];
  const grid = el('div', { class: 'prod-grid' });

  for (const c of PRODUCT_CATEGORIES) {
    const item = el('div', { class: 'prod' });
    const cid = nextId();
    const cb = el('input', { type: 'checkbox', id: cid, autocomplete: 'off' });
    cb.checked = data.products.categories[c.key].selected;
    cb.addEventListener('change', () => ctx.onChange(`products.categories.${c.key}.selected`, cb.checked));
    item.append(el('label', { class: 'prod-pick', for: cid }, cb, el('span', { text: c.label })));
    grid.append(item);

    // Product detail is deliberately not collected here — it is submitted later
    // via the separate Product List. The official template's detail cells are
    // left blank rather than filled with anything invented.
    refreshers.push((d) => {
      item.classList.toggle('is-on', d.products.categories[c.key].selected);
    });
  }

  const othersList = el('div', { class: 'repeat-list' });
  const renderOthers = () => {
    othersList.replaceChildren();
    data.products.others.forEach((o, i) => {
      const row = el('div', { class: 'repeat-item' },
        el('div', { class: 'repeat-head' },
          el('span', { class: 'repeat-title', text: `その他 ${i + 1}` }),
          el('button', { type: 'button', class: 'btn-ghost', onClick: () => ctx.removeItem('products.others', i) }, '削除')),
        field({ label: '製品カテゴリー名', type: 'text', required: true }, `products.others.${i}.name`, o.name, ctx));
      othersList.append(row);
    });
  };
  renderOthers();
  ctx.registerRepeat('products.others', renderOthers);

  const addOther = el('button', { type: 'button', class: 'btn-line', onClick: () => ctx.addItem('products.others', emptyProductOther()) }, '＋ その他の製品カテゴリーを追加');
  const overflow = el('p', { class: 'warn-inline' });
  refreshers.push((d) => {
    const n = d.products.others.length;
    addOther.disabled = false;
    overflow.hidden = n <= PRODUCT_OTHER_MAX;
    overflow.textContent = `公式様式の「その他」欄は ${PRODUCT_OTHER_MAX} 行です。現在 ${n} 件 — 超過分は別紙での提出になります。`;
  });

  const node = el('div', {},
    el('p', { class: 'step-intro', text: '認証を希望する製品カテゴリーを選択してください。該当するものをすべて選択できます。' }),
    el('p', { class: 'note-inline', text: '製品詳細は本申請フォームでは不要です。詳細は後日、Product List にてご提出ください。' }),
    card('製品カテゴリー', grid),
    card('その他の製品カテゴリー', othersList, addOther, overflow));

  return { node, refresh: (d) => refreshers.forEach((r) => r(d)) };
}

/* ------------------------------------------------------------------ *
 * Step 5 — §5 facilities
 * ------------------------------------------------------------------ */
export function stepFacilities(data, ctx) {
  const refreshers = [];
  const list = el('div', { class: 'repeat-list' });

  const renderList = () => {
    list.replaceChildren();
    data.facilities.forEach((f, i) => {
      const p = `facilities.${i}`;
      const stdOptions = STANDARDS
        .filter((s) => isSelected(data, s.key))
        .map((s) => ({ value: s.key, label: s.name }));

      const item = el('section', { class: 'repeat-item facility' },
        el('div', { class: 'repeat-head' },
          el('span', { class: 'repeat-title', text: `施設 ${i + 1}` }),
          el('div', { class: 'repeat-actions' },
            el('button', { type: 'button', class: 'btn-ghost', onClick: () => ctx.duplicateItem('facilities', i) }, '複製'),
            el('button', { type: 'button', class: 'btn-ghost danger', disabled: data.facilities.length <= 1, onClick: () => ctx.removeItem('facilities', i) }, '削除'))),
        el('div', { class: 'grid-2' },
          field({ label: '会社/施設/ユニット名', type: 'text', required: true }, `${p}.name`, f.name, ctx),
          field({ label: '施設/ユニットの住所、市区町村、地域、郵便番号、国', type: 'text', required: true }, `${p}.address`, f.address, ctx),
          field({ label: '従業員数', type: 'text', required: true, inputmode: 'numeric', help: '正社員、契約社員、下請け社員をすべて含めてください。', helpSummary: 'なぜこの情報が必要ですか？' }, `${p}.employeeCount`, f.employeeCount, ctx),
          field({ label: 'ユニットタイプ', type: 'select', required: true, options: UNIT_TYPES }, `${p}.unitType`, f.unitType, ctx)),
        stdOptions.length
          ? field({ label: '規格', type: 'checkgroup', required: true, note: 'この施設に適用される認証規格を選択してください。' , options: stdOptions }, `${p}.standards`, f.standards, ctx)
          : el('p', { class: 'warn-inline', text: 'ステップ3で認証規格を選択すると、ここで施設ごとの規格を指定できます。' }),
        field({ label: '活動/工程のリスト', type: 'checkgroup', required: true, options: FACILITY_ACTIVITIES.map((a) => ({ value: a, label: a })) }, `${p}.activities`, f.activities, ctx),
        field({ label: '上記以外の活動/工程', type: 'text', placeholder: '該当するものがあれば入力してください' }, `${p}.activitiesOther`, f.activitiesOther, ctx),
        field({ label: '以前に認証を受けたことがありますか？', type: 'yesno', required: true }, `${p}.previouslyCertified`, f.previouslyCertified, ctx));
      list.append(item);
    });
  };
  renderList();
  ctx.registerRepeat('facilities', renderList);

  const overflow = el('p', { class: 'warn-inline' });
  refreshers.push((d) => {
    const n = d.facilities.length;
    overflow.hidden = n <= FACILITY_MASTER_ROWS;
    overflow.textContent = `公式様式の施設表は ${FACILITY_MASTER_ROWS} 行です。現在 ${n} 件 — 様式の指示どおり、超過分は別紙（Excel/Word）での提出になります。`;
  });

  const node = el('div', {},
    helpBlock('この項目の公式説明を見る', FACILITY_INSTRUCTIONS),
    card('下請け施設',
      field({
        label: 'この認証範囲において、認証製品を取引／取扱／加工する下請け施設がありますか？',
        type: 'yesno', required: true,
        note: 'ある場合は、各施設の「活動/工程のリスト」に「下請け」を明記してください。',
      }, 'facilitiesMeta.hasSubcontractors', data.facilitiesMeta.hasSubcontractors, ctx)),
    list,
    el('div', { class: 'repeat-foot' },
      el('button', { type: 'button', class: 'btn-line', onClick: () => ctx.addItem('facilities', emptyFacility()) }, '＋ 施設を追加'),
      overflow));

  return { node, refresh: (d) => refreshers.forEach((r) => r(d)) };
}

/* ------------------------------------------------------------------ *
 * Step 6 — §6 compliance
 * ------------------------------------------------------------------ */
export function stepCompliance(data, ctx) {
  const refreshers = [];

  const certList = el('div', { class: 'yn-list' });
  for (const c of OTHER_CERTIFICATIONS) {
    certList.append(field(
      { label: c.ja, labelEn: c.en, type: 'yesno', required: true },
      `otherCertifications.${c.key}`, data.otherCertifications[c.key], ctx));
  }

  const gotsQ = conditional(showsGotsChemicals, el('div', {},
    field({ label: 'GOTS 製品の製造に化学物質を投入する施設はありますか?', labelEn: 'Do any facilities use chemical inputs in the production of GOTS products?', type: 'yesno', required: true },
      'chemicalCompliance.usesChemicalsGots', data.chemicalCompliance.usesChemicalsGots, ctx),
    conditional((d) => d.chemicalCompliance.usesChemicalsGots === 'yes',
      field({ label: 'はいの場合、GOTS 製品の製造にはどのくらいの化学物質が使用されていますか?', type: 'text', required: true },
        'chemicalCompliance.chemicalCountGots', data.chemicalCompliance.chemicalCountGots, ctx),
      refreshers)), refreshers);

  const grsQ = conditional(showsGrsChemicals, el('div', {},
    field({ label: 'GRS 製品の製造に化学物質を投入する施設はありますか?', labelEn: 'Do any facilities use chemical inputs in the production of GRS products?', type: 'yesno', required: true },
      'chemicalCompliance.usesChemicalsGrs', data.chemicalCompliance.usesChemicalsGrs, ctx),
    conditional((d) => d.chemicalCompliance.usesChemicalsGrs === 'yes',
      field({ label: 'はいの場合、GRS 製品の製造にはどのくらいの化学物質が使用されていますか?', type: 'text', required: true },
        'chemicalCompliance.chemicalCountGrs', data.chemicalCompliance.chemicalCountGrs, ctx),
      refreshers)), refreshers);

  const noChem = el('p', { class: 'inline-note', text: 'GOTS / GRS を選択していないため、化学物質に関する質問は表示されません。' });
  refreshers.push((d) => { noChem.hidden = showsGotsChemicals(d) || showsGrsChemicals(d); });

  const node = el('div', {},
    card('認証 — 組織または施設は、以下のいずれかの規格の認証を受けていますか?', certList),
    card('化学物質のコンプライアンス', gotsQ, grsQ, noChem),
    card('認証コンプライアンス',
      field({ label: '組織またはその施設は、別の認証機関によって認証を拒否されたことがありますか?', type: 'yesno', required: true },
        'certifications.refusedBefore', data.certifications.refusedBefore, ctx),
      conditional((d) => d.certifications.refusedBefore === 'yes',
        field({ label: '拒否された場合は、詳細情報を記入してください。', type: 'textarea', required: true },
          'certifications.refusedDetail', data.certifications.refusedDetail, ctx),
        refreshers),
      field({ label: '組織またはその施設は製品認証を禁止されたことがありますか? 禁止されている場合は、以下に説明してください。', type: 'textarea' },
        'certifications.prohibitedDetail', data.certifications.prohibitedDetail, ctx)));

  return { node, refresh: (d) => refreshers.forEach((r) => r(d)) };
}

/* ------------------------------------------------------------------ *
 * Step 7 — §8 recycling + §§9–12 RDS
 * ------------------------------------------------------------------ */
export function stepStandardSpecific(data, ctx) {
  const refreshers = [];
  const node = el('div', {});

  /* §8 */
  const recycleInner = el('div', {});
  const recycleCard = card('セクション8 — リサイクル材料（GRS / RCS・リサイクル業者のみ）',
    field({
      label: '組織または施設ではリサイクルプロセスを実行する予定ですか?', type: 'radio', required: true,
      options: RECYCLED_MATERIAL_TYPES,
    }, 'recycling.materialType', data.recycling.materialType, ctx),
    recycleInner);

  recycleInner.append(
    el('p', { class: 'inline-note', text: '「はい」と回答した場合は、リサイクルプロセスに関する以下の情報を提供してください。' }),
    field({ label: 'CCS 105で定義されている代替体積整合（VR2）を使用するすべての ASR 213 Raw Material（RM）Process Category（PR）コードを一覧にしてください。該当なしの場合は N/A。', type: 'textarea', required: true, help: '「原材料は製造システムに連続的に投入され、完成した化学製品はスペースを作るために取り除かれます」。' }, 'recycling.vr2Sites', data.recycling.vr2Sites, ctx),
    field({ label: 'リサイクルされる投入廃棄物（再生材料など）について説明してください。そしてそれぞれが使用済み材料か使用前材料かを識別してください。', type: 'textarea', required: true }, 'recycling.inputWasteDescription', data.recycling.inputWasteDescription, ctx),
    field({ label: '廃棄物の収集・集中化を行う業者（再生資材の供給者）の推定数はどのくらいですか？', type: 'text', required: true }, 'recycling.collectorCount', data.recycling.collectorCount, ctx),
    field({ label: '廃棄物の収集・集中化業者（再生資材の供給者）の一般的な所在地（地域/国）はどこですか？', type: 'text', required: true }, 'recycling.collectorLocations', data.recycling.collectorLocations, ctx),
    field({ label: '収集・集中化業者（再生資材の供給者）の一般的な活動・プロセスの一覧（例：収集、開封、選別、フレーク化など）：', type: 'textarea', required: true }, 'recycling.collectorActivities', data.recycling.collectorActivities, ctx),
    helpBlock('補足（公式）', '再生資材の供給者は、素材の収集または集中化のプロセスにのみ関与している限り、GRS/RCSの認証を受ける必要はありません。ただし、再生材料供給者は、GRS/RCS の要件に従って記録を保持する必要があります。再生材料サプライヤーは、「再生材料サプライヤー契約書」付録 B に記載されている通り、検査の対象となる場合があります。'));

  node.append(conditional(showsRecycling, recycleCard, refreshers));
  refreshers.push((d) => {
    recycleInner.hidden = !d.recycling.materialType || d.recycling.materialType === 'none';
  });

  /* §§9–12 */
  const rdsCard = card('セクション9〜12 — RDS 関連情報',
    field({
      label: 'RDS の認証範囲に含まれるものを選択してください', type: 'checkgroup', required: true,
      options: RDS_SCOPES.map((s) => ({ value: s.value, label: `${s.label}（セクション${s.section}）` })),
    }, 'rds.scopes', data.rds.scopes, ctx));

  for (const [tableKey, table] of Object.entries(RDS_TABLES)) {
    const list = el('div', { class: 'repeat-list' });
    const renderList = () => {
      list.replaceChildren();
      data.rds[tableKey].forEach((item, i) => {
        const p = `rds.${tableKey}.${i}`;
        const row = el('section', { class: 'repeat-item' },
          el('div', { class: 'repeat-head' },
            el('span', { class: 'repeat-title', text: `${table.itemLabel} ${i + 1}` }),
            el('div', { class: 'repeat-actions' },
              el('button', { type: 'button', class: 'btn-ghost', onClick: () => ctx.duplicateItem(`rds.${tableKey}`, i) }, '複製'),
              el('button', { type: 'button', class: 'btn-ghost danger', onClick: () => ctx.removeItem(`rds.${tableKey}`, i) }, '削除'))),
          el('div', { class: 'grid-2' },
            ...table.fields.map((f) => field(f, `${p}.${f.key}`, item[f.key], ctx))));
        list.append(row);
      });
    };
    renderList();
    ctx.registerRepeat(`rds.${tableKey}`, renderList);

    const overflow = el('p', { class: 'warn-inline' });
    const sub = el('div', { class: 'rds-table' },
      el('h4', { class: 'sub-title', text: `セクション${table.section} — ${table.itemLabel}` }),
      el('p', { class: 'inline-note', text: table.instructions }),
      list,
      el('button', { type: 'button', class: 'btn-line', onClick: () => ctx.addItem(`rds.${tableKey}`, emptyRdsItem(tableKey)) }, `＋ ${table.itemLabel}を追加`),
      overflow);
    rdsCard.append(sub);

    refreshers.push((d) => {
      sub.hidden = !rdsScopeActive(d, table.scope);
      const n = d.rds[tableKey].length;
      overflow.hidden = n <= RDS_MASTER_ROWS;
      overflow.textContent = `公式様式の${table.itemLabel}表は ${RDS_MASTER_ROWS} 行です。現在 ${n} 件 — 超過分は別紙での提出になります。`;
    });
  }

  node.append(conditional(showsRds, rdsCard, refreshers));

  const none = el('p', { class: 'inline-note', text: 'ステップ3で選択された規格には、追加の規格別情報はありません。' });
  refreshers.push((d) => { none.hidden = showsRecycling(d) || showsRds(d); });
  node.append(none);

  return { node, refresh: (d) => refreshers.forEach((r) => r(d)) };
}

/* ------------------------------------------------------------------ *
 * Step 9 — §7 declaration
 * ------------------------------------------------------------------ */
export function stepDeclaration(data, ctx) {
  const refreshers = [];
  const node = el('div', {},
    el('div', { class: 'declaration-text' },
      el('p', { text: '署名者は、申請書に記載されたすべての情報が完全に真実であることを確認します。この申請書に故意に虚偽の記載をした場合、認定が取り消される場合があります。' })),
    card('署名情報',
      field({ label: 'Name of Company / 会社名', type: 'text', required: true }, 'declaration.companyName', data.declaration.companyName, ctx),
      field({ label: 'Name and Title of the Signatory / 署名者の氏名と役職', type: 'text', required: true }, 'declaration.signatoryNameTitle', data.declaration.signatoryNameTitle, ctx),
      field({ label: 'Date / 日付', type: 'text', required: true, placeholder: '例：2026-08-24' }, 'declaration.date', data.declaration.date, ctx)),
    card('申請代表者（他の企業が申請をサポートしている場合）',
      el('p', { class: 'inline-note', text: '該当する場合のみご記入ください。' }),
      el('div', { class: 'grid-2' },
        field({ label: '申請代表者　会社名', type: 'text' }, 'declaration.representative.companyName', data.declaration.representative.companyName, ctx),
        field({ label: '申請代表者　ご担当者', type: 'text' }, 'declaration.representative.contactName', data.declaration.representative.contactName, ctx),
        field({ label: '申請代表者　連絡先メールアドレス', type: 'email' }, 'declaration.representative.email', data.declaration.representative.email, ctx))),
    el('div', { class: 'notice' },
      el('h4', { text: '署名と社印について' }),
      el('p', { text: '生成される申請書は「未署名」の状態です。公式様式の Authorized Signature（承認の署名）欄と Company’s Registered Seal/Stamp（社印）欄は、印刷後に手書きの署名と社印を押していただく必要があります。本システムがこの2箇所を自動で埋めることはありません。' })));

  return { node, refresh: (d) => refreshers.forEach((r) => r(d)) };
}

export const STEP_RENDERERS = {
  applicant: stepApplicant,
  payment: stepPayment,
  standards: stepStandards,
  products: stepProducts,
  facilities: stepFacilities,
  compliance: stepCompliance,
  standardSpecific: stepStandardSpecific,
  declaration: stepDeclaration,
};

export { COUNTRY_SUGGESTIONS };

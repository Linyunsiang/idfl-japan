/**
 * Step 8 — Review.
 *
 * Reads the same ApplicationData the form writes; nothing is duplicated here.
 * Every missing item is a button that jumps straight to the offending field.
 */

import { el } from './render.js';
import {
  STANDARDS, PRODUCT_CATEGORIES, OTHER_CERTIFICATIONS, UNIT_TYPES,
  RECYCLED_MATERIAL_TYPES, RDS_TABLES, RDS_SCOPES, PARTY_FIELDS,
} from './schema.js';
import {
  getPath, isSelected, showsRecycling, showsRds, rdsScopeActive,
  showsGotsChemicals, showsGrsChemicals, effectivePaymentCompany,
} from './engine.js';

const YN = { yes: 'はい', no: 'いいえ', '': '—' };
const dash = (v) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? '—' : v);
const label = (list, v) => list.find((o) => o.value === v)?.label ?? dash(v);

function kv(rows) {
  const dl = el('dl', { class: 'rv-dl' });
  for (const [k, v] of rows) {
    dl.append(el('dt', { text: k }));
    const dd = el('dd');
    const val = dash(v);
    dd.append(el('span', { class: val === '—' ? 'rv-empty' : '', text: Array.isArray(val) ? val.join('、') : String(val) }));
    dl.append(dd);
  }
  return dl;
}

function group(title, stepId, status, body, ctx) {
  const badge = { complete: ['完了', 'ok'], incomplete: ['未入力あり', 'bad'], attention: ['要確認', 'warn'] }[status];
  return el('section', { class: `rv-group is-${status}` },
    el('header', { class: 'rv-head' },
      el('h3', { class: 'rv-title', text: title }),
      el('span', { class: `rv-badge ${badge[1]}`, text: badge[0] }),
      el('button', { type: 'button', class: 'btn-ghost', onClick: () => ctx.goToStep(stepId) }, '編集')),
    body);
}

/**
 * Document-generation gate.
 *
 * The Word button is enabled only when ALL of the following hold (Phase 3A rule 16):
 *   1. every required field validates
 *   2. the official master's SHA-256 matches the supported template
 *   3. no section exceeds the master's physical row capacity
 * Until the asynchronous template check completes the button stays disabled.
 */
function buildGate(data, errorCount) {
  const status = el('p', { class: 'inline-note', text: '公式様式を確認しています…' });
  const reasons = el('ul', { class: 'gate-reasons' });
  const wordBtn = el('button', { type: 'button', class: 'btn-primary', disabled: true }, 'Word (.docx) をダウンロード');
  const pdfBtn = el('button', { type: 'button', class: 'btn-line', disabled: true, title: 'フェーズ3Bで実装予定' }, 'PDF をダウンロード');

  const gate = el('div', { class: 'rv-gate' },
    el('h3', { text: '申請書類の生成' }),
    el('p', { text: '入力内容を IDFL 公式様式（IDFLAS-FF-GEN-4100-JP）にそのまま差し込んだ Word 文書を作成します。様式のレイアウト・書式・ヘッダー・社印欄は一切変更されません。' }),
    el('div', { class: 'rv-gate-btns' }, wordBtn, pdfBtn),
    status, reasons,
    el('p', { class: 'inline-note', text: '※ 生成される書類は未署名です。印刷後、承認の署名と社印をご記入ください。' }));

  wordBtn.addEventListener('click', async () => {
    wordBtn.disabled = true;
    status.textContent = '書類を作成しています…';
    try {
      const { downloadDocx } = await import('./docgen/browser.js');
      const report = await downloadDocx(data);
      status.textContent = `ダウンロードしました（${report.fieldsPopulated} 項目を差し込み／公式様式 ${report.templateVersion}）。`;
    } catch (err) {
      status.textContent = `書類を作成できませんでした：${err.message}`;
    } finally {
      wordBtn.disabled = false;
    }
  });

  (async () => {
    try {
      const { checkReadiness } = await import('./docgen/browser.js');
      const verdict = await checkReadiness(data);
      reasons.replaceChildren();
      if (verdict.ready) {
        wordBtn.disabled = false;
        status.textContent = '公式様式を確認しました。ダウンロードできます。';
      } else {
        wordBtn.disabled = true;
        status.textContent = errorCount
          ? '未入力の必須項目があるため、書類生成は行えません。'
          : '以下の理由により、書類生成は行えません。';
        for (const r of verdict.reasons) reasons.append(el('li', { text: r }));
      }
    } catch (err) {
      wordBtn.disabled = true;
      status.textContent = `公式様式を確認できませんでした：${err.message}`;
    }
  })();

  return gate;
}

export function stepReview(data, ctx) {
  const node = el('div', { class: 'review' });

  const render = (d) => {
    node.replaceChildren();
    const v = ctx.getValidation();
    const errBy = {};
    for (const e of v.errors) (errBy[e.step] ||= []).push(e);
    const warnBy = {};
    for (const w of v.warnings) (warnBy[w.step] ||= []).push(w);

    const statusOf = (step) =>
      errBy[step]?.length ? 'incomplete' : warnBy[step]?.length ? 'attention' : 'complete';

    /* ---- summary banner ---- */
    const total = v.errors.length;
    node.append(el('div', { class: `rv-summary ${total ? 'bad' : 'ok'}` },
      el('div', {},
        el('strong', { text: total ? `未入力の必須項目が ${total} 件あります` : 'すべての必須項目が入力されています' }),
        el('p', { text: total
          ? '下の「未入力の項目へ移動」から該当箇所に直接移動できます。すべて入力されるまで申請書類の生成はできません。'
          : '内容をご確認のうえ、次のステップ（確認・署名）へお進みください。' })),
      v.warnings.length ? el('span', { class: 'rv-badge warn', text: `要確認 ${v.warnings.length} 件` }) : null));

    /* ---- missing list ---- */
    if (total) {
      const ul = el('ul', { class: 'rv-missing' });
      for (const e of v.errors.slice(0, 40)) {
        ul.append(el('li', {},
          el('button', { type: 'button', class: 'rv-jump', onClick: () => ctx.goToField(e.step, e.path) },
            el('span', { class: 'rv-jump-label', text: e.label }),
            el('span', { class: 'rv-jump-msg', text: e.message }))));
      }
      if (v.errors.length > 40) ul.append(el('li', { class: 'rv-more', text: `他 ${v.errors.length - 40} 件` }));
      node.append(el('section', { class: 'rv-group is-incomplete' },
        el('header', { class: 'rv-head' }, el('h3', { class: 'rv-title', text: '未入力の項目へ移動' })), ul));
    }

    /* ---- warnings ---- */
    if (v.warnings.length) {
      const ul = el('ul', { class: 'rv-warnlist' });
      for (const w of v.warnings) {
        ul.append(el('li', {},
          el('button', { type: 'button', class: 'rv-jump', onClick: () => ctx.goToField(w.step, w.path) },
            el('span', { class: 'rv-jump-label', text: w.label }),
            el('span', { class: 'rv-jump-msg', text: w.message }))));
      }
      node.append(el('section', { class: 'rv-group is-attention' },
        el('header', { class: 'rv-head' }, el('h3', { class: 'rv-title', text: '要確認' })), ul));
    }

    /* ---- §1 ---- */
    node.append(group('申請者情報', 'applicant', statusOf('applicant'),
      kv(PARTY_FIELDS.map((f) => [f.label, d.applicant[f.key]])), ctx));

    /* ---- §2 ---- */
    const pay = effectivePaymentCompany(d);
    node.append(group('支払情報', 'payment', statusOf('payment'), el('div', {},
      kv([
        ['支払いの通貨', d.payment.currency === 'OTHER' ? `OTHER（${dash(d.payment.currencyOther)}）` : d.payment.currency],
        ['Tax ID #', d.payment.taxId],
        ['ラッシュ 現場訪問 / 評価', d.payment.rush.siteVisit ? '希望する' : '希望しない'],
        ['ラッシュ認証決定', d.payment.rush.certificationDecision ? '希望する' : '希望しない'],
        ['支払企業', d.payment.sameAsApplicant ? '申請者と同じ' : '別企業'],
      ]),
      el('h4', { class: 'rv-sub', text: '支払企業の情報' }),
      d.payment.sameAsApplicant ? el('p', { class: 'inline-note', text: '申請者情報がそのまま使用されます。' }) : null,
      kv(PARTY_FIELDS.map((f) => [f.label, pay[f.key]])),
    ), ctx));

    /* ---- §3 ---- */
    const stdBody = el('div', {});
    const chosen = STANDARDS.filter((s) => d.standards[s.key].selected);
    if (!chosen.length) stdBody.append(el('p', { class: 'rv-empty', text: '認証規格が選択されていません。' }));
    for (const s of chosen) {
      const b = d.standards[s.key];
      const rows = [['認証状態', b.certificationStatus === 'initial' ? 'Initial Certification（初期認証）' : b.certificationStatus === 'renewal' ? 'Renewal Certification（更新認証）' : '']];
      if (s.subStandards) rows.push(['対象規格', (b.subStandards || []).map((k) => s.subStandards.find((x) => x.key === k)?.label.split(' ')[0]).join('、')]);
      const priors = s.prior.filter((p) => b.priorCertifications[p.key]).map((p) => p.label);
      rows.push(['他認証機関での認証歴', priors.length ? priors : '該当なし']);
      if (priors.length || b.previousLicenceNo || b.previousCertifier) {
        rows.push(['前回のプロジェクト / ライセンス番号', b.previousLicenceNo]);
        rows.push(['以前の認証機関', b.previousCertifier]);
        rows.push(['認証更新日', b.certificationRenewalDate]);
      }
      stdBody.append(el('h4', { class: 'rv-sub', text: s.name }), kv(rows));
    }
    node.append(group('認証規格', 'standards', statusOf('standards'), stdBody, ctx));

    /* ---- §4 ---- */
    // Categories only — product detail is submitted later via the Product List.
    const prodNames = PRODUCT_CATEGORIES
      .filter((c) => d.products.categories[c.key].selected)
      .map((c) => c.label);
    d.products.others.filter((o) => o.selected)
      .forEach((o, i) => prodNames.push(`その他 ${i + 1}：${dash(o.name)}`));
    const prodBody = prodNames.length
      ? el('div', {},
          kv([['選択した製品カテゴリー', prodNames.join('、')]]),
          el('p', { class: 'rv-note', text: '製品詳細は本申請フォームでは提出不要です。詳細は後日、Product List にてご提出ください。' }))
      : el('p', { class: 'rv-empty', text: '製品カテゴリーが選択されていません。' });
    node.append(group('製品', 'products', statusOf('products'), prodBody, ctx));

    /* ---- §5 ---- */
    const facBody = el('div', {},
      kv([['下請け施設の有無', YN[d.facilitiesMeta.hasSubcontractors]], ['登録施設数', `${d.facilities.length} 件`]]));
    d.facilities.forEach((f, i) => {
      const acts = [...(f.activities || [])];
      if (f.activitiesOther) acts.push(f.activitiesOther);
      facBody.append(el('h4', { class: 'rv-sub', text: `施設 ${i + 1}：${dash(f.name)}` }), kv([
        ['住所', f.address],
        ['従業員数', f.employeeCount],
        ['規格', (f.standards || []).map((k) => STANDARDS.find((s) => s.key === k)?.name || k)],
        ['活動/工程のリスト', acts],
        ['ユニットタイプ', label(UNIT_TYPES, f.unitType)],
        ['以前に認証を受けたことがありますか？', YN[f.previouslyCertified]],
      ]));
    });
    node.append(group('施設・工程', 'facilities', statusOf('facilities'), facBody, ctx));

    /* ---- §6 ---- */
    const compBody = el('div', {},
      el('h4', { class: 'rv-sub', text: '他規格の認証状況' }),
      kv(OTHER_CERTIFICATIONS.map((c) => [c.ja, YN[d.otherCertifications[c.key]]])));
    const chemRows = [];
    if (showsGotsChemicals(d)) {
      chemRows.push(['GOTS 製品の製造に化学物質を投入する施設', YN[d.chemicalCompliance.usesChemicalsGots]]);
      if (d.chemicalCompliance.usesChemicalsGots === 'yes') chemRows.push(['GOTS 製品の化学物質数', d.chemicalCompliance.chemicalCountGots]);
    }
    if (showsGrsChemicals(d)) {
      chemRows.push(['GRS 製品の製造に化学物質を投入する施設', YN[d.chemicalCompliance.usesChemicalsGrs]]);
      if (d.chemicalCompliance.usesChemicalsGrs === 'yes') chemRows.push(['GRS 製品の化学物質数', d.chemicalCompliance.chemicalCountGrs]);
    }
    if (chemRows.length) compBody.append(el('h4', { class: 'rv-sub', text: '化学物質のコンプライアンス' }), kv(chemRows));
    compBody.append(el('h4', { class: 'rv-sub', text: '認証コンプライアンス' }), kv([
      ['別の認証機関によって認証を拒否されたことがあるか', YN[d.certifications.refusedBefore]],
      ...(d.certifications.refusedBefore === 'yes' ? [['拒否の詳細', d.certifications.refusedDetail]] : []),
      ['製品認証を禁止されたことがあるか（説明）', d.certifications.prohibitedDetail],
    ]));
    node.append(group('認証・コンプライアンス情報', 'compliance', statusOf('compliance'), compBody, ctx));

    /* ---- §7 (step 7 = standard specific) ---- */
    if (showsRecycling(d) || showsRds(d)) {
      const ssBody = el('div', {});
      if (showsRecycling(d)) {
        const rows = [['リサイクルプロセスの実施', label(RECYCLED_MATERIAL_TYPES, d.recycling.materialType)]];
        if (d.recycling.materialType && d.recycling.materialType !== 'none') {
          rows.push(['ASR 213 RM/PR コード', d.recycling.vr2Sites]);
          rows.push(['リサイクルされる投入廃棄物', d.recycling.inputWasteDescription]);
          rows.push(['収集・集中化業者の推定数', d.recycling.collectorCount]);
          rows.push(['収集・集中化業者の所在地', d.recycling.collectorLocations]);
          rows.push(['収集・集中化業者の活動・プロセス', d.recycling.collectorActivities]);
        }
        ssBody.append(el('h4', { class: 'rv-sub', text: 'セクション8 — リサイクル材料' }), kv(rows));
      }
      if (showsRds(d)) {
        ssBody.append(el('h4', { class: 'rv-sub', text: 'RDS 認証範囲' }),
          kv([['対象', d.rds.scopes.map((s) => RDS_SCOPES.find((x) => x.value === s)?.label || s)]]));
        for (const [key, table] of Object.entries(RDS_TABLES)) {
          if (!rdsScopeActive(d, table.scope)) continue;
          ssBody.append(el('h4', { class: 'rv-sub', text: `セクション${table.section} — ${table.itemLabel}（${d.rds[key].length} 件）` }));
          d.rds[key].forEach((item, i) => {
            ssBody.append(kv([[`${table.itemLabel} ${i + 1}`, table.fields
              .map((f) => `${f.label}：${f.type === 'yesno' ? YN[item[f.key]] : dash(item[f.key])}`)
              .join(' ／ ')]]));
          });
        }
      }
      node.append(group('規格別追加情報', 'standardSpecific', statusOf('standardSpecific'), ssBody, ctx));
    }

    /* ---- §9 declaration ---- */
    node.append(group('確認・署名', 'declaration', statusOf('declaration'), kv([
      ['会社名', d.declaration.companyName],
      ['署名者の氏名と役職', d.declaration.signatoryNameTitle],
      ['日付', d.declaration.date],
      ['申請代表者 会社名', d.declaration.representative.companyName],
      ['申請代表者 ご担当者', d.declaration.representative.contactName],
      ['申請代表者 メールアドレス', d.declaration.representative.email],
    ]), ctx));

    /* ---- generation gate ---- */
    node.append(buildGate(d, total));
  };

  return { node, refresh: render };
}

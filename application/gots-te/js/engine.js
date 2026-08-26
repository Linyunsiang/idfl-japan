/**
 * Model + conditional logic + validation + completion.
 *
 * All rules here come from docs/online-application-plan.md §5 (which was derived from the
 * master). Nothing is invented. Each rule cites the section it implements.
 *
 * @typedef {import('../types/application-data').ApplicationData} ApplicationData
 */

import {
  STANDARDS, STANDARD_CONFLICTS, PRODUCT_CATEGORIES, PRODUCT_OTHER_MAX,
  OTHER_CERTIFICATIONS, RDS_TABLES, RDS_MASTER_ROWS, FACILITY_MASTER_ROWS,
  PARTY_FIELDS, SCHEMA_VERSION, TEMPLATE_VERSION,
} from './schema.js';

/* ------------------------------------------------------------------ *
 * Path helpers — 'facilities.0.name' style
 * ------------------------------------------------------------------ */

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let cur = obj;
  for (const k of keys) {
    if (cur[k] == null) cur[k] = /^\d+$/.test(k) ? [] : {};
    cur = cur[k];
  }
  cur[last] = value;
  return obj;
}

/* ------------------------------------------------------------------ *
 * Factories
 * ------------------------------------------------------------------ */

const emptyParty = () => ({
  companyName: '', companyNameEnglish: '', address: '', city: '', country: '',
  contactName: '', contactTitle: '', phone: '', email: '',
});

export const emptyFacility = () => ({
  name: '', address: '', employeeCount: '', standards: [], activities: [],
  activitiesOther: '', unitType: '', previouslyCertified: '',
});

export const emptyProductOther = () => ({ selected: true, name: '', detail: '' });

export function emptyRdsItem(tableKey) {
  const item = {};
  for (const f of RDS_TABLES[tableKey].fields) item[f.key] = '';
  return item;
}

function emptyStandardBlock(std) {
  const priorCertifications = {};
  for (const p of std.prior) priorCertifications[p.key] = false;
  const block = {
    selected: false, certificationStatus: '', priorCertifications,
    previousLicenceNo: '', previousCertifier: '', certificationRenewalDate: '',
  };
  if (std.subStandards) block.subStandards = [];
  return block;
}

/** @returns {ApplicationData} */
export function createEmptyApplication() {
  const standards = {};
  for (const s of STANDARDS) standards[s.key] = emptyStandardBlock(s);

  const categories = {};
  for (const c of PRODUCT_CATEGORIES) categories[c.key] = { selected: false, detail: '' };

  const otherCertifications = {};
  for (const c of OTHER_CERTIFICATIONS) otherCertifications[c.key] = '';

  return {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      templateVersion: TEMPLATE_VERSION,
      draftId: 'draft-' + Math.random().toString(36).slice(2, 10),
      savedAt: '',
      locale: 'ja',
    },
    applicant: emptyParty(),
    payment: {
      currency: '', currencyOther: '', taxId: '',
      rush: { siteVisit: false, certificationDecision: false },
      sameAsApplicant: true,           // smart default — plan §5
      company: emptyParty(),
    },
    standards,
    products: { categories, others: [] },
    facilitiesMeta: { hasSubcontractors: '' },
    facilities: [emptyFacility()],     // the applicant's own facility is always required
    otherCertifications,
    chemicalCompliance: {
      usesChemicalsGots: '', chemicalCountGots: '',
      usesChemicalsGrs: '', chemicalCountGrs: '',
    },
    certifications: { refusedBefore: '', refusedDetail: '', prohibitedDetail: '' },
    recycling: {
      materialType: '', vr2Sites: '', inputWasteDescription: '',
      collectorCount: '', collectorLocations: '', collectorActivities: '',
    },
    rds: { scopes: [], slaughterhouses: [], farmGroups: [], individualFarms: [], farmAreas: [] },
    declaration: {
      companyName: '', signatoryNameTitle: '', date: '',
      representative: { companyName: '', contactName: '', email: '' },
    },
  };
}

/**
 * Merge a loaded draft onto a fresh model so that drafts saved by an older schema
 * never arrive with missing keys.
 */
export function hydrate(loaded) {
  const base = createEmptyApplication();
  if (!loaded || typeof loaded !== 'object') return base;
  const merge = (target, src) => {
    for (const k of Object.keys(target)) {
      const s = src?.[k];
      if (s === undefined) continue;
      if (Array.isArray(target[k])) target[k] = Array.isArray(s) ? s : target[k];
      else if (target[k] && typeof target[k] === 'object') merge(target[k], s);
      else target[k] = s;
    }
    // preserve keys the base doesn't know about rather than silently dropping user data
    for (const k of Object.keys(src || {})) if (!(k in target)) target[k] = src[k];
    return target;
  };
  const out = merge(base, loaded);
  out.meta.schemaVersion = SCHEMA_VERSION;
  return out;
}

/* ------------------------------------------------------------------ *
 * Derived selectors
 * ------------------------------------------------------------------ */

export const selectedStandards = (d) => STANDARDS.filter((s) => d.standards[s.key].selected);
export const isSelected = (d, key) => !!d.standards[key]?.selected;
export const anyPriorCert = (d, key) =>
  Object.values(d.standards[key]?.priorCertifications || {}).some(Boolean);

/** plan §5: recycling block shown iff GRS or RCS selected */
export const showsRecycling = (d) => isSelected(d, 'grs') || isSelected(d, 'rcs');
/** plan §5: RDS sections shown iff RDS selected */
export const showsRds = (d) => isSelected(d, 'rds');
export const rdsScopeActive = (d, scope) => showsRds(d) && d.rds.scopes.includes(scope);

/** §6 r14 is GOTS-scoped, r16 is GRS-scoped — verified against the master's full labels. */
export const showsGotsChemicals = (d) => isSelected(d, 'gots');
export const showsGrsChemicals = (d) => isSelected(d, 'grs');

/**
 * §2c is hidden while `sameAsApplicant`, but the values are still produced for the
 * document. Mirroring happens here, at read time, so the user's separately-typed
 * payment details are never destroyed by toggling the checkbox.
 */
export function effectivePaymentCompany(d) {
  return d.payment.sameAsApplicant ? { ...d.applicant } : d.payment.company;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @returns {{errors: Array, warnings: Array, byStep: Object, requiredTotal: number, requiredFilled: number}}
 */
export function validate(d) {
  const errors = [];
  const warnings = [];
  let requiredTotal = 0;
  let requiredFilled = 0;

  const req = (step, path, label, value, extra) => {
    requiredTotal++;
    if (isBlank(value)) errors.push({ step, path, label, message: `${label}は必須です`, ...extra });
    else requiredFilled++;
  };
  const soft = (step, path, label, message) => warnings.push({ step, path, label, message });

  /* ---- Step 1 §1 applicant ---- */
  for (const f of PARTY_FIELDS) {
    const v = d.applicant[f.key];
    req('applicant', `applicant.${f.key}`, f.label, v);
    if (f.key === 'email' && !isBlank(v) && !EMAIL_RE.test(v))
      errors.push({ step: 'applicant', path: 'applicant.email', label: f.label, message: 'メールアドレスの形式が正しくありません' });
  }

  /* ---- Step 2 §2 payment ---- */
  req('payment', 'payment.currency', '支払いの通貨', d.payment.currency);
  if (d.payment.currency === 'OTHER')
    req('payment', 'payment.currencyOther', 'その他の通貨', d.payment.currencyOther);
  req('payment', 'payment.taxId', 'Tax ID #', d.payment.taxId);
  if (!d.payment.sameAsApplicant) {
    for (const f of PARTY_FIELDS) {
      const v = d.payment.company[f.key];
      req('payment', `payment.company.${f.key}`, `支払企業 ${f.label}`, v);
      if (f.key === 'email' && !isBlank(v) && !EMAIL_RE.test(v))
        errors.push({ step: 'payment', path: 'payment.company.email', label: `支払企業 ${f.label}`, message: 'メールアドレスの形式が正しくありません' });
    }
  }

  /* ---- Step 3 §3 standards ---- */
  requiredTotal++;
  if (selectedStandards(d).length === 0)
    errors.push({ step: 'standards', path: 'standards', label: '認証規格', message: '認証規格を1つ以上選択してください' });
  else requiredFilled++;

  for (const s of STANDARDS) {
    const b = d.standards[s.key];
    if (!b.selected) continue;
    req('standards', `standards.${s.key}.certificationStatus`, `${s.name} 認証状態`, b.certificationStatus);
    if (s.subStandards) {
      requiredTotal++;
      if ((b.subStandards || []).length === 0)
        errors.push({ step: 'standards', path: `standards.${s.key}.subStandards`, label: `${s.name} 対象規格`, message: 'RWS / RMS / RAS のいずれかを選択してください' });
      else requiredFilled++;
    }
    // plan §5: prior certification ⇒ licence no. + previous certifier become required
    if (anyPriorCert(d, s.key)) {
      req('standards', `standards.${s.key}.previousLicenceNo`, `${s.name} 前回のプロジェクト/ライセンス番号`, b.previousLicenceNo);
      req('standards', `standards.${s.key}.previousCertifier`, `${s.name} 以前の認証機関`, b.previousCertifier);
    }
    // renewal implies there is a previous certification to describe
    if (b.certificationStatus === 'renewal' && !anyPriorCert(d, s.key) && isBlank(b.previousLicenceNo))
      soft('standards', `standards.${s.key}.previousLicenceNo`, `${s.name}`,
        '更新認証を選択されています。前回のライセンス番号と認証機関のご記入をお勧めします。');
  }

  // mutual-exclusion warnings stated in the master
  for (const c of STANDARD_CONFLICTS) {
    if (isSelected(d, c.standard) && d.standards[c.standard].priorCertifications[c.priorKey])
      soft('standards', `standards.${c.standard}`, '規格の組み合わせ', c.message);
  }

  /* ---- Step 4 §4 products ---- */
  const chosenCats = PRODUCT_CATEGORIES.filter((c) => d.products.categories[c.key].selected);
  const chosenOthers = d.products.others.filter((o) => o.selected);
  requiredTotal++;
  if (chosenCats.length === 0 && chosenOthers.length === 0)
    errors.push({ step: 'products', path: 'products', label: '製品カテゴリー', message: '製品カテゴリーを1つ以上選択してください' });
  else requiredFilled++;

  // Product detail is NOT required: the online application collects categories
  // only, and the detail is submitted later via the separate Product List. The
  // official template's detail cells are simply left blank.
  d.products.others.forEach((o, i) => {
    if (!o.selected) return;
    req('products', `products.others.${i}.name`, `その他 ${i + 1} の製品カテゴリー名`, o.name);
  });
  if (d.products.others.length > PRODUCT_OTHER_MAX)
    soft('products', 'products.others', 'その他の製品',
      `公式様式の「その他」欄は ${PRODUCT_OTHER_MAX} 行です。超過分は別紙での提出になります。`);

  /* ---- Step 5 §5 facilities ---- */
  requiredTotal++;
  if (d.facilities.length === 0)
    errors.push({ step: 'facilities', path: 'facilities', label: '施設', message: '施設を1つ以上登録してください' });
  else requiredFilled++;

  req('facilities', 'facilitiesMeta.hasSubcontractors', '下請け施設の有無', d.facilitiesMeta.hasSubcontractors);

  d.facilities.forEach((f, i) => {
    const p = `facilities.${i}`;
    const n = `施設 ${i + 1}`;
    req('facilities', `${p}.name`, `${n} 会社/施設/ユニット名`, f.name);
    req('facilities', `${p}.address`, `${n} 住所`, f.address);
    req('facilities', `${p}.employeeCount`, `${n} 従業員数`, f.employeeCount);
    req('facilities', `${p}.standards`, `${n} 規格`, f.standards);
    requiredTotal++;
    if (isBlank(f.activities) && isBlank(f.activitiesOther))
      errors.push({ step: 'facilities', path: `${p}.activities`, label: `${n} 活動/工程のリスト`, message: `${n} の活動/工程を1つ以上選択または入力してください` });
    else requiredFilled++;
    req('facilities', `${p}.unitType`, `${n} ユニットタイプ`, f.unitType);
    req('facilities', `${p}.previouslyCertified`, `${n} 以前の認証`, f.previouslyCertified);

    const unknown = (f.standards || []).filter((k) => !isSelected(d, k));
    if (unknown.length)
      soft('facilities', `${p}.standards`, n,
        `${n} に、ステップ3で選択していない規格が指定されています（${unknown.join(', ')}）。`);
  });
  if (d.facilities.length > FACILITY_MASTER_ROWS)
    soft('facilities', 'facilities', '施設数',
      `公式様式の施設表は ${FACILITY_MASTER_ROWS} 行です。${d.facilities.length} 件のうち超過分は、様式の指示どおり別紙（Excel/Word）での提出になります。`);

  /* ---- Step 6 §6 compliance ---- */
  for (const c of OTHER_CERTIFICATIONS)
    req('compliance', `otherCertifications.${c.key}`, c.ja, d.otherCertifications[c.key]);

  if (showsGotsChemicals(d)) {
    req('compliance', 'chemicalCompliance.usesChemicalsGots', 'GOTS 製品の化学物質使用', d.chemicalCompliance.usesChemicalsGots);
    if (d.chemicalCompliance.usesChemicalsGots === 'yes')
      req('compliance', 'chemicalCompliance.chemicalCountGots', 'GOTS 製品の化学物質数', d.chemicalCompliance.chemicalCountGots);
  }
  if (showsGrsChemicals(d)) {
    req('compliance', 'chemicalCompliance.usesChemicalsGrs', 'GRS 製品の化学物質使用', d.chemicalCompliance.usesChemicalsGrs);
    if (d.chemicalCompliance.usesChemicalsGrs === 'yes')
      req('compliance', 'chemicalCompliance.chemicalCountGrs', 'GRS 製品の化学物質数', d.chemicalCompliance.chemicalCountGrs);
  }

  req('compliance', 'certifications.refusedBefore', '認証拒否の有無', d.certifications.refusedBefore);
  if (d.certifications.refusedBefore === 'yes')
    req('compliance', 'certifications.refusedDetail', '認証拒否の詳細', d.certifications.refusedDetail);

  /* ---- Step 7 §8 / §§9–12 ---- */
  if (showsRecycling(d)) {
    req('standardSpecific', 'recycling.materialType', 'リサイクルプロセスの実施', d.recycling.materialType);
    if (d.recycling.materialType && d.recycling.materialType !== 'none') {
      req('standardSpecific', 'recycling.vr2Sites', 'ASR 213 RM/PR コード', d.recycling.vr2Sites);
      req('standardSpecific', 'recycling.inputWasteDescription', 'リサイクルされる投入廃棄物', d.recycling.inputWasteDescription);
      req('standardSpecific', 'recycling.collectorCount', '収集・集中化業者の推定数', d.recycling.collectorCount);
      req('standardSpecific', 'recycling.collectorLocations', '収集・集中化業者の所在地', d.recycling.collectorLocations);
      req('standardSpecific', 'recycling.collectorActivities', '収集・集中化業者の活動・プロセス', d.recycling.collectorActivities);
    }
  }

  if (showsRds(d)) {
    requiredTotal++;
    if (d.rds.scopes.length === 0)
      errors.push({ step: 'standardSpecific', path: 'rds.scopes', label: 'RDS 認証範囲', message: 'RDS の認証範囲を1つ以上選択してください' });
    else requiredFilled++;

    for (const [tableKey, table] of Object.entries(RDS_TABLES)) {
      if (!rdsScopeActive(d, table.scope)) continue;
      const list = d.rds[tableKey];
      requiredTotal++;
      if (list.length === 0)
        errors.push({ step: 'standardSpecific', path: `rds.${tableKey}`, label: table.itemLabel, message: `${table.itemLabel}を1件以上登録してください` });
      else requiredFilled++;

      list.forEach((item, i) => {
        for (const f of table.fields) {
          if (!f.required) continue;
          req('standardSpecific', `rds.${tableKey}.${i}.${f.key}`,
            `${table.itemLabel} ${i + 1} ${f.label}`, item[f.key]);
        }
      });
      if (list.length > RDS_MASTER_ROWS)
        soft('standardSpecific', `rds.${tableKey}`, table.itemLabel,
          `公式様式の${table.itemLabel}表は ${RDS_MASTER_ROWS} 行です。超過分は別紙での提出になります。`);
    }
  }

  /* ---- Step 9 §7 declaration ---- */
  req('declaration', 'declaration.companyName', '会社名', d.declaration.companyName);
  req('declaration', 'declaration.signatoryNameTitle', '署名者の氏名と役職', d.declaration.signatoryNameTitle);
  req('declaration', 'declaration.date', '日付', d.declaration.date);
  const repEmail = d.declaration.representative.email;
  if (!isBlank(repEmail) && !EMAIL_RE.test(repEmail))
    errors.push({ step: 'declaration', path: 'declaration.representative.email', label: '申請代表者 メールアドレス', message: 'メールアドレスの形式が正しくありません' });

  /* ---- group by step ---- */
  const byStep = {};
  for (const e of errors) (byStep[e.step] ||= { errors: [], warnings: [] }).errors.push(e);
  for (const w of warnings) (byStep[w.step] ||= { errors: [], warnings: [] }).warnings.push(w);

  return { errors, warnings, byStep, requiredTotal, requiredFilled };
}

/** Overall completion, 0–100. Only *applicable* required fields count. */
export function completion(result) {
  if (!result.requiredTotal) return 0;
  return Math.round((result.requiredFilled / result.requiredTotal) * 100);
}

/** Which steps are visible. Declaration + review always are, in that order. */
export function visibleSteps(d) {
  return ['applicant', 'payment', 'standards', 'products', 'facilities', 'compliance']
    .concat(showsRecycling(d) || showsRds(d) ? ['standardSpecific'] : [])
    .concat(['declaration', 'review']);
}

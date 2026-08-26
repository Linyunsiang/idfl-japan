/**
 * Test fixtures for DOCX generation.
 *
 * TEST DATA ONLY. Every company name is prefixed "TEST COMPANY - DO NOT USE" so a generated
 * file can never be mistaken for a real application.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../../application/gots-te');
const { createEmptyApplication } = await import(`file://${resolve(APP, 'js/engine.js')}`);

const MARK = 'TEST COMPANY - DO NOT USE';

function baseApplication(suffix) {
  const d = createEmptyApplication();
  d.applicant = {
    companyName: `${MARK} 株式会社テスト繊維（${suffix}）`,
    companyNameEnglish: `${MARK} Test Textile Co Ltd ${suffix}`,
    address: '大阪府大阪市中央区久太郎町1丁目6番地21 シャンクレール本町 2階',
    city: '大阪市',
    country: '日本',
    contactName: '山田 太郎',
    contactTitle: '品質管理部長',
    phone: '+81 6 6484 5656',
    email: 'test-do-not-use@example.co.jp',
  };
  d.payment.currency = 'JPY';
  d.payment.taxId = 'T0000000000000';
  d.payment.sameAsApplicant = true;
  d.facilitiesMeta.hasSubcontractors = 'no';
  d.facilities = [{
    name: `${MARK} 本社工場`,
    address: '大阪府大阪市中央区久太郎町1丁目6番地21',
    employeeCount: '120',
    standards: [],
    activities: ['染色', '仕上げ'],
    activitiesOther: '',
    unitType: 'main',
    previouslyCertified: 'no',
  }];
  for (const k of Object.keys(d.otherCertifications)) d.otherCertifications[k] = 'no';
  d.certifications.refusedBefore = 'no';
  d.declaration.companyName = `${MARK} 株式会社テスト繊維`;
  d.declaration.signatoryNameTitle = '山田 太郎 / 品質管理部長';
  d.declaration.date = '2026-08-24';
  return d;
}

function pickStandard(d, key, status) {
  d.standards[key].selected = true;
  d.standards[key].certificationStatus = status;
  d.facilities.forEach((f) => { if (!f.standards.includes(key)) f.standards.push(key); });
}

/* ---------------- Scenario A — GOTS Initial ---------------- */
export function scenarioA() {
  const d = baseApplication('A');
  pickStandard(d, 'gots', 'initial');
  d.products.categories.fabric = { selected: true, detail: 'オーガニックコットン平織り生地（30番手・幅150cm）' };
  d.chemicalCompliance.usesChemicalsGots = 'yes';
  d.chemicalCompliance.chemicalCountGots = '12';
  return d;
}

/* ---------------- Scenario B — GOTS + OCS ---------------- */
export function scenarioB() {
  const d = baseApplication('B');
  pickStandard(d, 'gots', 'initial');
  pickStandard(d, 'ocs', 'initial');
  d.products.categories.fabric = { selected: true, detail: 'オーガニックコットン生地' };
  d.products.categories.yarn = { selected: true, detail: 'オーガニックコットン糸 20/1, 30/1' };
  d.chemicalCompliance.usesChemicalsGots = 'no';
  return d;
}

/* ---------------- Scenario C — GRS with recycled information ---------------- */
export function scenarioC() {
  const d = baseApplication('C');
  pickStandard(d, 'grs', 'initial');
  d.products.categories.recycledMaterial = { selected: true, detail: 'リサイクルポリエステル短繊維' };
  d.products.categories.filling = { selected: true, detail: 'リサイクルポリエステル詰め物' };
  d.chemicalCompliance.usesChemicalsGrs = 'yes';
  d.chemicalCompliance.chemicalCountGrs = '8';
  d.recycling = {
    materialType: 'postConsumer',
    vr2Sites: 'N/A',
    inputWasteDescription: '使用済みPETボトル（使用済み材料）\n工場端材（使用前材料）',
    collectorCount: '約 25 社',
    collectorLocations: '日本（近畿・中部）、ベトナム',
    collectorActivities: '収集、開封、選別、フレーク化',
  };
  return d;
}

/* ---------------- Scenario D — RCS Renewal with previous CB ---------------- */
export function scenarioD() {
  const d = baseApplication('D');
  pickStandard(d, 'rcs', 'renewal');
  d.standards.rcs.priorCertifications.rcs = true;
  d.standards.rcs.previousLicenceNo = 'RCS-2023-00891';
  d.standards.rcs.previousCertifier = 'Control Union';
  d.standards.rcs.certificationRenewalDate = '2026-03-31';
  d.products.categories.apparel = { selected: true, detail: 'リサイクル素材使用アウター' };
  d.recycling.materialType = 'none';
  return d;
}

/* ---------------- Scenario E — RDS ---------------- */
export function scenarioE() {
  const d = baseApplication('E');
  pickStandard(d, 'rds', 'initial');
  d.products.categories.rawDownFeather = { selected: true, detail: 'ホワイトダックダウン 90/10' };
  d.rds.scopes = ['slaughterhouse', 'individualFarm'];
  d.rds.slaughterhouses = [{
    name: `${MARK} テスト屠畜場`,
    address: '青森県三沢市テスト町1-1',
    contact: '佐藤 花子',
    waterfowlSpecies: 'アヒル（北京種）',
    annualSlaughterCount: '450,000',
    activities: '屠殺、脱羽、選別',
    previouslyCertified: 'no',
  }];
  d.rds.individualFarms = [{
    name: `${MARK} テスト農場`,
    address: '青森県三沢市テスト町2-2',
    contact: '鈴木 一郎',
    waterfowlSpecies: 'アヒル（北京種）',
    annualRearedCount: '80,000',
    activities: '飼育、給餌',
    isParentFarm: 'yes',
    previouslyCertified: 'no',
  }];
  return d;
}

/* ---------------- Scenario F — multiple facilities (at capacity) ---------------- */
export function scenarioF() {
  const d = baseApplication('F');
  pickStandard(d, 'gots', 'initial');
  d.products.categories.fabric = { selected: true, detail: 'オーガニックコットン生地' };
  d.chemicalCompliance.usesChemicalsGots = 'no';
  const unitTypes = ['main', 'facility', 'associatedSubcontractor', 'certifiedSubcontractor', 'facility', 'facility'];
  d.facilities = unitTypes.map((unitType, i) => ({
    name: `${MARK} 施設 ${i + 1}`,
    address: `大阪府大阪市中央区テスト${i + 1}丁目`,
    employeeCount: String(20 * (i + 1)),
    standards: ['gots'],
    activities: i % 2 ? ['織布', '編み物'] : ['染色', '仕上げ'],
    activitiesOther: i === 5 ? '検品' : '',
    unitType,
    previouslyCertified: i === 0 ? 'yes' : 'no',
  }));
  d.facilitiesMeta.hasSubcontractors = 'yes';
  return d;
}

/* ---------------- Scenario G — deliberate overflow (7 facilities) ---------------- */
export function scenarioOverflow() {
  const d = scenarioF();
  d.facilities.push({
    name: `${MARK} 施設 7（超過）`,
    address: '大阪府大阪市中央区テスト7丁目',
    employeeCount: '10',
    standards: ['gots'],
    activities: ['保管'],
    activitiesOther: '',
    unitType: 'facility',
    previouslyCertified: 'no',
  });
  return d;
}

/* ---------------- Everything at once — maximum population ---------------- */
export function scenarioFull() {
  const d = scenarioF();
  pickStandard(d, 'ocs', 'initial');
  pickStandard(d, 'grs', 'renewal');
  pickStandard(d, 'raf', 'initial');
  d.standards.raf.subStandards = ['rws', 'rms'];
  d.standards.grs.priorCertifications.grs = true;
  d.standards.grs.previousLicenceNo = 'GRS-2022-00123';
  d.standards.grs.previousCertifier = 'Ecocert';
  d.standards.grs.certificationRenewalDate = '2026-06-30';
  for (const k of Object.keys(d.products.categories)) {
    d.products.categories[k] = { selected: true, detail: `テスト用製品詳細 ${k}` };
  }
  d.products.others = Array.from({ length: 8 }, (_, i) => ({
    selected: true, name: `その他カテゴリー ${i + 1}`, detail: `詳細 ${i + 1}`,
  }));
  d.otherCertifications.oekoTexStep = 'yes';
  d.otherCertifications.bsci = 'yes';
  d.chemicalCompliance.usesChemicalsGrs = 'yes';
  d.chemicalCompliance.chemicalCountGrs = '30';
  d.certifications.refusedBefore = 'yes';
  d.certifications.refusedDetail = '2019年に別の認証機関で書類不備により一度差し戻しあり（テストデータ）。';
  d.certifications.prohibitedDetail = '該当なし';
  d.recycling = {
    materialType: 'both',
    vr2Sites: 'RM-01 / PR-04',
    inputWasteDescription: '使用済みPETボトル\n工場端材',
    collectorCount: '25',
    collectorLocations: '日本、ベトナム',
    collectorActivities: '収集、開封、選別、フレーク化',
  };
  d.declaration.representative = {
    companyName: `${MARK} コンサルティング株式会社`,
    contactName: '田中 次郎',
    email: 'rep-test-do-not-use@example.co.jp',
  };
  return d;
}

/* ---------------- MAX — true maximum functional coverage ---------------- *
 *
 * Purpose: prove that EVERY supported certification option and EVERY major conditional
 * section can populate the official template correctly.
 *
 *   · all 7 standards selected (OCS, GOTS, IVN BEST, GRS, RCS, RAF, RDS)
 *   · all 3 RAF sub-standards (RWS, RMS, RAS)
 *   · every prior-certification checkbox + a DISTINCT licence / certifier / date per
 *     standard, so a value landing in the wrong standard's block is detectable
 *   · all 4 RDS scopes, every RDS table filled to its 3-row capacity
 *   · currency = OTHER (exercises the free-text currency cell, control #24)
 *   · sameAsApplicant = false (exercises the DISTINCT §2c payment-company branch;
 *     the mirrored branch stays covered by FULL)
 *   · both rush services, all 10 other certifications = yes, both chemical questions = yes
 *
 * Certification status is "renewal" for all 7 so the prior-CB blocks are meaningful.
 * The initial-side ballots are covered by scenarioMaxInitial() below.
 */

const ALL_STANDARD_KEYS = ['ocs', 'gots', 'ivnBest', 'grs', 'rcs', 'raf', 'rds'];

/** Distinct per-standard previous-CB data — deliberately no two values alike. */
const PREVIOUS_CB = {
  ocs: { licence: 'OCS-2021-01001', certifier: 'Control Union', date: '2026-01-31' },
  gots: { licence: 'GOTS-2021-02002', certifier: 'Ecocert', date: '2026-02-28' },
  ivnBest: { licence: 'IVN-2021-03003', certifier: 'ETKO', date: '2026-03-31' },
  grs: { licence: 'GRS-2021-04004', certifier: 'Peterson Projects', date: '2026-04-30' },
  rcs: { licence: 'RCS-2021-05005', certifier: 'SGS', date: '2026-05-31' },
  raf: { licence: 'RAF-2021-06006', certifier: 'ICEA', date: '2026-06-30' },
  rds: { licence: 'RDS-2021-07007', certifier: 'NSF', date: '2026-07-31' },
};

function rdsSlaughterhouses() {
  return [1, 2, 3].map((n) => ({
    name: `${MARK} テスト屠畜場 ${n}`,
    address: `青森県三沢市屠畜${n}丁目${n}番地`,
    contact: `屠畜 担当${n}`,
    waterfowlSpecies: ['アヒル（北京種）', 'ガチョウ（トゥールーズ種）', 'アヒル（マガモ種）'][n - 1],
    annualSlaughterCount: String(100000 * n),
    activities: `屠殺、脱羽、選別（${n}系列）`,
    previouslyCertified: n === 2 ? 'no' : 'yes',
  }));
}

function rdsFarmGroups() {
  return [1, 2, 3].map((n) => ({
    groupName: `${MARK} テスト農場グループ ${n}`,
    contact: `グループ 担当${n}`,
    memberCount: String(10 * n),
    parentFarmCount: String(n),
    // NOTE: controls 272/281/290 are comboBoxes whose list items are YES/NO — a defect in
    // the master (docs/docx-generation-strategy.md §6). The species text is written verbatim.
    waterfowlSpecies: ['ガチョウ（ランド種）', 'アヒル（北京種）', 'ガチョウ（エムデン種）'][n - 1],
    annualRearedCount: String(50000 * n),
    annualSlaughterCount: String(25000 * n),
    activities: `飼育、給餌、集約（グループ${n}）`,
    previouslyCertified: n === 3 ? 'no' : 'yes',
  }));
}

function rdsIndividualFarms() {
  return [1, 2, 3].map((n) => ({
    name: `${MARK} テスト個別農場 ${n}`,
    address: `岩手県盛岡市農場${n}丁目${n}番地`,
    contact: `農場 担当${n}`,
    waterfowlSpecies: ['アヒル（北京種）', 'ガチョウ（トゥールーズ種）', 'アヒル（バリケン種）'][n - 1],
    annualRearedCount: String(30000 * n),
    activities: `飼育、給餌、記録管理（農場${n}）`,
    isParentFarm: n === 1 ? 'yes' : 'no',
    previouslyCertified: n === 1 ? 'no' : 'yes',
  }));
}

function rdsFarmAreas() {
  return [1, 2, 3].map((n) => ({
    areaName: `${MARK} テスト農場エリア ${n}`,
    contact: `エリア 担当${n}`,
    collectorCount: String(5 * n),
    regionName: ['東北地方', '北陸地方', '九州地方'][n - 1],
    waterfowlSpecies: ['アヒル（北京種）', 'ガチョウ（ランド種）', 'アヒル（マガモ種）'][n - 1],
    activities: `収集、集約、記録管理（エリア${n}）`,
    estimatedAnnualVolume: `${12 * n},000 kg`,
    previouslyCertified: n === 2 ? 'yes' : 'no',
  }));
}

export function scenarioMax() {
  const d = baseApplication('MAX');

  /* ---- §2 payment: OTHER currency, both rush services, DISTINCT payment company ---- */
  d.payment.currency = 'OTHER';
  d.payment.currencyOther = 'AUD (オーストラリアドル)';
  d.payment.taxId = 'T9999999999999';
  d.payment.rush = { siteVisit: true, certificationDecision: true };
  d.payment.sameAsApplicant = false;
  d.payment.company = {
    companyName: `${MARK} 支払代行株式会社`,
    companyNameEnglish: `${MARK} Payment Agent Co Ltd`,
    address: '東京都千代田区丸の内1丁目1番1号 支払ビル 8階',
    city: '東京都千代田区',
    country: '日本',
    contactName: '経理 花子',
    contactTitle: '経理部長',
    phone: '+81 3 1234 5678',
    email: 'payment-test-do-not-use@example.co.jp',
  };

  /* ---- §3 standards: all 7, all renewal, every prior box, distinct previous-CB data ---- */
  for (const key of ALL_STANDARD_KEYS) {
    const block = d.standards[key];
    block.selected = true;
    block.certificationStatus = 'renewal';
    for (const p of Object.keys(block.priorCertifications)) block.priorCertifications[p] = true;
    block.previousLicenceNo = PREVIOUS_CB[key].licence;
    block.previousCertifier = PREVIOUS_CB[key].certifier;
    block.certificationRenewalDate = PREVIOUS_CB[key].date;
  }
  d.standards.raf.subStandards = ['rws', 'rms', 'ras'];

  /* ---- §4 products: all 12 categories + all 8 その他 rows ---- */
  for (const k of Object.keys(d.products.categories)) {
    d.products.categories[k] = { selected: true, detail: `MAX 製品詳細 ${k}` };
  }
  d.products.others = Array.from({ length: 8 }, (_, i) => ({
    selected: true, name: `MAX その他カテゴリー ${i + 1}`, detail: `MAX その他詳細 ${i + 1}`,
  }));

  /* ---- §5 facilities: 6 rows = capacity, all four unit types, all 7 standards each ---- */
  const unitTypes = ['main', 'facility', 'associatedSubcontractor', 'certifiedSubcontractor', 'facility', 'facility'];
  d.facilitiesMeta.hasSubcontractors = 'yes';
  d.facilities = unitTypes.map((unitType, i) => ({
    name: `${MARK} MAX 施設 ${i + 1}`,
    address: `京都府京都市中京区MAX${i + 1}丁目`,
    employeeCount: String(15 * (i + 1)),
    standards: [...ALL_STANDARD_KEYS],
    activities: i % 2 ? ['紡績', '織布', '編み物'] : ['リサイクル材料', '染色', '仕上げ'],
    activitiesOther: i === 5 ? '検品・出荷' : '',
    unitType,
    previouslyCertified: i % 2 === 0 ? 'yes' : 'no',
  }));

  /* ---- §6 certification information: every other-certification = yes, both chemical = yes ---- */
  for (const k of Object.keys(d.otherCertifications)) d.otherCertifications[k] = 'yes';
  d.chemicalCompliance.usesChemicalsGots = 'yes';
  d.chemicalCompliance.chemicalCountGots = '48';
  d.chemicalCompliance.usesChemicalsGrs = 'yes';
  d.chemicalCompliance.chemicalCountGrs = '61';
  d.certifications.refusedBefore = 'yes';
  d.certifications.refusedDetail = 'MAX テストデータ：2020年に書類不備により一度差し戻しあり。';
  d.certifications.prohibitedDetail = 'MAX テストデータ：禁止された事実はありません。';

  /* ---- §8 recycling ---- */
  d.recycling = {
    materialType: 'both',
    vr2Sites: 'MAX-RM-01 / MAX-PR-02 / MAX-PR-03',
    inputWasteDescription: '使用済みPETボトル（使用済み材料）\n紡績工場端材（使用前材料）',
    collectorCount: '42',
    collectorLocations: '日本（東北・北陸・九州）、ベトナム、タイ',
    collectorActivities: '収集、開封、選別、フレーク化、集約',
  };

  /* ---- §§9-12 RDS: all four scopes, every table at its 3-row capacity ---- */
  d.rds = {
    scopes: ['slaughterhouse', 'farmGroup', 'individualFarm', 'farmArea'],
    slaughterhouses: rdsSlaughterhouses(),
    farmGroups: rdsFarmGroups(),
    individualFarms: rdsIndividualFarms(),
    farmAreas: rdsFarmAreas(),
  };

  /* ---- §7 declaration ---- */
  d.declaration.companyName = `${MARK} 株式会社テスト繊維（MAX）`;
  d.declaration.signatoryNameTitle = '山田 太郎 / 代表取締役';
  d.declaration.date = '2026-08-25';
  d.declaration.representative = {
    companyName: `${MARK} MAX コンサルティング株式会社`,
    contactName: '田中 次郎',
    email: 'max-rep-test-do-not-use@example.co.jp',
  };

  return d;
}

/* -------- MAXINIT — the initial-certification half of the ballot matrix --------
 *
 * Identical population to scenarioMax except: all 7 standards are INITIAL certification
 * with NO prior-CB data. Two things this proves that scenarioMax cannot:
 *   1. the 7 "Initial Certification" ballots, for all 7 standards
 *   2. selecting a standard does NOT tick its prior-CB boxes or fill its licence cells
 */
export function scenarioMaxInitial() {
  const d = scenarioMax();
  d.applicant.companyName = `${MARK} 株式会社テスト繊維（MAXINIT）`;
  d.applicant.companyNameEnglish = `${MARK} Test Textile Co Ltd MAXINIT`;
  for (const key of ALL_STANDARD_KEYS) {
    const block = d.standards[key];
    block.certificationStatus = 'initial';
    for (const p of Object.keys(block.priorCertifications)) block.priorCertifications[p] = false;
    block.previousLicenceNo = '';
    block.previousCertifier = '';
    block.certificationRenewalDate = '';
  }
  d.declaration.companyName = `${MARK} 株式会社テスト繊維（MAXINIT）`;
  return d;
}

/* -------- NODETAIL — categories only, no product detail anywhere -----------
 *
 * The online application collects product CATEGORIES only; detail is submitted
 * later via the separate Product List. This fixture is the shape the wizard now
 * actually produces: every category ticked, every detail string empty, and the
 * 「その他」 rows carrying a name but no detail.
 *
 * What it must prove:
 *   1. generation is NOT blocked by missing product detail
 *   2. the category checkboxes are still ticked in the official template
 *   3. the official detail cells are left as their untouched placeholder —
 *      nothing is invented to fill them
 */
export function scenarioNoProductDetail() {
  const d = baseApplication('NODETAIL');
  pickStandard(d, 'gots', 'initial');
  for (const k of Object.keys(d.products.categories)) {
    d.products.categories[k] = { selected: true, detail: '' };
  }
  d.products.others = [
    { selected: true, name: 'その他カテゴリー A', detail: '' },
    { selected: true, name: 'その他カテゴリー B', detail: '' },
  ];
  d.chemicalCompliance.usesChemicalsGots = 'no';
  return d;
}

export const SCENARIOS = {
  A: { label: 'GOTS Initial', build: scenarioA },
  B: { label: 'GOTS + OCS', build: scenarioB },
  C: { label: 'GRS with recycled information', build: scenarioC },
  D: { label: 'RCS Renewal with previous CB', build: scenarioD },
  E: { label: 'RDS', build: scenarioE },
  F: { label: 'Multiple facilities (6 = capacity)', build: scenarioF },
  FULL: { label: 'Maximum population', build: scenarioFull },
  MAX: { label: 'True maximum — 7 standards (renewal) + all 4 RDS sections at capacity', build: scenarioMax },
  MAXINIT: { label: 'True maximum — 7 standards (initial), no prior CB', build: scenarioMaxInitial },
  NODETAIL: { label: 'Product categories only — no product detail (Product List submitted separately)', build: scenarioNoProductDetail },
  OVERFLOW: { label: 'Overflow (7 facilities) — must be refused', build: scenarioOverflow },
};

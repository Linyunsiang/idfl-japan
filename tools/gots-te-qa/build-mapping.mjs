/**
 * Generate the document mapping for one IDFL template version.
 *
 * ApplicationData paths  →  Word w:id
 *
 * Inputs (never modified):
 *   application/gots-te/js/schema.js   (carries `controls:` references)
 *   docs/gots-te-application/_generated/control-inventory.json               (control index → w:id)
 *   docs/gots-te-application/_generated/template-identity.json               (sha256, control count)
 *
 * Output:
 *   application/gots-te/templates/<version>/mapping.json
 *
 * Re-run this after `tools/extract-controls.py` whenever IDFL ships a new template.
 * Business logic must never contain a w:id; it only ever names ApplicationData paths.
 *
 *   node tools/gots-te-qa/build-mapping.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const APP = resolve(ROOT, 'application/gots-te');

const schema = await import(`file://${resolve(APP, 'js/schema.js')}`);
const inventory = JSON.parse(readFileSync(resolve(ROOT, 'docs/gots-te-application/_generated/control-inventory.json'), 'utf8'));
const identity = JSON.parse(readFileSync(resolve(ROOT, 'docs/gots-te-application/_generated/template-identity.json'), 'utf8'));

/** control document-order index (1-based, as used throughout the docs) → w:id */
const idOf = new Map(inventory.map((c) => [c.n, String(c.id)]));
const kindOf = new Map(inventory.map((c) => [c.n, c.kind]));

const text = [];
const checkbox = [];
const combo = [];
const ballot = [];

function T(path, n) {
  expect(n, ['TEXT', 'COMBO']);
  text.push({ path, control: n, id: idOf.get(n) });
}
function C(path, n, opts = {}) {
  expect(n, ['CHK']);
  checkbox.push({ path, control: n, id: idOf.get(n), ...opts });
}
function CB(path, n) {
  expect(n, ['COMBO']);
  combo.push({ path, control: n, id: idOf.get(n) });
}
function expect(n, kinds) {
  const k = kindOf.get(n);
  if (!k) throw new Error(`control #${n} not present in the inventory`);
  if (!kinds.includes(k)) throw new Error(`control #${n} is ${k}, expected one of ${kinds}`);
}

/* ---- §1 applicant ---- */
for (const [key, n] of Object.entries(schema.APPLICANT_CONTROLS)) T(`applicant.${key}`, n);

/* ---- §2 payment ---- */
for (const c of schema.CURRENCIES) C('payment.currency', c.control, { whenEquals: c.value });
T('payment.currencyOther', 24);
T('payment.taxId', 25);
C('payment.rush.siteVisit', 26);
C('payment.rush.certificationDecision', 27);
C('payment.sameAsApplicant', 28);
for (const [key, n] of Object.entries(schema.PAYMENT_PARTY_CONTROLS)) T(`payment.company.${key}`, n);

/* ---- §3 standards ---- */
schema.STANDARDS.forEach((s, i) => {
  C(`standards.${s.key}.selected`, s.controls.selected);
  T(`standards.${s.key}.previousLicenceNo`, s.controls.licence);
  T(`standards.${s.key}.previousCertifier`, s.controls.certifier);
  T(`standards.${s.key}.certificationRenewalDate`, s.controls.renewalDate);
  for (const p of s.prior) C(`standards.${s.key}.priorCertifications.${p.key}`, p.control);
  for (const sub of s.subStandards || []) {
    C(`standards.${s.key}.subStandards`, sub.control, { whenIncludes: sub.key });
  }
  // Initial / Renewal are plain-text ballots, in standard order: 2 per standard
  ballot.push({ path: `standards.${s.key}.certificationStatus`, ordinal: i * 2 + 1, whenEquals: 'initial' });
  ballot.push({ path: `standards.${s.key}.certificationStatus`, ordinal: i * 2 + 2, whenEquals: 'renewal' });
});

/* ---- §4 products ---- */
for (const c of schema.PRODUCT_CATEGORIES) {
  C(`products.categories.${c.key}.selected`, c.controls.selected);
  T(`products.categories.${c.key}.detail`, c.controls.detail);
}
/* the 8 その他 rows: checkbox + name (cell 1) + detail (cell 2); the 3rd control of each
   row is a nested duplicate of the name and must NOT be written — see
   docs/ui-to-template-transformations.md §3 */
const OTHER_ROWS = [
  { selected: 105, name: 106, detail: 108 },
  { selected: 109, name: 110, detail: 112 },
  { selected: 113, name: 114, detail: 116 },
  { selected: 117, name: 118, detail: 120 },
  { selected: 121, name: 122, detail: 124 },
  { selected: 125, name: 126, detail: 128 },
  { selected: 129, name: 130, detail: 132 },
  { selected: 133, name: 134, detail: 136 },
];
const productOthers = OTHER_ROWS.map((r, i) => {
  expect(r.selected, ['CHK']); expect(r.name, ['TEXT']); expect(r.detail, ['TEXT']);
  return {
    row: i,
    selected: { control: r.selected, id: idOf.get(r.selected) },
    fields: [
      { key: 'name', control: r.name, id: idOf.get(r.name), kind: 'TEXT' },
      { key: 'detail', control: r.detail, id: idOf.get(r.detail), kind: 'TEXT' },
    ],
  };
});

/* ---- §5 facilities: 6 rows × 7 columns, first control #138 ---- */
const FACILITY_FIELDS = [
  { key: 'name', kind: 'TEXT' },
  { key: 'address', kind: 'TEXT' },
  { key: 'employeeCount', kind: 'TEXT' },
  { key: 'standards', kind: 'TEXT', join: true },
  { key: 'activities', kind: 'TEXT', join: true },
  { key: 'unitType', kind: 'TEXT' },
  { key: 'previouslyCertified', kind: 'COMBO' },
];
const facilities = [];
for (let r = 0; r < schema.FACILITY_MASTER_ROWS; r++) {
  const base = 138 + r * 7;
  facilities.push({
    row: r,
    fields: FACILITY_FIELDS.map((f, c) => {
      const n = base + c;
      expect(n, [f.kind]);
      return { ...f, control: n, id: idOf.get(n) };
    }),
  });
}
/* §5 下請け施設 はい/いいえ — plain ballots 15 / 16 */
ballot.push({ path: 'facilitiesMeta.hasSubcontractors', ordinal: 15, whenEquals: 'yes' });
ballot.push({ path: 'facilitiesMeta.hasSubcontractors', ordinal: 16, whenEquals: 'no' });

/* ---- §6 compliance ---- */
for (const c of schema.OTHER_CERTIFICATIONS) {
  C(`otherCertifications.${c.key}`, c.controls[0], { whenEquals: 'yes' });
  C(`otherCertifications.${c.key}`, c.controls[1], { whenEquals: 'no' });
}
C('chemicalCompliance.usesChemicalsGots', 200, { whenEquals: 'yes' });
C('chemicalCompliance.usesChemicalsGots', 201, { whenEquals: 'no' });
T('chemicalCompliance.chemicalCountGots', 202);
C('chemicalCompliance.usesChemicalsGrs', 203, { whenEquals: 'yes' });
C('chemicalCompliance.usesChemicalsGrs', 204, { whenEquals: 'no' });
T('chemicalCompliance.chemicalCountGrs', 205);
C('certifications.refusedBefore', 206, { whenEquals: 'yes' });
C('certifications.refusedBefore', 207, { whenEquals: 'no' });
T('certifications.refusedDetail', 208);
T('certifications.prohibitedDetail', 209);

/* ---- §7 declaration (signature + seal deliberately absent) ---- */
T('declaration.companyName', 210);
T('declaration.signatoryNameTitle', 212);
T('declaration.date', 213);
T('declaration.representative.companyName', 214);
T('declaration.representative.contactName', 215);
T('declaration.representative.email', 216);

/* ---- §8 recycling ---- */
ballot.push({ path: 'recycling.materialType', ordinal: 17, whenEquals: 'none' });
ballot.push({ path: 'recycling.materialType', ordinal: 18, whenEquals: 'postConsumer' });
ballot.push({ path: 'recycling.materialType', ordinal: 19, whenEquals: 'preConsumer' });
ballot.push({ path: 'recycling.materialType', ordinal: 20, whenEquals: 'both' });
T('recycling.vr2Sites', 217);
T('recycling.inputWasteDescription', 219);
T('recycling.collectorCount', 223);
T('recycling.collectorLocations', 226);
T('recycling.collectorActivities', 228);

/* ---- §§9–12 RDS ---- */
const rds = {};
for (const [tableKey, table] of Object.entries(schema.RDS_TABLES)) {
  rds[tableKey] = {
    section: table.section,
    itemLabel: table.itemLabel,
    rows: table.rowControls.map((row, r) => ({
      row: r,
      fields: table.fields.map((f, c) => {
        const n = row[c];
        const kind = kindOf.get(n);
        if (!kind) throw new Error(`${tableKey} row ${r} col ${c}: control #${n} missing`);
        return { key: f.key, control: n, id: idOf.get(n), kind };
      }),
    })),
  };
}

/* ---- assemble ---- */
const mapping = {
  templateVersion: schema.TEMPLATE_VERSION,
  documentNumber: 'IDFLAS-FF-GEN-4100-JP(JP)',
  reference: 'IDFL-FF-MS01 EN V7.0',
  dcn: '25-013',
  generatedBy: 'tools/gots-te-qa/build-mapping.mjs',
  master: {
    path: '/files/GOTS-TE-Application-Form-JP.docx',
    sha256: identity.sha256,
    part: 'word/document.xml',
    controlCount: identity.controlTotal,
    ballotCount: Object.values(identity.plainTextBallotBoxes).reduce((a, b) => a + b, 0),
  },
  capacity: {
    facilities: schema.FACILITY_MASTER_ROWS,
    productOthers: schema.PRODUCT_OTHER_MAX,
    rds: Object.fromEntries(Object.keys(schema.RDS_TABLES).map((k) => [k, schema.RDS_MASTER_ROWS])),
  },
  unitTypeLabels: Object.fromEntries(schema.UNIT_TYPES.map((u) => [u.value, u.label])),
  standardNames: Object.fromEntries(schema.STANDARDS.map((s) => [s.key, s.name])),
  text, checkbox, combo, ballot,
  repeat: { facilities, productOthers, rds },
};

/* sanity: no control written twice, and every referenced id exists */
const seen = new Map();
const claim = (n, where) => {
  if (!idOf.has(n)) throw new Error(`${where}: control #${n} does not exist`);
  if (seen.has(n)) throw new Error(`control #${n} claimed twice: ${seen.get(n)} and ${where}`);
  seen.set(n, where);
};
for (const t of text) claim(t.control, `text ${t.path}`);
for (const c of checkbox) claim(c.control, `checkbox ${c.path}${c.whenEquals ? '=' + c.whenEquals : ''}${c.whenIncludes ? '∋' + c.whenIncludes : ''}`);
for (const c of combo) claim(c.control, `combo ${c.path}`);
for (const r of productOthers) { claim(r.selected.control, `productOthers[${r.row}].selected`); for (const f of r.fields) claim(f.control, `productOthers[${r.row}].${f.key}`); }
for (const r of facilities) for (const f of r.fields) claim(f.control, `facilities[${r.row}].${f.key}`);
for (const [k, t] of Object.entries(rds)) for (const r of t.rows) for (const f of r.fields) claim(f.control, `rds.${k}[${r.row}].${f.key}`);

const ballotOrdinals = new Set();
for (const b of ballot) {
  if (b.ordinal < 1 || b.ordinal > mapping.master.ballotCount) throw new Error(`ballot ordinal ${b.ordinal} out of range`);
  if (ballotOrdinals.has(b.ordinal)) throw new Error(`ballot ordinal ${b.ordinal} claimed twice`);
  ballotOrdinals.add(b.ordinal);
}

const outDir = resolve(APP, 'templates', schema.TEMPLATE_VERSION.replace('/', '-'));
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'mapping.json'), JSON.stringify(mapping, null, 1), 'utf8');

const nested = [107,111,115,119,123,127,131,135,137,211,218,220,221,222,224,225,227,229,230,
                233,235,237,239,243,245,247,249,251,253,256,258,260,262,264,266];
const unmapped = [...idOf.keys()].filter((n) => !seen.has(n));
console.log(`mapped controls : ${seen.size} / ${idOf.size}`);
console.log(`ballots mapped  : ${ballotOrdinals.size} / ${mapping.master.ballotCount}`);
console.log(`unmapped        : ${unmapped.length}`);
const unexpected = unmapped.filter((n) => !nested.includes(n));
console.log(`  nested duplicates (correctly skipped): ${unmapped.filter((n) => nested.includes(n)).length}`);
console.log(`  other unmapped: ${unexpected.length ? unexpected.join(', ') : 'none'}`);
console.log(`-> ${resolve(outDir, 'mapping.json')}`);

/**
 * Emit one in-memory-generated DOCX per mutually-exclusive option variant.
 *
 *   node tests/gots-te/emit-variants.mjs <outDir>
 *
 * Some official questions are single-select: a currency, a recycled-material type, a yes/no
 * pair. One application can only ever tick one of them, so no single fixture — not even MAX —
 * can prove that every option in the group is wired to the right box. This emits one document
 * per option so tools/audit-variants.py can check each one positionally.
 *
 * Writes only into <outDir>. The master is read-only, as everywhere else.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const APP = resolve(ROOT, 'application/gots-te');
const MASTER = resolve(ROOT, 'files/GOTS-TE-Application-Form-JP.docx');

const outDir = process.argv[2];
if (!outDir) { console.error('usage: node tests/gots-te/emit-variants.mjs <outDir>'); process.exit(2); }
mkdirSync(outDir, { recursive: true });

const { generateDocx } = await import(`file://${resolve(APP, 'js/docgen/generate.js')}`);
const { scenarioMax } = await import(`file://${resolve(ROOT, 'tests/gots-te/fixtures.mjs')}`);

const mapping = JSON.parse(readFileSync(resolve(APP, 'templates/GOTS-TE-V7.0-DCN25-013/mapping.json'), 'utf8'));
const masterBytes = new Uint8Array(readFileSync(MASTER));

const CURRENCIES = ['USD', 'RMB', 'EURO', 'TWD', 'TRY', 'CHF', 'INR', 'BDT',
  'JPY', 'PKR', 'KRW', 'IDR', 'VND', 'OTHER'];
const MATERIAL_TYPES = ['none', 'postConsumer', 'preConsumer', 'both'];
const YESNO = ['yes', 'no'];

const variants = [];

for (const c of CURRENCIES) {
  variants.push({
    id: `currency-${c}`, group: 'payment.currency', option: c,
    mutate(d) {
      d.payment.currency = c;
      d.payment.currencyOther = c === 'OTHER' ? 'AUD (オーストラリアドル)' : '';
    },
  });
}

for (const t of MATERIAL_TYPES) {
  variants.push({
    id: `recycling-${t}`, group: 'recycling.materialType', option: t,
    mutate(d) {
      d.recycling.materialType = t;
      if (t === 'none') {
        // "no recycling" must not carry recycling detail — matches scenario D
        Object.assign(d.recycling, {
          vr2Sites: '', inputWasteDescription: '', collectorCount: '',
          collectorLocations: '', collectorActivities: '',
        });
      }
    },
  });
}

for (const v of YESNO) {
  variants.push({
    id: `chem-gots-${v}`, group: 'chemicalCompliance.usesChemicalsGots', option: v,
    mutate(d) {
      d.chemicalCompliance.usesChemicalsGots = v;
      d.chemicalCompliance.chemicalCountGots = v === 'yes' ? '48' : '';
    },
  });
  variants.push({
    id: `chem-grs-${v}`, group: 'chemicalCompliance.usesChemicalsGrs', option: v,
    mutate(d) {
      d.chemicalCompliance.usesChemicalsGrs = v;
      d.chemicalCompliance.chemicalCountGrs = v === 'yes' ? '61' : '';
    },
  });
  variants.push({
    id: `refused-${v}`, group: 'certifications.refusedBefore', option: v,
    mutate(d) {
      d.certifications.refusedBefore = v;
      if (v === 'no') d.certifications.refusedDetail = '';
    },
  });
  variants.push({
    id: `subcontractors-${v}`, group: 'facilitiesMeta.hasSubcontractors', option: v,
    mutate(d) { d.facilitiesMeta.hasSubcontractors = v; },
  });
  variants.push({
    id: `same-as-applicant-${v}`, group: 'payment.sameAsApplicant', option: v,
    mutate(d) { d.payment.sameAsApplicant = v === 'yes'; },
  });
}

// all ten §6 other-certifications flipped together — one doc for each side of the pair
for (const v of YESNO) {
  variants.push({
    id: `other-certs-all-${v}`, group: 'otherCertifications.*', option: v,
    mutate(d) { for (const k of Object.keys(d.otherCertifications)) d.otherCertifications[k] = v; },
  });
}

const manifest = [];
for (const variant of variants) {
  const data = scenarioMax();
  variant.mutate(data);
  const { bytes } = await generateDocx(masterBytes, mapping, data);
  const file = join(outDir, `${variant.id}.docx`);
  writeFileSync(file, bytes);
  manifest.push({ id: variant.id, group: variant.group, option: variant.option, file });
}

process.stdout.write(JSON.stringify(manifest));

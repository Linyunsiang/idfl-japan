/**
 * Generate the test DOCX set and verify each one against the master.
 *
 *   node tests/gots-te/generate-test-docs.mjs
 *
 * Reads the master read-only, writes only into ./generated/.
 * Prints a per-file report separating EXPECTED changes (mapped fields) from
 * UNEXPECTED ones (anything else in the package).
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const APP = resolve(ROOT, 'application/gots-te');
const MASTER = resolve(ROOT, 'files/GOTS-TE-Application-Form-JP.docx');
const OUT = resolve(ROOT, 'generated');

const { generateDocx, OverflowError, TemplateMismatchError } = await import(`file://${resolve(APP, 'js/docgen/generate.js')}`);
const { readZip, entryText } = await import(`file://${resolve(APP, 'js/ooxml/zip.js')}`);
const { indexDocument, sharedTextGroups } = await import(`file://${resolve(APP, 'js/ooxml/docxpatch.js')}`);
const { scan, descendants, textOf } = await import(`file://${resolve(APP, 'js/ooxml/xmlscan.js')}`);
const { SCENARIOS } = await import(`file://${resolve(ROOT, 'tests/gots-te/fixtures.mjs')}`);

const mapping = JSON.parse(readFileSync(resolve(APP, 'templates/GOTS-TE-V7.0-DCN25-013/mapping.json'), 'utf8'));

const sha = (b) => createHash('sha256').update(b).digest('hex');
const masterBytes = new Uint8Array(readFileSync(MASTER));
const masterSha = sha(masterBytes);

console.log('master sha256 :', masterSha);
console.log('expected      :', mapping.master.sha256);
console.log('match         :', masterSha === mapping.master.sha256 ? 'OK' : 'MISMATCH');
if (masterSha !== mapping.master.sha256) process.exit(1);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/* ---------- package-level comparison ---------- */
const masterZip = readZip(masterBytes);
const masterXml = await entryText(masterZip.entries.find((e) => e.name === mapping.master.part));
const masterDoc = indexDocument(masterXml);

function packageDiff(genZip) {
  const byName = new Map(masterZip.entries.map((e) => [e.name, e]));
  const out = { identical: [], changed: [], added: [], removed: [] };
  for (const e of genZip.entries) {
    const m = byName.get(e.name);
    if (!m) { out.added.push(e.name); continue; }
    const same = m.crc === e.crc && m.uncompressedSize === e.uncompressedSize;
    (same ? out.identical : out.changed).push(e.name);
    byName.delete(e.name);
  }
  out.removed = [...byName.keys()];
  return out;
}

/** Read back every mapped control's value from the generated XML. */
function readBack(xml) {
  const doc = indexDocument(xml);
  const values = new Map();
  for (const c of doc.controls) values.set(c.id, { kind: c.kind, text: textOf(xml, c.tNode) });
  const checked = doc.controls.filter((c) => c.kind === 'CHK' && textOf(xml, c.tNode) === '☒').length;
  const { root } = scan(xml);
  const ticked = descendants(root, 'w:t').filter((t) => {
    for (let n = t.parent; n; n = n.parent) if (n.name === 'w:sdt') return false;
    return textOf(xml, t) === '☒';
  }).length;
  return { doc, values, checkedControls: checked, tickedBallots: ticked };
}

let failures = 0;
const summary = [];

for (const [key, scenario] of Object.entries(SCENARIOS)) {
  const data = scenario.build();
  process.stdout.write(`\n=== Scenario ${key} — ${scenario.label} ===\n`);

  let result;
  try {
    result = await generateDocx(masterBytes, mapping, data);
  } catch (err) {
    if (err instanceof OverflowError) {
      const ok = key === 'OVERFLOW';
      console.log(`  ${ok ? 'PASS' : 'FAIL'} refused: ${err.message}`);
      for (const o of err.overflow) console.log(`    ${o.section}: ${o.supplied} supplied, capacity ${o.capacity}, overflow ${o.overflowCount}`);
      if (!ok) failures++;
      summary.push({ key, status: ok ? 'refused (expected)' : 'REFUSED UNEXPECTEDLY' });
      continue;
    }
    console.log(`  FAIL ${err.name}: ${err.message}`);
    failures++;
    summary.push({ key, status: 'ERROR' });
    continue;
  }

  if (key === 'OVERFLOW') {
    console.log('  FAIL: overflow scenario generated a document instead of being refused');
    failures++;
    summary.push({ key, status: 'SHOULD HAVE REFUSED' });
    continue;
  }

  const path = resolve(OUT, `${key}_${result.filename}`);
  writeFileSync(path, result.bytes);

  /* ---- package integrity ---- */
  const genZip = readZip(result.bytes);
  const diff = packageDiff(genZip);
  const genXml = await entryText(genZip.entries.find((e) => e.name === mapping.master.part));
  const back = readBack(genXml);

  const required = [
    '[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml',
    'word/settings.xml', 'word/header1.xml', 'word/footer1.xml', 'word/numbering.xml',
    'word/theme/theme1.xml', 'word/fontTable.xml', 'word/_rels/document.xml.rels',
    'word/media/image1.png', 'word/media/image2.png', 'docProps/core.xml', 'docProps/app.xml',
    'word/glossary/document.xml',
  ];
  const missing = required.filter((n) => !genZip.entries.some((e) => e.name === n));

  /* ---- expected vs unexpected values ---- */
  const expectedIds = new Set(result.report.applied.filter((a) => a.control).map((a) => String(
    (mapping.text.find((t) => t.control === a.control)
      || mapping.checkbox.find((t) => t.control === a.control)
      || mapping.combo.find((t) => t.control === a.control) || {}).id
    || masterDoc.controls[a.control - 1].id)));

  // A nested duplicate shares its w:t with the outer control, so writing the outer
  // legitimately changes the inner's reported text. Treat such a group as one unit.
  const shared = sharedTextGroups(masterDoc);
  const expectedWithShared = new Set(expectedIds);
  for (const id of expectedIds) for (const peer of shared.get(id) || []) expectedWithShared.add(peer);

  let valueChanges = 0;
  let nestedEcho = 0;
  const unexpectedValueChanges = [];
  for (const [id, v] of back.values) {
    const before = textOf(masterXml, masterDoc.byId.get(id).tNode);
    if (before === v.text) continue;
    valueChanges++;
    if (expectedIds.has(id)) continue;
    if (expectedWithShared.has(id)) { nestedEcho++; continue; }
    unexpectedValueChanges.push({ id, before, after: v.text });
  }

  const settingsSame = diff.identical.includes('word/settings.xml');
  const mediaSame = diff.identical.includes('word/media/image1.png') && diff.identical.includes('word/media/image2.png');

  console.log(`  file            : generated/${key}_${result.filename}  (${(result.bytes.length / 1024).toFixed(0)} KB)`);
  console.log(`  fields populated: ${result.report.fieldsPopulated}   edits: ${result.report.editsApplied}`);
  console.log(`  controls        : ${back.doc.controls.length} (master ${masterDoc.controls.length})`);
  console.log(`  checkboxes ☒    : ${back.checkedControls}   ballots ☒: ${back.tickedBallots}`);
  console.log(`  package         : ${diff.identical.length} identical, ${diff.changed.length} changed, ${diff.added.length} added, ${diff.removed.length} removed`);
  console.log(`  changed parts   : ${diff.changed.join(', ') || 'none'}`);
  console.log(`  settings.xml    : ${settingsSame ? 'byte-identical (protection preserved)' : 'CHANGED'}`);
  console.log(`  media           : ${mediaSame ? 'byte-identical' : 'CHANGED'}`);
  console.log(`  missing parts   : ${missing.length ? missing.join(', ') : 'none'}`);
  console.log(`  value changes   : ${valueChanges} total, ${nestedEcho} nested-duplicate echoes, ${unexpectedValueChanges.length} unexpected`);
  if (result.report.warnings.length) {
    for (const w of result.report.warnings) console.log(`  warning         : ${w}`);
  }

  const problems = [];
  if (diff.changed.length !== 1 || diff.changed[0] !== mapping.master.part) problems.push('unexpected parts changed');
  if (diff.added.length || diff.removed.length) problems.push('package entries added/removed');
  if (missing.length) problems.push('required parts missing');
  if (!settingsSame) problems.push('settings.xml changed (document protection at risk)');
  if (!mediaSame) problems.push('media changed');
  if (back.doc.controls.length !== masterDoc.controls.length) problems.push('control count changed');
  if (unexpectedValueChanges.length) {
    problems.push(`${unexpectedValueChanges.length} unexpected value changes`);
    for (const u of unexpectedValueChanges.slice(0, 5)) console.log(`    UNEXPECTED ${u.id}: ${JSON.stringify(u.before)} -> ${JSON.stringify(u.after)}`);
  }

  if (problems.length) { console.log(`  RESULT          : FAIL — ${problems.join('; ')}`); failures++; }
  else console.log('  RESULT          : PASS');

  summary.push({
    key, status: problems.length ? 'FAIL' : 'PASS',
    fields: result.report.fieldsPopulated,
    checked: back.checkedControls, ballots: back.tickedBallots,
    file: `generated/${key}_${result.filename}`,
  });
}

/* ---------- master must be untouched ---------- */
const afterSha = sha(new Uint8Array(readFileSync(MASTER)));
console.log('\n=== master integrity ===');
console.log('before:', masterSha);
console.log('after :', afterSha);
console.log('UNCHANGED:', afterSha === masterSha);
if (afterSha !== masterSha) failures++;

console.log('\n=== summary ===');
for (const s of summary) {
  console.log(`  ${s.key.padEnd(9)} ${String(s.status).padEnd(20)} ${s.fields != null ? `fields=${String(s.fields).padStart(3)} ☒=${String(s.checked).padStart(3)} ballots=${s.ballots}` : ''}`);
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);

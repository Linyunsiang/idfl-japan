/**
 * Population primitives for the IDFL master document.
 *
 * Every function returns *edits* (offset splices) rather than mutating anything, so the caller
 * can validate the whole edit set before a single byte changes. See
 * docs/docx-generation-strategy.md §4 for the rules these implement.
 */

import {
  scan, descendants, child, attrs, attrValueRange, textOf, escapeXml,
} from './xmlscan.js';

/** Glyphs declared by the master's own checkbox controls. */
export const CHECKED_GLYPH = '☒';   // ☒  w14:checkedState val=2612
export const UNCHECKED_GLYPH = '☐'; // ☐  w14:uncheckedState val=2610

function hasSdtAncestor(node) {
  for (let n = node.parent; n; n = n.parent) if (n.name === 'w:sdt') return true;
  return false;
}

function ancestor(node, name) {
  for (let n = node.parent; n; n = n.parent) if (n.name === name) return n;
  return null;
}

/**
 * Index every content control and plain-text ballot box in word/document.xml.
 *
 * @returns {{xml:string, byId:Map<string,object>, controls:object[], ballots:object[]}}
 */
export function indexDocument(xml) {
  const { root } = scan(xml);
  const sdts = descendants(root, 'w:sdt');

  const controls = [];
  const byId = new Map();

  sdts.forEach((sdt, i) => {
    const pr = child(sdt, 'w:sdtPr');
    const content = child(sdt, 'w:sdtContent');
    if (!pr || !content) throw new Error(`control #${i + 1}: missing sdtPr/sdtContent`);

    const idNode = child(pr, 'w:id');
    const id = idNode ? attrs(xml, idNode)['w:val'] : null;
    if (!id) throw new Error(`control #${i + 1}: missing w:id`);

    const checkbox = child(pr, 'w14:checkbox');
    const combo = child(pr, 'w:comboBox');
    const kind = checkbox ? 'CHK' : combo ? 'COMBO' : 'TEXT';

    const ts = descendants(content, 'w:t');
    if (ts.length === 0) {
      throw new Error(`control #${i + 1} (id ${id}): no w:t in sdtContent`);
    }
    // In the pristine master every control holds exactly one w:t (asserted separately by
    // assertPristineShape). After population a multi-line value legitimately becomes
    // <w:t/><w:br/><w:t/>, so indexing must tolerate more than one and use the first.
    const tNode = ts[0];
    const run = ancestor(tNode, 'w:r');

    const info = {
      index: i + 1, id, kind, sdt, sdtPr: pr, content, tNode, run,
      textNodeCount: ts.length,
      showingPlcHdr: child(pr, 'w:showingPlcHdr'),
      checkedNode: checkbox ? child(checkbox, 'w14:checked') : null,
      comboItems: combo
        ? descendants(combo, 'w:listItem').map((li) => {
            const a = attrs(xml, li);
            return { display: a['w:displayText'] ?? a['w:value'], value: a['w:value'] };
          })
        : null,
      placeholderText: textOf(xml, tNode),
    };
    controls.push(info);
    if (byId.has(id)) throw new Error(`duplicate control id ${id}`);
    byId.set(id, info);
  });

  // Plain-text ballot boxes: an isolated w:t holding only ☐, outside any content control.
  const ballots = descendants(root, 'w:t')
    .filter((t) => !hasSdtAncestor(t) && textOf(xml, t) === UNCHECKED_GLYPH)
    .map((t, i) => ({ ordinal: i + 1, tNode: t, run: ancestor(t, 'w:r') }));

  return { xml, byId, controls, ballots };
}

/**
 * Assert the shape this generator was written against. Run on the MASTER only:
 * every control must hold exactly one w:t. A future template that violates this
 * needs the population rules revisited, not a silent best effort.
 */
export function assertPristineShape(doc) {
  const bad = doc.controls.filter((c) => c.textNodeCount !== 1);
  if (bad.length) {
    throw new Error(
      `master shape unexpected: ${bad.length} control(s) do not hold exactly one w:t ` +
      `(first: #${bad[0].index} id ${bad[0].id}, ${bad[0].textNodeCount} nodes)`
    );
  }
}

/**
 * Controls that share a w:t — i.e. a nested duplicate and its outer control.
 * Writing the outer necessarily changes the inner's text too; verification must
 * treat them as one unit rather than reporting a phantom unexpected change.
 * @returns {Map<string, string[]>} control id -> all ids sharing its w:t
 */
export function sharedTextGroups(doc) {
  const byOffset = new Map();
  for (const c of doc.controls) {
    const k = c.tNode.start;
    if (!byOffset.has(k)) byOffset.set(k, []);
    byOffset.get(k).push(c.id);
  }
  const out = new Map();
  for (const ids of byOffset.values()) for (const id of ids) out.set(id, ids);
  return out;
}

/* ------------------------------------------------------------------ *
 * Edit builders
 * ------------------------------------------------------------------ */

/** Remove `<w:rStyle w:val="PlaceholderText"/>` from the run holding the value. */
function dropPlaceholderStyle(xml, info, edits) {
  if (!info.run) return;
  const rPr = child(info.run, 'w:rPr');
  if (!rPr) return;
  const rStyle = child(rPr, 'w:rStyle');
  if (!rStyle) return;
  if (attrs(xml, rStyle)['w:val'] !== 'PlaceholderText') return;
  edits.push({ start: rStyle.start, end: rStyle.end, text: '', why: 'drop PlaceholderText rStyle' });
}

/**
 * Remove `<w:showingPlcHdr/>` so Word stops treating the content as a placeholder.
 *
 * Must also clear it on any control NESTED inside this one: 35 controls in the master are
 * nested duplicates wrapping the very same run, and a leftover flag on the inner control
 * makes Word treat the populated text as placeholder content again.
 */
function dropShowingPlaceholder(info, edits) {
  const flags = [];
  if (info.showingPlcHdr) flags.push(info.showingPlcHdr);
  for (const inner of descendants(info.content, 'w:sdt')) {
    const innerPr = child(inner, 'w:sdtPr');
    const flag = innerPr && child(innerPr, 'w:showingPlcHdr');
    if (flag) flags.push(flag);
  }
  for (const f of flags) {
    edits.push({ start: f.start, end: f.end, text: '', why: 'drop showingPlcHdr' });
  }
}

/** Replace the single `w:t`, rendering newlines as `<w:br/>` inside the same run. */
function replaceText(info, value, edits, why) {
  const lines = String(value).split(/\r\n|\r|\n/);
  const markup = lines
    .map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`)
    .join('<w:br/>');
  edits.push({ start: info.tNode.start, end: info.tNode.end, text: markup, why });
}

/**
 * Populate a text or comboBox control.
 * Empty/blank values produce NO edits — the control keeps its original placeholder state.
 */
export function editText(doc, id, value) {
  const info = doc.byId.get(String(id));
  if (!info) throw new Error(`unknown control id ${id}`);
  if (info.kind === 'CHK') throw new Error(`control ${id} is a checkbox, not text`);
  if (value == null || String(value).trim() === '') return [];

  const edits = [];
  dropShowingPlaceholder(info, edits);
  dropPlaceholderStyle(doc.xml, info, edits);
  replaceText(info, value, edits, `text control ${id}`);
  return edits;
}

/**
 * Blank a text control on purpose.
 *
 * Different from `editText(doc, id, '')`, which is a no-op and leaves the control showing
 * its placeholder ("Click here to enter text."). This clears the placeholder flag and the
 * placeholder run style and writes an EMPTY string, so the cell renders blank in Word.
 *
 * Used only where a deliberately empty answer is meaningful — see the product-detail rule
 * in docgen/resolve.js. Nothing is invented and no "N/A" is written.
 */
export function clearText(doc, id) {
  const info = doc.byId.get(String(id));
  if (!info) throw new Error(`unknown control id ${id}`);
  if (info.kind === 'CHK') throw new Error(`control ${id} is a checkbox, not text`);

  const edits = [];
  dropShowingPlaceholder(info, edits);
  dropPlaceholderStyle(doc.xml, info, edits);
  edits.push({
    start: info.tNode.start, end: info.tNode.end,
    text: '<w:t xml:space="preserve"></w:t>', why: `blank text control ${id}`,
  });
  return edits;
}

/**
 * Populate a comboBox control, validating the value against the control's own list.
 * The master contains two different Yes/No spellings, so the value must match this control.
 */
export function editCombo(doc, id, value, { strict = true } = {}) {
  const info = doc.byId.get(String(id));
  if (!info) throw new Error(`unknown control id ${id}`);
  if (info.kind !== 'COMBO') throw new Error(`control ${id} is not a comboBox`);
  if (value == null || String(value).trim() === '') return [];

  if (strict) {
    const allowed = info.comboItems.map((it) => it.display);
    if (!allowed.includes(String(value))) {
      throw new Error(`control ${id}: "${value}" is not one of [${allowed.join(', ')}]`);
    }
  }
  const edits = [];
  dropShowingPlaceholder(info, edits);
  dropPlaceholderStyle(doc.xml, info, edits);
  replaceText(info, value, edits, `combo control ${id}`);
  return edits;
}

/**
 * Set a checkbox control. Requires TWO coordinated edits — the logical state and the glyph.
 * `false` produces no edits: the master's default is already unchecked.
 */
export function editCheckbox(doc, id, checked) {
  const info = doc.byId.get(String(id));
  if (!info) throw new Error(`unknown control id ${id}`);
  if (info.kind !== 'CHK') throw new Error(`control ${id} is not a checkbox`);
  if (!checked) return [];
  if (!info.checkedNode) throw new Error(`control ${id}: missing w14:checked`);

  const range = attrValueRange(doc.xml, info.checkedNode, 'w14:val');
  if (!range) throw new Error(`control ${id}: w14:checked has no w14:val`);

  return [
    { start: range.start, end: range.end, text: '1', why: `checkbox ${id} state` },
    {
      start: info.tNode.start, end: info.tNode.end,
      text: `<w:t>${CHECKED_GLYPH}</w:t>`, why: `checkbox ${id} glyph`,
    },
  ];
}

/**
 * Tick one of the 20 plain-text ballot boxes (1-based document order).
 * These are not content controls — see docs/docx-generation-strategy.md §1.6.
 */
export function editBallot(doc, ordinal, checked) {
  const b = doc.ballots[ordinal - 1];
  if (!b) throw new Error(`ballot ordinal ${ordinal} out of range (have ${doc.ballots.length})`);
  if (!checked) return [];
  return [{
    start: b.tNode.start, end: b.tNode.end,
    text: `<w:t>${CHECKED_GLYPH}</w:t>`, why: `ballot ${ordinal}`,
  }];
}

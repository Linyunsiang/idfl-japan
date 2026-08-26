/**
 * ApplicationData  →  concrete Word edits.
 *
 * This is the only place that reads the mapping. It contains no Word control ids of its own
 * and no UI concerns; it turns business values into (control id, value) pairs plus an
 * overflow report.
 */

import { getPath } from '../engine.js';
import { editText, editCombo, editCheckbox, editBallot, clearText } from '../ooxml/docxpatch.js';

/** §4 fixed-category detail paths, e.g. products.categories.fabric.detail */
const PRODUCT_CATEGORY_DETAIL = /^products\.categories\.([A-Za-z0-9_]+)\.detail$/;

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

/** Effective payment company — mirrored from the applicant when "same as applicant" is on. */
function paymentCompanyValue(data, key) {
  return data.payment?.sameAsApplicant ? data.applicant?.[key] : data.payment?.company?.[key];
}

/** Pick the combo display value matching a yes/no answer, respecting this control's own list. */
function comboYesNo(info, value) {
  if (value !== 'yes' && value !== 'no') return null;
  const want = value === 'yes' ? 'yes' : 'no';
  const hit = (info.comboItems || []).find((it) => String(it.display).toLowerCase() === want);
  return hit ? hit.display : null;
}

/**
 * @returns {{edits: object[], applied: object[], overflow: object[], warnings: string[]}}
 */
export function resolveEdits(doc, mapping, data) {
  const edits = [];
  const applied = [];
  const overflow = [];
  const warnings = [];

  const push = (list, note) => {
    if (list.length) { edits.push(...list); applied.push(note); }
  };

  /* ---------- plain text / combo controls ---------- */
  for (const entry of mapping.text) {
    let value;
    if (entry.path.startsWith('payment.company.')) {
      value = paymentCompanyValue(data, entry.path.slice('payment.company.'.length));
    } else {
      value = getPath(data, entry.path);
    }

    // §4 product detail: the online form collects categories only — detail is supplied
    // later via the separate Product List. When a category IS selected but carries no
    // detail, the official cell must render BLANK rather than keep its "Click here to
    // enter text." placeholder. Drafts that do carry detail still write it normally.
    // Scoped deliberately to product detail; every other blank field is left untouched.
    const catDetail = PRODUCT_CATEGORY_DETAIL.exec(entry.path);
    if (catDetail && blank(value)) {
      if (data.products?.categories?.[catDetail[1]]?.selected) {
        push(clearText(doc, entry.id),
          { path: entry.path, control: entry.control, kind: 'TEXT', value: '', blanked: true });
      }
      continue;
    }

    if (blank(value)) continue;
    const info = doc.byId.get(entry.id);
    if (!info) throw new Error(`mapping references missing control ${entry.id} (${entry.path})`);
    const list = info.kind === 'COMBO'
      ? editCombo(doc, entry.id, value, { strict: false })
      : editText(doc, entry.id, value);
    push(list, { path: entry.path, control: entry.control, kind: info.kind, value: String(value) });
  }

  /* ---------- standalone combos (none at present, kept for future versions) ---------- */
  for (const entry of mapping.combo) {
    const value = getPath(data, entry.path);
    if (blank(value)) continue;
    const info = doc.byId.get(entry.id);
    const mapped = comboYesNo(info, value) ?? value;
    push(editCombo(doc, entry.id, mapped, { strict: false }),
      { path: entry.path, control: entry.control, kind: 'COMBO', value: String(mapped) });
  }

  /* ---------- checkboxes ---------- */
  for (const entry of mapping.checkbox) {
    const value = getPath(data, entry.path);
    let on;
    if (entry.whenEquals !== undefined) on = value === entry.whenEquals;
    else if (entry.whenIncludes !== undefined) on = Array.isArray(value) && value.includes(entry.whenIncludes);
    else on = value === true;
    if (!on) continue;
    push(editCheckbox(doc, entry.id, true),
      { path: entry.path, control: entry.control, kind: 'CHK', value: entry.whenEquals ?? entry.whenIncludes ?? true });
  }

  /* ---------- plain-text ballot boxes ---------- */
  for (const entry of mapping.ballot) {
    const value = getPath(data, entry.path);
    if (value !== entry.whenEquals) continue;
    push(editBallot(doc, entry.ordinal, true),
      { path: entry.path, ballot: entry.ordinal, kind: 'BALLOT', value: entry.whenEquals });
  }

  /* ---------- §4 その他 products ---------- */
  const chosenOthers = (data.products?.others || []).filter((o) => o.selected);
  if (chosenOthers.length > mapping.capacity.productOthers) {
    overflow.push({
      section: '§4 その他の製品', capacity: mapping.capacity.productOthers,
      supplied: chosenOthers.length, overflowCount: chosenOthers.length - mapping.capacity.productOthers,
    });
  }
  chosenOthers.slice(0, mapping.capacity.productOthers).forEach((item, i) => {
    const row = mapping.repeat.productOthers[i];
    push(editCheckbox(doc, row.selected.id, true),
      { path: `products.others[${i}].selected`, control: row.selected.control, kind: 'CHK', value: true });
    for (const f of row.fields) {
      const v = item[f.key];
      if (blank(v)) {
        // same product-detail rule as the fixed categories above
        if (f.key === 'detail') {
          push(clearText(doc, f.id),
            { path: `products.others[${i}].detail`, control: f.control, kind: 'TEXT', value: '', blanked: true });
        }
        continue;
      }
      push(editText(doc, f.id, v),
        { path: `products.others[${i}].${f.key}`, control: f.control, kind: 'TEXT', value: String(v) });
    }
  });

  /* ---------- §5 facilities ---------- */
  const facilities = data.facilities || [];
  if (facilities.length > mapping.capacity.facilities) {
    overflow.push({
      section: '§5 施設と工程', capacity: mapping.capacity.facilities,
      supplied: facilities.length, overflowCount: facilities.length - mapping.capacity.facilities,
    });
  }
  facilities.slice(0, mapping.capacity.facilities).forEach((fac, i) => {
    const row = mapping.repeat.facilities[i];
    for (const f of row.fields) {
      let value;
      switch (f.key) {
        case 'standards':
          value = (fac.standards || []).map((k) => mapping.standardNames[k] || k).join('、');
          break;
        case 'activities': {
          const acts = [...(fac.activities || [])];
          if (!blank(fac.activitiesOther)) acts.push(fac.activitiesOther);
          value = acts.join('、');
          break;
        }
        case 'unitType':
          value = mapping.unitTypeLabels[fac.unitType] || '';
          break;
        default:
          value = fac[f.key];
      }
      if (blank(value)) continue;

      if (f.kind === 'COMBO') {
        const info = doc.byId.get(f.id);
        const mapped = comboYesNo(info, value) ?? value;
        push(editCombo(doc, f.id, mapped, { strict: false }),
          { path: `facilities[${i}].${f.key}`, control: f.control, kind: 'COMBO', value: String(mapped) });
      } else {
        push(editText(doc, f.id, value),
          { path: `facilities[${i}].${f.key}`, control: f.control, kind: 'TEXT', value: String(value) });
      }
    }
  });

  /* ---------- §§9–12 RDS ---------- */
  for (const [tableKey, table] of Object.entries(mapping.repeat.rds)) {
    const items = data.rds?.[tableKey] || [];
    const cap = mapping.capacity.rds[tableKey];
    if (items.length > cap) {
      overflow.push({
        section: `§${table.section} ${table.itemLabel}`, capacity: cap,
        supplied: items.length, overflowCount: items.length - cap,
      });
    }
    items.slice(0, cap).forEach((item, i) => {
      const row = table.rows[i];
      for (const f of row.fields) {
        const value = item[f.key];
        if (blank(value)) continue;
        if (f.kind === 'COMBO') {
          const info = doc.byId.get(f.id);
          const mapped = comboYesNo(info, value) ?? value;
          if (comboYesNo(info, value) === null && (value === 'yes' || value === 'no')) {
            warnings.push(`rds.${tableKey}[${i}].${f.key}: control ${f.control} has no Yes/No item; wrote "${mapped}" verbatim`);
          }
          push(editCombo(doc, f.id, mapped, { strict: false }),
            { path: `rds.${tableKey}[${i}].${f.key}`, control: f.control, kind: 'COMBO', value: String(mapped) });
        } else {
          push(editText(doc, f.id, value),
            { path: `rds.${tableKey}[${i}].${f.key}`, control: f.control, kind: 'TEXT', value: String(value) });
        }
      }
    });
  }

  return { edits, applied, overflow, warnings };
}

/**
 * Browser glue for DOCX generation.
 *
 * Loads the mapping and the official master over HTTP (read-only), verifies the template
 * identity once, and hands the caller a ready/blocked verdict plus a download action.
 *
 * Nothing is uploaded: the master is fetched, populated in the page, and saved locally.
 * The application data never leaves the machine.
 */

import { generateDocx, verifyTemplate, OverflowError, TemplateMismatchError } from './generate.js';
import { validate } from '../engine.js';

const MAPPING_URL = new URL('../../templates/GOTS-TE-V7.0-DCN25-013/mapping.json', import.meta.url);

let loading = null;
let cache = null;

/** Fetch + verify the template once. Repeated calls share one in-flight promise. */
export function loadTemplate() {
  if (cache) return Promise.resolve(cache);
  if (loading) return loading;

  loading = (async () => {
    const mappingRes = await fetch(MAPPING_URL);
    if (!mappingRes.ok) throw new Error(`マッピングを読み込めません (${mappingRes.status})`);
    const mapping = await mappingRes.json();

    // master path is site-root absolute in the mapping; encode the spaces/parentheses
    const masterUrl = new URL(encodeURI(mapping.master.path), location.origin);
    const masterRes = await fetch(masterUrl);
    if (!masterRes.ok) throw new Error(`公式様式を読み込めません (${masterRes.status})`);
    const masterBytes = new Uint8Array(await masterRes.arrayBuffer());

    await verifyTemplate(masterBytes, mapping);   // throws TemplateMismatchError
    cache = { mapping, masterBytes };
    return cache;
  })();

  loading.catch(() => { loading = null; });   // allow a retry after a transient failure
  return loading;
}

/**
 * Everything that must hold before the download button may be enabled.
 * @returns {Promise<{ready:boolean, reasons:string[], overflow:object[]}>}
 */
export async function checkReadiness(data) {
  const reasons = [];
  let overflow = [];

  const v = validate(data);
  if (v.errors.length) reasons.push(`未入力の必須項目が ${v.errors.length} 件あります`);

  let loaded = null;
  try {
    loaded = await loadTemplate();
  } catch (err) {
    reasons.push(err instanceof TemplateMismatchError
      ? '公式様式が想定と一致しません。フィールド対応表の見直しが必要です。'
      : `公式様式を確認できません：${err.message}`);
    return { ready: false, reasons, overflow };
  }

  // dry-run the resolver purely to detect overflow, without producing a file
  try {
    await generateDocx(loaded.masterBytes, loaded.mapping, data);
  } catch (err) {
    if (err instanceof OverflowError) {
      overflow = err.overflow;
      for (const o of err.overflow) {
        reasons.push(`${o.section}：${o.supplied} 件（公式様式の上限 ${o.capacity} 件）— ${o.overflowCount} 件が超過`);
      }
    } else if (err instanceof TemplateMismatchError) {
      reasons.push('公式様式が想定と一致しません。フィールド対応表の見直しが必要です。');
    } else {
      reasons.push(`書類生成の事前確認に失敗しました：${err.message}`);
    }
  }

  return { ready: reasons.length === 0, reasons, overflow };
}

/** Generate and save. Returns the generation report. */
export async function downloadDocx(data) {
  const { mapping, masterBytes } = await loadTemplate();
  const { bytes, filename, report } = await generateDocx(masterBytes, mapping, data);

  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  return report;
}

export { OverflowError, TemplateMismatchError };

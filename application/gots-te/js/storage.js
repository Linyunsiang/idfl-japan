/**
 * Draft storage — deliberately isolated behind one small interface.
 *
 * Phase 2 uses browser localStorage only: no database, no accounts, no server.
 * The application data therefore never leaves the user's machine, which is the
 * strongest privacy property of this design (see plan §9).
 *
 * To move to server-side storage later, replace `LocalDraftStore` with another
 * object exposing the same four methods. Nothing else in the app touches storage.
 */

const KEY = 'idfl.application.gots-te.draft.v1';
const EXPIRY_DAYS = 30;

export const LocalDraftStore = {
  /** @returns {{data:object, savedAt:string}|null} */
  load() {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      return null;           // private mode / storage blocked
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.savedAt) {
        const age = (Date.now() - new Date(parsed.savedAt).getTime()) / 86400000;
        if (age > EXPIRY_DAYS) {
          this.clear();
          return null;
        }
      }
      return parsed;
    } catch {
      return null;           // corrupt draft — better to start clean than to crash
    }
  },

  /** @returns {{ok:boolean, savedAt?:string, error?:string}} */
  save(data) {
    const savedAt = new Date().toISOString();
    try {
      localStorage.setItem(KEY, JSON.stringify({ savedAt, data }));
      return { ok: true, savedAt };
    } catch (e) {
      return { ok: false, error: e && e.name === 'QuotaExceededError' ? 'quota' : 'unavailable' };
    }
  },

  clear() {
    try { localStorage.removeItem(KEY); } catch { /* nothing to do */ }
  },

  available() {
    try {
      const probe = '__idfl_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  },
};

/** Portable backup: download the draft as a .json file. */
export function exportDraftFile(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `IDFL-application-draft-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Restore from a .json produced by exportDraftFile. */
export function importDraftFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ファイルを読み込めませんでした'));
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch {
        reject(new Error('下書きファイルの形式が正しくありません'));
      }
    };
    reader.readAsText(file);
  });
}

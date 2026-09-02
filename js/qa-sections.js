/* ============================================================
   Q&A のセクション定義（管理画面と公開ページの共通ソース）

   このファイルが唯一の定義元です。セクションを追加・変更する場合は
   ここだけを編集してください。/admin の選択肢も /qa.html の表示も
   自動的に追従します。

   key   … データに保存される内部値。変更しないでください（既存データが
           参照しています）。新規追加は自由です。
   label … 画面に表示される日本語名
   short … 絞り込みプルダウンなど、短く表示したい場所で使う名称

   公開ページでは「該当する質問が1件もないセクションは表示しない」ため、
   使う予定のセクションを先に足しておいても表示は乱れません。
   ============================================================ */
(function (root) {
  var SECTIONS = [
    { key: 'audit',             label: '監査・認証編',        short: '監査・認証' },
    { key: 'standards',         label: '規格編',              short: '規格' },
    { key: 'tc',                label: 'TC（取引証明書）編',  short: 'TC' },
    { key: 'scope-certificate', label: 'スコープ証明書編',    short: 'スコープ証明書' },
    { key: 'chemical',          label: 'ケミカル編',          short: 'ケミカル' },
    { key: 'factory',           label: '工場・施設編',        short: '工場・施設' },
    { key: 'fees',              label: '費用編',              short: '費用' },
    { key: 'seminar',           label: 'セミナー編',          short: 'セミナー' },
    { key: 'logo',              label: 'LOGO編',              short: 'LOGO' },
    { key: 'other',             label: 'その他編',            short: 'その他' }
  ];

  /* 未知のキーが来ても表示を壊さないための保険。過去データや手作業で
     入った値がそのまま画面に出るより、「その他」に寄せたほうが安全です。 */
  var FALLBACK = 'other';

  function all() { return SECTIONS.slice(); }
  function keys() { return SECTIONS.map(function (s) { return s.key; }); }
  function has(key) { return keys().indexOf(String(key)) >= 0; }
  function get(key) {
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].key === key) return SECTIONS[i];
    return null;
  }
  /** 表示用の日本語名。未知の値はそのまま返さず「その他編」に寄せる。 */
  function label(key) { var s = get(key); return s ? s.label : (get(FALLBACK) || {}).label || 'その他編'; }
  function short(key) { var s = get(key); return s ? s.short : (get(FALLBACK) || {}).short || 'その他'; }
  /** 保存前の正規化。空白除去・小文字化し、未知なら FALLBACK を返す。 */
  function normalize(key) {
    var k = String(key == null ? '' : key).trim().toLowerCase();
    return has(k) ? k : FALLBACK;
  }

  root.QA_SECTION_DEFS = {
    all: all, keys: keys, has: has, get: get,
    label: label, short: short, normalize: normalize,
    FALLBACK: FALLBACK
  };
})(window);

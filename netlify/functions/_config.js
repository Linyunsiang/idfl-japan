// ============================================================
// IDFL admin - 単一の設定ソース（アップロード許可形式・サイズ上限）
// 変更はこのファイルだけで行ってください。
// フロント(admin.html)はサーバの /file-manager?action=config から
// この値を取得するため、二重管理は不要です。
// ============================================================

// 実ファイルの最大サイズ（バイト）。
// Netlify 同期関数のリクエスト上限が約6MB(base64膨張後)のため、実ファイルは約4MBが安全上限。
const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB

// 拡張子 -> {mime, magic(先頭バイトの16進シグネチャ候補)}
// magic は「実体（中身）検証」に使用。ブラウザ由来のファイル名だけに依存しない。
const TYPES = {
  pdf:  { mime:'application/pdf', magic:['25504446'] },                                   // %PDF
  doc:  { mime:'application/msword', magic:['d0cf11e0a1b11ae1'] },                        // OLE2
  docx: { mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic:['504b0304','504b0506','504b0708'] }, // PK(zip)
  xls:  { mime:'application/vnd.ms-excel', magic:['d0cf11e0a1b11ae1'] },                  // OLE2
  xlsx: { mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic:['504b0304','504b0506','504b0708'] },
  ppt:  { mime:'application/vnd.ms-powerpoint', magic:['d0cf11e0a1b11ae1'] },             // OLE2
  pptx: { mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic:['504b0304','504b0506','504b0708'] },
  zip:  { mime:'application/zip', magic:['504b0304','504b0506','504b0708'] },
  jpg:  { mime:'image/jpeg', magic:['ffd8ff'] },
  jpeg: { mime:'image/jpeg', magic:['ffd8ff'] },
  png:  { mime:'image/png', magic:['89504e47'] },
};

const ALLOWED_EXT = Object.keys(TYPES);

// 実行形式・スクリプト等は明示的に拒否（許可リスト外なので自動的に不可だが、念のため明記）
const BLOCKED_EXT = ['html','htm','js','mjs','php','phtml','exe','bat','cmd','sh','com','msi','dll','svg'];

module.exports = { MAX_FILE_BYTES, TYPES, ALLOWED_EXT, BLOCKED_EXT };

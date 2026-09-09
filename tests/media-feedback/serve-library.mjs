// Stand the customer pages up over real HTTP with one record of every media
// type, so the browser pass can exercise the whole library rather than the two
// types the unit fixtures happen to need.
//
//   node tests/media-feedback/serve-library.mjs [port] [path-to-unpacked-deck]
import fs from 'node:fs';
import path from 'node:path';
import { setEnv, createServer, invoke, resetStores, ROOT } from './harness.mjs';
import { seedAll } from './seed.mjs';

const ENV = setEnv();
const PORT = Number(process.argv[2] || 8890);
const PKG = process.argv[3] || process.env.IDFL_TEST_PKG;

const SAME = { host: 'localhost:' + PORT, origin: 'http://localhost:' + PORT };
function cookieOf(res){ return String((res.headers && res.headers['Set-Cookie']) || '').split(';')[0]; }

resetStores();

const staffRes = await invoke('auth-login', {
  httpMethod: 'POST',
  headers: Object.assign({ 'x-nf-client-connection-ip': '127.0.0.1' }, SAME),
  body: JSON.stringify({ role: 'staff', password: ENV.STAFF_ACCESS_PASSWORD }),
});
const as = Object.assign({ cookie: cookieOf(staffRes) }, SAME);

if (PKG && fs.existsSync(PKG)) {
  await seedAll(PKG);
} else {
  console.log('(no deck supplied - seeding without the HTML presentation)');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary'), Buffer.alloc(2048, 0x20)]);
  await invoke('protected-upload', {
    httpMethod: 'POST', headers: as,
    body: JSON.stringify({
      filename: 'gots-scope4-checklist.pdf', contentBase64: pdf.toString('base64'), role: 'customer',
      title: 'GOTS スコープ4 準備チェックリスト',
      description: '申請前にご確認いただきたい項目の一覧です。', group: 'IDFL Guide',
    }),
  });
  await invoke('protected-addlink', {
    httpMethod: 'POST', headers: as,
    body: JSON.stringify({
      url: 'https://global-standard.org/', title: 'GOTS 公式サイト',
      description: '規格本文および最新の改訂情報（外部サイト）。', role: 'customer', group: 'IDFL Guide',
    }),
  });
}

// ---- the types the unit fixtures do not cover ----------------------------
const png = fs.readFileSync(path.join(ROOT, 'IDFL-Logo.png'));
await invoke('protected-upload', {
  httpMethod: 'POST', headers: as,
  body: JSON.stringify({
    filename: 'idfl-mark.png', contentBase64: png.toString('base64'), role: 'customer',
    title: 'IDFL 認証マーク 使用ガイド（図版）',
    description: '認証マークの余白・最小サイズ・配色の基準を示した図版です。印刷物にご利用の際はこの比率を保ってください。',
    group: 'ブランド運用',
  }),
});

const xlsx = fs.readFileSync(path.join(ROOT, 'sample.xlsx'));
await invoke('protected-upload', {
  httpMethod: 'POST', headers: as,
  body: JSON.stringify({
    filename: 'tc-application-template.xlsx', contentBase64: xlsx.toString('base64'), role: 'customer',
    title: 'TC申請 入力テンプレート（Excel）',
    description: '取引ごとの原料・数量・出荷先をまとめてご提出いただくための様式です。',
    group: 'IDFL Guide',
  }),
});

await invoke('protected-upload', {
  httpMethod: 'POST', headers: as,
  body: JSON.stringify({
    filename: 'staff-only-notes.pdf',
    contentBase64: Buffer.concat([Buffer.from('%PDF-1.4\n', 'binary'), Buffer.alloc(512, 0x20)]).toString('base64'),
    role: 'staff', title: '審査員向け 内部メモ',
    description: 'IDFL STAFF のみに表示される資料です。', group: '内部資料',
  }),
});

const server = createServer();
server.listen(PORT, () => {
  console.log('\nlibrary on http://localhost:' + PORT + '/customer/media.html');
  console.log('  customer password  ' + ENV.CUSTOMER_ACCESS_PASSWORD);
  console.log('  staff password     ' + ENV.STAFF_ACCESS_PASSWORD);
  console.log('\nCtrl+C to stop.');
});

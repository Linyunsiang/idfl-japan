// Seeds the harness with the GOTS presentation plus a few ordinary records,
// so the browser pass has something real to click through.
//
//   IDFL_HARNESS_SEED=<path to the unpacked presentation> node tests/media-feedback/harness.mjs
import { invoke } from './harness.mjs';
import { zipDir } from './zip-writer.mjs';

function cookieOf(res){ return String((res.headers && res.headers['Set-Cookie']) || '').split(';')[0]; }
const SAME = { host: 'localhost', origin: 'http://localhost' };

export async function seedAll(pkgDir){
  const staffRes = await invoke('auth-login', {
    httpMethod: 'POST', headers: Object.assign({ 'x-nf-client-connection-ip': '127.0.0.1' }, SAME),
    body: JSON.stringify({ role: 'staff', password: process.env.STAFF_ACCESS_PASSWORD }),
  });
  const staff = cookieOf(staffRes);
  if(!staff) throw new Error('seed: staff login failed: ' + staffRes.body);
  const as = { cookie: staff, host: 'localhost', origin: 'http://localhost' };

  const zip = await zipDir(pkgDir);
  const up = JSON.parse((await invoke('protected-media-upload', {
    httpMethod: 'POST', headers: as,
    body: JSON.stringify({
      filename: 'gots-scope4-presentation.zip', contentBase64: zip.toString('base64'),
      role: 'customer', status: 'published',
      title: 'GOTS 8.0 スコープ4 化学品承認 意見交換会',
      description: 'GOTS Version 8.0 スコープ4（化学品承認）の評価ポイントと、化学品メーカー様に求められるサイト要件を解説します。日本語 / English / 繁體中文。',
      group: '2026 大阪セミナー',
    }),
  })).body);

  const draft = JSON.parse((await invoke('protected-media-upload', {
    httpMethod: 'POST', headers: as,
    body: JSON.stringify({
      filename: 'draft-deck.html',
      contentBase64: Buffer.from('<!doctype html><html lang="ja"><body style="font-family:sans-serif;padding:40px"><h1>社内レビュー用の下書き</h1><p>公開前のプレビュー確認用です。</p></body></html>', 'utf8').toString('base64'),
      role: 'customer', status: 'draft', title: '（下書き）2026 セミナー補足資料',
      description: '公開前の下書き。お客様には表示されません。', group: '2026 大阪セミナー',
    }),
  })).body);

  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary'), Buffer.alloc(2048, 0x20)]);
  await invoke('protected-upload', {
    httpMethod: 'POST', headers: as,
    body: JSON.stringify({
      filename: 'gots-scope4-checklist.pdf', contentBase64: pdf.toString('base64'), role: 'customer',
      title: 'GOTS スコープ4 準備チェックリスト', description: '申請前にご確認いただきたい項目の一覧です。', group: 'IDFL Guide',
    }),
  });

  await invoke('protected-addlink', {
    httpMethod: 'POST', headers: as,
    body: JSON.stringify({
      url: 'https://global-standard.org/', title: 'GOTS 公式サイト',
      description: '規格本文および最新の改訂情報（外部サイト）。', role: 'customer', group: 'IDFL Guide',
    }),
  });

  console.log('seeded: media=' + up.id + ' (v' + up.version + ', ' + up.files + ' files), draft=' + draft.id);
  return { mediaId: up.id, draftId: draft.id };
}

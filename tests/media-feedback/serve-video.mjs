// Stand the real functions up over real HTTP, upload the real video package
// through the real chunked path, and print the URLs to open in a browser.
//
// This is the check no unit test can make: whether a browser's media stack
// actually plays a clip that is only ever delivered in 3 MB byte ranges, and
// whether dragging the progress bar lands where it should.
//
//   node tests/media-feedback/serve-video.mjs [port] [path-to-zip]
import crypto from 'node:crypto';
import fs from 'node:fs';
import { setEnv, createServer, invoke, resetStores, loadFn } from './harness.mjs';

const ENV = setEnv();
const PORT = Number(process.argv[2] || 8792);
const CHUNK_BYTES = loadFn('protected-media-chunk').CHUNK_BYTES;
const SRC = process.argv[3] || process.env.IDFL_TC_PACKAGE ||
  'C:/Users/AldenLin/Downloads/TC/IDFL_TC_Manual_web_v6_動画同梱.zip';

const SAME = { host: 'localhost:' + PORT, origin: 'http://localhost:' + PORT };
let ip = 0;
async function login(role, password){
  const r = await invoke('auth-login', {
    httpMethod: 'POST',
    headers: Object.assign({}, SAME, { 'x-nf-client-connection-ip': '10.9.0.' + (++ip) }),
    body: JSON.stringify({ role, password }),
  });
  return String((r.headers && r.headers['Set-Cookie']) || '').split(';')[0];
}

resetStores();
const staff = await login('staff', ENV.STAFF_ACCESS_PASSWORD);
const customer = await login('customer', ENV.CUSTOMER_ACCESS_PASSWORD);

const buf = fs.readFileSync(SRC);
const totalChunks = Math.ceil(buf.length / CHUNK_BYTES);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
console.log('source      ' + (buf.length / 1048576).toFixed(2) + ' MB, ' + totalChunks + ' chunks of ' +
  (CHUNK_BYTES / 1048576).toFixed(0) + ' MB');

const call = async (p) => JSON.parse((await invoke('protected-media-chunk', {
  httpMethod: 'POST', headers: Object.assign({ cookie: staff }, SAME), body: JSON.stringify(p),
})).body);

const started = await call({
  action: 'start', filename: SRC.split(/[\\/]/).pop(), totalBytes: buf.length,
  totalChunks, chunkBytes: CHUNK_BYTES, sha256: sha, role: 'customer', status: 'published',
  title: 'IDFL JAPAN TC申請マニュアル（動画同梱）', group: 'IDFL Guide',
});
if(!started.ok) throw new Error(started.error);
for(let i = 0; i < totalChunks; i++){
  const part = buf.slice(i * CHUNK_BYTES, Math.min(buf.length, (i + 1) * CHUNK_BYTES));
  const r = await call({ action: 'chunk', sid: started.sid, index: i, dataBase64: part.toString('base64') });
  if(!r.ok) throw new Error('chunk ' + i + ': ' + r.error);
  process.stdout.write('\r  uploading ' + Math.round((i + 1) / totalChunks * 100) + '%');
}
const t0 = Date.now();
const done = await call({ action: 'complete', sid: started.sid });
if(!done.ok) throw new Error(done.error);
console.log('\nassembled   sha256 ' + (done.sourceSha256 === sha ? 'matches source' : 'MISMATCH') +
  ', complete took ' + (Date.now() - t0) + ' ms');
console.log('package     ' + done.files + ' files, ' + done.sizeLabel + ' expanded, entry ' + done.entry);

const grant = JSON.parse((await invoke('media-grant', {
  headers: Object.assign({ cookie: customer }, SAME), queryStringParameters: { id: done.id },
})).body);

const base = 'http://localhost:' + PORT + '/media/' + done.id + '/' + grant.token + '/v/';
const server = createServer();
server.listen(PORT, () => {
  console.log('\nserving on http://localhost:' + PORT);
  console.log('  entry     ' + base + done.entry);
  console.log('  a clip    ' + base + 'media/tccheck.mp4');
  console.log('  id        ' + done.id);
  console.log('\nCtrl+C to stop.');
});

// Upload a package ZIP through the real chunked path and serve it, so the
// package can be exercised in a browser exactly as a customer would meet it.
//
//   node tests/media-feedback/serve-zip.mjs <package.zip> [port]
import crypto from 'node:crypto';
import fs from 'node:fs';
import { setEnv, createServer, invoke, resetStores, loadFn } from './harness.mjs';

const ENV = setEnv();
const ZIP = process.argv[2];
const PORT = Number(process.argv[3] || 8795);
const CHUNK_BYTES = loadFn('protected-media-chunk').CHUNK_BYTES;
const SAME = { host: 'localhost:' + PORT, origin: 'http://localhost:' + PORT };

let ip = 0;
async function login(role, password){
  const r = await invoke('auth-login', {
    httpMethod: 'POST',
    headers: Object.assign({}, SAME, { 'x-nf-client-connection-ip': '10.4.0.' + (++ip) }),
    body: JSON.stringify({ role, password }),
  });
  return String((r.headers && r.headers['Set-Cookie']) || '').split(';')[0];
}

resetStores();
const staff = await login('staff', ENV.STAFF_ACCESS_PASSWORD);
const customer = await login('customer', ENV.CUSTOMER_ACCESS_PASSWORD);

const zip = fs.readFileSync(ZIP);
const totalChunks = Math.ceil(zip.length / CHUNK_BYTES);
console.log('package ' + (zip.length / 1048576).toFixed(2) + ' MB, ' + totalChunks + ' chunks');

const call = async (p) => JSON.parse((await invoke('protected-media-chunk', {
  httpMethod: 'POST', headers: Object.assign({ cookie: staff }, SAME), body: JSON.stringify(p),
})).body);

const started = await call({
  action: 'start', filename: 'tc-manual.zip', totalBytes: zip.length, totalChunks,
  sha256: crypto.createHash('sha256').update(zip).digest('hex'),
  role: 'customer', status: 'published', title: 'IDFL JAPAN TC申請マニュアル',
});
if(!started.ok) throw new Error(started.error);
for(let i = 0; i < totalChunks; i++){
  await call({ action: 'chunk', sid: started.sid, index: i,
    dataBase64: zip.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).toString('base64') });
  process.stdout.write('\r  uploading ' + Math.round((i + 1) / totalChunks * 100) + '%');
}
const done = await call({ action: 'complete', sid: started.sid });
if(!done.ok) throw new Error(done.error);
console.log('\n' + done.files + ' files, entry ' + done.entry +
  (done.report ? ', index ' + (done.report.indexBytes / 1048576).toFixed(2) + ' MB' : ''));

const grant = JSON.parse((await invoke('media-grant', {
  headers: Object.assign({ cookie: customer }, SAME), queryStringParameters: { id: done.id },
})).body);

createServer().listen(PORT, () => {
  console.log('\n  entry  http://localhost:' + PORT + '/media/' + done.id + '/' + grant.token + '/v/index.html');
  console.log('\nCtrl+C to stop.');
});

// ============================================================
// Local test harness for the Media Library / feedback stack.
//
// Runs the real netlify/functions/*.js against an in-memory Netlify Blobs
// stand-in and the real static files, mirroring the rewrites in netlify.toml.
//
// It exists so the feature can be exercised end-to-end WITHOUT `netlify dev`
// and, critically, without any chance of writing test data into the production
// blob store (see netlify.toml / _stores.js on preview-vs-production).
//
//   node tests/media-feedback/serve.mjs [port] [package-dir]
// ============================================================
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---------------------------------------------------------------- blob stub
// Implements only the surface the functions actually use.
const STORES = new Map();

function toBuffer(v){
  if(Buffer.isBuffer(v)) return Buffer.from(v);
  if(v instanceof ArrayBuffer) return Buffer.from(new Uint8Array(v));
  if(ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  return Buffer.from(String(v), 'utf8');
}

// Netlify Blobs reads a key strongly but lists a prefix eventually: a blob that
// was just written stays out of list() results for a while. Production hit that
// (a customer's own feedback vanished from the drawer right after submitting),
// so the stand-in can reproduce it on demand.
let LIST_LAG_MS = 0, LIST_LAG_STORE = '';
// Netlify Blobs can also serve a STALE read right after a write. That is what
// silently dropped a staff reply in production: feedback-manage read the record
// back without the field it had just saved, then wrote that copy.
let READ_STALE_MS = 0, READ_STALE_STORE = '';
export function setReadStale(ms, match){ READ_STALE_MS = ms || 0; READ_STALE_STORE = match || ''; }
/** Lag list() for stores whose name contains `match` (default: all). */
export function setListLag(ms, match){ LIST_LAG_MS = ms || 0; LIST_LAG_STORE = match || ''; }

class MemStore {
  constructor(name){ this.name = name; this.data = new Map(); }
  _remember(k){ const prev = this.data.get(String(k)); if(prev) this.prev = (this.prev||new Map()).set(String(k), prev); }
  async set(key, value, opts){ this._remember(key); this.data.set(String(key), { buf: toBuffer(value), metadata: (opts && opts.metadata) || {}, at: Date.now() }); }
  async setJSON(key, value, opts){ this._remember(key); this.data.set(String(key), { buf: Buffer.from(JSON.stringify(value), 'utf8'), metadata: (opts && opts.metadata) || {}, json: true, at: Date.now() }); }
  _read(key){
    const cur = this.data.get(String(key));
    if(!cur) return cur;
    const staleing = READ_STALE_MS > 0 && (!READ_STALE_STORE || this.name.indexOf(READ_STALE_STORE) >= 0);
    if(staleing && cur.at && Date.now() - cur.at < READ_STALE_MS){
      const old = this.prev && this.prev.get(String(key));
      if(old) return old;                       // the write has not landed for readers yet
    }
    return cur;
  }
  async get(key, opts){
    const e = this._read(key);
    if(!e) return null;
    const type = (opts && opts.type) || 'text';
    if(type === 'json'){ try{ return JSON.parse(e.buf.toString('utf8')); }catch(err){ return null; } }
    if(type === 'arrayBuffer') return e.buf.buffer.slice(e.buf.byteOffset, e.buf.byteOffset + e.buf.byteLength);
    return e.buf.toString('utf8');
  }
  async getMetadata(key){ const e = this.data.get(String(key)); return e ? { metadata: e.metadata } : null; }
  async getWithMetadata(key, opts){
    const e = this.data.get(String(key));
    if(!e) return null;
    return { data: await this.get(key, opts), metadata: e.metadata };
  }
  async delete(key){ this.data.delete(String(key)); }
  async list(opts){
    const prefix = (opts && opts.prefix) || '';
    const now = Date.now();
    const lagging = LIST_LAG_MS > 0 && (!LIST_LAG_STORE || this.name.indexOf(LIST_LAG_STORE) >= 0);
    const blobs = [];
    for(const [k, v] of this.data.entries()){
      if(k.indexOf(prefix) !== 0) continue;
      if(lagging && v.at && now - v.at < LIST_LAG_MS) continue;       // not yet listed
      blobs.push({ key: k });
    }
    return { blobs };
  }
}

export const blobsStub = {
  getStore(name){
    const n = typeof name === 'string' ? name : (name && name.name);
    if(!STORES.has(n)) STORES.set(n, new MemStore(n));
    return STORES.get(n);
  },
  getDeployStore(name){ return blobsStub.getStore('deploy:' + name); },
  connectLambda(){ /* no-op */ },
};

export function resetStores(){ STORES.clear(); }
export function dumpStore(name){ const s = STORES.get(name); return s ? s.data : new Map(); }
export function storeNames(){ return [...STORES.keys()]; }

// Intercept the dependency so the functions load unmodified.
const _load = Module._load;
Module._load = function(request, parent, isMain){
  if(request === '@netlify/blobs') return blobsStub;
  return _load.apply(this, arguments);
};

const require_ = Module.createRequire(import.meta.url);
const fnCache = new Map();
export function loadFn(name){
  if(!fnCache.has(name)) fnCache.set(name, require_(path.join(ROOT, 'netlify/functions', name + '.js')));
  return fnCache.get(name);
}

// ------------------------------------------------------------------ invoke
export async function invoke(name, event){
  const mod = loadFn(name);
  const ev = Object.assign({ httpMethod: 'GET', headers: {}, queryStringParameters: {}, body: null }, event);
  ev.headers = Object.assign({ host: 'localhost' }, ev.headers);
  return mod.handler(ev);
}

// ------------------------------------------------------------------ server
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.xlsx': 'application/octet-stream',
};

function send(res, out){
  const headers = Object.assign({}, out.headers || {});
  const body = out.isBase64Encoded ? Buffer.from(out.body || '', 'base64') : Buffer.from(out.body || '', 'utf8');
  /* Netlify always returns a length; node defaults to chunked without one.
     That difference is not cosmetic for media: Chrome's audio pipeline stalls
     at readyState 0 on a chunked response with no Content-Length, so a clip
     that plays perfectly in production looks broken here. Match production. */
  if(headers['Content-Length'] === undefined) headers['Content-Length'] = String(body.length);
  res.writeHead(out.statusCode || 200, headers);
  res.end(body);
}

export function createServer(){
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    const query = {}; for(const [k, v] of url.searchParams) query[k] = v;

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const rawBody = Buffer.concat(chunks).toString('utf8');

    const baseEvent = {
      httpMethod: req.method,
      headers: Object.assign({}, req.headers, { host: req.headers.host || 'localhost' }),
      queryStringParameters: query,
      body: rawBody || null,
    };

    try{
      // netlify.toml: /media/:id/:token/:mode/*  ->
      //   /.netlify/functions/protected-media-asset/:id/:token/:mode/:splat
      // Rewritten as a PATH, exactly as Netlify does it, because placeholders
      // are not substituted inside a redirect's query string.
      const m = /^\/media\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/.exec(p);
      if(m){
        const out = await invoke('protected-media-asset', Object.assign({}, baseEvent, {
          path: '/.netlify/functions/protected-media-asset/' + m[1] + '/' + m[2] + '/' + m[3] + '/' + m[4],
          queryStringParameters: query,
        }));
        return send(res, out);
      }

      if(p.indexOf('/.netlify/functions/') === 0){
        const name = p.slice('/.netlify/functions/'.length).split('/')[0];
        if(!/^[a-z0-9-]+$/.test(name)) { res.writeHead(404); return res.end('no'); }
        const out = await invoke(name, baseEvent);
        return send(res, out);
      }

      // netlify.toml: /admin -> /admin.html ; /tests/* -> 404
      let file = p === '/admin' ? '/admin.html' : p;
      if(file.indexOf('/tests/') === 0){ res.writeHead(404); return res.end('not found'); }
      if(file.endsWith('/')) file += 'index.html';
      const abs = path.join(ROOT, file);
      if(!abs.startsWith(ROOT)){ res.writeHead(400); return res.end('bad path'); }
      const buf = await fsp.readFile(abs);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      return res.end(buf);
    }catch(err){
      if(err && err.code === 'ENOENT'){ res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('not found: ' + p); }
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('harness error: ' + (err && err.stack || err));
    }
  });
}

// ------------------------------------------------------------------- seed
export function setEnv(over){
  const env = Object.assign({
    SESSION_SECRET: 'harness-secret-not-a-real-one',
    CUSTOMER_ACCESS_PASSWORD: process.env.IDFL_TEST_CUSTOMER_PASSWORD || 'test-customer-password',
    STAFF_ACCESS_PASSWORD: 'harness-staff-password',
    CONTEXT: 'dev',
    // The admin console's outer gate validates against publish.js.
    ADMIN_PASSWORD: 'harness-admin-password',
    URL: 'http://localhost:8899',
  }, over || {});
  Object.assign(process.env, env);
  return env;
}

// ============================================================
// No credential may ship to a browser, and no public page may publish.
//
// The Q&A page used to carry an admin password as a JavaScript constant and
// post it to publish.js. That value is now rotated and permanently invalid,
// but the shape of the mistake is easy to reintroduce, so these tests fail
// the build rather than relying on anyone remembering.
//
// Values are never printed. A failure names the file, the line and the kind.
//
//   node tests/qa/security.test.mjs
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let pass = 0, fail = 0;
async function t(name, fn){
  try{ await fn(); console.log('  ok   ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + '\n       ' + (e && e.message)); fail++; }
}
function G(n){ console.log('\n' + n); }

// ---------------------------------------------------------------- scanning
const SKIP_DIRS = new Set(['.git','node_modules','.gstack','dist','build']);
const SCAN_EXT  = new Set(['.html','.js','.mjs','.cjs','.json','.css']);

/** Files a browser can fetch: everything except functions, tests and tools. */
function publicFiles(){
  const out = [];
  (function walk(dir){
    for(const e of fs.readdirSync(dir, { withFileTypes: true })){
      if(SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if(e.isDirectory()){ walk(full); continue; }
      if(!SCAN_EXT.has(path.extname(e.name).toLowerCase())) continue;
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      if(rel.startsWith('netlify/') || rel.startsWith('tests/') || rel.startsWith('tools/')) continue;
      out.push(rel);
    }
  })(ROOT);
  return out;
}

const RULES = [
  { n:'password assigned to a variable', re:/\b(?:const|let|var)\s+\w*(?:PASS|PASSWORD|PWD)\w*\s*=\s*['"`]([^'"`\n]{3,})['"`]/gi, capture:true },
  { n:'password as an object key',       re:/["']?(?:password|passwd|pwd|admin_password|adminPassword)["']?\s*[:=]\s*['"`]([^'"`\n]{3,})['"`]/gi, capture:true },
  { n:'key or token assigned',           re:/\b(?:const|let|var)\s+\w*(?:API_?KEY|SECRET)\w*\s*=\s*['"`]([^'"`\n]{8,})['"`]/gi, capture:true },
  { n:'key or token as an object key',   re:/["']?(?:api[_-]?key|apiKey|access[_-]?token|client[_-]?secret|session[_-]?secret)["']?\s*[:=]\s*['"`]([^'"`\n]{8,})['"`]/gi, capture:true },
  { n:'GitHub token',    re:/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g },
  { n:'Resend API key',  re:/\bre_[A-Za-z0-9_]{16,}/g },
  { n:'AWS access key',  re:/\bAKIA[0-9A-Z]{16}\b/g },
  { n:'Slack token',     re:/\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { n:'Google API key',  re:/\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { n:'private key',     re:/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
];

// Things that match the shape but carry nothing secret.
const BENIGN = [
  /^process\.env\./, /^import\.meta\.env\./, /^\$\{/, /^</, /^\{\{/,
  /^(?:password|your[-_ ]?password|changeme|example|placeholder|xxx+|\*+|…|\.\.\.|none|null|undefined|true|false)$/i,
  /^(?:text|string|hidden|submit|button|email|number|tel|url|date|checkbox|search)$/i,
  /^[a-z-]+\/[a-z-]+$/i,
];

function scan(rel){
  const txt = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const hits = [];
  for(const rule of RULES){
    rule.re.lastIndex = 0;
    let m;
    while((m = rule.re.exec(txt)) !== null){
      if(rule.capture){
        const v = String(m[1] || '').trim();
        if(!v || BENIGN.some(r => r.test(v))) continue;
      }
      hits.push({ rel, line: txt.slice(0, m.index).split('\n').length, kind: rule.n });
    }
  }
  return hits;
}
/* These pages may call the publish endpoint: they embed no credential and
   ask the server to validate a password the operator types, which is the
   same gate the admin console uses. The rule under test is 'no page ships a
   secret', not 'no page has an admin mode'. */
const SERVER_GATED = new Set(['admin.html', 'idfl_news.html']);

const describe = (h) => h.rel + ':' + h.line + ' [' + h.kind + ']';   // never the value

// ==========================================================================
G('NO CREDENTIAL REACHES A BROWSER');

await t('qa.html carries no credential of any kind', async () => {
  const hits = scan('qa.html');
  assert.equal(hits.length, 0, 'found: ' + hits.map(describe).join(', '));
});

await t('the other two pages that used to carry one are clean', async () => {
  for(const f of ['download.html','seminar_schedule.html']){
    const hits = scan(f);
    assert.equal(hits.length, 0, 'found: ' + hits.map(describe).join(', '));
  }
});

await t('no public file anywhere in the repository carries one', async () => {
  const hits = publicFiles().flatMap(scan);
  assert.equal(hits.length, 0, hits.length + ' finding(s): ' + hits.map(describe).join(', '));
});

await t('the removed constant name is gone, not merely renamed', async () => {
  for(const f of ['qa.html','download.html','seminar_schedule.html']){
    const txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/\bQA_PASS\b/.test(txt), f + ' still references QA_PASS');
    assert.ok(!/\bvar PASS\b|\bconst PASS\b|\blet PASS\b/.test(txt), f + ' still declares PASS');
  }
});

// ==========================================================================
G('NO PUBLIC PAGE CAN PUBLISH');

await t('no public page calls the publish endpoint', async () => {
  const offenders = publicFiles().filter(f =>
    /\/\.netlify\/functions\/publish/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')) && !SERVER_GATED.has(f));
  assert.equal(offenders.length, 0, 'still calls publish: ' + offenders.join(', '));
});

await t('no public page except the admin console uploads files', async () => {
  const offenders = publicFiles().filter(f =>
    /\/\.netlify\/functions\/(upload-file|file-manager)/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')) && !SERVER_GATED.has(f));
  assert.equal(offenders.length, 0, 'still uploads: ' + offenders.join(', '));
});

await t('the Q&A page has no editing surface left', async () => {
  const txt = fs.readFileSync(path.join(ROOT, 'qa.html'), 'utf8');
  for(const marker of ['qaEditModal','qaLoginModal','qaAdminBar','qaFloatBtn','qaSaveItem','qaDelete(','qaPublish','_qaDoPublish'])
    assert.ok(!txt.includes(marker), 'qa.html still contains ' + marker);
});

await t('the pages that kept their editor can no longer authenticate in the browser', async () => {
  for(const f of ['download.html','seminar_schedule.html']){
    const txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
    // isAdmin may only ever be set true inside a function that does not compare
    // a password; doLogin now just navigates to the admin console.
    assert.ok(/function doLogin\(\) \{\s*\/\/[^\n]*\n\s*window\.location\.href = '\/admin';/.test(txt),
      f + ': doLogin should only redirect to /admin');
    assert.ok(!/\.value !== PASS/.test(txt), f + ' still compares against a password constant');
  }
});

await t('function sources are not served as static files', async () => {
  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  assert.ok(/from = "\/netlify\/\*"/.test(toml), 'netlify.toml should block /netlify/*');
  assert.ok(/from = "\/tests\/\*"/.test(toml), 'netlify.toml should block /tests/*');
  // and the block must be forced, or the static file wins
  const blocks = toml.split('[[redirects]]').filter(b => /\/netlify\/\*|\/tests\/\*/.test(b));
  for(const b of blocks) assert.ok(/force = true/.test(b), 'the block must use force = true');
});

// ==========================================================================
G('publish.js REFUSES ANONYMOUS CALLERS');

const PUBLISH = path.join(ROOT, 'netlify/functions/publish.js');
const ADMIN_PW = 'test-admin-password-not-the-real-one';

/** Load publish.js fresh with a known env and a stubbed GitHub API. */
async function withPublish(fn){
  const savedEnv = { ...process.env };
  const savedFetch = globalThis.fetch;
  process.env.ADMIN_PASSWORD = ADMIN_PW;
  process.env.GITHUB_TOKEN = 'test-token-not-real';
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: (opts && opts.method) || 'GET' });
    if(!opts || opts.method !== 'PUT') return { status: 404, json: async () => ({}) };
    return { status: 200, json: async () => ({ content: {} }) };
  };
  const mod = await import('file://' + PUBLISH.split(path.sep).join('/') + '?v=' + Math.random());
  try{ return await fn(mod.handler, calls); }
  finally{ globalThis.fetch = savedFetch; process.env = savedEnv; }
}
const call = (handler, body, headers) => handler({
  httpMethod: 'POST', headers: headers || {}, body: JSON.stringify(body),
});
const J = (r) => { try{ return JSON.parse(r.body); }catch(e){ return {}; } };

await t('a request with no password is refused', async () => {
  await withPublish(async (h, calls) => {
    const r = await call(h, { type: 'qa', data: [] });
    assert.equal(r.statusCode, 401);
    assert.equal(calls.length, 0, 'nothing may be written to GitHub');
  });
});

await t('a request with the wrong password is refused', async () => {
  await withPublish(async (h, calls) => {
    const r = await call(h, { type: 'qa', password: 'definitely-not-it', data: [] });
    assert.equal(r.statusCode, 401);
    assert.equal(calls.length, 0);
  });
});

await t('an empty password is refused', async () => {
  await withPublish(async (h, calls) => {
    for(const pw of ['', null, undefined, 0, false]){
      const r = await call(h, { type: 'qa', password: pw, data: [] });
      assert.equal(r.statusCode, 401, 'accepted password of type ' + typeof pw);
    }
    assert.equal(calls.length, 0);
  });
});

await t('the refusal says nothing about the expected value', async () => {
  await withPublish(async (h) => {
    const body = (await call(h, { type: 'qa', password: 'nope', data: [] })).body;
    assert.ok(!/ADMIN_PASSWORD/.test(body), 'the error must not name the env var');
    assert.ok(!body.includes(ADMIN_PW), 'the error must not echo the expected password');
  });
});

await t('validateOnly still needs the password', async () => {
  await withPublish(async (h) => {
    assert.equal((await call(h, { type: 'news', validateOnly: true })).statusCode, 401);
    assert.equal((await call(h, { type: 'news', password: 'wrong', validateOnly: true })).statusCode, 401);
  });
});

await t('an unknown data type is refused even with the right password', async () => {
  await withPublish(async (h, calls) => {
    const r = await call(h, { type: '../../etc/passwd', password: ADMIN_PW, data: [] });
    assert.equal(r.statusCode, 400);
    assert.equal(calls.length, 0);
  });
});

await t('a non-array payload is refused', async () => {
  await withPublish(async (h, calls) => {
    const r = await call(h, { type: 'qa', password: ADMIN_PW, data: { not: 'an array' } });
    assert.equal(r.statusCode, 400);
    assert.equal(calls.length, 0);
  });
});

// ==========================================================================
G('AN AUTHENTICATED ADMIN CAN STILL PUBLISH');

await t('the login check still succeeds with the right password', async () => {
  await withPublish(async (h, calls) => {
    const r = await call(h, { type: 'news', password: ADMIN_PW, validateOnly: true });
    assert.equal(r.statusCode, 200);
    assert.equal(J(r).ok, true);
    assert.equal(calls.length, 0, 'a login check must not write anything');
  });
});

await t('every existing data type still publishes', async () => {
  for(const type of ['qa','news','downloads','schedule','factories']){
    await withPublish(async (h, calls) => {
      const data = type === 'factories'
        ? [{ id: 'x', companyName: 'テスト会社', logo: '/files/a.png', officialWebsiteUrl: 'https://example.com' }]
        : [{ id: 'x', q: 'Q', a: 'A' }];
      const r = await call(h, { type, password: ADMIN_PW, data });
      assert.equal(r.statusCode, 200, type + ' failed: ' + r.body);
      assert.equal(J(r).ok, true);
      const put = calls.filter(c => c.method === 'PUT');
      assert.equal(put.length, 1, type + ' should write exactly once');
      assert.ok(/api\.github\.com/.test(put[0].url), type + ' should write via the GitHub API');
    });
  }
});

await t('a Q&A payload carrying the new fields publishes unchanged', async () => {
  await withPublish(async (h, calls) => {
    const data = [{ id:'qa-1', section:'chemical', q:'Q', a:'A',
      images:[{src:'/files/a.png',caption:'図1'}], isNew:true, newUntil:'2027-01-01' }];
    const r = await call(h, { type: 'qa', password: ADMIN_PW, data });
    assert.equal(r.statusCode, 200);
    const put = calls.find(c => c.method === 'PUT');
    assert.ok(put, 'it should have been written');
  });
});

await t('the factories URL and logo checks still hold', async () => {
  await withPublish(async (h, calls) => {
    const bad = await call(h, { type: 'factories', password: ADMIN_PW,
      data: [{ id:'x', companyName:'A', officialWebsiteUrl: 'javascript:alert(1)' }] });
    assert.equal(bad.statusCode, 400, 'a non-https URL should be refused');
    const badLogo = await call(h, { type: 'factories', password: ADMIN_PW,
      data: [{ id:'x', companyName:'A', logo: 'ftp://evil.example/x.png' }] });
    assert.equal(badLogo.statusCode, 400, 'a logo that is neither /files/ nor https should be refused');
    assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
  });
});

await t('the oversized-payload guard still holds', async () => {
  await withPublish(async (h, calls) => {
    const r = await call(h, { type: 'qa', password: ADMIN_PW, data: new Array(5001).fill({ id:'x' }) });
    assert.equal(r.statusCode, 413);
    assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;

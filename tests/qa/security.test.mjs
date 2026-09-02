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

// 集計は終了時に出す。テストを末尾に足しても集計が途中に取り残されない。
process.on('exit', () => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if(fail) process.exitCode = 1;
});

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
  // default to the production console unless a test says otherwise
  if(process.env.CONTEXT === undefined) process.env.CONTEXT = 'production';
  if(process.env.BRANCH === undefined) process.env.BRANCH = 'main';
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

// ==========================================================================
G('A DEPLOY PREVIEW MUST NOT WRITE TO PRODUCTION');

const TARGET = path.join(ROOT, 'netlify/functions/_target.js');
async function target(env){
  const saved = { ...process.env };
  delete process.env.CONTEXT; delete process.env.BRANCH;
  Object.assign(process.env, env);
  const mod = await import('file://' + TARGET.split(path.sep).join('/') + '?v=' + Math.random());
  try{ return await (mod.default ? mod.default.resolveBranch : mod.resolveBranch)(env.GITHUB_TOKEN || null, env.__host || null); }
  finally{ process.env = saved; }
}

await t('production writes to main', async () => {
  assert.equal(await target({ CONTEXT:'production', BRANCH:'main' }), 'main');
});

await t('production writes to main even if BRANCH says otherwise', async () => {
  assert.equal(await target({ CONTEXT:'production', BRANCH:'somebody-elses-branch' }), 'main');
});

await t('a deploy preview writes to its own branch', async () => {
  assert.equal(await target({ CONTEXT:'deploy-preview', BRANCH:'feature/qa-admin-improvements' }),
    'feature/qa-admin-improvements');
});

await t('a deploy preview never resolves to main', async () => {
  for(const env of [
    { CONTEXT:'deploy-preview', BRANCH:'main' },
    { CONTEXT:'deploy-preview' },
    { CONTEXT:'deploy-preview', BRANCH:'' },
    { CONTEXT:'deploy-preview', BRANCH:'   ' },
  ]) assert.notEqual(await target(env), 'main', 'resolved to main for ' + JSON.stringify(env));
});

await t('an unknown context with no branch refuses rather than guessing', async () => {
  assert.equal(await target({}), null);
  assert.equal(await target({ CONTEXT:'dev' }), null);
});

await t('a branch deploy of main is still main', async () => {
  assert.equal(await target({ CONTEXT:'branch-deploy', BRANCH:'main' }), 'main');
});

await t('a branch name that is not a branch name is refused', async () => {
  for(const b of ['../../etc/passwd', 'a..b', 'branch with spaces', '-leading-dash', 'x'.repeat(300), 'tag\nname'])
    assert.equal(await target({ CONTEXT:'deploy-preview', BRANCH:b }), null, 'accepted: ' + JSON.stringify(b));
});

await t('publish.js sends the preview branch, not main', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { CONTEXT:'deploy-preview', BRANCH:'feature/qa-admin-improvements' });
  try{
    await withPublish(async (h, calls) => {
      const r = await call(h, { type:'qa', password: ADMIN_PW, data:[{ id:'x' }] });
      assert.equal(r.statusCode, 200);
      assert.equal(J(r).branch, 'feature/qa-admin-improvements', 'the response should name the branch');
      const put = calls.find(c => c.method === 'PUT');
      assert.ok(put, 'it should have written');
    });
  } finally { process.env = saved; }
});

await t('publish.js refuses when the target cannot be established', async () => {
  const saved = { ...process.env };
  // empty, not deleted: the harness fills in a production context only when the
  // variables are absent, and this test is about them being present but useless
  process.env.CONTEXT = ''; process.env.BRANCH = '';
  try{
    await withPublish(async (h, calls) => {
      const r = await call(h, { type:'qa', password: ADMIN_PW, data:[{ id:'x' }] });
      assert.equal(r.statusCode, 500);
      assert.equal(calls.filter(c => c.method === 'PUT').length, 0, 'nothing may be written');
    });
  } finally { process.env = saved; }
});

await t('no write endpoint hard-codes a branch any more', async () => {
  for(const f of ['publish.js','upload-file.js','file-manager.js']){
    const txt = fs.readFileSync(path.join(ROOT, 'netlify/functions', f), 'utf8');
    assert.ok(!/BRANCH\s*=\s*['"]main['"]/.test(txt), f + ' still hard-codes main');
    assert.ok(/require\('\.\/_target'\)/.test(txt), f + ' should resolve its target through _target');
  }
});

await t('a deploy preview with no BRANCH and no token refuses', async () => {
  // BRANCH is a build variable; Netlify does not put it in the function
  // runtime, so this is the real shape of a preview invocation.
  assert.equal(await target({ CONTEXT:'deploy-preview', REVIEW_ID:'10' }), null);
});

await t('a malformed REVIEW_ID is never looked up', async () => {
  for(const id of ['abc', '1; rm -rf /', '../10', '', '9'.repeat(20)])
    assert.equal(await target({ CONTEXT:'deploy-preview', REVIEW_ID:id }), null, 'accepted: ' + JSON.stringify(id));
});

await t('the write endpoints resolve their target asynchronously', async () => {
  for(const f of ['publish.js','upload-file.js','file-manager.js']){
    const txt = fs.readFileSync(path.join(ROOT, 'netlify/functions', f), 'utf8');
    assert.ok(txt.includes('await T.resolveBranch('), f + ' should await resolveBranch');
  }
});

await t('the branch is resolved only after the caller is authenticated', async () => {
  // an unauthenticated request must never reach the GitHub lookup
  const txt = fs.readFileSync(path.join(ROOT, 'netlify/functions/publish.js'), 'utf8');
  const authAt = txt.indexOf('password !== process.env.ADMIN_PASSWORD');
  const branchAt = txt.indexOf('await T.resolveBranch(');
  assert.ok(authAt >= 0 && branchAt > authAt, 'the password check must come first');
});

// ==========================================================================
G('THE HOST DECIDES WHEN NETLIFY PROVIDES NOTHING');

// This site's function runtime carries no CONTEXT / BRANCH / REVIEW_ID at all
// — confirmed against a live deploy — so these tests describe reality, not a
// hypothetical. Getting this wrong in the production direction breaks
// publishing for the whole site, so it is pinned here.

await t('the production domain resolves to main with no env at all', async () => {
  for(const host of ['idfl-japan.com','www.idfl-japan.com','idfl-japan.netlify.app','main--idfl-japan.netlify.app'])
    assert.equal(await target({ __host: host }), 'main', 'failed for ' + host);
});

await t('a port on the host does not confuse it', async () => {
  assert.equal(await target({ __host: 'idfl-japan.com:443' }), 'main');
});

await t('case in the host does not confuse it', async () => {
  assert.equal(await target({ __host: 'IDFL-Japan.COM' }), 'main');
});

await t('a preview host never resolves to main', async () => {
  // without a token the PR lookup cannot run, so it must refuse rather than
  // fall back to production
  assert.equal(await target({ __host: 'deploy-preview-10--idfl-japan.netlify.app' }), null);
});

await t('a host that is neither is refused', async () => {
  for(const host of ['evil.example','idfl-japan.com.evil.example','','deploy-preview--idfl-japan.netlify.app',
                     'deploy-preview-abc--idfl-japan.netlify.app','feature-x--idfl-japan.netlify.app'])
    assert.notEqual(await target({ __host: host }), 'main', 'resolved to main for ' + JSON.stringify(host));
});

await t('a look-alike production host cannot claim main', async () => {
  for(const host of ['idfl-japan.com.attacker.test','notidfl-japan.com','idfl-japan.netlify.app.evil.test'])
    assert.equal(await target({ __host: host }), null, 'accepted: ' + host);
});

await t('CONTEXT still wins where Netlify does provide it', async () => {
  // a production build must not be re-decided by a host header
  assert.equal(await target({ CONTEXT:'production', __host:'deploy-preview-10--idfl-japan.netlify.app' }), 'main');
});

await t('the host classifier agrees with the branch resolver', async () => {
  const mod = await import('file://' + TARGET.split(path.sep).join('/') + '?v=' + Math.random());
  const dep = mod.default ? mod.default.deploymentFromHost : mod.deploymentFromHost;
  assert.equal(dep('idfl-japan.com').kind, 'production');
  assert.equal(dep('deploy-preview-10--idfl-japan.netlify.app').kind, 'preview');
  assert.equal(dep('deploy-preview-10--idfl-japan.netlify.app').review, '10');
  assert.equal(dep('evil.example').kind, 'unknown');
  assert.equal(dep('').kind, 'unknown');
  assert.equal(dep(null).kind, 'unknown');
});

await t('every write endpoint passes the request host through', async () => {
  for(const f of ['publish.js','upload-file.js']){
    const txt = fs.readFileSync(path.join(ROOT, 'netlify/functions', f), 'utf8');
    assert.ok(/resolveBranch\(token, event\.headers/.test(txt), f + ' should pass the host');
  }
  const fm = fs.readFileSync(path.join(ROOT, 'netlify/functions/file-manager.js'), 'utf8');
  assert.ok(/setHost\(event\.headers/.test(fm), 'file-manager.js should record the host');
});

#!/usr/bin/env node
/* Fails when a page's generated chrome no longer matches /partials, or when
   a page uses a legacy design token that new work is not allowed to add.

   Run: node tools/check-chrome.mjs
*/
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sync = require(path.join(ROOT, 'tools', 'sync-chrome.js'));

let failures = 0;
const fail = (m) => { console.error('FAIL  ' + m); failures++; };
const ok = (m) => console.log('ok    ' + m);

/* ---- 1. chrome drift ------------------------------------------------- */
for (const page of sync.PAGES) {
  const file = path.join(ROOT, page);
  if (!fs.existsSync(file)) { fail(`${page} is missing`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  const parts = sync.build(page);
  for (const region of sync.REGIONS) {
    const { start, end } = sync.markers(region);
    const si = html.indexOf(start);
    const ei = html.indexOf(end);
    if (si === -1 || ei === -1) { fail(`${page}: ${region} markers missing`); continue; }
    if (html.indexOf(start, si + 1) !== -1) { fail(`${page}: duplicate ${region}:START`); continue; }
    const actual = html.slice(si + start.length, ei).trim();
    const expected = parts[region].trim();
    if (actual !== expected) {
      fail(`${page}: ${region} drifted from /partials (run node tools/sync-chrome.js)`);
    }
  }
}
if (!failures) ok(`chrome matches /partials across ${sync.PAGES.length} pages`);

/* ---- 2. no new legacy tokens ----------------------------------------
   tokens.css keeps a fixed set of aliases for backward compatibility.
   New CSS must use --idfl-*. This catches an alias being introduced in
   the new stylesheets. */
const LEGACY_BLOCK = /--(accent2?|nav-[a-z-]+|b\d{3}|brand-\d{2,3}|ink(-soft)?|muted|faint|hairline[a-z0-9-]*|line|maxw|gut|f-(sans|mono)|idfl-(sans|mono))\s*:/g;
const NEW_SHEETS = ['css/base.css', 'css/chrome.css', 'css/components.css'];
for (const sheet of NEW_SHEETS) {
  const css = fs.readFileSync(path.join(ROOT, sheet), 'utf8');
  const hits = css.match(LEGACY_BLOCK);
  if (hits) fail(`${sheet} defines legacy token(s): ${[...new Set(hits)].join(', ')} — new components must use --idfl-*`);
}
if (failures === 0) ok('no legacy tokens defined outside tokens.css');

/* ---- 3. every --idfl-* used is defined -------------------------------- */
const tokensCss = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8');
const defined = new Set([...tokensCss.matchAll(/(--idfl-[\w-]+)\s*:/g)].map(m => m[1]));
for (const sheet of NEW_SHEETS) {
  const css = fs.readFileSync(path.join(ROOT, sheet), 'utf8');
  for (const m of css.matchAll(/var\((--idfl-[\w-]+)/g)) {
    if (!defined.has(m[1])) fail(`${sheet} uses undefined token ${m[1]}`);
  }
}

/* ---- 4. partials must not hard-code a homepage-only anchor ------------ */
for (const f of ['header.html', 'mega-menu.html', 'footer.html']) {
  const src = fs.readFileSync(path.join(ROOT, 'partials', f), 'utf8');
  // #main is the skip link and must stay page-local. Any other bare hash is
  // a homepage section that would silently do nothing on a sub-page.
  const bare = (src.match(/href="#(?!\s)[\w-]+"/g) || []).filter(h => h !== 'href="#main"');
  if (bare.length) fail(`partials/${f} has page-relative anchor(s) ${bare.join(', ')} — use {{HOME}}# so they resolve from sub-pages`);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll chrome checks passed.');
process.exit(failures ? 1 : 0);

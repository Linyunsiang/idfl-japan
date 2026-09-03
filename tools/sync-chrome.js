#!/usr/bin/env node
/* ============================================================
   IDFL JAPAN — global chrome generator.

   The partials in /partials are authoritative. This writes their content
   into the marked regions of each public page, so the shipped HTML is
   static: navigation exists in the document, needs no fetch, and survives
   a JavaScript failure.

   Generated regions are never hand-edited. tools/check-chrome.mjs fails if
   a page drifts from its partial.

   Usage:
     node tools/sync-chrome.js          write changed pages
     node tools/sync-chrome.js --check  report drift, write nothing (exit 1)
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P = (...a) => path.join(ROOT, ...a);

/* Pages that carry the marketing chrome.

   Deliberately excluded, because the shared header would work against what
   the page is for:
     admin.html                    - the console has its own shell
     customer/media-viewer.html    - full-screen protected presentation
     customer/*.html               - authenticated app pages
     application/gots-te/          - a focused multi-step form
     gots-preparation/index.html   - 836KB self-contained guide, out of scope for v1
*/
const PAGES = [
  'index.html',
  'idfl_news.html',
  'news/detail.html',
  'qa.html',
  'seminar_schedule.html',
  'past_seminar_v2.html',
  'download.html',
  'certified-factories.html',
  'converter.html',
  'gots_cas_checker.html',
  'seminar-2026-osaka.html',
];

const REGIONS = ['HEAD', 'HEADER', 'MENU', 'FOOTER', 'SCRIPT'];

// The `js` class is set inline rather than from the deferred script: the
// reveal styling keys off it, and setting it after parse would show every
// section, then hide it, then fade it back in.
const HEAD = `<script>document.documentElement.className+=' js';</script>
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/base.css">
<link rel="stylesheet" href="/css/chrome.css">
<link rel="stylesheet" href="/css/components.css">`;

const SCRIPT = `<script src="/js/site-motion.js" defer></script>`;

/** Root-relative links work from every page; on the homepage itself the bare
    hash is kept so in-page scrolling behaves exactly as it does today. */
function substitute(html, page) {
  const home = page === 'index.html' ? '' : '/';
  return html.replace(/\{\{HOME\}\}/g, home);
}

function readPartial(name) {
  return fs.readFileSync(P('partials', name), 'utf8').replace(/\s+$/, '');
}

function build(page) {
  return {
    HEAD,
    HEADER: substitute(readPartial('header.html'), page),
    MENU: substitute(readPartial('mega-menu.html'), page),
    FOOTER: substitute(readPartial('footer.html'), page),
    SCRIPT,
  };
}

function markers(region) {
  return {
    start: `<!-- IDFL:${region}:START -->`,
    end: `<!-- IDFL:${region}:END -->`,
  };
}

/** Replace one region. Returns {html, changed} or throws with a clear reason. */
function writeRegion(html, region, body, page) {
  const { start, end } = markers(region);
  const si = html.indexOf(start);
  const ei = html.indexOf(end);
  if (si === -1 || ei === -1) {
    throw new Error(`${page}: missing ${region} markers. Add them where the region belongs — placement is a human decision, not something this tool guesses.`);
  }
  if (ei < si) throw new Error(`${page}: ${region} END appears before START.`);
  if (html.indexOf(start, si + 1) !== -1) throw new Error(`${page}: duplicate ${region}:START.`);

  const before = html.slice(0, si + start.length);
  const after = html.slice(ei);
  const next = `${before}\n${body}\n${after}`;
  return { html: next, changed: next !== html };
}

function run(checkOnly) {
  let drift = 0, written = 0, errors = 0;
  for (const page of PAGES) {
    const file = P(page);
    if (!fs.existsSync(file)) { console.error(`MISSING PAGE ${page}`); errors++; continue; }
    let html = fs.readFileSync(file, 'utf8');
    const parts = build(page);
    let pageChanged = false;
    try {
      for (const region of REGIONS) {
        const r = writeRegion(html, region, parts[region], page);
        html = r.html;
        if (r.changed) pageChanged = true;
      }
    } catch (e) {
      console.error('ERROR ' + e.message);
      errors++;
      continue;
    }
    if (pageChanged) {
      drift++;
      if (checkOnly) {
        console.error(`DRIFT  ${page} — generated chrome differs from /partials`);
      } else {
        fs.writeFileSync(file, html);
        written++;
        console.log(`synced ${page}`);
      }
    }
  }
  if (errors) { console.error(`\n${errors} page(s) could not be processed.`); return 1; }
  if (checkOnly) {
    if (drift) {
      console.error(`\n${drift} page(s) drifted. Run: node tools/sync-chrome.js`);
      return 1;
    }
    console.log(`chrome OK — ${PAGES.length} pages match /partials`);
    return 0;
  }
  console.log(`\n${written} page(s) written, ${PAGES.length - written} already current.`);
  return 0;
}

if (require.main === module) {
  process.exit(run(process.argv.includes('--check')));
}
module.exports = { PAGES, REGIONS, build, markers };

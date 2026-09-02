# Media Library / presentation feedback — tests

QA tooling for `/customer/media.html`, `/customer/media-viewer.html`, the
`メディアライブラリ` and `メディアフィードバック` tabs in `/admin`, and the
`netlify/functions/*` behind them. Ships in git, is not part of the site
(`netlify.toml` 404s `/tests/*`, `.assetsignore` excludes it).

## Run

```bash
npm install                    # @netlify/blobs + jsdom (devDependency)
npm test                       # or: node tests/media-feedback/run-all.mjs
```

`zip.test.mjs` and `api.test.mjs` need only Node. `anchor/admin/customer` need
`jsdom`; without it they print a skip line and exit 0 rather than failing.

The GOTS presentation used as the fixture is not in this repository. Point the
suite at a local copy of the unpacked deck:

```bash
IDFL_TEST_PKG=/path/to/gots-scope4-presentation npm test
```

## Why there is a harness at all

`harness.mjs` runs the **real** functions against an in-memory stand-in for
Netlify Blobs, plus the real static files, mirroring the rewrites in
`netlify.toml` (including `/media/:id/:token/:mode/*`).

That matters for more than convenience. `getStore()` is **site-wide**: a Deploy
Preview and production share one bucket. Testing feedback against a real
deployment would write customer-shaped records into the production store. The
harness makes that impossible — nothing here can reach a real store.

`_stores.js` covers the same risk in production code: the new stores
(`idfl-media-html`, `idfl-feedback`) are suffixed per deploy context, so a
preview writes to `idfl-feedback-dp-<n>` and never to `idfl-feedback`.

## Suites

| File | Covers |
|---|---|
| `zip.test.mjs` | `_zip.js`: deflate/stored entries, traversal, zip bombs, CRC, ZIP64 refusal, and the real 14-file GOTS package |
| `api.test.mjs` | auth, media upload/serve/replace/delete, grant tokens, feedback CRUD, PII isolation, e-mail, and regression of the existing download page |
| `anchor.test.mjs` | the injected annotation agent against the real deck DOM: selector scoping, text-quote fallback, and the rule that a pin must not drift onto another slide |
| `admin.test.mjs` | the real `/admin` page and its inline JS: both new tabs, staff gating, reply/status/note/delete, and that no existing tab was lost |
| `customer.test.mjs` | the real customer pages: library filters, sandbox attributes, submission, reload persistence, and what a second customer must not see |
| `apps.test.mjs` | the /customer/<slug> direct routes: slug rules, reserved and duplicate refusal, draft/disabled/role visibility, the apps dashboard, and that a slug never shadows a real page |

## Manual browser pass

Some things only a real browser can answer. Serve the site with seeded content:

```bash
node tests/media-feedback/serve.mjs 8899 /path/to/gots-scope4-presentation
```

Then check:

- the deck renders with styles, images and animations intact
- `コメントを追加` → clicking an element drops a numbered pin at that spot
- a pin appears only on the slide it belongs to
- 375 px wide: header wraps, drawer stacks under the deck, no sideways scroll

Use obviously fake contact details (`QA FIXTURE - NOT A REAL PERSON`,
`qa-fixture-a@example.invalid`, `+81-00-0000-0000`) and never real customer data. Harness
storage is in memory, so it is gone the moment the process exits.

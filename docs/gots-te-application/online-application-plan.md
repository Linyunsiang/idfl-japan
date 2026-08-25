# IDFL Online Application System — Phase 1 Plan

Companion to [`application-template-field-map.md`](./application-template-field-map.md).
**No application code has been written. Nothing in the master template was modified**
(verified: SHA-256 identical before and after analysis).

---

## 1. Current project architecture assessment

| Question | Finding |
|---|---|
| Frontend framework | **None.** One hand-written HTML file, inline `<style>`, inline `<script>` |
| TypeScript | **None.** ES5-style vanilla JS in an IIFE |
| Styling system | CSS custom properties on `:root`; tokens documented in `idfl-japan-export/DESIGN.md` |
| Component system | **None.** No partials, no includes, no templating |
| Build tooling | **None.** No `package.json`, no bundler, no lockfile, no CI config |
| Backend | **None.** No server code of any kind in the repo |
| Version control | **Not a git repository** |
| Deployment | **Unknown from the repo.** Root-absolute paths (`/IDFL-Logo.png`, `/download.html`) imply deploy at a site root; the referenced pages are not in this folder |
| Server-side document generation possible today? | **No.** There is no server |

**Repo contents in full:**

```
idfl-japan-website/
├─ idfl-japan-export/
│  ├─ index.html                 seminar landing page (redesigned earlier this session)
│  ├─ index.original.html        backup
│  ├─ DESIGN.md                  visual tokens + motion rules
│  └─ templates/
│     └─ GOTS-TE-Application-Form-JP (1).docx     ← the master
├─ docs/                         (created by this analysis)
├─ tools/                        (created by this analysis)
└─ 多產品_原料別認證混率計算器_インプット材料版.html
```

### The one place the "preserve the stack" rule has to bend

The brief says preserve the existing stack unless absolutely necessary. The existing stack is
*a static HTML file with no build step*. A 9-step conditional wizard over ~342 fields with
autosave and live validation is at the edge of what is sane to hand-write in vanilla JS, but it
is not the blocker. **The blocker is PDF.**

| Capability | Achievable with the current static-only stack? |
|---|---|
| Wizard UI, validation, review screen | Yes — vanilla JS, or a small framework |
| Draft autosave | Yes — `localStorage`, no server |
| **Populated DOCX download** | **Yes — fully client-side** (see §7) |
| **PDF from the populated DOCX** | **No.** Requires a converter that runs Word or LibreOffice |

So: **stages 0–8 and the DOCX output need no backend at all.** Only PDF does. That lets us ship
a genuinely useful v1 on the current hosting with zero infrastructure, and treat PDF as a
separately-scoped addition. See §8.

### Framework recommendation

**Keep it dependency-light, but do not hand-roll 342 fields in vanilla JS.**

Recommended: **Vite + TypeScript + Preact** (or Svelte), output = static files, deployed exactly
like today. Rationale:

- TypeScript is worth real money here: `ApplicationData` is the contract shared by the form, the
  validator, the review screen and the DOCX writer. Getting a field name wrong should be a
  compile error, not a silently blank cell in an official document.
- Output is still plain static assets — hosting does not change.
- Preact/Svelte keep the bundle small; no need for Next.js or a React meta-framework.

If you would rather add no build step at all, the fallback is vanilla JS + ES modules with the
field map as a JSON data file. It will work; it will just be slower to change safely.

**Refero / MotionSites / React Bits are not connected in this session and React Bits does not
apply here regardless** — this is an enterprise data-entry flow, not a marketing page. The design
direction is stated in §6.

---

## 2. DOCX template structure assessment

Full detail is in the field map; the decision-relevant summary:

| Finding | Impact |
|---|---|
| 342 Word **Content Controls** (233 text / 85 checkbox / 24 combo) | This is the fill mechanism |
| 0 legacy form fields, 0 merge fields | Rules out most templating libraries |
| Only 21 controls are named, and those names are **duplicated** | Cannot address fields by name |
| All 342 `w:id` values are **unique** | `w:id` is the only viable key — but see the versioning risk in §7 |
| **20 ballot boxes are plain text, not controls** | Includes Initial/Renewal for all 7 standards — a core answer |
| Document is protected `w:edit="forms"` with a password hash | Must be preserved byte-for-byte; also means adding table rows is a deviation |
| Repeating capacity is fixed and small | Facilities **6**; each RDS table **3** |
| Template's own instruction for overflow | 「追加のスペースが必要な場合は、他の文書シート（ExcelまたはWordが望ましい）を使用して」 |
| Checkbox state needs 2 coordinated edits | `w14:checked` **and** the run glyph (`☐`→`☒`), font `MS Gothic` |

**Bottom line: the master is fillable, but only by direct OOXML manipulation.** No off-the-shelf
templating library fits it without modifying the master first — which the brief forbids.

---

## 3. Field map

Delivered: [`docs/application-template-field-map.md`](./application-template-field-map.md).

Supporting artefacts:

| File | Purpose |
|---|---|
| `docs/_generated/control-inventory.tsv` | All 342 controls, one per row — human-diffable across template releases |
| `docs/_generated/control-inventory.json` | Same, for the build step |
| `docs/_generated/template-identity.json` | Doc no., DCN, sha256, counts, protection attrs |
| `tools/extract-controls.py` | Regenerates all of the above. Read-only, stdlib only |

`python tools/extract-controls.py "<master.docx>"` — run this on every new IDFL release and diff
the TSV before touching anything else.

**8 open items (V1–V8) are listed at the end of the field map.** They block coding, not planning.
All are resolvable in one marker-fill pass (fill control *n* with `@@nnn@@`, open in Word, read
off the positions). That pass should be the first task of Phase 2.

---

## 4. Proposed `ApplicationData` schema

One normalized model drives form, validation, review, DOCX and PDF. No separate Word model.

```ts
type YesNo = 'yes' | 'no';
type CertStatus = 'initial' | 'renewal';
type StandardKey = 'ocs' | 'gots' | 'ivnBest' | 'grs' | 'rcs' | 'raf' | 'rds';

interface Party {                      // §1 and §2c share this shape
  companyName: string;
  companyNameEnglish: string;
  address: string;
  city: string;
  country: string;
  contactName: string;
  contactTitle: string;
  phone: string;
  email: string;
}

interface StandardBlock {
  selected: boolean;
  certificationStatus?: CertStatus;    // →  plain-text ☐ pair
  priorCertifications: Partial<Record<StandardKey, boolean>>;
  previousLicenceNo?: string;
  previousCertifier?: string;
  certificationRenewalDate?: string;
}

interface Facility {                   // §5 · master holds 6
  name: string;
  address: string;
  employeeCount: string;
  standards: StandardKey[];            // joined to text on write
  activities: string[];                // joined to text on write
  unitType: 'main' | 'facility' | 'associatedSubcontractor' | 'certifiedSubcontractor';
  previouslyCertified?: YesNo;         // comboBox: exact strings 'Yes' | 'No'
}

interface ApplicationData {
  meta: {
    schemaVersion: string;             // e.g. '1.0.0'
    templateVersion: string;           // e.g. 'GOTS-TE/V7.0-DCN25-013'
    draftId: string;
    savedAt: string;                   // ISO
    locale: 'ja';
  };

  applicant: Party;

  payment: {
    currency: 'USD'|'RMB'|'EURO'|'TWD'|'TRY'|'CHF'|'INR'|'BDT'
            |'JPY'|'PKR'|'KRW'|'IDR'|'VND'|'OTHER';
    currencyOther?: string;
    taxId: string;
    rush: { siteVisit: boolean; certificationDecision: boolean };
    sameAsApplicant: boolean;          // default true
    company: Party;                    // mirrored from applicant when sameAsApplicant
  };

  standards: Record<StandardKey, StandardBlock> & {
    raf: StandardBlock & { subStandards: ('rws' | 'rms' | 'ras')[] };
  };

  products: {
    categories: Record<string, { selected: boolean; detail?: string }>;   // 12 fixed keys
    others: { selected: boolean; name: string; detail?: string }[];       // max 8
  };

  facilitiesMeta: { hasSubcontractors?: YesNo };
  facilities: Facility[];              // UI unlimited, output capped — see §7 overflow

  otherCertifications: Record<
    'oekoTexStep'|'scsRcv'|'bsci'|'sa8000'|'higgFem'|'higgFslm'
    |'higgBrm'|'wrap'|'gscpSocial'|'gscpEnvironmental', YesNo | undefined>;

  chemicalCompliance: {
    usesChemicalsQ1?: YesNo; chemicalCountQ1?: string;
    usesChemicalsQ2?: YesNo; chemicalCountQ2?: string;   // ⚠ V5: confirm Q1/Q2 scope
  };

  certifications: { refusedBefore?: YesNo; refusedDetail?: string; additionalNotes?: string };

  recycling: {                         // §8 · GRS/RCS recyclers only
    materialType?: 'none' | 'postConsumer' | 'preConsumer' | 'both';
    vr2Sites?: string;
    inputWasteDescription?: string;
    collectorCount?: string;
    collectorLocations?: string;
    collectorActivities?: string;
  };

  rds: {                               // §§9–12 · master holds 3 rows each
    slaughterhouses: RdsSlaughterhouse[];
    farmGroups: RdsFarmGroup[];
    individualFarms: RdsIndividualFarm[];
    farmAreas: RdsFarmArea[];
  };

  declaration: {
    companyName: string;
    signatoryNameTitle: string;
    date: string;
    representative?: { companyName?: string; contactName?: string; email?: string };
    // signature + seal are physical. Never populated.
  };
}
```

**Rule: the schema stores answers, never Word coordinates.** All `w:id` knowledge lives in the
separate mapping file (§7).

---

## 5. Conditional question logic / validation matrix

| Trigger | Effect |
|---|---|
| `payment.currency === 'OTHER'` | show + require `payment.currencyOther` |
| `payment.sameAsApplicant === true` | hide §2c; mirror `applicant` → `payment.company` on write |
| `payment.sameAsApplicant` false → true | keep the typed values in the draft, just stop using them (don't destroy input) |
| `standards.X.selected` | show X's status / prior-cert / licence block |
| `standards.X.selected` **and** any `priorCertifications` true | require `previousLicenceNo` + `previousCertifier` |
| any standard selected | require `certificationStatus` for **each** selected standard |
| `standards.raf.selected` | require ≥1 of `subStandards` (RWS / RMS / RAS) |
| `standards.gots.selected && standards.ocs.priorCertifications.gots` | ⚠ warn: IDFL cannot issue unless transferring to IDFL |
| `standards.ocs.selected && priorCertifications.gots` | ⚠ same warning, mirrored |
| `standards.grs.selected` ↔ `rcs` prior | ⚠ same warning pair |
| `products.categories[k].selected` | show + require `detail` for that category |
| `products.others[i].selected` | require `name`; `detail` optional |
| `facilities.length === 0` | error — at least the applicant's own facility is required |
| `facilities.length > 6` | ⚠ overflow — see §7 |
| `standards.grs.selected \|\| standards.rcs.selected` | show §8 recycling block |
| `recycling.materialType !== 'none'` | require `inputWasteDescription` |
| `standards.rds.selected` | show §§9–12 selector |
| RDS scope includes slaughterhouse / farm group / individual farm / farm area | show only the matching section(s) of 9–12 |
| any `rds.*` array `.length > 3` | ⚠ overflow |
| `chemicalCompliance.usesChemicalsQ1 === 'yes'` | require `chemicalCountQ1` (same for Q2) |
| `certifications.refusedBefore === 'yes'` | require `refusedDetail` |
| always | `declaration.signatoryNameTitle`, `declaration.date` required |

**Validation timing (from the brief): never defer to the last page.** Validate a field on blur,
a step on "next", and keep a live per-section completion count feeding the progress indicator.
"Application completion: 72%" = required-fields-filled ÷ required-fields-applicable, where
*applicable* is recomputed from the conditions above.

---

## 6. Proposed screen flow

Design direction — enterprise, functional, deliberately unlike the marketing site:

- **Style:** enterprise / technical. Dense but calm. No hero imagery, no scroll animation.
- **Palette:** reuse `DESIGN.md` tokens — IDFL blue `#1255A0` for progress and primary actions
  only; grey scale for everything else; amber for warnings; red reserved for blocking errors.
- **Type:** same Zen Kaku Gothic New / Space Mono pairing, one step down in scale.
- **Layout:** left rail = step list + per-step completion; right = one step, single column,
  max ~72ch. Repeating entities are cards, never Word-style tables.
- **Motion:** step transition (150 ms fade) and expand/collapse of conditional blocks only.
  Nothing else. All under `prefers-reduced-motion`.

| Step | Screen | Writes to | Master section |
|---|---|---|---|
| 0 | Start — standards, initial/renewal, existing-cert & transfer status | `standards.*` | §3 (drives everything) |
| 1 | Applicant information | `applicant` | §1 |
| 2 | Payment — currency, tax ID, rush, `同申請者` default ON | `payment` | §2 |
| 3 | Certification standards — per-standard detail for step-0 picks only | `standards.*` | §3 |
| 4 | Products — 12 category cards + `その他` rows; detail appears on select | `products` | §4 |
| 5 | Facilities — cards, `+ Add` / `Duplicate` / `Remove` | `facilities` | §5 |
| 6 | Certification info — other certs, chemicals, refusal history | `otherCertifications`, `chemicalCompliance`, `certifications` | §6 |
| 7 | Standard-specific — recycling (GRS/RCS) and/or RDS 9–12, only when applicable | `recycling`, `rds` | §§8–12 |
| 8 | Review — completed / missing / warnings, each item deep-links to the field | — | all |
| 9 | Generate — `Download Word (.docx)` · `Download PDF (.pdf)` | — | — |

Step 0 is the whole trick: it decides which of steps 3–7 exist at all. An applicant doing
GOTS-renewal-only should never see a single RDS or recycling question.

**Step 9 must state plainly** that the generated file is an *unsigned* application requiring
signature and company seal (§7 of the master has no signature control — it is wet-ink by design).

---

## 7. Recommended document generation approach

### Rejected options and why

| Approach | Verdict |
|---|---|
| `docxtemplater` | Needs `{placeholder}` tags inserted into the master → **modifies the master.** Rejected |
| `docx` (npm) | Builds documents from scratch → cannot preserve the master. Rejected |
| `docx-templates` | Same tag-injection requirement. Rejected |
| `python-docx` | Weak content-control support; rewrites parts it does not understand. Rejected |
| HTML → PDF lookalike | Explicitly forbidden by the brief, and correctly so. Rejected |

### Recommended: direct OOXML patching

```
master.docx (read-only, never mutated)
   │  unzip in memory
   ▼
word/document.xml  ──patch only the runs inside targeted w:sdt elements──►  patched XML
   │  every other part copied through byte-for-byte
   ▼
generated.docx  ──►  PDF (§8)
```

Three write routines, one per control type:

| Type | Operation |
|---|---|
| `TEXT` | replace the text of the single `w:t` inside `w:sdtContent`; drop `w:showingPlcHdr`; keep the run's `w:rPr` untouched |
| `CHK` | set `w14:checked/@w14:val` to `1`, **and** set the run text to `☒` (`MS Gothic` preserved) |
| `COMBO` | write the exact `displayText` (`Yes`/`No`, or `YES`/`NO` — the two sets differ); drop `w:showingPlcHdr` |

Plus one special routine for the **20 plain-text `☐`** (§0.1 of the field map): locate the run by
document position from the mapping file and swap the single character. Never a global replace —
`☐` is also the unchecked glyph of the 85 real checkboxes.

**Hard rules for the writer:**

1. Never touch `word/settings.xml` — `documentProtection` (hash + salt) must survive intact.
2. Never add, remove or reorder `w:tbl`, `w:tr`, `w:tc`, `w:sectPr`, headers, footers or styles.
3. Never alter `w:rPr` on a run being filled — fonts and sizes are the template's.
4. Re-zip preserving the original entry order and `[Content_Types].xml` untouched.
5. After generation, assert: same part list, same part count, and only `word/document.xml` differs.

Where it runs: **the browser** (JSZip + `DOMParser`/`XMLSerializer`) for v1 — no backend, no
upload, application data never leaves the user's machine. The identical code can run server-side
later if you want the PDF path to be one round trip.

### Overflow — needs your decision

Master capacity is 6 facilities and 3 rows per RDS table. Three options:

| Option | Behaviour | Fidelity |
|---|---|---|
| **A (recommended)** | Fill the 6/3 rows; emit remaining entries into a **separate appendix file** (`.xlsx` or a plain `.docx`), exactly as the template's own instruction directs | Master untouched. Matches IDFL's documented process |
| B | Clone table rows to fit N entries | Master structure changed; contradicts `edit="forms"`; row cloning must replicate `w:tcPr` widths exactly or column widths shift |
| C | Hard-cap the UI at 6/3 | Simplest, but the brief explicitly asks for unlimited `+ Add another` |

**A is the only option that satisfies "do not change the document structure" while still
accepting more than 6 facilities.** Please confirm before Phase 3.

### Template versioning

```
templates/
└─ GOTS-TE/
   └─ V7.0-DCN25-013/
      ├─ master.docx
      ├─ mapping.json        fieldId → { controlId, kind, comboValues? }
      └─ identity.json       sha256 + expected control counts
```

- `mapping.json` is data, **not** business logic. The generator takes
  `(ApplicationData, templateVersion)` and never hard-codes a `w:id`.
- On startup the generator verifies the master's sha256 against `identity.json`. **Mismatch =
  refuse to generate**, loudly. A silently-renumbered control writing a company name into a
  chemical-count cell is exactly the failure mode this guards against.
- New IDFL release → new folder + `tools/extract-controls.py` diff + new `mapping.json`. Old
  versions stay so in-flight drafts keep generating against the template they started on
  (`meta.templateVersion`).

### Draft saving — no database

| Mechanism | Role |
|---|---|
| `localStorage`, debounced ~1 s | Primary autosave. Survives refresh and accidental close |
| "Save draft file" → `.json` download | Portable backup; lets a user move machines or email a colleague |
| "Load draft file" → upload `.json` | Restore. Validate `meta.schemaVersion` on load |

No database, no accounts, no server storage in v1. If IDFL later wants staff-side visibility,
that is a deliberate later phase — and it changes the privacy analysis completely (§9).

---

## 8. Recommended PDF conversion method

The PDF must come from the populated DOCX, not from HTML. That means a real converter.

| Option | Fidelity | Infra | Note |
|---|---|---|---|
| **Microsoft Graph** `GET /drive/items/{id}/content?format=pdf` | **Highest** — Word's own engine | Uses your existing Microsoft 365 tenant | **Recommended.** You already run M365 (the seminar page submits to `forms.office.com`) |
| LibreOffice headless (`soffice --convert-to pdf`) | Good, not perfect | A container / VM you run | Needs **MS Gothic or a metric-compatible JP font installed**, or the `☒` glyphs and Japanese text will shift |
| Word automation on a Windows host | Highest | A Windows box + licence | Fragile to automate; not recommended |
| Client-side DOCX→PDF | — | — | Does not exist at acceptable fidelity. Do not attempt |
| **Defer: ship DOCX only in v1** | N/A | **Zero** | User opens in Word → Save as PDF. Honest, costs nothing, unblocks everything else |

**Recommendation: ship v1 DOCX-only, add Graph-based PDF in a later phase.** That keeps v1 fully
static and zero-infrastructure, and when PDF arrives it arrives at Word-grade fidelity rather
than LibreOffice's approximation of a protected Japanese form.

Whichever path: **a fidelity acceptance test is mandatory** — generate a fully-populated document,
convert, and compare page-by-page against Word's own PDF export. Check specifically: page count
stays 5, header/footer intact, `☒` renders (not tofu), table column widths unchanged, no reflow
in the §5 and §9–12 tables.

---

## 9. Security & privacy considerations

The data is business-confidential and contains personal data (担当者名, email, phone) — Japan's
個人情報保護法 (APPI) applies.

| Area | Position |
|---|---|
| **Data location (v1)** | Everything stays in the browser. No upload, no server, no DB. This is the single strongest privacy property of the client-side design — keep it as long as possible |
| **`localStorage` risk** | Drafts persist on shared/kiosk machines. Mitigate: visible "この端末に下書きを保存しています" notice, a "Clear draft" button, and auto-expiry (e.g. 30 days) |
| **When PDF conversion arrives** | Data crosses the network. Requirements: TLS only; process in memory; **never write the DOCX to disk**; no request-body logging; delete immediately after response; document the retention as zero |
| **Microsoft Graph path** | Data lands in your own M365 tenant — acceptable, but it *is* storage. Use a dedicated drive folder, delete the temp item in a `finally` block, and confirm the tenant's retention/eDiscovery policy does not silently keep copies |
| **Transport of the finished application** | Out of scope for v1 (user downloads and sends it themselves). If you later add "submit to IDFL", that is a new privacy surface needing its own review |
| **Signature integrity** | The system must **never** auto-fill signature or seal. Generating a document that appears signed would be document fraud. §7 of the master is wet-ink by design — keep it that way |
| **Tax ID** | Treat as sensitive; do not include it in any telemetry, error report or analytics event |
| **No analytics on form content** | If you add analytics, restrict to step-level events (`step_3_completed`), never field values |
| **Dependency surface** | Only JSZip is strictly needed for generation. Pin versions, use SRI if loaded from a CDN. Note the site's Japan-CDN issues already recorded in your environment — prefer self-hosting the dependency |
| **Rate limiting** | Only relevant once a conversion endpoint exists; add it then |

---

## 10. Implementation plan — small phases

Each phase is independently reviewable and independently shippable.

| Phase | Scope | Output | Depends on |
|---|---|---|---|
| **2. Resolve the unknowns** | Marker-fill pass (`@@001@@`…`@@342@@`) → open in Word → resolve V1–V6. Confirm the master filename (V8) | Completed field map, zero `⚠` rows | Your go-ahead |
| **3. Decisions** | You decide: overflow policy (A/B/C), PDF path, framework, deployment target | Written decisions in this doc | Phase 2 |
| **4. Mapping + generator core** | `mapping.json` for V7.0-DCN25-013; the three write routines + the plain-`☐` routine; sha256 guard | A CLI that turns a JSON fixture into a populated DOCX | Phase 3 |
| **5. Generator acceptance** | Golden-file tests: full-fill, empty-fill, every-standard, RDS-only. Assert part list unchanged, only `document.xml` differs, page count 5. **Open every output in Word** | Signed-off generator | Phase 4 |
| **6. Schema + validation engine** | `ApplicationData` types, the §5 condition table as data, completion-percentage calculation. Headless, unit-tested | Validated model, no UI | Phase 3 (parallel with 4–5) |
| **7. Wizard UI — steps 0–2** | Shell, left rail, progress, autosave, applicant + payment incl. `同申請者` | Clickable partial flow | Phase 6 |
| **8. Wizard UI — steps 3–7** | Standards, products, facility cards, certification info, conditional standard-specific sections | Full data entry | Phase 7 |
| **9. Review screen** | Completed / missing / warnings, deep-link to field | Step 8 | Phase 8 |
| **10. Wire up download** | Step 9 → generator → `.docx`; unsigned-document notice | **v1 shippable** | Phases 5 + 9 |
| **11. PDF** | Chosen converter + fidelity acceptance test | `.pdf` button | Phase 10 + a decision in Phase 3 |
| **12. Template versioning drill** | Rehearse a V7.1 intake: run the extractor, diff, add a new version folder | Proven upgrade path | Phase 10 |

**Suggested v1 cut line: end of Phase 10** — full wizard, official DOCX output, no backend, no
database, no PDF. Everything after that is additive.

# GOTS / Textile Exchange application — QA tooling

Automated verification for the online application at `/application/gots-te/`.

Everything here is **development / test only**. None of it is needed to serve the site, and
nothing here is loaded by the application at runtime.

Run every command **from the repository root**.

## Requirements

- Node 18+ (ES modules, no dependencies)
- Python 3.9+ (standard library only — `zipfile`, `xml.etree`)

## The master template

The generator reads the official master **read-only** from:

```
files/GOTS-TE-Application-Form-JP.docx     sha256 6593c44681a7141140a52bf8b0eebac33b506e0d53e1f6431d8cf1e127fc7796
```

This is the same file the site publishes for download. It is **never modified**. Before any edit
the generator hashes it and compares against `mapping.json`; a mismatch aborts generation loudly
rather than writing a document against an unknown field layout.

## Running the suite

```bash
node   tools/gots-te-qa/generate-test-docs.mjs   # writes generated/  (gitignored)
python tools/gots-te-qa/verify-generated.py      # independent package + control checks
python tools/gots-te-qa/audit-full.py            # positional assertions, FULL fixture
python tools/gots-te-qa/audit-conditional.py     # conditional sections, scenarios C/D/E
python tools/gots-te-qa/audit-max.py             # positional assertions, MAX + MAXINIT
python tools/gots-te-qa/audit-variants.py        # every option of every single-select question
python tools/gots-te-qa/coverage-report.py       # mapping reachability sweep
```

All seven exit `0` when the system is healthy. `generated/` is gitignored and fully
reproducible from the first command.

| Tool | What it proves |
|---|---|
| `generate-test-docs.mjs` | Generates every fixture; asserts only `word/document.xml` changed, `settings.xml` byte-identical (document protection intact), no package entry added or removed, and the master's sha256 is unchanged afterwards |
| `verify-generated.py` | Re-checks each output with a **different** zip reader and XML parser, so the generator cannot mark its own homework |
| `audit-full.py` / `audit-conditional.py` / `audit-max.py` | Positional assertions: each names the official table / row / cell. They never read `mapping.json` or control ids, so a value written into the wrong official cell fails even when the generator believes it succeeded |
| `audit-variants.py` | One document per option of each mutually-exclusive question (14 currencies, 4 recycled-material types, every yes/no pair). One application can only answer each question once, so no single fixture can cover these |
| `coverage-report.py` | Sweeps all 342 controls and 20 ballots and reports anything the fixture suite never reaches |

Current state: **307/307 mapped controls and 20/20 ballots exercised, zero mapping mismatch.**

## Fixtures

`fixtures.mjs` — all test data is prefixed `TEST COMPANY - DO NOT USE` so a generated file can
never be mistaken for a real application.

| Fixture | Purpose |
|---|---|
| `A`–`F` | Single-standard and multi-facility scenarios |
| `FULL` | Broad population (OCS + GOTS + GRS + RAF) |
| `MAX` | All 7 standards, **renewal**, every prior-CB box, all 3 RAF sub-standards, all 4 RDS sections at their 3-row capacity |
| `MAXINIT` | Same population, all 7 standards **initial** with no prior-CB — proves the initial ballots and that selecting a standard does not tick its prior-CB boxes |
| `OVERFLOW` | 7 facilities against a 6-row master. **Must be refused** for the suite to pass |

## Overflow policy

**Current policy: refuse generation when official template capacity is exceeded. Never silently
truncate data.**

Capacity is 6 facilities, 8 「その他」 product rows and 3 rows in each RDS table. Exceeding any of
them raises `OverflowError` naming the section, the capacity and the overflow count, and no file
is produced. Appendix generation (option A) is not implemented yet.

## Known IDFL master-template issue

**Section 10 · 水鳥の種類/種 · controls #272 / #281 / #290** — the comboBox contains `YES` / `NO`
options even though the field is for a waterfowl species. This is a defect in the official
master. **The master is not modified to fix it.** Because these are `w:comboBox` rather than
`w:dropDownList`, Word accepts a typed value, so the generator writes the species name verbatim
and it renders correctly.

## Regenerating the mapping (new IDFL template release)

```bash
python tools/gots-te-qa/extract-controls.py "files/GOTS-TE-Application-Form-JP.docx"
node   tools/gots-te-qa/build-mapping.mjs
```

Diff `docs/gots-te-application/_generated/control-inventory.tsv` before touching anything else,
and add a new `application/gots-te/templates/<version>/` folder rather than editing the existing
one, so drafts in flight keep generating against the template they started on.

## Not included

PDF generation. The application produces an **unsigned** `.docx` only; signature and company seal
are wet-ink by design and are never auto-filled.

# DOCX Generation Strategy — Phase 3A

Decided **before** implementation, from direct inspection of the OOXML package.
Master: `IDFLAS-FF-GEN-4100-JP(JP)` · Ref `IDFL-FF-MS01 EN V7.0` · DCN `25-013`
SHA-256 `6593c44681a7141140a52bf8b0eebac33b506e0d53e1f6431d8cf1e127fc7796`

---

## 1. Package investigation results

### 1.1 ZIP package

40 entries. No ZIP64, no data descriptors, no archive comment.
38 entries DEFLATE, **2 entries STORE** (`word/media/image1.png`, `word/media/image2.png` — the IDFL logo and a second image).

### 1.2 Where the controls live

| Part | `w:sdt` count |
|---|---|
| `word/document.xml` | **342** |
| `word/header1.xml` | 0 |
| `word/footer1.xml` | 0 |
| `word/footnotes.xml` | 0 |
| `word/endnotes.xml` | 0 |
| `word/glossary/document.xml` | 0 |

**Only one part is ever modified: `word/document.xml`.** Headers, footers, styles, numbering,
theme, settings, media and all relationships are untouched by construction.

> The glossary part holds 514 `w:docPart` entries — the placeholder definitions the controls
> reference (`<w:placeholder><w:docPart w:val="…"/></w:placeholder>`). It is **not** modified.

### 1.3 Content-control shapes — verified uniform

Every one of the 342 `w:sdtContent` elements contains **exactly one `w:r` and exactly one `w:t`**:

| Shape | Count |
|---|---|
| TEXT, content = `w:tc` (cell-wrapping), 1 p / 1 r / 1 t | 186 |
| CHK, content = `w:r`, 1 r / 1 t | 83 |
| TEXT, content = `w:sdt` (nested duplicate), 1 r / 1 t | 27 |
| COMBO, content = `w:p`, 1 r / 1 t | 21 |
| TEXT, content = `w:r` | 10 |
| TEXT, content = `w:sdt` (nested, no p) | 8 |
| COMBO, content = `w:tc` | 3 |
| CHK, content = `w:tc` | 2 |
| TEXT, content = `w:p` | 2 |

**Consequence:** no control has its value split across multiple `w:t` nodes. Population is always
"replace the text of the single `w:t` inside this control". No run merging, no run deletion.

### 1.4 Placeholder state — must be cleared when populating

| Property | TEXT | COMBO | CHK |
|---|---|---|---|
| `<w:showingPlcHdr/>` in `sdtPr` | 157 of 233 | 24 of 24 | 0 |
| `<w:rStyle w:val="PlaceholderText"/>` on the content run | **233 of 233** | **24 of 24** | 0 |

Leaving `PlaceholderText` in place would render the applicant's data in the **grey placeholder
style**. Leaving `showingPlcHdr` would keep Word treating the content as a placeholder.
Both must be removed for a populated control — this is exactly what Word itself does when a user
types into a content control.

Exact XML of a text control before population:

```xml
<w:sdt><w:sdtPr>
    <w:rPr>…real formatting…</w:rPr>
    <w:id w:val="1449190965"/>
    <w:placeholder><w:docPart w:val="B17EB863…"/></w:placeholder>
    <w:showingPlcHdr/>
  </w:sdtPr><w:sdtEndPr/>
  <w:sdtContent><w:tc>…<w:p>…
      <w:r><w:rPr><w:rStyle w:val="PlaceholderText"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
        <w:t>Click here to enter text.</w:t></w:r>
  </w:p></w:tc></w:sdtContent></w:sdt>
```

Three edits populate it: drop `<w:showingPlcHdr/>`, drop `<w:rStyle …/>`, replace the `w:t` text.
Everything else — `tcPr`, shading `F2F2F2`, `vAlign`, `pPr`, `sz`, `rsid` attributes — is byte-preserved.

### 1.5 Checkbox structure

```xml
<w14:checkbox>
  <w14:checked w14:val="0"/>
  <w14:checkedState   w14:val="2612" w14:font="MS Gothic"/>   <!-- ☒ -->
  <w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>   <!-- ☐ -->
</w14:checkbox>
…
<w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" …/>…</w:rPr><w:t>☐</w:t></w:r></w:sdtContent>
```

Checking requires **two coordinated edits**: `w14:checked/@w14:val` → `1`, and the `w:t` glyph
→ `☒`. Setting only the attribute leaves Word displaying `☐`; setting only the glyph leaves the
control's logical state unchecked. The `MS Gothic` run font is preserved untouched.

### 1.6 The 20 plain-text ballot boxes — resolved

Each is its **own isolated `w:t` whose entire content is the single character `☐`**, in its own
run, outside any content control. Population is therefore a clean whole-node replacement — no
substring surgery inside a longer string, and no risk of hitting the 85 real checkboxes (whose
`☐` lives inside an `sdt`).

Document-order ordinals, verified against their table rows:

| Ordinal | Location | Meaning |
|---|---|---|
| 1, 2 | tbl3 row21 | OCS — Initial / Renewal |
| 3, 4 | tbl3 row26 | GOTS — Initial / Renewal |
| 5, 6 | tbl3 row31 | IVN BEST — Initial / Renewal |
| 7, 8 | tbl3 row36 | GRS — Initial / Renewal |
| 9, 10 | tbl3 row41 | RCS — Initial / Renewal |
| 11, 12 | tbl3 row46 | RAF — Initial / Renewal |
| 13, 14 | tbl3 row50 | RDS — Initial / Renewal |
| 15, 16 | tbl4 row28 | §5 下請け施設 — はい / いいえ |
| 17–20 | tbl8 row2 | §8 リサイクル材料なし / 使用後 / 使用前 / 両方 |

### 1.7 Document protection

`<w:documentProtection w:edit="forms" w:enforcement="1" cryptProviderType="rsaAES" … hash … salt …>`
lives in `word/settings.xml`, which **is never touched**, so protection survives byte-identically.

### 1.8 Combo value sets

Two distinct sets exist; the writer must use the one belonging to the specific control:

| Items | Count |
|---|---|
| `Certified Previous (Y/N)` / `Yes` / `No` | 21 |
| `Choose an item.` / `YES` / `NO` | 3 |

These are `w:comboBox` (not `w:dropDownList`), so Word permits typed values outside the list.
See §6 for the one place this matters.

---

## 2. Chosen method — targeted OOXML edit, no library

**Rejected**, per the phase rules and the Phase 1 evaluation:

| Option | Why rejected |
|---|---|
| `docxtemplater`, `docx-templates` | Require `{placeholder}` tags injected into the master |
| `docx` (npm) | Builds documents from scratch |
| `python-docx` | Rewrites parts it does not model; weak content-control support |
| Any HTML/CSS reconstruction | Forbidden, and correctly so |

**Chosen:**

```
master.docx (read-only, never opened for writing)
   │  read bytes, verify SHA-256 against template-identity.json
   ▼
parse ZIP central directory
   │  every entry EXCEPT word/document.xml is copied as RAW COMPRESSED BYTES
   │  (no inflate, no re-deflate — those entries are bit-identical in the output)
   ▼
word/document.xml  →  inflate to text
   │  offset-based XML scan (no DOM, no reserialization)
   │  apply N surgical string splices, right-to-left
   │  re-parse to confirm well-formedness + expected values
   ▼
re-deflate ONLY word/document.xml → rebuild ZIP → generated.docx
```

Two properties this buys:

1. **39 of 40 package entries are bit-identical to the master**, including both PNGs, all
   relationships, styles, numbering, theme, settings (protection), headers and footers.
2. Inside `document.xml`, every byte outside the spliced ranges is preserved — attribute order,
   `rsid` values, whitespace, self-closing forms, namespace declarations. A DOM round-trip would
   silently normalise all of these.

No third-party dependency. ZIP inflate/deflate uses the platform's native
`DecompressionStream('deflate-raw')` / `CompressionStream('deflate-raw')`, available in both the
browser and Node 24. CRC-32 is computed locally for the one rewritten entry.

---

## 3. Mapping layer

Word control identity never appears in UI or business-logic code.

```
ApplicationData  →  templates/<version>/mapping.json  →  w:id  →  OOXML splice
```

`mapping.json` is **generated** by `tools/build-mapping.mjs` from `js/schema.js` (which already
carries `controls:` references) plus `docs/_generated/control-inventory.json`, so a new IDFL
release is handled by re-running the extractor and the builder, not by editing application code.

The mapping declares, per template version: master path, expected SHA-256, expected control count,
row capacities, and four edit tables (`text`, `checkbox`, `combo`, `ballot`) plus repeating-row
blocks.

---

## 4. Population rules

| Kind | Edits |
|---|---|
| TEXT | remove `showingPlcHdr` · remove `rStyle PlaceholderText` · replace `w:t` text |
| COMBO | identical to TEXT; value must be an exact `displayText` of that control's own list |
| CHK — checked | `w14:checked/@w14:val` → `1` · `w:t` → `☒` |
| CHK — unchecked | **no edit** (master default is already `0` / `☐`) |
| BALLOT — chosen | `w:t` → `☒` |
| BALLOT — not chosen | **no edit** |

Text handling: XML-escape `& < >`; add `xml:space="preserve"` when the value has leading/trailing
whitespace; render embedded newlines as `</w:t><w:br/><w:t>` **inside the same run**, so paragraph
and cell formatting are untouched. Japanese, English, digits, dates and punctuation are written as
UTF-8 text with no transformation.

**Fields with no value are not edited at all.** They keep the master's original placeholder state —
which is exactly what an applicant filling the form in Word and skipping an optional field produces.
This is the "original blank state" required by the phase rules. See §7 risk R3.

---

## 5. Conditional sections are never removed

Nothing is deleted from the generated document. If a section is not applicable — RDS when RDS was
not selected, recycling when neither GRS nor RCS was selected — its controls simply receive no
edit and remain in their original unchecked/placeholder state. The generated file always has the
same 5-page structure, the same tables and the same section count as the master.

---

## 6. Known IDFL master-template issue — §10 水鳥の種類/種

> **Section 10 · 水鳥の種類/種 · controls #272 / #281 / #290**
> The comboBox contains **YES / NO** options even though the field is for a waterfowl species.
> This is a defect in the official master. **The master template is not modified to fix it.**
> Because these are `w:comboBox` (not `w:dropDownList`), Word accepts a typed value, so the
> generator writes the species name verbatim and it renders correctly. Worth reporting to IDFL.

In Section 10 (農場グループ), the *水鳥の種類/種* column is a **comboBox whose list items are
`YES` / `NO`** (controls #272, #281, #290). A species name is clearly intended by the column header.
Because these are `w:comboBox` and not `w:dropDownList`, Word accepts a typed value, so the
generator writes the species text. **This is a defect in the master worth reporting to IDFL.**
Recorded here and in `docs/ui-to-template-transformations.md`.

---

## 7. Risks requiring human review in Word

| # | Risk | Mitigation |
|---|---|---|
| R1 | Long values could reflow a fixed-width table cell and push the document past 5 pages | Automated page-count check is not possible from XML — **manual Word review required** |
| R2 | Removing `PlaceholderText` relies on Word inheriting fonts from the paragraph/style, exactly as it does for hand-typed input | Verified against the master's own structure; confirm visually |
| R3 | Untouched optional fields still read "Click here to enter text." | Matches current hand-filled practice; confirm this is acceptable to IDFL |
| R4 | Overflow beyond 6 facilities / 3 RDS rows | Generation is **blocked**, not truncated — see §8 |

---

## 8. Overflow policy

The master physically holds 6 facility rows, 8 「その他」 product rows and 3 rows in each RDS table.

**Current policy: refuse generation when official template capacity is exceeded. Never silently truncate data.**

The generator **refuses to generate** when the application exceeds any capacity, and returns a
structured overflow report naming the section, the capacity and the overflow count. It does not
truncate, and it does not add table rows to the protected layout. No partial file is produced.
This satisfies "do not generate a misleading complete application" and leaves option A/B/C (V7)
open for decision without having baked one in. Regression-tested by the `OVERFLOW` fixture,
which must be refused for the suite to pass.

---

## 9. Template version protection

Before any edit, the generator hashes the loaded master and compares it with
`mapping.json.master.sha256` (sourced from `docs/_generated/template-identity.json`). It also
re-counts the controls found in `document.xml` and compares with the expected 342. Either mismatch
aborts with:

> Unsupported or updated IDFL application template detected. Field mapping must be reviewed.

No partial file is produced.

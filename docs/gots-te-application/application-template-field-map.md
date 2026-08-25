# Application Template Field Map

**Master template:** `idfl-japan-export/templates/GOTS-TE-Application-Form-JP (1).docx`
**Document no.:** `IDFLAS-FF-GEN-4100-JP(JP)`
**Ref:** `IDFL-FF-MS01 EN V7.0` · **DCN:** `25-013`
**Scope banner:** Textile Exchange | GOTS | IVN · 5 pages
**SHA-256:** `6593c44681a7141140a52bf8b0eebac33b506e0d53e1f6431d8cf1e127fc7796`
**Analysed:** 2026-08-24 · read-only, template not modified

> This map is **generated + curated**. The machine-readable inventory of all 342 controls is
> `docs/_generated/control-inventory.tsv` (regenerate with `tools/extract-controls.py`).
> `#N` below is the control's document-order index in that file; each row there also carries the
> Word `w:id`, table/row/column, and the surrounding label text.

---

## 0. How this template stores its answers — read this before choosing a library

| Fact | Value | Consequence |
|---|---|---|
| Fill mechanism | **Word Content Controls** (`w:sdt`) — 342 of them | Fill via content controls, not text search/replace |
| Legacy form fields | **0** (`FORMTEXT` / `FORMCHECKBOX`) | Legacy-formfield libraries are useless here |
| Mail-merge fields | **0** (`MERGEFIELD`) | Mail-merge tooling is useless here |
| Control types | 233 `w:text` · 85 `w14:checkbox` · 24 `w:comboBox` | Three fill routines needed |
| Named controls | **21 of 342** carry `w:alias`/`w:tag` | Names are NOT usable as keys |
| …and those names are | `Certified Previous (Y/N)` ×18, `Parent Farm (Y/N)` ×3 | Duplicated — not unique either |
| `w:id` | 342 values, **all unique**, range ±2.1e9 | Only viable machine key today |
| Control locking | `w:lock` set on **0** controls | Controls are freely writable |
| Document protection | **`<w:documentProtection w:edit="forms" w:enforcement="1">`** with password hash | See §0.2 |
| Plain-text `☐` glyphs | **20**, outside any control | See §0.1 — these are NOT fillable |

### 0.1 The 20 unfillable checkboxes

Twenty ballot boxes are literal `☐` characters in ordinary text runs, not content controls.
Setting them means editing a character inside a run — a different, riskier operation than
setting a content control, and it must be targeted by run, not by global replace
(`☐` also appears as the *unchecked glyph* of the 85 real checkboxes).

| Where | Count | Content |
|---|---|---|
| §3, every standard block | 14 | `☐ Initial Certification 初期認証` / `☐ Renewal Certification 更新認証` (7 standards × 2) |
| §5 instructions row | 2 | 下請け施設がありますか？ `☐ はい` / `☐ いいえ` |
| §8 recycled-material row | 4 | `☐ リサイクル材料なし` / `☐ はい、使用後材料` / `☐ はい、使用前材料` / `☐ はい、使用済み材料、使用前材料の両方` |

**This is the single biggest implementation risk in the template.** Initial vs Renewal is a
core answer of the whole application and it is not machine-fillable by the normal route.

### 0.2 Document protection

The master is protected with `w:edit="forms"` and a password hash. Notes:

- Protection is enforced by the Word **UI**, not by the file format — a library can still write
  content controls into the XML, and the output opens correctly.
- The `documentProtection` element (hash + salt) **must be copied through verbatim**. A library
  that rewrites `settings.xml` and drops it silently downgrades the official document.
- Any operation Word itself would refuse under `edit="forms"` — notably **adding table rows** —
  is a structural deviation. See §5 and §9–12.

### 0.3 Checkbox internals

```xml
<w14:checkbox>
  <w14:checked w14:val="0"/>
  <w14:checkedState   w14:val="2612" w14:font="MS Gothic"/>   <!-- ☒ -->
  <w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>   <!-- ☐ -->
</w14:checkbox>
```

Checking a box requires **two** edits: set `w14:checked/@w14:val` to `1` **and** replace the run
text with `☒`. Writing only one of the two produces a document that looks wrong in Word or
prints wrong. `MS Gothic` must be preserved on the run.

---

## Section 1 — 申請者の情報 (Applicant)

Table 2, rows 2–10. All `w:text`. All always visible. Controls **#1–#9**.

| # | Official field | Internal ID | Type | Required | Validation |
|---|---|---|---|---|---|
| 1 | 会社名 | `applicant.companyName` | text | ✔ | 1–200 chars |
| 2 | 会社名(英語表記) | `applicant.companyNameEnglish` | text | ✔ | Latin chars recommended (warn, don't block) |
| 3 | 住所 | `applicant.address` | text | ✔ | |
| 4 | 市 | `applicant.city` | text | ✔ | |
| 5 | 国 | `applicant.country` | text (UI: searchable select) | ✔ | ISO-3166 list, **write the display name**, not the code |
| 6 | ご担当者名 | `applicant.contactName` | text | ✔ | |
| 7 | 役職 | `applicant.contactTitle` | text | ✔ | |
| 8 | 電話番号 | `applicant.phone` | text | ✔ | permissive; keep `+`, spaces, hyphens |
| 9 | メールアドレス | `applicant.email` | text | ✔ | RFC-ish email |

---

## Section 2 — 支払情報 (Payment)

Table 3, rows 2–17. Controls **#10–#37**.

### 2a. 支払いの通貨 — checkboxes #10–#23

Rendered as 14 separate checkboxes but semantically **one choice**.

| # | Currency | # | Currency |
|---|---|---|---|
| 10 | USD | 17 | BDT |
| 11 | RMB | 18 | JPY |
| 12 | EURO | 19 | PKR |
| 13 | TWD | 20 | KRW |
| 14 | TRY | 21 | IDR |
| 15 | CHF | 22 | VND |
| 16 | INR | 23 | OTHER |

- `payment.currency` : enum of the 14 · required · UI = single-select (radio/segmented), **not** 14 checkboxes
- `payment.currencyOther` (**#24**, text) : required **iff** `payment.currency === "OTHER"`

### 2b. Other payment fields

| # | Official field | Internal ID | Type | Condition |
|---|---|---|---|---|
| 25 | Tax ID # | `payment.taxId` | text | always |
| 26 | ラッシュ 現場訪問 / 評価（7営業日以内） | `payment.rush.siteVisit` | boolean | always |
| 27 | ラッシュ認証決定（3営業日以内） | `payment.rush.certificationDecision` | boolean | always |
| 28 | 支払企業の情報 **(申請者と同様)** | `payment.sameAsApplicant` | boolean | always — **smart default: ON** |

### 2c. 支払企業 — #29–#37, mirror of §1

Hidden in the UI while `payment.sameAsApplicant === true`; **still written to the DOCX**, copied
from `applicant.*`, because the official form has these cells and IDFL reads them.

| # | Official field | Internal ID |
|---|---|---|
| 29 | 会社名 | `payment.company.companyName` |
| 30 | 会社名(英語表記) | `payment.company.companyNameEnglish` |
| 31 | 住所Indirizzo: | `payment.company.address` |
| 32 | 市 | `payment.company.city` |
| 33 | 国 | `payment.company.country` |
| 34 | ご担当者様 | `payment.company.contactName` |
| 35 | 役職 | `payment.company.contactTitle` |
| 36 | 電話番号 | `payment.company.phone` |
| 37 | メールアドレス | `payment.company.email` |

> **#31 label reads `住所Indirizzo:`** — an Italian string left in the JP master.
> It is official wording. **Do not correct it.** Worth reporting to IDFL separately.

---

## Section 3 — 申請基準 (Standards)

Table 3, rows 21–53. Controls **#38–#80**. Seven standard blocks, identical shape:

```
[✓ standard]  |  ☐ Initial / ☐ Renewal (PLAIN TEXT)  |  [✓ prior cert A]
                                                        [✓ prior cert B]
                                                        [前回のプロジェクト/ライセンス番号]
                                                        [以前の認証機関]
                                                        [認証更新日]
```

| Standard | Select | Prior-CB checkboxes | Licence no. / Prev. CB / Renewal date | Internal prefix |
|---|---|---|---|---|
| Organic Content Standard (OCS) | #38 | #39 prior OCS · #40 prior GOTS | #41 · #42 · #43 | `standards.ocs` |
| Global Organic Textile Standard (GOTS) | #44 | #45 prior GOTS · #46 prior OCS | #47 · #48 · #49 | `standards.gots` |
| Naturtextil IVN BEST | #50 | #51 prior IVN · #52 prior GOTS | #53 · #54 · #55 | `standards.ivnBest` |
| Global Recycled Standard (GRS) | #56 | #57 prior GRS · #58 prior RCS | #59 · #60 · #61 | `standards.grs` |
| Recycled Claim Standard (RCS) | #62 | #63 prior RCS · #64 prior GRS | #65 · #66 · #67 | `standards.rcs` |
| Responsible Animal Fiber (RAF) | **#68 RAF · #69 RWS · #70 RMS · #71 RAS** | #72 prior RAF | #73 · #74 · #75 | `standards.raf` |
| Responsible Down Standard (RDS) | #76 | #77 prior RDS | #78 · #79 · #80 | `standards.rds` |

Per-standard fields (`X` = prefix above):

| Internal ID | Type | Condition |
|---|---|---|
| `X.selected` | boolean | always |
| `X.certificationStatus` | enum `initial` \| `renewal` | required iff `X.selected` — **writes a plain-text ☐, see §0.1** |
| `X.priorCert.<a>` / `X.priorCert.<b>` | boolean | shown iff `X.selected` |
| `X.previousLicenceNo` | text | shown iff `X.selected`; required iff any prior-CB box ticked |
| `X.previousCertifier` | text | shown iff `X.selected`; required iff any prior-CB box ticked |
| `X.certificationRenewalDate` | text (date-like) | shown iff `X.selected` |

**RAF is a group, not a single standard.** #68 is the RAF umbrella; #69/#70/#71 are RWS / RMS / RAS
sub-standards in the same cell. Model as `standards.raf.selected` +
`standards.raf.subStandards: ("rws"|"rms"|"ras")[]`.

**Mutual-exclusion rules stated in the official text** (surface as UI warnings, do not hard-block):
- IDFL will not issue OCS to a company holding GOTS from another CB (unless transferring to IDFL).
- IDFL will not issue GOTS to a company holding OCS from another CB (unless transferring).
- Same pairing for GRS ↔ RCS.

---

## Section 4 — 製品 (Products)

Table 4. Controls **#81–#137** (57).

### 4a. Twelve fixed categories — checkbox + detail text

| # (chk / text) | Category | Internal ID |
|---|---|---|
| 81 / 82 | ホームテキスタイル / 寝具 | `products.homeTextiles` |
| 83 / 84 | アパレル | `products.apparel` |
| 85 / 86 | アクセサリー | `products.accessories` |
| 87 / 88 | 履物 | `products.footwear` |
| 89 / 90 | 生地 | `products.fabric` |
| 91 / 92 | 糸 | `products.yarn` |
| 93 / 94 | 繊維/フィラメント | `products.fibreFilament` |
| 95 / 96 | フィリング/詰め物 | `products.filling` |
| 97 / 98 | パッケージ | `products.packaging` |
| 99 / 100 | リサイクル材料 | `products.recycledMaterial` |
| 101 / 102 | 未加工のダウン/フェザー | `products.rawDownFeather` |
| 103 / 104 | 鳥類 / 水鳥 | `products.birdsWaterfowl` |

Each: `products.<key>.selected` (boolean) + `products.<key>.detail` (text, shown & required only
when selected — this is the progressive-disclosure rule from the brief).

### 4b. その他 free rows — 8 rows, **#105–#136** (4 controls each) + **#137**

Model as `products.others[]` (max 8) with `{ selected, name, detail }`.

> ⚠️ **Needs cell-level verification before coding.** Each その他 row carries one checkbox and
> **three** text controls; which of the three is the category name and which is the detail is not
> determinable from the XML label context alone (all three sit in cells whose only text is `その他`).
> Resolve by filling one row with marker strings and opening the result in Word. `#137` is a
> trailing 57th control not part of the 8×4 grid — identify it in the same pass.

---

## Section 5 — 施設と工程 (Facilities)

Table 5. **6 facility rows** (table rows 2–7) × **7 columns** = 42 controls, **#138–#179**.
Row *n* occupies `#(138 + 7·(n−1))` … `#(144 + 7·(n−1))`.

| Col | Official header | Internal ID (`facilities[i].…`) | Type |
|---|---|---|---|
| 1 | 会社/施設/ユニット名 | `.name` | text |
| 2 | 施設/ユニットの住所、市区町村、地域、郵便番号、国 | `.address` | text |
| 3 | 従業員数 | `.employeeCount` | text (numeric-ish; official cell is free text) |
| 4 | 規格 | `.standards` | text (UI: multi-select of selected standards → joined) |
| 5 | 活動/工程のリスト | `.activities` | text (UI: multi-select + free text → joined) |
| 6 | ユニットタイプ（メイン / 施設 / 関連下請け業者 / 認証下請け業者） | `.unitType` | text (UI: select of the 4 official values) |
| 7 | 以前に認証を受けたことがありますか？(Y/N) | `.previouslyCertified` | **comboBox** — items `Yes` / `No` |

Also in this section, in the instructions block above the table:

| Field | Internal ID | Type | Note |
|---|---|---|---|
| 下請け施設がありますか？ `☐ はい ☐ いいえ` | `facilitiesMeta.hasSubcontractors` | enum yes/no | **plain-text ☐, see §0.1** |

### The 6-row ceiling

The official table holds exactly 6 facilities and the template's own instruction says:

> 追加のスペースが必要な場合は、他の文書シート（ExcelまたはWordが望ましい）を使用して上記の情報を送信してください

So IDFL's documented answer to >6 facilities is **a separate attachment, not a longer table**.
The web UI should still allow unlimited facilities (`+ Add another facility` / `Duplicate`), and
generation should follow the template's instruction rather than mutate the protected table.
See the plan document for the recommended overflow behaviour — **this needs your decision.**

---

## Section 6 — 認証情報 (Other certifications & chemicals)

Table 6. Controls **#180–#209** (30).

### 6a. Ten other-certification yes/no pairs — #180–#199

Each row is two checkboxes (`はい` / `いいえ`) = one tri-state answer (unanswered / yes / no).

| # (yes / no) | Official row | Internal ID (`otherCertifications.…`) |
|---|---|---|
| 180 / 181 | OEKO-TEX STEP Environmental Performance Requirements | `.oekoTexStep` |
| 182 / 183 | SCS Recycled Content Verification | `.scsRcv` |
| 184 / 185 | BSCI Social Audit | `.bsci` |
| 186 / 187 | SA 8000 Audit | `.sa8000` |
| 188 / 189 | Higg Facilities Environmental Module (FEM) | `.higgFem` |
| 190 / 191 | Higg Facilities Social Labor Module (FSLM) | `.higgFslm` |
| 192 / 193 | Higg Brand Retail Module (BRM) | `.higgBrm` |
| 194 / 195 | Worldwide Responsible Accreditation Program (WRAP) | `.wrap` |
| 196 / 197 | Any standard approved against the GSCP social reference | `.gscpSocial` |
| 198 / 199 | Any standard approved against the GSCP environmental reference | `.gscpEnvironmental` |

UI: one Yes/No control per row, **not** two checkboxes. Writer sets exactly one of the pair.

### 6b. Chemical inputs

| # | Official field | Internal ID | Type | Condition |
|---|---|---|---|---|
| 200 / 201 | Do any facilities use chemical inputs …? (Q1) | `chemicalCompliance.usesChemicalsQ1` | yes/no pair | always |
| 202 | If yes, how many chemicals …? | `chemicalCompliance.chemicalCountQ1` | text | iff Q1 = yes |
| 203 / 204 | Do any facilities use chemical inputs …? (Q2) | `chemicalCompliance.usesChemicalsQ2` | yes/no pair | always |
| 205 | If yes, how many chemicals …? | `chemicalCompliance.chemicalCountQ2` | text | iff Q2 = yes |

> ⚠️ Q1 and Q2 have near-identical truncated labels in the XML. **Read the two full cell texts in
> Word before wiring them** — they almost certainly scope different standards (e.g. GOTS vs GRS).
> Do not assume they are duplicates.

### 6c. Certification refusal

| # | Official field | Internal ID | Type | Condition |
|---|---|---|---|---|
| 206 / 207 | 組織またはその施設は、別の認証機関によって認証を拒否されたことがありますか? | `certifications.refusedBefore` | yes/no pair | always |
| 208 | (detail row) | `certifications.refusedDetail` | text | iff refused = yes |
| 209 | (row 22, unlabelled) | `certifications.additionalNotes` | text | ⚠️ verify purpose in Word |

---

## Section 7 — 承認/署名 (Declaration & signature)

Table 7. Controls **#210–#216** (7).

| # | Official field | Internal ID | Type | Note |
|---|---|---|---|---|
| 210 | Name of Company: 会社名 | `declaration.companyName` | text | prefill from `applicant.companyName` |
| 211 | Company's Registered Seal/Stamp: 社印 | `declaration.sealCell` | text | **leave empty** — physical seal area |
| — | Authorized Signature 承認の署名 (table row 5) | — | — | **no control — handwritten. Never auto-fill.** |
| 212 | Name and Title of the Signatory / 署名者の氏名と役職 | `declaration.signatoryNameTitle` | text | ✔ required |
| 213 | Date / 日付 | `declaration.date` | text | ✔ required |
| 214 | 申請代表者　会社名 | `declaration.representative.companyName` | text | optional block |
| 215 | 申請代表者　ご担当者 | `declaration.representative.contactName` | text | optional |
| 216 | 申請代表者　連絡先メールアドレス | `declaration.representative.email` | text | optional, email format |

The generated document is an **unsigned application** requiring wet signature + seal. The web UI
must say so explicitly at the download step.

---

## Section 8 — (GRS/RCS) リサイクル材料 — recyclers only

Table 8. Controls **#217–#230** (14) + **4 plain-text ☐**.
**Visible iff** `standards.grs.selected || standards.rcs.selected` **and** the applicant is a recycler.

| Field | Internal ID | Type | Controls |
|---|---|---|---|
| リサイクル材料の種類 `☐なし ☐使用後 ☐使用前 ☐両方` | `recycling.materialType` | enum ×4 | **plain-text ☐, see §0.1** |
| ASR 213 / 代替体積整合（VR2, CCS 105） | `recycling.vr2Sites` | text | #217, #218 |
| リサイクルされる投入廃棄物の説明と使用比率 | `recycling.inputWasteDescription` | text | #219–#222 |
| 廃棄物の収集・集中化業者の推定数 | `recycling.collectorCount` | text | #223–#225 |
| 収集・集中化業者の一般的な所在地（地域/国） | `recycling.collectorLocations` | text | #226, #227 |
| 収集・集中化業者の活動・プロセス一覧 | `recycling.collectorActivities` | text | #228–#230 |

> ⚠️ Each question spans **2–4 text controls** (split cells). Whether these are sub-columns
> (e.g. material / percentage) or continuation cells is not determinable from XML label context.
> **Verify in Word before mapping.** Until then treat the first control of each group as primary.

---

## Sections 9–12 — RDS supply-chain tables

All four are repeating tables. **Each holds only 3 data rows** (table rows 4–6) — a tighter limit
than §5. Same overflow question as §5 applies.

### Section 9 — (RDS) 屠畜場 (肉加工業者) · #231–#267 · **3 rows**
Visible iff `standards.rds.selected` **and** the scope includes a slaughterhouse.

Official columns (7): 施設名 · 施設の住所 · ご担当者 · 水鳥の種類 · 年間に屠殺される水鳥の数 ·
活動/工程のリスト · 以前に認証を受けたことがありますか？(Y/N, comboBox)

Internal: `rds.slaughterhouses[].{ name, address, contact, waterfowlSpecies, annualSlaughterCount, activities, previouslyCertified }`

> ⚠️ **Control counts do not match the 7 columns**: row 4 = 11 controls, rows 5 and 6 = 13 each
> (10–12 text + 1 combo). The other three RDS tables match their headers exactly, so this table
> has merged/split cells. **Section 9 requires a cell-level verification pass before mapping.**

### Section 10 — (RDS) 農場グループ認証 · #268–#294 · **3 rows × 9** ✔ matches header
農場のグループ名 · ご担当者 · 農場グループのメンバー数 · グループ内の親農場の数（ある場合） ·
水鳥の種類/種 (**comboBox**) · 年間に飼育される水鳥の数 · 毎年屠殺される水鳥の数（該当する場合） ·
活動/プロセスのリスト · 以前に認証を受けたことがありますか？(**comboBox**)

Internal: `rds.farmGroups[].{ groupName, contact, memberCount, parentFarmCount, waterfowlSpecies, annualRearedCount, annualSlaughterCount, activities, previouslyCertified }`

### Section 11 — (RDS) 個別農場認証 · #295–#318 · **3 rows × 8** ✔ matches header
農場名 · 農場の住所 · ご担当者 · 水鳥の種類/種 · 年間に飼育される水鳥の数 · 活動/プロセスのリスト ·
親農場(Y/N) (**comboBox**) · 以前に認証を受けたことがありますか？(**comboBox**)

Internal: `rds.individualFarms[].{ name, address, contact, waterfowlSpecies, annualRearedCount, activities, isParentFarm, previouslyCertified }`

### Section 12 — (RDS) 農場エリアの認証 · #319–#342 · **3 rows × 8** ✔ matches header
農場エリア名 · ご担当者 · コレクターの数 · 地域名 · 水鳥の種類/種 · 活動/プロセスのリスト ·
年間に収集される材料の量の推定 · 以前に認証を受けたことがありますか？(**comboBox**)

Internal: `rds.farmAreas[].{ areaName, contact, collectorCount, regionName, waterfowlSpecies, activities, estimatedAnnualVolume, previouslyCertified }`

---

## Repeating-capacity summary

| Section | Entity | Rows in master | Overflow instruction in the template |
|---|---|---|---|
| 5 | Facility | **6** | 別シート（Excel/Word）で提出 |
| 9 | Slaughterhouse | **3** | (same note pattern — verify) |
| 10 | Farm group | **3** | (verify) |
| 11 | Individual farm | **3** | (verify) |
| 12 | Farm area | **3** | (verify) |

---

## ComboBox value sets

Only two distinct item sets exist across all 24 comboBoxes:

| Items | Count | Where |
|---|---|---|
| `Certified Previous (Y/N)` (prompt) · `Yes` · `No` | 21 | 以前に認証を受けたことがありますか / 親農場(Y/N) |
| `Choose an item.` (prompt) · `YES` · `NO` | 3 | §10 水鳥の種類/種 column |

Writers must emit the **exact display strings** (`Yes`/`No` vs `YES`/`NO` differ by set) and must
not leave the prompt string as a value.

---

## Open items — status after Phase 2

Phase 2 resolved five of the eight by reading the master's full label text and discovering the
35 **nested duplicate** controls (see `docs/ui-to-template-transformations.md` §3).

| # | Item | Status |
|---|---|---|
| V1 | Initial/Renewal `☐` are plain text, not controls | **RESOLVED** — confirmed real; the run-level ballot writer is implemented (`editBallot`, `mapping.ballot[]`) and all 20 plain ballots are exercised by the test suite |
| V2 | §9 control count (11/13/13) ≠ 7 columns | **RESOLVED** — 16 nested duplicates. 37 − 16 = 21 = 3 rows × 7 columns |
| V3 | §4 `その他` — role of the 3 text controls, stray `#137` | **RESOLVED** — each row is `☐ その他 [name]` in cell 1 + `[detail]` in cell 2; the third control is a nested duplicate of the name. `#137` is the nested duplicate of `#136` |
| V4 | §8 multi-control questions (2–4 each) | **RESOLVED** — 9 nested duplicates. 14 − 9 = 5 = one control per question row |
| V5 | §6b Q1 vs Q2 scope | **RESOLVED** — Q1 (#200–202) is **GOTS**-scoped, Q2 (#203–205) is **GRS**-scoped. Full labels: 「GOTS 製品の製造に化学物質を投入する施設はありますか?」 / 「GRS 製品の…」 |
| V6 | `#209` purpose | **RESOLVED** — §6 r21「組織またはその施設は製品認証を禁止されたことがありますか? 禁止されている場合は、以下に説明してください。」 free-text answer. Note this question has **no** yes/no control, unlike the 拒否 question above it |
| V7 | Overflow policy >6 facilities / >3 RDS rows | **Implemented as refusal; appendix still open.** Current policy: refuse generation when official template capacity is exceeded. Never silently truncate data. `OverflowError` names the section, the capacity and the overflow count, and no file is produced. Option A (appendix file) remains open and needs IDFL's business decision |
| V8 | Intended master filename | **RESOLVED** — the site repository publishes the master at `/files/GOTS-TE-Application-Form-JP.docx` (byte-identical, sha256 `6593c446…`). That is the canonical name and the path the generator loads |

Effective fillable control count: **307** (342 − 35 nested duplicates).

**Still recommended before Phase 4:** the marker-fill pass (fill control *n* with `@@nnn@@`,
open in Word, read off the positions). V2–V6 are resolved by structural analysis; the marker pass
turns that into direct visual confirmation and settles V1's exact run targets.

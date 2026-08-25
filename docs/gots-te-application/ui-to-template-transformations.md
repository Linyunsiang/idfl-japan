# UI ↔ Official Template Transformations

Phase 2 deliverable #8 / requirement #12.

Every field in the web wizard must be traceable to the official Word control it will eventually
populate. Where the web UX **combines, splits, re-types or re-shapes** an official field, the
transformation is recorded here. Phase 4's writer must implement the "→ written to the document as"
column exactly.

**Traceability chain:** `ApplicationData` path → this table → `js/schema.js` `controls:` → the
`#N` index in `docs/_generated/control-inventory.tsv` → the Word `w:id`.

---

## 1. Deliberate transformations

| # | Official form | Web UI | → written to the document as | Why |
|---|---|---|---|---|
| T1 | §2 支払いの通貨 — **14 separate checkboxes** (#10–#23) | one single-select radio group | tick exactly the one checkbox matching `payment.currency` | 14 checkboxes for a single choice invites contradictory input. The document still receives one ticked box |
| T2 | §3 Initial / Renewal — **plain-text `☐` pairs**, 7 × 2 = 14 glyphs | radio group per standard | replace the chosen `☐` glyph with `☒` in that specific run | Not content controls (field map §0.1). Requires run-level targeting, not a control write |
| T3 | §6 other certifications — **2 checkboxes per row** (はい/いいえ), 10 rows | one Yes/No radio per row | tick exactly one of the pair | Two checkboxes cannot express "unanswered" vs "both"; the radio can, and writes one box |
| T4 | §6 chemical questions — 2 checkboxes each | Yes/No radio | tick one of the pair | as T3 |
| T5 | §6 認証拒否 — 2 checkboxes | Yes/No radio | tick one of the pair | as T3 |
| T6 | §8 リサイクル材料 — **4 plain-text `☐`** | radio group (4 options) | replace the chosen `☐` with `☒` | Not content controls (field map §0.1) |
| T7 | §5 施設 `規格` — free-text cell | multi-select of the standards chosen in step 3 | join selected standard **names** with `、` | Stops applicants inventing standard names or listing standards they did not apply for |
| T8 | §5 施設 `活動/工程のリスト` — free-text cell | multi-select of the 18 official example activities **+** a free-text "上記以外" box | join selected labels and the free text with `、` | The master lists the 18 as examples; offering them as choices raises consistency without closing the list |
| T9 | §5 施設 `ユニットタイプ` — free-text cell | select of the 4 official values | write the official Japanese label (`メイン` / `施設` / `関連下請け業者` / `認証下請け業者`) | The 4 values are printed in the column header; free text produced inconsistent answers |
| T10 | §5 施設 — **6 fixed table rows** | unbounded `facilities[]` with Add / Duplicate / Remove | first 6 → the table; **7th onward → appendix file** | Follows the master's own instruction (「追加のスペースが必要な場合は…別の文書シート」). **Pending your decision (V7)** |
| T11 | §§9–12 RDS — **3 fixed rows each** | unbounded arrays | first 3 → the table; rest → appendix | as T10. **Pending V7** |
| T12 | §4 その他 — **8 fixed rows** | `products.others[]`, Add/Remove, soft cap warning at 8 | first 8 → the rows; rest → appendix | as T10 |
| T13 | §§9–12 「以前に認証を受けたことがありますか？」 — comboBox | Yes/No radio | write the exact combo `displayText`: `Yes` / `No` | Two different item sets exist in the master (`Yes/No` and `YES/NO`) — the writer must use the set belonging to that specific control |
| T14 | §2c 支払企業 — 9 cells | hidden while 「支払企業は申請者と同じ」 is ticked | **always written**, mirrored from `applicant.*` when the box is ticked | The official form has these cells and IDFL reads them; hiding is a UI convenience only |
| T15 | §1/§2c 国 — free-text cell | text input **with a datalist of suggestions** | the typed string, verbatim | Suggestions only — the field stays free text, so there is no value transformation |
| T16 | §3 RAF — 4 checkboxes in one cell (#68 RAF, #69 RWS, #70 RMS, #71 RAS) | one "RAF" toggle + a required multi-select of RWS/RMS/RAS | tick #68 plus each selected sub-standard | RAF is an umbrella; treating all four as peers let applicants tick a sub-standard without RAF |

## 2. Official fields intentionally NOT in the web UI

| Official field | Controls | Reason |
|---|---|---|
| §7 Authorized Signature（承認の署名） | *no control in the master* | Wet-ink signature. Auto-filling it would produce a document that appears signed — document fraud. The UI states this explicitly at step 9 |
| §7 Company's Registered Seal/Stamp（社印） | inside #210/#211 cell | Physical seal area, left blank by design |
| 35 **nested duplicate** content controls | see §3 below | Word editing artifacts — a text control wrapped inside another. Writing both would double-write the same cell |

## 3. Nested duplicate controls — do not write

Phase 2 analysis found the 342 controls include **35 nested pairs** (`inner ⊂ outer`). Only the
**307 outer** controls are real fields. Writing an inner control as if it were separate would
corrupt the cell.

```
§4  その他:  107⊂106  111⊂110  115⊂114  119⊂118  123⊂122  127⊂126  131⊂130  135⊂134  137⊂136
§7         :  211⊂210
§8         :  218⊂217  220⊂219  221⊂220  222⊂221  224⊂223  225⊂224  227⊂226  229⊂228  230⊂229
§9         :  233⊂232  235⊂234  237⊂236  239⊂238  243⊂242  245⊂244  247⊂246  249⊂248
              251⊂250  253⊂252  256⊂255  258⊂257  260⊂259  262⊂261  264⊂263  266⊂265
```

Subtracting them reconciles the counts that looked wrong in Phase 1:

| Section | Raw controls | − nested | Result | Matches header? |
|---|---|---|---|---|
| §4 その他 | 33 | 9 | 24 = 8 rows × (checkbox + name + detail) | ✔ |
| §8 | 14 | 9 | 5 = the 5 question rows | ✔ |
| §9 | 37 | 16 | 21 = 3 rows × 7 columns | ✔ |
| §10 | 27 | 0 | 27 = 3 × 9 | ✔ |
| §11 | 24 | 0 | 24 = 3 × 8 | ✔ |
| §12 | 24 | 0 | 24 = 3 × 8 | ✔ |

## 4. Fields with no clean web representation

None. Every official input has a home in the wizard, except the two physical items in §2 above,
which are intentional.

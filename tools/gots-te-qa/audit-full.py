#!/usr/bin/env python3
"""
Functional mapping audit for the FULL fixture.

Positional assertions: every expectation names the OFFICIAL table / row / cell and the value
that must appear there. Nothing here reads mapping.json or control ids, so a value written
into the wrong official cell fails even though the generator thinks it succeeded.

    python tools/gots-te-qa/audit-full.py
"""
import glob, sys, zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

path = sys.argv[1] if len(sys.argv) > 1 else sorted(glob.glob("generated/FULL_*.docx"))[0]
root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml").decode("utf-8"))


def txt(el):
    out = []

    def walk(e):
        for ch in e:
            if ch.tag == W + "t":
                out.append(ch.text or "")
            elif ch.tag == W + "br":
                out.append("\n")
            else:
                walk(ch)

    walk(el)
    return "".join(out).strip()


def cells(tr):
    out = []

    def collect(node):
        for n in node:
            if n.tag == W + "tc":
                out.append(n)
            elif n.tag == W + "sdt":
                c = n.find(W + "sdtContent")
                if c is not None:
                    collect(c)

    collect(tr)
    return out


tables = [t for t in root.iter(W + "tbl")]
rows = {i + 1: [r for r in t if r.tag == W + "tr"] for i, t in enumerate(tables)}

PASS, FAIL = [], []


def cell(tbl, row, col):
    try:
        return txt(cells(rows[tbl][row - 1])[col - 1])
    except IndexError:
        return None


def check(area, label, tbl, row, col, expected, mode="eq"):
    actual = cell(tbl, row, col)
    if actual is None:
        FAIL.append((area, label, f"t{tbl}r{row}c{col}", "<cell missing>", expected))
        return
    ok = (actual == expected) if mode == "eq" else (expected in actual)
    (PASS if ok else FAIL).append((area, label, f"t{tbl}r{row}c{col}", actual, expected))


APPLICANT = [
    ("会社名", "TEST COMPANY - DO NOT USE 株式会社テスト繊維（F）"),
    ("会社名(英語表記)", "TEST COMPANY - DO NOT USE Test Textile Co Ltd F"),
    ("住所", "大阪府大阪市中央区久太郎町1丁目6番地21 シャンクレール本町 2階"),
    ("市", "大阪市"),
    ("国", "日本"),
    ("ご担当者名", "山田 太郎"),
    ("役職", "品質管理部長"),
    ("電話番号", "+81 6 6484 5656"),
    ("メールアドレス", "test-do-not-use@example.co.jp"),
]

# ---- 1. applicant : table 2 rows 2-10 ----
for i, (lab, val) in enumerate(APPLICANT):
    check("applicant", lab, 2, 2 + i, 1, lab)
    check("applicant", lab, 2, 2 + i, 2, val)

# ---- 2. payment ----
CURRENCY_R2 = ["USD", "RMB", "EURO", "TWD", "TRY", "CHF", "INR", "BDT"]
CURRENCY_R3 = ["JPY", "PKR", "KRW", "IDR", "VND", "OTHER"]
for i, c in enumerate(CURRENCY_R2):
    check("payment", f"currency {c} unticked", 3, 2, 2 + i, "☐", "in")
for i, c in enumerate(CURRENCY_R3):
    want = "☒" if c == "JPY" else "☐"
    check("payment", f"currency {c}", 3, 3, 2 + i, want, "in")
check("payment", "Tax ID label", 3, 4, 1, "Tax ID #")
check("payment", "Tax ID value", 3, 4, 2, "T0000000000000")
check("payment", "rush site visit unticked", 3, 6, 2, "☐")
check("payment", "rush decision unticked", 3, 7, 2, "☐")
check("payment", "same-as-applicant ticked", 3, 8, 2, "☒", "in")
for i, (lab, val) in enumerate(APPLICANT):
    check("payment", f"payment company {lab}", 3, 9 + i, 2, val)

# ---- 3/4/5. standards, initial-renewal, previous CB ----
STD_ROWS = {
    "OCS": (21, True, "initial"), "GOTS": (26, True, "initial"),
    "IVN BEST": (31, False, None), "GRS": (36, True, "renewal"),
    "RCS": (41, False, None), "RAF": (46, True, "initial"), "RDS": (50, False, None),
}
for name, (r, selected, status) in STD_ROWS.items():
    check("standards", f"{name} selected", 3, r, 1, "☒" if selected else "☐", "in")
    st = cell(3, r, 2) or ""
    init_ok = st.startswith("☒") if status == "initial" else st.startswith("☐")
    ren_ok = ("☒ Renewal" in st) if status == "renewal" else ("☐ Renewal" in st)
    (PASS if init_ok else FAIL).append(("initial/renewal", f"{name} Initial", f"t3r{r}c2", st[:34], f"status={status}"))
    (PASS if ren_ok else FAIL).append(("initial/renewal", f"{name} Renewal", f"t3r{r}c2", st[:34], f"status={status}"))

check("standards", "RAF sub RWS ticked", 3, 46, 1, "☒ Responsible Wool Standard", "in")
check("standards", "RAF sub RMS ticked", 3, 46, 1, "☒ Responsible Mohair Standard", "in")
check("standards", "RAF sub RAS unticked", 3, 46, 1, "☐ Responsible Alpaca Standard", "in")

check("previous CB", "GRS prior GRS ticked", 3, 36, 3, "☒以前/現在", "in")
check("previous CB", "GRS prior RCS unticked", 3, 37, 3, "☐以前/現在", "in")
check("previous CB", "GRS licence no.", 3, 38, 4, "GRS-2022-00123")
check("previous CB", "GRS previous certifier", 3, 39, 4, "Ecocert")
check("previous CB", "GRS renewal date", 3, 40, 4, "2026-06-30")
for name, r in (("OCS", 23), ("GOTS", 28), ("IVN", 33), ("RCS", 43), ("RAF", 47), ("RDS", 51)):
    check("previous CB", f"{name} licence left blank", 3, r, 4, "Click here to enter text.")

# ---- 6. products ----
CATS = ["ホームテキスタイル", "アパレル", "アクセサリー", "履物", "生地", "糸",
        "繊維/フィラメント", "フィリング/詰め物", "パッケージ", "リサイクル材料",
        "未加工のダウン/フェザー", "鳥類 / 水鳥"]
KEYS = ["homeTextiles", "apparel", "accessories", "footwear", "fabric", "yarn",
        "fibreFilament", "filling", "packaging", "recycledMaterial",
        "rawDownFeather", "birdsWaterfowl"]
for i, (label, key) in enumerate(zip(CATS, KEYS)):
    check("products", f"{key} ticked", 4, 4 + i, 1, "☒", "in")
    check("products", f"{key} label", 4, 4 + i, 1, label.split(" /")[0][:6], "in")
    check("products", f"{key} detail", 4, 4 + i, 2, f"テスト用製品詳細 {key}")
for i in range(8):
    check("products", f"その他 {i+1} ticked+name", 4, 16 + i, 1, f"☒ その他その他カテゴリー {i+1}")
    check("products", f"その他 {i+1} detail", 4, 16 + i, 2, f"詳細 {i+1}")

# ---- 7. facilities ----
UNIT = ["メイン", "施設", "関連下請け業者", "認証下請け業者", "施設", "施設"]
ACTS = ["染色、仕上げ", "織布、編み物", "染色、仕上げ", "織布、編み物", "染色、仕上げ", "織布、編み物、検品"]
CERT = ["Yes", "No", "No", "No", "No", "No"]
STDJOIN = ("Global Organic Textile Standard (GOTS)、Organic Content Standard (OCS)、"
           "Global Recycled Standard (GRS)、Responsible Animal Fiber (RAF)")
check("facilities", "subcontractors はい", 4, 28, 2, "☒ はい", "in")
for i in range(6):
    r = 2 + i
    check("facilities", f"facility {i+1} name", 5, r, 1, f"TEST COMPANY - DO NOT USE 施設 {i+1}")
    check("facilities", f"facility {i+1} address", 5, r, 2, f"大阪府大阪市中央区テスト{i+1}丁目")
    check("facilities", f"facility {i+1} employees", 5, r, 3, str(20 * (i + 1)))
    check("facilities", f"facility {i+1} standards", 5, r, 4, STDJOIN)
    check("facilities", f"facility {i+1} activities", 5, r, 5, ACTS[i])
    check("facilities", f"facility {i+1} unit type", 5, r, 6, UNIT[i])
    check("facilities", f"facility {i+1} prev cert", 5, r, 7, CERT[i])

# ---- 8. certification information ----
OTHER_CERTS = [("oekoTexStep", 3, "yes"), ("scsRcv", 4, "no"), ("bsci", 5, "yes"),
               ("sa8000", 6, "no"), ("higgFem", 7, "no"), ("higgFslm", 8, "no"),
               ("higgBrm", 9, "no"), ("wrap", 10, "no"),
               ("gscpSocial", 11, "no"), ("gscpEnvironmental", 12, "no")]
for key, r, ans in OTHER_CERTS:
    v = cell(6, r, 2) or ""
    ok = (v.startswith("☒") if ans == "yes" else ("☒ いいえ" in v or v.startswith("☐")))
    yes_ticked = v.startswith("☒")
    ok = (yes_ticked if ans == "yes" else (not yes_ticked and "☒" in v))
    (PASS if ok else FAIL).append(("certification info", f"{key}={ans}", f"t6r{r}c2", v, ans))

# ---- 9. chemical compliance ----
check("chemical", "GOTS chemicals = いいえ", 6, 14, 2, "☐ はい  ☒ いいえ")
check("chemical", "GOTS count left blank", 6, 15, 2, "Click to enter text.")
check("chemical", "GRS chemicals = はい", 6, 16, 2, "☒ はい  ☐ いいえ")
check("chemical", "GRS count = 30", 6, 17, 2, "30")
check("chemical", "refused = はい", 6, 19, 2, "☒ はい  ☐ いいえ")
check("chemical", "refused detail", 6, 20, 1, "2019年に別の認証機関で書類不備により一度差し戻しあり（テストデータ）。")
check("chemical", "prohibited detail", 6, 22, 1, "該当なし")

# ---- 10. recycling ----
check("recycling", "material type = both", 8, 2, 2, "☒ はい、使用済み材料、使用前材料の両方", "in")
check("recycling", "material type none unticked", 8, 2, 2, "☐ リサイクル材料なし", "in")
check("recycling", "vr2Sites", 8, 4, 2, "RM-01 / PR-04")
check("recycling", "inputWasteDescription", 8, 5, 2, "使用済みPETボトル\n工場端材")
check("recycling", "collectorCount", 8, 6, 2, "25")
check("recycling", "collectorLocations", 8, 7, 2, "日本、ベトナム")
check("recycling", "collectorActivities", 8, 8, 2, "収集、開封、選別、フレーク化")

# ---- 11. declaration ----
check("declaration", "company name", 7, 4, 1, "TEST COMPANY - DO NOT USE 株式会社テスト繊維")
check("declaration", "signature area untouched", 7, 6, 1, "")
check("declaration", "signatory", 7, 7, 2, "山田 太郎 / 品質管理部長")
check("declaration", "date", 7, 8, 2, "2026-08-24")
check("declaration", "rep company", 7, 10, 2, "TEST COMPANY - DO NOT USE コンサルティング株式会社")
check("declaration", "rep contact", 7, 11, 2, "田中 次郎")
check("declaration", "rep email", 7, 12, 2, "rep-test-do-not-use@example.co.jp")

# ---- 12. RDS conditional sections must remain untouched ----
for tbl, cols in ((9, 7), (10, 9), (11, 8), (12, 8)):
    for r in (4, 5, 6):
        for c in range(1, cols + 1):
            v = cell(tbl, r, c) or ""
            # the master uses two placeholder texts: "Click here/to enter text." for w:text
            # controls and "Choose an item." for comboBoxes (e.g. §10 水鳥の種類/種)
            ok = v.startswith("Click") or v.startswith("Choose an item")
            (PASS if ok else FAIL).append(("RDS untouched", f"t{tbl}r{r}c{c}", f"t{tbl}r{r}c{c}", v[:30], "untouched placeholder"))

# ---- report ----
areas = []
for a, *_ in PASS + FAIL:
    if a not in areas:
        areas.append(a)
print(f"FILE: {path}\n")
print(f"{'area':<20}{'pass':>6}{'fail':>6}")
for a in areas:
    p = sum(1 for x in PASS if x[0] == a)
    f = sum(1 for x in FAIL if x[0] == a)
    print(f"{a:<20}{p:>6}{f:>6}")
print(f"{'TOTAL':<20}{len(PASS):>6}{len(FAIL):>6}")

if FAIL:
    print("\n=== MISMATCHES ===")
    for area, label, loc, actual, expected in FAIL:
        print(f"  [{area}] {label} @ {loc}")
        print(f"      expected: {expected!r}")
        print(f"      actual  : {actual!r}")
    sys.exit(1)
print("\nALL POSITIONAL ASSERTIONS PASSED")

#!/usr/bin/env python3
"""
Functional mapping audit for the MAX / MAXINIT fixtures — the true-maximum coverage pair.

Positional assertions only: every expectation names the OFFICIAL table / row / cell and the
value that must appear there. Nothing here reads mapping.json, control ids or the generator's
own report, so a value written into the wrong official cell fails even though the generator
believes it succeeded.

    python tests/gots-te/audit-max.py

MAX     — all 7 standards selected, ALL renewal, every prior-CB box ticked, distinct
          licence/certifier/date per standard, all 3 RAF sub-standards, all 4 RDS sections
          filled to their 3-row capacity, currency = OTHER, payment company NOT mirrored.
MAXINIT — same population, all 7 standards INITIAL with no prior-CB data. Proves the initial
          ballots and proves that selecting a standard does not tick its prior-CB boxes.
"""
import glob, sys, zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

MARK = "TEST COMPANY - DO NOT USE"
PASS, FAIL = [], []


def load(prefix):
    hits = sorted(glob.glob(f"generated/{prefix}_*.docx"))
    if not hits:
        print(f"MISSING: no generated/{prefix}_*.docx — run node tests/gots-te/generate-test-docs.mjs")
        sys.exit(2)
    return hits[0], ET.fromstring(zipfile.ZipFile(hits[0]).read("word/document.xml").decode("utf-8"))


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
    """Cells of a row, descending through w:sdt wrappers exactly as Word lays them out."""
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


class Doc:
    def __init__(self, path, root, tag):
        self.path, self.tag = path, tag
        tables = [t for t in root.iter(W + "tbl")]
        self.rows = {i + 1: [r for r in t if r.tag == W + "tr"] for i, t in enumerate(tables)}

    def cell(self, tbl, row, col):
        try:
            return txt(cells(self.rows[tbl][row - 1])[col - 1])
        except (IndexError, KeyError):
            return None

    def check(self, area, label, tbl, row, col, expected, mode="eq"):
        actual = self.cell(tbl, row, col)
        loc = f"{self.tag} t{tbl}r{row}c{col}"
        if actual is None:
            FAIL.append((area, label, loc, "<cell missing>", expected))
            return
        ok = (actual == expected) if mode == "eq" else (expected in actual)
        (PASS if ok else FAIL).append((area, label, loc, actual, expected))

    def assert_(self, area, label, loc, ok, actual, expected):
        (PASS if ok else FAIL).append((area, label, f"{self.tag} {loc}", actual, expected))


# --------------------------------------------------------------------------- #
# Expected data — mirrors tools/fixtures.mjs, written out longhand on purpose.
# --------------------------------------------------------------------------- #

APPLICANT_LABELS = ["会社名", "会社名(英語表記)", "住所", "市", "国",
                    "ご担当者名", "役職", "電話番号", "メールアドレス"]

APPLICANT_TAIL = ["大阪府大阪市中央区久太郎町1丁目6番地21 シャンクレール本町 2階", "大阪市", "日本",
                  "山田 太郎", "品質管理部長", "+81 6 6484 5656", "test-do-not-use@example.co.jp"]

PAYMENT_COMPANY = [f"{MARK} 支払代行株式会社", f"{MARK} Payment Agent Co Ltd",
                   "東京都千代田区丸の内1丁目1番1号 支払ビル 8階", "東京都千代田区", "日本",
                   "経理 花子", "経理部長", "+81 3 1234 5678", "payment-test-do-not-use@example.co.jp"]

# name, selected-row, prior-rows, (licence-row, certifier-row, date-row)
STANDARD_BLOCKS = [
    ("OCS", 21, [21, 22], (23, 24, 25), "OCS-2021-01001", "Control Union", "2026-01-31"),
    ("GOTS", 26, [26, 27], (28, 29, 30), "GOTS-2021-02002", "Ecocert", "2026-02-28"),
    ("IVN BEST", 31, [31, 32], (33, 34, 35), "IVN-2021-03003", "ETKO", "2026-03-31"),
    ("GRS", 36, [36, 37], (38, 39, 40), "GRS-2021-04004", "Peterson Projects", "2026-04-30"),
    ("RCS", 41, [41, 42], (43, 44, 45), "RCS-2021-05005", "SGS", "2026-05-31"),
    ("RAF", 46, [46], (47, 48, 49), "RAF-2021-06006", "ICEA", "2026-06-30"),
    ("RDS", 50, [50], (51, 52, 53), "RDS-2021-07007", "NSF", "2026-07-31"),
]

PRODUCT_LABELS = ["ホームテキスタイル", "アパレル", "アクセサリー", "履物", "生地", "糸",
                  "繊維/フィラメント", "フィリング/詰め物", "パッケージ", "リサイクル材料",
                  "未加工のダウン/フェザー", "鳥類 / 水鳥"]
PRODUCT_KEYS = ["homeTextiles", "apparel", "accessories", "footwear", "fabric", "yarn",
                "fibreFilament", "filling", "packaging", "recycledMaterial",
                "rawDownFeather", "birdsWaterfowl"]

STANDARDS_JOINED = ("Organic Content Standard (OCS)、Global Organic Textile Standard (GOTS)、"
                    "Naturtextil IVN BEST、Global Recycled Standard (GRS)、"
                    "Recycled Claim Standard (RCS)、Responsible Animal Fiber (RAF)、"
                    "Responsible Down Standard (RDS)")

FACILITY_UNITS = ["メイン", "施設", "関連下請け業者", "認証下請け業者", "施設", "施設"]
FACILITY_ACTS = ["リサイクル材料、染色、仕上げ", "紡績、織布、編み物"] * 2 + \
                ["リサイクル材料、染色、仕上げ", "紡績、織布、編み物、検品・出荷"]
FACILITY_CERT = ["Yes", "No", "Yes", "No", "Yes", "No"]

OTHER_CERT_KEYS = ["oekoTexStep", "scsRcv", "bsci", "sa8000", "higgFem",
                   "higgFslm", "higgBrm", "wrap", "gscpSocial", "gscpEnvironmental"]

YES_CELL = "☒ はい  ☐ いいえ"

SLAUGHTERHOUSES = [
    [f"{MARK} テスト屠畜場 1", "青森県三沢市屠畜1丁目1番地", "屠畜 担当1", "アヒル（北京種）",
     "100000", "屠殺、脱羽、選別（1系列）", "Yes"],
    [f"{MARK} テスト屠畜場 2", "青森県三沢市屠畜2丁目2番地", "屠畜 担当2", "ガチョウ（トゥールーズ種）",
     "200000", "屠殺、脱羽、選別（2系列）", "No"],
    [f"{MARK} テスト屠畜場 3", "青森県三沢市屠畜3丁目3番地", "屠畜 担当3", "アヒル（マガモ種）",
     "300000", "屠殺、脱羽、選別（3系列）", "Yes"],
]
FARM_GROUPS = [
    [f"{MARK} テスト農場グループ 1", "グループ 担当1", "10", "1", "ガチョウ（ランド種）",
     "50000", "25000", "飼育、給餌、集約（グループ1）", "Yes"],
    [f"{MARK} テスト農場グループ 2", "グループ 担当2", "20", "2", "アヒル（北京種）",
     "100000", "50000", "飼育、給餌、集約（グループ2）", "Yes"],
    [f"{MARK} テスト農場グループ 3", "グループ 担当3", "30", "3", "ガチョウ（エムデン種）",
     "150000", "75000", "飼育、給餌、集約（グループ3）", "No"],
]
INDIVIDUAL_FARMS = [
    [f"{MARK} テスト個別農場 1", "岩手県盛岡市農場1丁目1番地", "農場 担当1", "アヒル（北京種）",
     "30000", "飼育、給餌、記録管理（農場1）", "Yes", "No"],
    [f"{MARK} テスト個別農場 2", "岩手県盛岡市農場2丁目2番地", "農場 担当2", "ガチョウ（トゥールーズ種）",
     "60000", "飼育、給餌、記録管理（農場2）", "No", "Yes"],
    [f"{MARK} テスト個別農場 3", "岩手県盛岡市農場3丁目3番地", "農場 担当3", "アヒル（バリケン種）",
     "90000", "飼育、給餌、記録管理（農場3）", "No", "Yes"],
]
FARM_AREAS = [
    [f"{MARK} テスト農場エリア 1", "エリア 担当1", "5", "東北地方", "アヒル（北京種）",
     "収集、集約、記録管理（エリア1）", "12,000 kg", "No"],
    [f"{MARK} テスト農場エリア 2", "エリア 担当2", "10", "北陸地方", "ガチョウ（ランド種）",
     "収集、集約、記録管理（エリア2）", "24,000 kg", "Yes"],
    [f"{MARK} テスト農場エリア 3", "エリア 担当3", "15", "九州地方", "アヒル（マガモ種）",
     "収集、集約、記録管理（エリア3）", "36,000 kg", "No"],
]

RDS_HEADERS = {
    9: ["施設名", "施設の住所", "ご担当者", "水鳥の種類", "年間に屠殺される水鳥の数",
        "活動/工程のリスト", "以前に認証を受けたことがありますか？"],
    10: ["農場のグループ名", "ご担当者", "農場グループのメンバー数", "グループ内の", "水鳥の",
         "年間に飼育される水鳥の数", "毎年屠殺される", "活動/プロセスのリスト", "以前に認証を"],
    11: ["農場名", "農場の住所", "ご担当者", "水鳥の種類/種", "年間に飼育される水鳥の数",
         "活動/プロセスのリスト", "親農場", "以前に認証を"],
    12: ["農場エリア名", "ご担当者", "コレクターの数", "地域名", "水鳥の種類/種",
         "活動/プロセスのリスト", "年間に収集される材料の量の推定", "以前に認証を"],
}


# --------------------------------------------------------------------------- #
# Shared assertions — everything that is identical in MAX and MAXINIT
# --------------------------------------------------------------------------- #

def audit_common(d, company_ja, company_en, decl_company):
    # ---- §1 applicant : table 2 rows 2-10, label in c1 / value in c2 ----
    values = [company_ja, company_en] + APPLICANT_TAIL
    for i, (lab, val) in enumerate(zip(APPLICANT_LABELS, values)):
        d.check("§1 applicant", f"{lab} label", 2, 2 + i, 1, lab)
        d.check("§1 applicant", f"{lab} value", 2, 2 + i, 2, val)

    # ---- §2 payment ----
    # currency row 1 (USD..BDT) must all be unticked; row 2 must tick OTHER only
    for i, c in enumerate(["USD", "RMB", "EURO", "TWD", "TRY", "CHF", "INR", "BDT"]):
        d.check("§2 payment", f"currency {c} unticked", 3, 2, 2 + i, "☐", "in")
    for i, c in enumerate(["JPY", "PKR", "KRW", "IDR", "VND"]):
        d.check("§2 payment", f"currency {c} unticked", 3, 3, 2 + i, "☐", "in")
    d.check("§2 payment", "currency OTHER ticked", 3, 3, 7, "☒", "in")
    d.check("§2 payment", "currency OTHER free text", 3, 3, 8, "AUD (オーストラリアドル)")
    d.check("§2 payment", "Tax ID label", 3, 4, 1, "Tax ID #")
    d.check("§2 payment", "Tax ID value", 3, 4, 2, "T9999999999999")
    d.check("§2 payment", "rush site visit ticked", 3, 6, 2, "☒")
    d.check("§2 payment", "rush decision ticked", 3, 7, 2, "☒")
    # sameAsApplicant is FALSE here — the box must stay empty and §2c must carry its own data
    d.check("§2 payment", "same-as-applicant NOT ticked", 3, 8, 2, "☐", "in")
    for i, val in enumerate(PAYMENT_COMPANY):
        d.check("§2 payment", f"payment company {APPLICANT_LABELS[i]}", 3, 9 + i, 2, val)
    # and the payment company must NOT be a copy of the applicant
    d.assert_("§2 payment", "payment company differs from applicant", "t3r9c2",
              d.cell(3, 9, 2) != company_ja, d.cell(3, 9, 2), f"!= {company_ja}")

    # ---- §4 products : 12 categories + 8 その他 rows ----
    for i, (label, key) in enumerate(zip(PRODUCT_LABELS, PRODUCT_KEYS)):
        d.check("§4 products", f"{key} ticked", 4, 4 + i, 1, "☒", "in")
        d.check("§4 products", f"{key} label", 4, 4 + i, 1, label.split(" /")[0][:6], "in")
        d.check("§4 products", f"{key} detail", 4, 4 + i, 2, f"MAX 製品詳細 {key}")
    for i in range(8):
        d.check("§4 products", f"その他 {i+1} ticked+name", 4, 16 + i, 1,
                f"☒ その他MAX その他カテゴリー {i+1}")
        d.check("§4 products", f"その他 {i+1} detail", 4, 16 + i, 2, f"MAX その他詳細 {i+1}")

    # ---- §5 facilities : 6 rows = capacity ----
    d.check("§5 facilities", "subcontractors = はい", 4, 28, 2, "☒ はい", "in")
    d.check("§5 facilities", "subcontractors いいえ unticked", 4, 28, 2, "☐ いいえ", "in")
    for i in range(6):
        r = 2 + i
        d.check("§5 facilities", f"facility {i+1} name", 5, r, 1, f"{MARK} MAX 施設 {i+1}")
        d.check("§5 facilities", f"facility {i+1} address", 5, r, 2, f"京都府京都市中京区MAX{i+1}丁目")
        d.check("§5 facilities", f"facility {i+1} employees", 5, r, 3, str(15 * (i + 1)))
        d.check("§5 facilities", f"facility {i+1} standards (all 7)", 5, r, 4, STANDARDS_JOINED)
        d.check("§5 facilities", f"facility {i+1} activities", 5, r, 5, FACILITY_ACTS[i])
        d.check("§5 facilities", f"facility {i+1} unit type", 5, r, 6, FACILITY_UNITS[i])
        d.check("§5 facilities", f"facility {i+1} prev cert", 5, r, 7, FACILITY_CERT[i])

    # ---- §6 certification information ----
    for i, key in enumerate(OTHER_CERT_KEYS):
        d.check("§6 cert info", f"{key} = はい", 6, 3 + i, 2, YES_CELL)
    d.check("§6 chemical", "GOTS chemicals = はい", 6, 14, 2, YES_CELL)
    d.check("§6 chemical", "GOTS chemical count", 6, 15, 2, "48")
    d.check("§6 chemical", "GRS chemicals = はい", 6, 16, 2, YES_CELL)
    d.check("§6 chemical", "GRS chemical count", 6, 17, 2, "61")
    d.check("§6 chemical", "refused = はい", 6, 19, 2, YES_CELL)
    d.check("§6 chemical", "refused detail", 6, 20, 1,
            "MAX テストデータ：2020年に書類不備により一度差し戻しあり。")
    d.check("§6 chemical", "prohibited detail", 6, 22, 1,
            "MAX テストデータ：禁止された事実はありません。")

    # ---- §8 recycling ----
    d.check("§8 recycling", "materialType = both ticked", 8, 2, 2, "☒ はい、使用済み材料、使用前材料の両方", "in")
    d.check("§8 recycling", "none unticked", 8, 2, 2, "☐ リサイクル材料なし", "in")
    d.check("§8 recycling", "postConsumer unticked", 8, 2, 2, "☐ はい、使用後材料", "in")
    d.check("§8 recycling", "preConsumer unticked", 8, 2, 2, "☐ はい、使用前材料", "in")
    d.check("§8 recycling", "VR2 sites", 8, 4, 2, "MAX-RM-01 / MAX-PR-02 / MAX-PR-03")
    d.check("§8 recycling", "input waste description", 8, 5, 2,
            "使用済みPETボトル（使用済み材料）\n紡績工場端材（使用前材料）")
    d.check("§8 recycling", "collector count", 8, 6, 2, "42")
    d.check("§8 recycling", "collector locations", 8, 7, 2, "日本（東北・北陸・九州）、ベトナム、タイ")
    d.check("§8 recycling", "collector activities", 8, 8, 2, "収集、開封、選別、フレーク化、集約")

    # ---- §§9-12 RDS : header sanity + every cell of all three rows in all four tables ----
    for tbl, rows_expected in ((9, SLAUGHTERHOUSES), (10, FARM_GROUPS),
                               (11, INDIVIDUAL_FARMS), (12, FARM_AREAS)):
        area = f"§{tbl} RDS"
        for c, head in enumerate(RDS_HEADERS[tbl], 1):
            d.check(area, f"header c{c}", tbl, 3, c, head, "in")
        for i, expected_row in enumerate(rows_expected):
            r = 4 + i
            for c, val in enumerate(expected_row, 1):
                d.check(area, f"row {i+1} c{c}", tbl, r, c, val)

    # ---- §7 declaration ----
    d.check("§7 declaration", "company name", 7, 4, 1, decl_company)
    d.check("§7 declaration", "seal cell untouched", 7, 4, 2, "")
    d.check("§7 declaration", "signature area untouched", 7, 6, 1, "")
    d.check("§7 declaration", "signatory name/title", 7, 7, 2, "山田 太郎 / 代表取締役")
    d.check("§7 declaration", "date", 7, 8, 2, "2026-08-25")
    d.check("§7 declaration", "rep company", 7, 10, 2, f"{MARK} MAX コンサルティング株式会社")
    d.check("§7 declaration", "rep contact", 7, 11, 2, "田中 次郎")
    d.check("§7 declaration", "rep email", 7, 12, 2, "max-rep-test-do-not-use@example.co.jp")


def audit_standards(d, status):
    """§3 — all 7 standards selected; `status` is 'renewal' (MAX) or 'initial' (MAXINIT)."""
    for name, sel_row, prior_rows, (lic_r, cert_r, date_r), lic, certifier, date in STANDARD_BLOCKS:
        d.check("§3 standards", f"{name} selected", 3, sel_row, 1, "☒", "in")

        st = d.cell(3, sel_row, 2) or ""
        init_ok = st.startswith("☒") if status == "initial" else st.startswith("☐")
        ren_ok = ("☒ Renewal" in st) if status == "renewal" else ("☐ Renewal" in st)
        d.assert_("§3 initial/renewal", f"{name} Initial ballot", f"t3r{sel_row}c2",
                  init_ok, st[:36], f"status={status}")
        d.assert_("§3 initial/renewal", f"{name} Renewal ballot", f"t3r{sel_row}c2",
                  ren_ok, st[:36], f"status={status}")

        if status == "renewal":
            for pr in prior_rows:
                d.check("§3 previous CB", f"{name} prior box r{pr} ticked", 3, pr, 3, "☒以前/現在", "in")
            d.check("§3 previous CB", f"{name} licence no.", 3, lic_r, 4, lic)
            d.check("§3 previous CB", f"{name} previous certifier", 3, cert_r, 4, certifier)
            d.check("§3 previous CB", f"{name} renewal date", 3, date_r, 4, date)
        else:
            for pr in prior_rows:
                d.check("§3 previous CB", f"{name} prior box r{pr} NOT ticked", 3, pr, 3, "☐以前/現在", "in")
            for rr, lab in ((lic_r, "licence"), (cert_r, "certifier"), (date_r, "date")):
                v = d.cell(3, rr, 4) or ""
                d.assert_("§3 previous CB", f"{name} {lab} left as placeholder", f"t3r{rr}c4",
                          v.startswith("Click"), v[:30], "untouched placeholder")

    # RAF sub-standards live inside the RAF selected-row cell
    for label in ("Responsible Wool Standard", "Responsible Mohair Standard",
                  "Responsible Alpaca Standard"):
        d.check("§3 sub-standards", f"{label} ticked", 3, 46, 1, f"☒ {label}", "in")


def cross_check_no_bleed(d):
    """Each standard's previous-CB values must appear ONLY in that standard's own rows."""
    all_licences = [b[4] for b in STANDARD_BLOCKS]
    for name, _sel, _prior, (lic_r, _c, _d2), lic, _certifier, _date in STANDARD_BLOCKS:
        cellval = d.cell(3, lic_r, 4) or ""
        strays = [other for other in all_licences if other != lic and other in cellval]
        d.assert_("§3 no cross-bleed", f"{name} licence cell holds only its own value",
                  f"t3r{lic_r}c4", not strays, cellval, lic)


# --------------------------------------------------------------------------- #

max_path, max_root = load("MAX")
init_path, init_root = load("MAXINIT")

dmax = Doc(max_path, max_root, "MAX")
dinit = Doc(init_path, init_root, "MAXINIT")

audit_common(dmax, f"{MARK} 株式会社テスト繊維（MAX）", f"{MARK} Test Textile Co Ltd MAX",
             f"{MARK} 株式会社テスト繊維（MAX）")
audit_standards(dmax, "renewal")
cross_check_no_bleed(dmax)

audit_common(dinit, f"{MARK} 株式会社テスト繊維（MAXINIT）", f"{MARK} Test Textile Co Ltd MAXINIT",
             f"{MARK} 株式会社テスト繊維（MAXINIT）")
audit_standards(dinit, "initial")

# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #
print(f"MAX     : {max_path}")
print(f"MAXINIT : {init_path}\n")

areas = []
for a, *_ in PASS + FAIL:
    if a not in areas:
        areas.append(a)
print(f"{'area':<24}{'pass':>6}{'fail':>6}")
for a in areas:
    p = sum(1 for x in PASS if x[0] == a)
    f = sum(1 for x in FAIL if x[0] == a)
    print(f"{a:<24}{p:>6}{f:>6}")
print(f"{'TOTAL':<24}{len(PASS):>6}{len(FAIL):>6}")

if FAIL:
    print("\n=== MISMATCHES ===")
    for area, label, loc, actual, expected in FAIL:
        print(f"  [{area}] {label} @ {loc}")
        print(f"      expected: {expected!r}")
        print(f"      actual  : {actual!r}")
    sys.exit(1)
print("\nALL MAX POSITIONAL ASSERTIONS PASSED")

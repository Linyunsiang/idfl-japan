#!/usr/bin/env python3
"""
Positional audit of the CONDITIONAL scenarios (acceptance criterion 3).

FULL exercises no RDS data, so §§9-12 are only verified as "untouched" there.
This checks the scenarios that actually populate the conditional sections, and that the
sections which should stay empty really do.

    python tools/gots-te-qa/audit-conditional.py
"""
import glob, sys, zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
PASS, FAIL = [], []


def load(prefix):
    p = sorted(glob.glob(f"generated/{prefix}_*.docx"))[0]
    return p, ET.fromstring(zipfile.ZipFile(p).read("word/document.xml").decode("utf-8"))


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


def make(root):
    tables = [t for t in root.iter(W + "tbl")]
    rows = {i + 1: [r for r in t if r.tag == W + "tr"] for i, t in enumerate(tables)}

    def cell(tbl, row, col):
        try:
            return txt(cells(rows[tbl][row - 1])[col - 1])
        except IndexError:
            return None

    return cell


def check(scn, area, label, cell, tbl, row, col, expected, mode="eq"):
    actual = cell(tbl, row, col)
    if actual is None:
        FAIL.append((scn, area, label, f"t{tbl}r{row}c{col}", "<missing>", expected))
        return
    if mode == "eq":
        ok = actual == expected
    elif mode == "in":
        ok = expected in actual
    elif mode == "notin":
        ok = expected not in actual
    else:
        raise ValueError(f"unknown mode {mode!r}")
    (PASS if ok else FAIL).append((scn, area, label, f"t{tbl}r{row}c{col}", actual, expected))


def placeholder(scn, area, label, cell, tbl, row, col):
    v = cell(tbl, row, col) or ""
    ok = v.startswith("Click") or v.startswith("Choose an item")
    (PASS if ok else FAIL).append((scn, area, label, f"t{tbl}r{row}c{col}", v[:34], "untouched"))


# =====================================================================
# Scenario E — RDS selected: §§9 and 11 populated, §§10 and 12 empty,
#              §8 recycling must stay untouched (GRS/RCS not selected)
# =====================================================================
p, root = load("E")
c = make(root)
print(f"--- Scenario E : {p.split(chr(92))[-1]}")

check("E", "standards", "RDS selected", c, 3, 50, 1, "☒", "in")
check("E", "standards", "GOTS not selected", c, 3, 26, 1, "☐", "in")
check("E", "initial/renewal", "RDS Initial", c, 3, 50, 2, "☒ Initial", "in")

# §9 slaughterhouse row 1 — 7 columns
E9 = ["TEST COMPANY - DO NOT USE テスト屠畜場", "青森県三沢市テスト町1-1", "佐藤 花子",
      "アヒル（北京種）", "450,000", "屠殺、脱羽、選別", "No"]
for i, v in enumerate(E9):
    check("E", "§9 屠畜場", f"col{i+1}", c, 9, 4, i + 1, v)
for r in (5, 6):
    for col in range(1, 8):
        placeholder("E", "§9 unused rows", f"r{r}c{col}", c, 9, r, col)

# §11 individual farm row 1 — 8 columns
E11 = ["TEST COMPANY - DO NOT USE テスト農場", "青森県三沢市テスト町2-2", "鈴木 一郎",
       "アヒル（北京種）", "80,000", "飼育、給餌", "Yes", "No"]
for i, v in enumerate(E11):
    check("E", "§11 個別農場", f"col{i+1}", c, 11, 4, i + 1, v)

# §10 and §12 not in scope -> every data cell untouched
for tbl, cols in ((10, 9), (12, 8)):
    for r in (4, 5, 6):
        for col in range(1, cols + 1):
            placeholder("E", f"§{tbl} out of scope", f"r{r}c{col}", c, tbl, r, col)

# §8 recycling untouched (neither GRS nor RCS selected)
for r in (4, 5, 6, 7, 8):
    placeholder("E", "§8 not applicable", f"r{r}", c, 8, r, 2)
check("E", "§8 not applicable", "no material type ticked", c, 8, 2, 2, "☒", "notin")

# =====================================================================
# Scenario C — GRS initial + recycling postConsumer
# =====================================================================
p, root = load("C")
c = make(root)
print(f"--- Scenario C : {p.split(chr(92))[-1]}")
check("C", "standards", "GRS selected", c, 3, 36, 1, "☒", "in")
check("C", "initial/renewal", "GRS Initial", c, 3, 36, 2, "☒ Initial", "in")
check("C", "recycling", "postConsumer ticked", c, 8, 2, 2, "☒ はい、使用後材料", "in")
check("C", "recycling", "both NOT ticked", c, 8, 2, 2, "☐ はい、使用済み材料、使用前材料の両方", "in")
check("C", "recycling", "vr2Sites", c, 8, 4, 2, "N/A")
check("C", "recycling", "inputWaste multiline", c, 8, 5, 2, "使用済みPETボトル（使用済み材料）\n工場端材（使用前材料）")
check("C", "recycling", "collectorCount", c, 8, 6, 2, "約 25 社")
check("C", "chemical", "GRS chemicals はい", c, 6, 16, 2, "☒ はい", "in")
check("C", "chemical", "GOTS chemicals untouched", c, 6, 14, 2, "☐ はい  ☐ いいえ")
for r in (4, 5, 6):
    for col in range(1, 8):
        placeholder("C", "§9 not applicable", f"r{r}c{col}", c, 9, r, col)

# =====================================================================
# Scenario D — RCS renewal + previous CB
# =====================================================================
p, root = load("D")
c = make(root)
print(f"--- Scenario D : {p.split(chr(92))[-1]}")
check("D", "standards", "RCS selected", c, 3, 41, 1, "☒", "in")
check("D", "initial/renewal", "RCS Renewal ticked", c, 3, 41, 2, "☒ Renewal", "in")
check("D", "initial/renewal", "RCS Initial NOT ticked", c, 3, 41, 2, "☐ Initial", "in")
check("D", "previous CB", "prior RCS ticked", c, 3, 41, 3, "☒以前/現在", "in")
check("D", "previous CB", "prior GRS unticked", c, 3, 42, 3, "☐以前/現在", "in")
check("D", "previous CB", "licence no.", c, 3, 43, 4, "RCS-2023-00891")
check("D", "previous CB", "certifier", c, 3, 44, 4, "Control Union")
check("D", "previous CB", "renewal date", c, 3, 45, 4, "2026-03-31")
check("D", "recycling", "materialType none ticked", c, 8, 2, 2, "☒ リサイクル材料なし", "in")
for r in (4, 5, 6, 7, 8):
    placeholder("D", "§8 detail skipped when none", f"r{r}", c, 8, r, 2)

# ---- report ----
print()
combos = []
for s, a, *_ in PASS + FAIL:
    if (s, a) not in combos:
        combos.append((s, a))
print(f"{'scenario / area':<40}{'pass':>6}{'fail':>6}")
for s, a in combos:
    pn = sum(1 for x in PASS if x[0] == s and x[1] == a)
    fn = sum(1 for x in FAIL if x[0] == s and x[1] == a)
    print(f"{s + ' / ' + a:<40}{pn:>6}{fn:>6}")
print(f"{'TOTAL':<40}{len(PASS):>6}{len(FAIL):>6}")

if FAIL:
    print("\n=== MISMATCHES ===")
    for s, area, label, loc, actual, expected in FAIL:
        print(f"  [{s}][{area}] {label} @ {loc}")
        print(f"      expected: {expected!r}")
        print(f"      actual  : {actual!r}")
    sys.exit(1)
print("\nALL CONDITIONAL ASSERTIONS PASSED")

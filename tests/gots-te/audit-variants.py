#!/usr/bin/env python3
"""
Single-select option sweep — positional proof for every option of every mutually-exclusive
question in the official form.

MAX proves that the *selected* option lands correctly. It cannot prove the other 13 currencies,
the other recycled-material types, or the unpicked side of a yes/no pair, because one
application can only answer each question once. This generates one document per option (via
tools/emit-variants.mjs) and asserts positionally that:

  * the chosen option's official cell shows ☒
  * every sibling option in the same official row shows ☐

    python tests/gots-te/audit-variants.py [--keep]

The generated variants go to a temp directory and are deleted afterwards unless --keep is given.
"""
import json, os, shutil, subprocess, sys, tempfile, zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PASS, FAIL = [], []


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


def rows_of(path):
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml").decode("utf-8"))
    tables = [t for t in root.iter(W + "tbl")]
    return {i + 1: [r for r in t if r.tag == W + "tr"] for i, t in enumerate(tables)}


def cell(rows, tbl, row, col):
    try:
        return txt(cells(rows[tbl][row - 1])[col - 1])
    except (IndexError, KeyError):
        return None


def record(group, label, loc, ok, actual, expected):
    (PASS if ok else FAIL).append((group, label, loc, actual, expected))


# --- official positions of each single-select question -----------------------
# currency: table 3 row 2 cells 2-9, row 3 cells 2-7
CURRENCY_CELLS = {
    "USD": (2, 2), "RMB": (2, 3), "EURO": (2, 4), "TWD": (2, 5), "TRY": (2, 6),
    "CHF": (2, 7), "INR": (2, 8), "BDT": (2, 9),
    "JPY": (3, 2), "PKR": (3, 3), "KRW": (3, 4), "IDR": (3, 5), "VND": (3, 6), "OTHER": (3, 7),
}
# recycled-material type: all four options share one cell, table 8 row 2 cell 2
MATERIAL_LABELS = {
    "none": "リサイクル材料なし",
    "postConsumer": "はい、使用後材料",
    "preConsumer": "はい、使用前材料",
    "both": "はい、使用済み材料、使用前材料の両方",
}
# yes/no pairs rendered as "☒ はい  ☐ いいえ" in a single cell
YESNO_CELLS = {
    "chemicalCompliance.usesChemicalsGots": (6, 14, 2),
    "chemicalCompliance.usesChemicalsGrs": (6, 16, 2),
    "certifications.refusedBefore": (6, 19, 2),
    "facilitiesMeta.hasSubcontractors": (4, 28, 2),
}
OTHER_CERT_ROWS = list(range(3, 13))  # table 6 rows 3-12, cell 2


def check_currency(rows, chosen):
    for name, (r, c) in CURRENCY_CELLS.items():
        v = cell(rows, 3, r, c) or ""
        want = "☒" if name == chosen else "☐"
        record("payment.currency", f"{chosen}: {name} shows {want}",
               f"t3r{r}c{c}", want in v and (("☒" in v) == (name == chosen)), v[:24], want)
    if chosen == "OTHER":
        v = cell(rows, 3, 3, 8) or ""
        record("payment.currency", "OTHER free text written", "t3r3c8",
               v == "AUD (オーストラリアドル)", v, "AUD (オーストラリアドル)")
    else:
        v = cell(rows, 3, 3, 8) or ""
        record("payment.currency", f"{chosen}: OTHER free text left as placeholder", "t3r3c8",
               v.startswith("Click"), v[:24], "untouched placeholder")


def check_material(rows, chosen):
    v = cell(rows, 8, 2, 2) or ""
    for key, label in MATERIAL_LABELS.items():
        want = f"☒ {label}" if key == chosen else f"☐ {label}"
        record("recycling.materialType", f"{chosen}: {key} shows {want[0]}",
               "t8r2c2", want in v, v[:60], want)


def check_yesno(rows, path, chosen):
    tbl, r, c = YESNO_CELLS[path]
    v = cell(rows, tbl, r, c) or ""
    want = "☒ はい  ☐ いいえ" if chosen == "yes" else "☐ はい  ☒ いいえ"
    record(path, f"{chosen}", f"t{tbl}r{r}c{c}", v == want, v, want)


def check_other_certs(rows, chosen):
    want = "☒ はい  ☐ いいえ" if chosen == "yes" else "☐ はい  ☒ いいえ"
    for r in OTHER_CERT_ROWS:
        v = cell(rows, 6, r, 2) or ""
        record("otherCertifications.*", f"row {r} = {chosen}", f"t6r{r}c2", v == want, v, want)


def check_same_as_applicant(rows, chosen):
    v = cell(rows, 3, 8, 2) or ""
    want = "☒" if chosen == "yes" else "☐"
    record("payment.sameAsApplicant", chosen, "t3r8c2",
           want in v and (("☒" in v) == (chosen == "yes")), v[:30], want)
    # when mirrored, §2c must show the APPLICANT's company; when not, the payment company's
    applicant = cell(rows, 2, 2, 2) or ""
    company = cell(rows, 3, 9, 2) or ""
    ok = (company == applicant) if chosen == "yes" else (company != applicant and company != "")
    record("payment.sameAsApplicant", f"{chosen}: §2c company mirrored={chosen == 'yes'}",
           "t3r9c2", ok, company[:44], applicant[:44] if chosen == "yes" else "<distinct>")


# --- run ---------------------------------------------------------------------
keep = "--keep" in sys.argv
outdir = tempfile.mkdtemp(prefix="idfl-variants-")
try:
    proc = subprocess.run([shutil.which("node") or "node", "tests/gots-te/emit-variants.mjs", outdir],
                          cwd=ROOT, capture_output=True, text=True)
    if proc.returncode != 0:
        print("variant generation FAILED")
        print(proc.stdout[-4000:])
        print(proc.stderr[-4000:])
        sys.exit(2)
    manifest = json.loads(proc.stdout)

    for entry in manifest:
        rows = rows_of(entry["file"])
        group, option = entry["group"], entry["option"]
        if group == "payment.currency":
            check_currency(rows, option)
        elif group == "recycling.materialType":
            check_material(rows, option)
        elif group == "payment.sameAsApplicant":
            check_same_as_applicant(rows, option)
        elif group == "otherCertifications.*":
            check_other_certs(rows, option)
        elif group in YESNO_CELLS:
            check_yesno(rows, group, option)
        else:
            FAIL.append((group, "unhandled variant group", entry["id"], group, "handler"))
finally:
    if keep:
        print(f"variants kept in {outdir}")
    else:
        shutil.rmtree(outdir, ignore_errors=True)

print(f"variants generated: {len(manifest)}\n")
groups = []
for g, *_ in PASS + FAIL:
    if g not in groups:
        groups.append(g)
print(f"{'question':<42}{'pass':>6}{'fail':>6}")
for g in groups:
    p = sum(1 for x in PASS if x[0] == g)
    f = sum(1 for x in FAIL if x[0] == g)
    print(f"{g:<42}{p:>6}{f:>6}")
print(f"{'TOTAL':<42}{len(PASS):>6}{len(FAIL):>6}")

if FAIL:
    print("\n=== MISMATCHES ===")
    for group, label, loc, actual, expected in FAIL:
        print(f"  [{group}] {label} @ {loc}")
        print(f"      expected: {expected!r}")
        print(f"      actual  : {actual!r}")
    sys.exit(1)
print("\nALL SINGLE-SELECT OPTIONS PROVEN")

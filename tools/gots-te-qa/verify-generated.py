#!/usr/bin/env python3
"""
Independent verification of generated DOCX files.

Deliberately uses a DIFFERENT zip reader (python zipfile) and a DIFFERENT XML parser
(xml.etree) from the generator, so the generator cannot mark its own homework.

    python tools/gots-te-qa/verify-generated.py

Checks, per generated file:
  * opens as a valid ZIP, all entries readable, CRCs verified by zipfile
  * every part present in the master is present here
  * document.xml parses as XML
  * control count, checkbox states, ballot states
  * no PlaceholderText rStyle or showingPlcHdr left on a populated control
  * semantic spot-checks for the known scenario values
"""
import sys, zipfile, os, hashlib
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
W14 = "{http://schemas.microsoft.com/office/word/2010/wordml}"

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MASTER = os.path.join(ROOT, "files", "GOTS-TE-Application-Form-JP.docx")
GEN = os.path.join(ROOT, "generated")

failures = []


def fail(f, msg):
    failures.append(f"{f}: {msg}")
    print(f"    FAIL {msg}")


def controls(root):
    """(index, id, kind, checked, text, has_plchdr, has_placeholder_style)"""
    out = []
    for i, sdt in enumerate(root.iter(W + "sdt"), 1):
        pr = sdt.find(W + "sdtPr")
        cont = sdt.find(W + "sdtContent")
        idn = pr.find(W + "id")
        cid = idn.get(W + "val") if idn is not None else None
        cb = pr.find(W14 + "checkbox")
        combo = pr.find(W + "comboBox")
        kind = "CHK" if cb is not None else ("COMBO" if combo is not None else "TEXT")
        checked = None
        if cb is not None:
            ck = cb.find(W14 + "checked")
            checked = ck.get(W14 + "val") if ck is not None else None
        text = "".join(t.text or "" for t in cont.iter(W + "t"))
        plc = pr.find(W + "showingPlcHdr") is not None
        style = any(
            (rs.get(W + "val") == "PlaceholderText")
            for r in cont.iter(W + "r")
            for rPr in ([r.find(W + "rPr")] if r.find(W + "rPr") is not None else [])
            for rs in ([rPr.find(W + "rStyle")] if rPr.find(W + "rStyle") is not None else [])
        )
        out.append(dict(index=i, id=cid, kind=kind, checked=checked, text=text,
                        plchdr=plc, plcstyle=style))
    return out


def plain_ballots(root):
    parent = {c: p for p in root.iter() for c in p}

    def in_sdt(el):
        n = parent.get(el)
        while n is not None:
            if n.tag == W + "sdt":
                return True
            n = parent.get(n)
        return False

    return [t.text for t in root.iter(W + "t")
            if t.text and t.text.strip() in ("☐", "☒") and not in_sdt(t)]


def load(path):
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        if bad:
            raise RuntimeError(f"corrupt entry: {bad}")
        names = z.namelist()
        xml = z.read("word/document.xml").decode("utf-8")
    return names, xml, ET.fromstring(xml)


master_names, master_xml, master_root = load(MASTER)
master_controls = controls(master_root)
master_by_id = {c["id"]: c for c in master_controls}
print(f"master: {len(master_names)} parts, {len(master_controls)} controls, "
      f"{len(plain_ballots(master_root))} plain ballots\n")

EXPECT = {
    "A": {
        "text": [("TEST COMPANY - DO NOT USE 株式会社テスト繊維（A）", "applicant.companyName"),
                 ("オーガニックコットン平織り生地（30番手・幅150cm）", "products fabric detail"),
                 ("12", "GOTS chemical count"),
                 ("山田 太郎 / 品質管理部長", "signatory")],
        "absent": ["リサイクル", "アヒル"],
        "ballots_ticked": 2,
    },
    "B": {"text": [("オーガニックコットン糸 20/1, 30/1", "yarn detail")], "absent": ["アヒル"], "ballots_ticked": 3},
    "C": {"text": [("使用済みPETボトル（使用済み材料）", "recycling input waste line 1"),
                   ("工場端材（使用前材料）", "recycling input waste line 2"),
                   ("約 25 社", "collector count")],
          "absent": ["アヒル"], "ballots_ticked": 3},
    "D": {"text": [("RCS-2023-00891", "previous licence"), ("Control Union", "previous certifier")],
          "absent": ["アヒル"], "ballots_ticked": 3},
    "E": {"text": [("アヒル（北京種）", "waterfowl species"), ("450,000", "annual slaughter"),
                   ("TEST COMPANY - DO NOT USE テスト農場", "farm name")],
          "absent": ["リサイクルされる投入廃棄物"], "ballots_ticked": 2},
    "F": {"text": [("TEST COMPANY - DO NOT USE 施設 6", "facility 6 name"),
                   ("織布、編み物", "facility activities joined"),
                   ("検品", "facility activitiesOther appended")],
          "absent": [], "ballots_ticked": 2},
    "FULL": {"text": [("その他カテゴリー 8", "product other 8"),
                      ("GRS-2022-00123", "GRS previous licence"),
                      ("rep-test-do-not-use@example.co.jp", "representative email")],
             "absent": [], "ballots_ticked": 6},
}

files = sorted(f for f in os.listdir(GEN) if f.endswith(".docx"))
if not files:
    sys.exit("no generated files found — run tools/generate-test-docs.mjs first")

for fn in files:
    key = fn.split("_")[0]
    path = os.path.join(GEN, fn)
    print(f"=== {fn}")
    try:
        names, xml, root = load(path)
    except Exception as e:
        fail(fn, f"cannot open: {e}")
        continue

    missing = [n for n in master_names if n not in names]
    extra = [n for n in names if n not in master_names]
    if missing:
        fail(fn, f"missing parts: {missing}")
    if extra:
        fail(fn, f"unexpected parts: {extra}")

    cs = controls(root)
    if len(cs) != len(master_controls):
        fail(fn, f"control count {len(cs)} != master {len(master_controls)}")

    # checkbox coherence: w14:checked and the glyph must agree
    incoherent = [c for c in cs if c["kind"] == "CHK"
                  and ((c["checked"] == "1") != (c["text"].strip() == "☒"))]
    if incoherent:
        fail(fn, f"{len(incoherent)} checkbox(es) with state/glyph mismatch, e.g. #{incoherent[0]['index']}")

    # populated controls must not keep placeholder markers
    dirty = []
    for c in cs:
        m = master_by_id.get(c["id"])
        if m is None:
            continue
        if c["text"] != m["text"] and c["kind"] in ("TEXT", "COMBO"):
            if c["plchdr"] or c["plcstyle"]:
                dirty.append(c["index"])
    if dirty:
        fail(fn, f"{len(dirty)} populated control(s) still carry placeholder markers: {dirty[:5]}")

    ticked = sum(1 for b in plain_ballots(root) if b.strip() == "☒")
    total_ballots = len(plain_ballots(root))
    if total_ballots != 20:
        fail(fn, f"plain ballot count {total_ballots} != 20")

    exp = EXPECT.get(key)
    if exp:
        if ticked != exp["ballots_ticked"]:
            fail(fn, f"ticked ballots {ticked} != expected {exp['ballots_ticked']}")
        body = "".join(c["text"] for c in cs)
        for needle, label in exp["text"]:
            if needle not in body:
                fail(fn, f"missing value [{label}]: {needle!r}")
        for needle in exp["absent"]:
            if needle in body:
                fail(fn, f"value that should be absent is present: {needle!r}")

    checked_n = sum(1 for c in cs if c["kind"] == "CHK" and c["checked"] == "1")
    populated = sum(1 for c in cs if c["kind"] in ("TEXT", "COMBO")
                    and c["text"] != master_by_id.get(c["id"], {}).get("text"))
    print(f"    parts={len(names)} controls={len(cs)} checked={checked_n} "
          f"ballots☒={ticked}/{total_ballots} populatedText={populated}")
    if not any(f.startswith(fn) for f in failures):
        print("    OK")

print()
print(f"master sha256 after verification: {hashlib.sha256(open(MASTER,'rb').read()).hexdigest()}")
print()
if failures:
    print(f"{len(failures)} FAILURE(S)")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("ALL INDEPENDENT CHECKS PASSED")

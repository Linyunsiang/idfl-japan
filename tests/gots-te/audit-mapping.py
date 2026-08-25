#!/usr/bin/env python3
"""
Functional mapping audit.

Reads a GENERATED docx positionally — by table / row / cell and the official label printed
next to each value — and dumps what a human would see in Word. It deliberately does NOT use
the mapping file or control ids, so a value written into the wrong official cell shows up.

    python tests/gots-te/audit-mapping.py generated/FULL_*.docx
"""
import sys, glob, zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
W14 = "{http://schemas.microsoft.com/office/word/2010/wordml}"

path = sys.argv[1] if len(sys.argv) > 1 else sorted(glob.glob("generated/FULL_*.docx"))[0]
xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8")
root = ET.fromstring(xml)
parent = {c: p for p in root.iter() for c in p}


def in_sdt(el):
    n = parent.get(el)
    while n is not None:
        if n.tag == W + "sdt":
            return True
        n = parent.get(n)
    return False


def txt(el, sep=""):
    """Visible text. Content-control values are included; <w:br/> becomes ' / '."""
    out = []

    def walk(e):
        for ch in e:
            if ch.tag == W + "t":
                out.append(ch.text or "")
            elif ch.tag == W + "br":
                out.append(" / ")
            elif ch.tag == W + "tab":
                out.append(" ")
            else:
                walk(ch)

    walk(el)
    return sep.join("".join(out).split("\n")).strip()


def cells(tr):
    """Row cells in visual order.

    A cell may be wrapped in one OR MORE nested content controls
    (w:tr > w:sdt > w:sdtContent > w:sdt > w:sdtContent > w:tc), so unwrap recursively.
    Unwrapping only one level silently hides the answer cell of §4 その他 and all of §8.
    """
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

print(f"FILE: {path}\n")
for ti, tbl in enumerate(tables, 1):
    rows = [r for r in tbl if r.tag == W + "tr"]
    header = txt(rows[0])[:60] if rows else ""
    print(f"########## TABLE {ti}  ({len(rows)} rows)  first row: {header!r}")
    for ri, tr in enumerate(rows, 1):
        cs = cells(tr)
        vals = [txt(c) for c in cs]
        if not any(v for v in vals):
            continue
        line = " | ".join(v[:78] for v in vals)
        print(f"  r{ri:<3} {line}")
    print()

#!/usr/bin/env python3
"""
Mapping coverage report — which official Word controls does the fixture suite actually exercise?

Answers three questions that a passing assertion suite cannot:
  1. Is every control referenced by mapping.json reachable — i.e. does some fixture populate it?
  2. Which controls does MAX / MAXINIT populate on their own?
  3. Which controls in the master are NOT referenced by mapping.json at all, and why?

Independent of the generator: reads the master and each generated file with python zipfile +
xml.etree, and calls a control "exercised" when its text differs from the master's.

    python tests/gots-te/coverage-report.py
"""
import glob, json, os, sys, zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
W14 = "{http://schemas.microsoft.com/office/word/2010/wordml}"

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MASTER = os.path.join(ROOT, "files", "GOTS-TE-Application-Form-JP.docx")
MAPPING = os.path.join(ROOT, "application", "gots-te",
                       "templates", "GOTS-TE-V7.0-DCN25-013", "mapping.json")


def document(path):
    return ET.fromstring(zipfile.ZipFile(path).read("word/document.xml").decode("utf-8"))


def control_texts(root):
    """1-based control index -> concatenated text, in document order."""
    return {i: "".join(t.text or "" for t in sdt.find(W + "sdtContent").iter(W + "t"))
            for i, sdt in enumerate(root.iter(W + "sdt"), 1)}


def ballot_states(root):
    """1-based ballot ordinal -> glyph, for the plain ☐/☒ runs that live OUTSIDE any sdt."""
    parent = {c: p for p in root.iter() for c in p}

    def in_sdt(el):
        n = parent.get(el)
        while n is not None:
            if n.tag == W + "sdt":
                return True
            n = parent.get(n)
        return False

    out = {}
    n = 0
    for t in root.iter(W + "t"):
        if t.text and t.text.strip() in ("☐", "☒") and not in_sdt(t):
            n += 1
            out[n] = t.text.strip()
    return out


mapping = json.load(open(MAPPING, encoding="utf-8"))

# ---- every control index mapping.json can write, with the path it writes ----
mapped = {}
for entry in mapping["text"] + mapping["combo"]:
    mapped[entry["control"]] = entry["path"]
for entry in mapping["checkbox"]:
    suffix = entry.get("whenEquals", entry.get("whenIncludes"))
    mapped[entry["control"]] = entry["path"] + (f"=={suffix}" if suffix is not None else "")
for i, row in enumerate(mapping["repeat"]["productOthers"]):
    mapped[row["selected"]["control"]] = f"products.others[{i}].selected"
    for f in row["fields"]:
        mapped[f["control"]] = f"products.others[{i}].{f['key']}"
for i, row in enumerate(mapping["repeat"]["facilities"]):
    for f in row["fields"]:
        mapped[f["control"]] = f"facilities[{i}].{f['key']}"
for table_key, table in mapping["repeat"]["rds"].items():
    for i, row in enumerate(table["rows"]):
        for f in row["fields"]:
            mapped[f["control"]] = f"rds.{table_key}[{i}].{f['key']}"

master_root = document(MASTER)
master_text = control_texts(master_root)
TOTAL_CONTROLS = len(master_text)
TOTAL_BALLOTS = len(ballot_states(master_root))

files = sorted(glob.glob(os.path.join(ROOT, "generated", "*.docx")))
if not files:
    print("no generated files — run node tests/gots-te/generate-test-docs.mjs")
    sys.exit(2)

per_file_controls, per_file_ballots = {}, {}


def ingest(tag, path):
    root = document(path)
    texts = control_texts(root)
    per_file_controls[tag] = per_file_controls.get(tag, set()) | {
        i for i, v in texts.items() if v != master_text.get(i)}
    per_file_ballots[tag] = per_file_ballots.get(tag, set()) | {
        n for n, g in ballot_states(root).items() if g == "☒"}


for path in files:
    ingest(os.path.basename(path).split("_")[0], path)

# The single-select sweep (tools/audit-variants.py) reaches options no on-disk fixture can:
# one application answers "currency" once, so 13 of the 14 currency boxes are unreachable
# without it. Include those documents here unless --no-variants is passed.
if "--no-variants" not in sys.argv:
    import shutil, subprocess, tempfile
    tmp = tempfile.mkdtemp(prefix="idfl-coverage-variants-")
    try:
        proc = subprocess.run([shutil.which("node") or "node", "tests/gots-te/emit-variants.mjs", tmp],
                              cwd=ROOT, capture_output=True, text=True)
        if proc.returncode != 0:
            print("WARNING: variant generation failed; coverage below excludes the sweep")
            print(proc.stderr[-2000:])
        else:
            for entry in json.loads(proc.stdout):
                ingest("variants", entry["file"])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

exercised = set().union(*per_file_controls.values())
ballots_hit = set().union(*per_file_ballots.values())

print(f"master: {TOTAL_CONTROLS} controls, {TOTAL_BALLOTS} plain ballots")
print(f"mapping.json addresses {len(mapped)} controls and {len(mapping['ballot'])} ballots\n")

print(f"{'file':<10}{'controls changed':>18}{'ballots ☒':>12}")
for tag in sorted(per_file_controls, key=lambda t: -len(per_file_controls[t])):
    print(f"{tag:<10}{len(per_file_controls[tag]):>18}{len(per_file_ballots[tag]):>12}")
print()

problems = 0

# ---- 1. mapped controls no fixture ever reaches ----
never = sorted(c for c in mapped if c not in exercised)
if never:
    problems += 1
    print(f"MAPPED BUT NEVER EXERCISED — {len(never)} control(s):")
    for c in never:
        print(f"  #{c:<4} {mapped[c]}")
else:
    print(f"MAPPED AND EXERCISED : {len(mapped)}/{len(mapped)} — every mapped control is reachable")

# ---- 2. mapped ballots no fixture ever ticks ----
ballot_paths = {b["ordinal"]: f"{b['path']}=={b['whenEquals']}" for b in mapping["ballot"]}
never_b = sorted(o for o in ballot_paths if o not in ballots_hit)
if never_b:
    problems += 1
    print(f"\nMAPPED BALLOTS NEVER TICKED — {len(never_b)}:")
    for o in never_b:
        print(f"  ballot #{o:<3} {ballot_paths[o]}")
else:
    print(f"BALLOTS TICKED       : {len(ballot_paths)}/{len(ballot_paths)} — every initial/renewal "
          f"and yes/no ballot is proven")

# ---- 3. controls the mapping does not address ----
unmapped = sorted(c for c in master_text if c not in mapped)
unmapped_touched = [c for c in unmapped if c in exercised]
print(f"\nUNMAPPED CONTROLS    : {len(unmapped)} of {TOTAL_CONTROLS}")
print(f"  of which changed by generation (nested duplicates sharing an outer control's w:t): "
      f"{len(unmapped_touched)}")
print(f"  of which never changed (placeholders left for wet-ink / not part of the form): "
      f"{len(unmapped) - len(unmapped_touched)}")

# ---- 4. MAX-specific coverage ----
max_controls = per_file_controls.get("MAX", set()) | per_file_controls.get("MAXINIT", set())
max_ballots = per_file_ballots.get("MAX", set()) | per_file_ballots.get("MAXINIT", set())
covered_by_max = sorted(c for c in mapped if c in max_controls)
missed_by_max = sorted(c for c in mapped if c not in max_controls)
print(f"\nMAX + MAXINIT alone  : {len(covered_by_max)}/{len(mapped)} mapped controls, "
      f"{len(max_ballots)}/{len(ballot_paths)} ballots")
if missed_by_max:
    print("  mapped controls NOT reached by MAX/MAXINIT (covered by other fixtures):")
    for c in missed_by_max:
        others = sorted(t for t, s in per_file_controls.items() if c in s)
        print(f"    #{c:<4} {mapped[c]:<48} covered by: {', '.join(others) or 'NOBODY'}")

print()
if problems:
    print("COVERAGE GAPS FOUND")
    sys.exit(1)
print("NO MAPPING MISMATCH — every mapped control and ballot is exercised by the fixture suite")

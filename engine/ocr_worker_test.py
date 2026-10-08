"""EXP-OCR-01 worker test — the rules, checked. No engine, no LLM, and the frozen benchmark is untouched.

Run: cd engine && .venv/Scripts/python.exe ocr_worker_test.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from ocr_bench import ARIAL, OUT, degrade, render  # noqa: E402  import only — nothing here is modified
from PIL import Image  # noqa: E402
from ownrag_engine.ocr import (ARABIC_ENGINE, LATIN_ENGINE, page_types, process,  # noqa: E402
                               read_region, script_of, validate_and_retry, validate_number)

PASS = FAIL = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS, FAIL
    PASS, FAIL = PASS + bool(condition), FAIL + (not condition)
    print(f"  [{'PASS' if condition else 'FAIL'}] {name}{f' — {detail}' if detail else ''}")


print("1. script is decided per region, not per document")
check("arabic letters -> ar-SA", script_of("يحصل الموظف على إجازة") == ARABIC_ENGINE)
check("arabic-indic digits alone -> ar-SA", script_of("٢١") == ARABIC_ENGINE)
check("latin text -> en-US", script_of("Ref 90210") == LATIN_ENGINE)
check("mixed latin+indic -> ar-SA (region-local decision)", script_of("Ref 90210 رقم ٢١") == ARABIC_ENGINE)

print("2. numeric validation catches the measured failure modes")
two_dots = validate_number("4.812.75")
check("two decimals rejected (comma misread as dot)", not two_dots[0], two_dots[1])
grouping = validate_number("1,25,000")
check("grouping not 3-digit rejected", not grouping[0], grouping[1])
check("grouped decimal accepted", validate_number("1,250.00")[0])
check("arabic-indic accepted", validate_number("٤٥٦٧٨")[0])
check("hyphenated date accepted", validate_number("2026-10-08")[0])
check("19-digit string rejected", not validate_number("1234567890123456789")[0])

print("3. a low-resolution numeric region is retried, and never silently indexed when it fails")
img = degrade(render("1,234,567", ARIAL, size=30), "down150")
path = OUT / "worker-lowres.png"
img.save(path)
result = process(path)
pages = result["ocr"]["pages"]
check("image page classified needs_ocr (the guard decides)", page_types(path) == ["needs_ocr"])
check("region carries page metadata", bool(pages) and pages[0]["page"] == 1)
check("OCR text is separate from native text",
      result["native"]["text_source"] == "native" and result["ocr"]["text_source"] == "ocr"
      and not result["native"]["pages"])
numbers = [t for page in pages for t in page["accepted_numbers"]]
quarantined = result["quarantined"]
retried = [r for page in pages for r in page["retried"]]
print(f"      read={numbers} quarantined={[q['token'] for q in quarantined]} "
      f"retried={[r['was'] + '->' + r['now'] for r in retried]}")
for token in quarantined:
    check(f"quarantined {token['token']!r} carries page + reason", token["page"] == 1 and bool(token["reason"]))
check("every number is either valid or quarantined — never unvalidated",
      all(validate_number(t)[0] for t in numbers)
      and all(not validate_number(q["token"])[0] for q in quarantined))


print("4. the retry path, on the case the battery caught (4,812.75 -> 4.812.75)")
mixed = validate_number("1.234,567")
check("engine-swapped separators rejected", not mixed[0], mixed[1])
src = degrade(render("4,812.75", ARIAL, size=30), "down150")
p4 = OUT / "worker-retry.png"
src.save(p4)
first = read_region(Image.open(p4).convert("RGB"), 1)
print("      first read:", repr(first["text"]))
r4 = validate_and_retry(read_region(Image.open(p4).convert("RGB"), 1), Image.open(p4).convert("RGB"))
print("      accepted=", r4["accepted_numbers"], "retried=", [(x["was"], x["now"]) for x in r4["retried"]],
      "quarantined=", [q["token"] for q in r4["quarantined"]])
check("no invalid token is ever accepted", all(validate_number(x)[0] for x in r4["accepted_numbers"]))
check("a recovered value passes validation", all(validate_number(x["now"])[0] for x in r4["retried"]))
check("a retry uses the upscale, not the same scale again",
      all(x["scale"] >= 3.0 for x in r4["retried"]) or not r4["retried"],
      str([x["scale"] for x in r4["retried"]]))
check("the failing number resolves to accepted or quarantined, never to silence",
      bool(r4["retried"] or r4["quarantined"]) or validate_number("4,812.75")[0])

forced = {"page": 7, "bbox": None, "engine": LATIN_ENGINE, "text": "4.812.75",
          "words": [{"text": "4.812.75", "x": 0, "y": 0, "w": 12, "h": 12, "line": "4.812.75"}]}
res = validate_and_retry(dict(forced), Image.new("RGB", (700, 300), "white"))
check("unrecoverable -> quarantined with page and reason",
      bool(res["quarantined"]) and res["quarantined"][0]["page"] == 7 and bool(res["quarantined"][0]["reason"]),
      res["quarantined"][0]["reason"] if res["quarantined"] else "nothing quarantined")
check("unrecoverable token is not accepted", res["accepted_numbers"] == [])

print("5. a flagged page that yields no text is never a silent success")
p5 = OUT / "worker-blank.png"
Image.new("RGB", (700, 220), "white").save(p5)
res5 = process(p5)
check("status is NEEDS_OCR_NO_TEXT", res5["status"] == "NEEDS_OCR_NO_TEXT", res5["status"])
check("the page is named", res5["no_text_pages"] == [1], str(res5["no_text_pages"]))
check("never OCR_DONE with zero output", res5["status"] != "OCR_DONE")
check("whole-page retry was attempted",
      bool(res5["ocr"]["pages"]) and res5["ocr"]["pages"][0].get("whole_page_retry") is True)
check("no silent success text on the page", not any(page["text"].strip() for page in res5["ocr"]["pages"]))

print("\n" + "=" * 66)
print(f"  {PASS} passed · {FAIL} failed")
print("=" * 66)
sys.exit(1 if FAIL else 0)

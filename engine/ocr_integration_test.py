"""EXP-OCR-01 integration test - the six end-to-end behaviours. No engine, no LLM, frozen benchmark untouched."""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import pymupdf  # noqa: E402
from PIL import Image  # noqa: E402
from ocr_bench import ARIAL, OUT, degrade, render  # noqa: E402
from ownrag_engine.ocr import (LATIN_ENGINE, ocr_chunks_for, page_types, process,  # noqa: E402
                               validate_and_retry, validate_number)

PASS = FAIL = 0


def check(name, condition, detail=""):
    global PASS, FAIL
    PASS, FAIL = PASS + bool(condition), FAIL + (not condition)
    print(f"  [{'PASS' if condition else 'FAIL'}] {name}{f' - {detail}' if detail else ''}")


def build_pdf(path, pages):
    doc = pymupdf.open()
    for kind, *rest in pages:
        page = doc.new_page()
        if kind == "text":
            page.insert_text((72, 100), rest[0], fontsize=rest[1] if len(rest) > 1 else 11)
        else:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 120, 120))
            pix.set_rect(pix.irect, (40, 90, 160))
            page.insert_image(pymupdf.Rect(60, 60, 300, 300), pixmap=pix)
    doc.save(path)
    doc.close()
    return path


print("1. normal text stays native - never sent to OCR")
txt = OUT / "e2e-native.txt"
txt.write_text("The nightly build finished at 03:14 UTC and the index was rebuilt.", encoding="utf-8")
check("classified native", page_types(txt) == ["native"], str(page_types(txt)))
res1 = process(txt)
check("no OCR performed", res1["status"] == "NO_OCR_NEEDED" and not res1["ocr"]["pages"], res1["status"])
check("no OCR chunks produced", ocr_chunks_for(txt)["ocr_chunks"] == [])

print("2. an image becomes OCR, with page and source on the chunk")
img = render("Graph retrieval report, build 03:14 UTC.", ARIAL, size=26)
p2 = OUT / "e2e-image.png"
img.save(p2)
chunks2 = ocr_chunks_for(p2)
check("status is OCR_DONE", chunks2["status"] == "OCR_DONE", chunks2["status"])
check("chunks exist and are sourced as OCR", bool(chunks2["ocr_chunks"]) and all(c["source"] == "ocr" for c in chunks2["ocr_chunks"]))
check("every OCR chunk carries a page", all(isinstance(c["page"], int) for c in chunks2["ocr_chunks"]))
check("native chunks are kept apart (none returned here)", "ocr_chunks" in chunks2 and all(c["source"] != "native" for c in chunks2["ocr_chunks"]))

print("3. a mixed PDF keeps both paths: text pages native, image page OCR")
mixed = build_pdf(OUT / "e2e-mixed.pdf", [("text", "The nightly build finished at 03:14 UTC."), ("image",)])
check("page types are native then needs_ocr", page_types(mixed) == ["native", "needs_ocr"], str(page_types(mixed)))
res3 = process(mixed)
check("only the image page was OCR'd", [p["page"] for p in res3["ocr"]["pages"]] == [2], str([p["page"] for p in res3["ocr"]["pages"]]))
check("the OCR page carries page metadata", res3["ocr"]["pages"][0]["page"] == 2)

print("4. an invalid number is quarantined, not indexed (forced deterministically)")
bad = degrade(render("4,812.75", ARIAL, size=30), "down150")
p4 = OUT / "e2e-badnum.png"
bad.save(p4)
res4 = process(p4)
accepted4 = [t for p in res4["ocr"]["pages"] for t in p["accepted_numbers"]]
print("      live render:", accepted4, [q["token"] for q in res4["quarantined"]], res4["status"])
check("nothing invalid is accepted from the live render", all(validate_number(t)[0] for t in accepted4))
# The live render is NOT reliable as a fixture: the same PNG has been read correctly, as 4.812.75,
# and as nothing at all across runs. So the quarantine assertion is forced with a token that cannot
# be recovered - a bad number whose word box sits on blank paper - exactly as the worker test does.
forced = {"page": 4, "bbox": None, "engine": LATIN_ENGINE, "text": "4.812.75",
          "words": [{"text": "4.812.75", "x": 0, "y": 0, "w": 12, "h": 12, "line": "4.812.75"}]}
res4f = validate_and_retry(dict(forced), Image.new("RGB", (600, 200), "white"))
check("forced invalid number is quarantined with a reason",
      bool(res4f["quarantined"]) and bool(res4f["quarantined"][0]["reason"]) and res4f["accepted_numbers"] == [],
      res4f["quarantined"][0]["reason"] if res4f["quarantined"] else "nothing quarantined")

print("5. moderate-size number: 200 DPI vs 400 DPI (outcome recorded, recovery NOT claimed)")
mid = build_pdf(OUT / "e2e-mid.pdf", [("image", "Total 4,812.75 due", 10)])
res5 = process(mid)
page5 = res5["ocr"]["pages"][0] if res5["ocr"]["pages"] else {}
accepted5 = page5.get("accepted_numbers", [])
retries5 = page5.get("retried", [])
quar5 = [q["token"] for q in page5.get("quarantined", [])]
print("      first text:", repr(page5.get("text", "")))
print("      accepted=", accepted5, "retried=", [(r["was"], r["now"], r.get("via")) for r in retries5],
      "quarantined=", quar5, "status=", res5["status"])
check("nothing invalid is indexed", all(validate_number(t)[0] for t in accepted5))
check("a number that cannot be read is not silently dropped",
      bool(accepted5 or quar5 or res5["no_text_pages"] or page5.get("text")))
if retries5:
    print("      RECOVERY OBSERVED:", [(r["was"], r["now"], r.get("via")) for r in retries5])
else:
    print("      no recovery on this fixture - recovery is NOT claimed yet")

print("6. a flagged page with no text becomes NEEDS_OCR_NO_TEXT")
blank = OUT / "e2e-blank.png"
Image.new("RGB", (700, 220), "white").save(blank)
res6 = process(blank)
check("status is NEEDS_OCR_NO_TEXT", res6["status"] == "NEEDS_OCR_NO_TEXT", res6["status"])
check("never a silent OCR_DONE", res6["status"] != "OCR_DONE")
check("the page is named", res6["no_text_pages"] == [1], str(res6["no_text_pages"]))

print()
print("=" * 66)
print(f"  {PASS} passed, {FAIL} failed")
print("=" * 66)
sys.exit(1 if FAIL else 0)

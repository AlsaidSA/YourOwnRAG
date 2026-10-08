"""OCR numeric battery — exact-string accuracy, because for numbers CER hides the failure that matters.

A date read as 2026-10-08 when the page says 2026-10-09 has CER ~0.09 and is completely wrong. So the
headline here is EXACT: the sequence of numeric tokens (digits together with their separators) must match
the reference. Character-bag accuracy is a companion, never the verdict. Mixed Arabic/Latin items are run
through BOTH engines, because which engine reads a mixed-script number is itself a design question.

Run: cd engine && .venv/Scripts/python.exe ocr_num_bench.py     -> ocr-test/bench_num.json
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from ocr_bench import (ARABIC_ENGINE, ARIAL, LATIN_ENGINE, OUT, bag_cer, degrade,  # noqa: E402
                       normalise, ocr, render, render_ar, rtl_normalise)

NUMTOK = re.compile(r"[0-9\u0660-\u0669\u06F0-\u06F9]+(?:[.,/\u066B\u066C][0-9\u0660-\u0669\u06F0-\u06F9]+)*")
ARABICISH = re.compile(r"[\u0600-\u06FF]")
ARABIC_DIGITS = re.compile(r"[\u0660-\u0669\u06F0-\u06F9]")

CATS: dict[str, list[str]] = {
    "date": ["2026-10-08", "08/10/2026", "October 8, 2026", "٣٠/٠٩/٢٠٢٦"],
    "decimal": ["4,812.75", "0.875", "18.5%", "١٢٣٤٥.٦٧"],
    "thousands": ["1,234,567", "12,500", "9,876,543,210", "٩٨٧٦٥٤٣٢١"],
    "id": ["Ref 90210", "Cheque 4455667", "INV-2026-0042", "رقم ٤٥٦٧٨"],
    "latin": ["90210", "4455667", "2026", "481275"],
    "indic": ["٢١", "٣٠", "١٢٣٤٥", "٤٥٦٧٨٩٠"],
    "mixed": ["الرقم 21 والتاريخ 2026", "المبلغ 1,250.00 ريال", "Ref 90210 رقم ٢١"],
}
LOWRES = ("date", "decimal", "id", "mixed")


def tokens(text: str, rtl: bool = False) -> list[str]:
    # ar-SA returns Arabic in visual order, exactly as the prose axis showed. Map back before
    # extracting numbers, or a correctly-read date is scored as a failure purely for its order.
    if rtl:
        text = " ".join(normalise(text).split()[::-1])
    return NUMTOK.findall(text)


def squash(text: str) -> str:
    return re.sub(r"\s+", "", normalise(text))


def engines_for(item: str) -> list[str]:
    arabic = bool(ARABICISH.search(item))
    latin = bool(re.search(r"[A-Za-z]", item))
    if arabic and latin:
        return [LATIN_ENGINE, ARABIC_ENGINE]          # mixed script: ask both, report both
    return [ARABIC_ENGINE] if arabic or ARABIC_DIGITS.search(item) else [LATIN_ENGINE]


def run(cat: str, item: str, downscale: bool = False) -> None:
    for engine in engines_for(item):
        img = render_ar(item, f"{cat}-{engine}") if ARABICISH.search(item) else render(item, ARIAL, size=30)
        if downscale:
            img = degrade(img, "down150")
        path = OUT / f"num-{cat}-{engine}-{len(rows)}.png"
        img.save(path)
        hyp = ocr(path, engine)
        rtl = engine == ARABIC_ENGINE
        hyp_cmp = rtl_normalise(hyp) if rtl else normalise(hyp)
        ref_tok, hyp_tok = tokens(item), tokens(hyp, rtl)
        rows.append({
            "cat": cat, "item": item, "engine": engine, "downscale": downscale,
            "exact": ref_tok == hyp_tok, "bag": sorted(ref_tok) == sorted(hyp_tok),
            "squash": squash(item) == squash(hyp_cmp),
            "bag_cer": round(bag_cer(normalise(item), hyp_cmp), 3),
            "ref_tokens": ref_tok, "hyp_tokens": hyp_tok, "hyp_raw": hyp_cmp[:56],
        })


rows: list[dict] = []
for category, items in CATS.items():
    for item in items:
        run(category, item)
    if category in LOWRES:
        for item in items[:2]:
            run(f"{category}-lowres", item, downscale=True)

print(f"=== numeric battery: {len(rows)} measurements ===")
seen: dict[str, list[dict]] = {}
for row in rows:
    seen.setdefault(row["cat"], []).append(row)
for cat, rs in seen.items():
    exact = sum(1 for r in rs if r["exact"])
    print(f"  {cat:<15} exact={exact}/{len(rs)}  token-bag={sum(1 for r in rs if r['bag'])}/{len(rs)}"
          f"  meanBagCER={sum(r['bag_cer'] for r in rs) / len(rs):.3f}")

print("\n=== every exact-match failure (the actionable list) ===")
for r in rows:
    if not r["exact"]:
        print(f"  {r['cat']:<14} {r['engine']:<6} ref={r['ref_tokens']} got={r['hyp_tokens']}"
              f"{' [lowres]' if r['downscale'] else ''}")
        print(f"                 raw: {r['hyp_raw']!r}")

total = len(rows)
print(f"\n  OVERALL exact={sum(1 for r in rows if r['exact'])}/{total}"
      f"  token-bag={sum(1 for r in rows if r['bag'])}/{total}"
      f"  squash={sum(1 for r in rows if r['squash'])}/{total}")
(OUT.parent / "bench_num.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"  written: ocr-test/bench_num.json")

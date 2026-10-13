"""EXP-OCR-02 — Tesseract measured on the FROZEN benchmark's own cases.

The frozen benchmark (`ocr_bench.py`) and its record (`OCR-BENCH-FREEZE.md`, `ocr-test/bench.json`) are
not modified: this runner imports that module, swaps its single backend seam (`ocr`), and calls its
`main()`. Same texts, same renders, same degradations, same seed, same metrics — one axis changed.

Two deliberate differences from the winsdk run, both stated rather than hidden:

  1. Ordering. Windows OCR returns Arabic in VISUAL order, so the frozen bench reverses the hypothesis's
     word order before scoring. Tesseract returns Arabic in LOGICAL order, so that reversal would corrupt
     every line. `rtl_normalise` is therefore an identity here (still stripping tashkeel where asked).
  2. Timing. Each case is timed, because the swap changes the ingestion cost of a scanned page.

Run: cd engine && .venv/Scripts/python.exe ocr_bench_tesseract.py
Writes ocr-test/bench-tesseract.json. That directory is gitignored scratch; the record that matters is the
tracked `OCR-BENCH-FREEZE.md`. `bench.main()` writes its own ocr-test/bench.json, so if one is present when
this runs it is copied to ocr-test/bench-winsdk-frozen.json before the run and the fresh output is moved
aside — the frozen file is never overwritten. On a checkout where that scratch file was never generated
(the usual case) there is nothing to preserve and the copy step is skipped.
"""
from __future__ import annotations

import json
import pathlib
import shutil
import time

import ocr_bench as bench                                    # the frozen benchmark, imported not edited
from ownrag_engine import ocr as worker

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "ocr-test"
OUT.mkdir(parents=True, exist_ok=True)

# Recorded winsdk means from OCR-BENCH-FREEZE.md (2026-10-08), quoted for the side-by-side.
WINSDK_FROZEN = {
    "en": {"cer": 0.002, "n": 5, "note": "Latin clean"},
    "degraded": {"cer": 0.024, "n": 20, "note": "JPEG/blur/noise/downscale/rotate"},
    "ar": {"cer": 0.172, "n": 6, "note": "Arabic, incl. tashkeel and 18pt"},
    "num": {"cer": None, "n": 2, "note": "numeric battery, bagCER used"},
    "hand": {"cer": 0.266, "n": 1, "note": "handwriting FONT"},
}

TIMES: list[float] = []


def tesseract_ocr(path, lang_tag: str) -> str:
    """The PRODUCTION page path: the frozen fixture through the worker's own `process()`.

    `lang_tag` is deliberately unused. The worker decides the script per REGION (its rule 2), and the
    page preparation the swap added (upscale, then median) lives in that path — measuring anything
    lower would score a configuration that is not the one that ships.
    """
    began = time.perf_counter()
    result = worker.process(pathlib.Path(path))
    TIMES.append(time.perf_counter() - began)
    return "\n".join(page["text"] for page in result["ocr"]["pages"])


def logical_order(text: str, strip_tashkeel: bool = False) -> str:
    """Tesseract already reads Arabic in logical order: normalise, never reverse."""
    return bench.normalise(text, strip_tashkeel)


def main() -> None:
    existing = OUT / "bench.json"
    if existing.exists():
        shutil.copy2(existing, OUT / "bench-winsdk-frozen.json")
        print(f"  preserved the frozen record -> ocr-test/bench-winsdk-frozen.json")

    bench.ocr = tesseract_ocr                              # the single seam
    bench.rtl_normalise = logical_order
    bench.main()                                           # the frozen case set, unchanged

    produced = OUT / "bench.json"
    if produced.exists():
        shutil.move(str(produced), str(OUT / "bench-tesseract.json"))

    data = json.loads((OUT / "bench-tesseract.json").read_text(encoding="utf-8"))

    print("\n=== Tesseract vs the recorded winsdk baseline (mean CER over each axis) ===")
    print(f"  {'axis':<9} {'winsdk':>8} {'tesseract':>10}   verdict")
    for axis, row in sorted(data["axes"].items()):
        baseline = WINSDK_FROZEN.get(axis, {}).get("cer")
        was = f"{baseline:.3f}" if baseline is not None else "  —  "
        now = row["cer"]
        if baseline is None:
            verdict = "no single-number baseline; compare case by case"
        elif now < baseline * 0.9:
            verdict = "better"
        elif now > baseline * 1.1:
            verdict = "worse"
        else:
            verdict = "within 10%"
        print(f"  {axis:<9} {was:>8} {now:>10.3f}   {verdict}  (n={row['n']})")

    print("\n=== per-case, Arabic (the axis the swap is most likely to move) ===")
    for case in data["cases"]:
        if case["axis"] != "ar":
            continue
        extra = f"  notashkeel={case.get('cer_no_tashkeel')}" if "cer_no_tashkeel" in case else ""
        print(f"  {case['name']:<14} CER={case['cer']:.3f} WER={case['wer']:.3f} "
              f"bagCER={case['bag_cer']:.3f}{extra}")

    if TIMES:
        TIMES.sort()
        print(f"\n=== cost: {len(TIMES)} reads, median {TIMES[len(TIMES) // 2]:.2f}s, "
              f"slowest {TIMES[-1]:.2f}s per image ===")
    print("  written: ocr-test/bench-tesseract.json")


if __name__ == "__main__":
    main()

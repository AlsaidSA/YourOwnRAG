"""EXP-OCR-02c — can confidence choose the scale? If it can, the worker can escalate per page
instead of guessing one setting for every document.

The ladder the worker already uses for numbers (read, and if the read looks wrong, try harder) is the
natural home for this: read at the page's own resolution, and only spend the extra pass when the first
read is empty or unconvincing. That needs a signal that separates the two cases the sweep exposed —
Arabic small text (which needs 2x) from the salted-noise page (which 2x destroys).
"""
from __future__ import annotations

import statistics

import ocr_bench as bench
import pytesseract
from ownrag_engine.ocr import ARABIC_ENGINE, LATIN_ENGINE, tesseract_cmd, tesseract_langs
from PIL import Image

pytesseract.pytesseract.tesseract_cmd = tesseract_cmd()

CASES = [
    ("en-prose", LATIN_ENGINE, bench.EN),
    ("ar-prose", ARABIC_ENGINE, bench.AR),
    ("ar-policy", ARABIC_ENGINE,
     "يحصل الموظف على واحد وعشرين يوم إجازة مدفوعة، وتزيد إلى ثلاثين يوم بعد خمس سنوات من الخدمة."),
    ("ar-tashkeel", ARABIC_ENGINE, bench.AR_TASHKEEL),
    ("degraded-prose-noise", LATIN_ENGINE, bench.EN),
    ("degraded-prose-blur", LATIN_ENGINE, bench.EN),
    ("degraded-prose-down150", LATIN_ENGINE, bench.EN),
]


def read(path, lang, scale):
    code, _ = tesseract_langs(lang)
    img = Image.open(path)
    if scale != 1.0:
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
    data = pytesseract.image_to_data(img, lang=code, output_type=pytesseract.Output.DICT)
    confs = [float(c) for c in data["conf"] if str(c).replace(".", "", 1).lstrip("-").isdigit() and float(c) >= 0]
    text = " ".join(w for w in data["text"] if w.strip())
    return bench.normalise(text), (statistics.mean(confs) if confs else 0.0), len(confs)


print(f"  {'case':<22} {'1x: CER':>9} {'conf':>6} {'words':>6}   {'2x: CER':>9} {'conf':>6} {'words':>6}"
      f"   {'picks':>7} {'truth':>7}")
for name, lang, ref in CASES:
    path = bench.OUT / f"{name}.png"
    if not path.exists():
        print(f"  {name}: no render ({path.name})")
        continue
    ref_n = bench.normalise(ref)
    one = read(path, lang, 1.0)
    two = read(path, lang, 2.0)
    cer1, cer2 = bench.cer(ref_n, one[0]), bench.cer(ref_n, two[0])
    # the ladder: 2x only when the first read is empty or its confidence is unconvincing
    picks_two = one[1] < 70 or one[2] == 0
    truth = "2x" if cer2 < cer1 else "1x"
    took = "2x" if picks_two else "1x"
    flag = "" if took == truth else "   <-- WRONG SCALE"
    print(f"  {name:<22} {cer1:>9.3f} {one[1]:>6.1f} {one[2]:>6}   {cer2:>9.3f} {two[1]:>6.1f} {two[2]:>6}"
          f"   {took:>7} {truth:>7}{flag}")

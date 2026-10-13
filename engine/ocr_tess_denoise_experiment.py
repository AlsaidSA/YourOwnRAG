"""EXP-OCR-02d — the last lever: a 3x3 median filter before OCR.

The scale sweep showed 2x upscaling is what Tesseract needs for small Arabic text (prose 0.745 -> 0.049,
tashkeel 1.000 -> 0.144) and what breaks the salt-and-pepper page (0.306 -> 0.940). Salt-and-pepper is
exactly what a median filter removes, so this asks whether one cheap pre-pass lets both cases be right at
once — and whether it costs anything on the clean pages, which is the test that matters.
"""
from __future__ import annotations

import statistics

import ocr_bench as bench
import pytesseract
from ownrag_engine.ocr import ARABIC_ENGINE, LATIN_ENGINE, tesseract_cmd, tesseract_langs
from PIL import Image, ImageFilter

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
    ("num-digits", LATIN_ENGINE, bench.NUM),
    ("hand-font", LATIN_ENGINE, bench.EN),
]

VARIANTS = [("1x", 1.0, False), ("2x", 2.0, False), ("1x+med", 1.0, True), ("2x+med", 2.0, True)]


def read(path, lang, scale, median):
    code, _ = tesseract_langs(lang)
    img = Image.open(path).convert("L")
    if median:
        img = img.filter(ImageFilter.MedianFilter(3))
    if scale != 1.0:
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
    data = pytesseract.image_to_data(img, lang=code, output_type=pytesseract.Output.DICT)
    text = " ".join(w for w in data["text"] if w.strip())
    return bench.normalise(text)


print(f"  {'case':<24} " + " ".join(f"{name:>9}" for name, _, _ in VARIANTS))
means = {name: [] for name, _, _ in VARIANTS}
for name, lang, ref in CASES:
    path = bench.OUT / f"{name}.png"
    if not path.exists():
        print(f"  {name}: no render")
        continue
    ref_n = bench.normalise(ref)
    cells = []
    for variant, scale, median in VARIANTS:
        value = bench.cer(ref_n, read(path, lang, scale, median))
        means[variant].append(value)
        cells.append(f"{value:>9.3f}")
    print(f"  {name:<24} " + " ".join(cells))

print("\n  mean CER per variant (lower is better):")
for variant, _, _ in VARIANTS:
    vals = means[variant]
    print(f"    {variant:<8} {sum(vals) / len(vals):.3f}")

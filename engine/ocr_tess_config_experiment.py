"""EXP-OCR-02b — which Tesseract configuration reads the frozen cases best?

The first full run scored worse than the Windows engine on Arabic prose, tashkeel and the degraded axis.
Two failure modes were visible in the raw output rather than in the score: a wrapped RTL paragraph came
back with its lines in the wrong order (a block-segmentation problem), and the tashkeel render came back
EMPTY (a small-text problem). Both are configuration, not capability, so this script holds the fixtures
fixed and sweeps the settings, reporting CER per case so a win on one case cannot hide a loss on another.

Ordering: Tesseract reads Arabic in logical order, so the hypothesis is compared as-is.
"""
from __future__ import annotations

import time

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
    ("degraded-prose-blur", LATIN_ENGINE, bench.EN),
    ("degraded-prose-down150", LATIN_ENGINE, bench.EN),
    ("degraded-policy-noise", LATIN_ENGINE,
     "Employees receive twenty-one days of paid annual leave, rising to thirty days after five years of service. Reports are submitted monthly to the department."),
    ("num-digits", LATIN_ENGINE, bench.NUM),
]

CONFIGS = [
    ("psm3 (current)", "", 1.0),
    ("psm6", "--psm 6", 1.0),
    ("psm6 x2", "--psm 6", 2.0),
    ("psm4 x2", "--psm 4", 2.0),
    ("psm6 x3", "--psm 6", 3.0),
    ("psm6 x2 oem1", "--psm 6 --oem 1", 2.0),
]


def read(path, lang, config, scale):
    code, _ = tesseract_langs(lang)
    img = Image.open(path)
    if scale != 1.0:
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
    began = time.perf_counter()
    text = pytesseract.image_to_string(img, lang=code, config=config)
    return bench.normalise(text), time.perf_counter() - began


print(f"  {'case':<24} " + " ".join(f"{name:>14}" for name, _, _ in CONFIGS))
rows = {}
for name, lang, ref in CASES:
    path = bench.OUT / f"{name}.png"
    if not path.exists():
        print(f"  {name}: missing render ({path.name})")
        continue
    ref_n = bench.normalise(ref)
    cells, times = [], []
    for config_name, config, scale in CONFIGS:
        hyp, took = read(path, lang, config, scale)
        rows[(name, config_name)] = (bench.cer(ref_n, hyp), took, len(hyp))
        cells.append(f"{rows[(name, config_name)][0]:>7.3f}/{took:>5.2f}s")
    print(f"  {name:<24} " + " ".join(f"{c:>14}" for c in cells))

print("\n  best per case (CER, then time):")
for name, lang, ref in CASES:
    candidates = [(v[0], v[1], k) for k, v in rows.items() if k[0] == name]
    if not candidates:
        continue
    best = min(candidates)
    base = rows.get((name, "psm3 (current)"))
    print(f"    {name:<24} best={best[2]:<14} CER={best[0]:.3f}  "
          f"(current psm3 CER={base[0]:.3f})" if base else "")

print("\n  mean CER per config across the cases above:")
for config_name, _, _ in CONFIGS:
    vals = [v[0] for k, v in rows.items() if k[1] == config_name]
    mean_t = [v[1] for k, v in rows.items() if k[1] == config_name]
    print(f"    {config_name:<16} mean CER={sum(vals) / len(vals):.3f}  "
          f"mean {sum(mean_t) / len(mean_t):.2f}s/image")

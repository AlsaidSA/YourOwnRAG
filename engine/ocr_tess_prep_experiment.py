"""EXP-OCR-02g — the page-preparation variants, measured on the frozen cases through the PRODUCTION path.

Two edits landed together in the worker (drop the key sort, move the median filter before the upscale) and
the axis means moved in opposite directions, which proves nothing about either. `process()` calls
`prepare_page` as a module global, so each variant swaps in without touching the worker, and every variant
is measured on all 34 frozen cases with the same retry ladder behind it.

Variants:
  up->med    grayscale, upscale 2x, then 3x3 median   (what the worker does at the time of writing)
  med->up    grayscale, 3x3 median, then upscale 2x
  up         grayscale, upscale 2x only
  med        grayscale, 3x3 median only
  raw        grayscale only

Cases and references are rebuilt exactly as the frozen benchmark's own main() builds them.
"""
from __future__ import annotations

import collections
import pathlib

import ocr_bench as bench
from ownrag_engine import ocr as worker
from PIL import Image, ImageFilter

EN_TEXTS = {
    "prose": bench.EN,
    "policy": "Employees receive twenty-one days of paid annual leave, rising to thirty days after five years of service. Reports are submitted monthly to the department.",
    "technical": "The retriever returns thirty candidates and the reranker keeps five. Every citation maps back to the exact passage, so an answer can be checked against its source.",
    "short": "Nightly build finished at 03:14 UTC.",
}
AR_TEXTS = {
    "prose": bench.AR,
    "policy": "يحصل الموظف على واحد وعشرين يوم إجازة مدفوعة، وتزيد إلى ثلاثين يوم بعد خمس سنوات من الخدمة.",
    "report": "ترفع التقارير الشهرية إلى الإدارة خلال الأسبوع الأول من كل شهر، ويراجعها مدير القسم قبل الاعتماد.",
    "short": "اكتمل البناء الليلي في الساعة الثالثة صباحا.",
}

CASES: list[tuple[str, str, str]] = []
for name, text in EN_TEXTS.items():
    CASES.append(("en", name, text))
CASES.append(("en", "prose-16pt", bench.EN))
for name, text in EN_TEXTS.items():
    for kind in ("jpeg25", "blur", "noise", "down150", "rot3"):
        CASES.append(("degraded", f"{name}-{kind}", text))
CASES.append(("num", "digits", bench.NUM))
CASES.append(("hand", "font", bench.EN))
for name, text in AR_TEXTS.items():
    CASES.append(("ar", name, text))
CASES.append(("ar", "prose-18pt", bench.AR))
CASES.append(("ar", "tashkeel", bench.AR_TASHKEEL))
CASES.append(("num", "arabic-indic", bench.NUM))


def make(order: str, denoise: bool, upscale: bool):
    def prepare(img: Image.Image):
        img = img.convert("L")
        if denoise and order == "med->up":
            img = img.filter(ImageFilter.MedianFilter(3))
        scale = 1.0
        if upscale and max(img.size) < worker.UPSCALE_MAX_SIDE:
            scale = worker.PAGE_UPSCALE
            img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
        if denoise and order == "up->med":
            img = img.filter(ImageFilter.MedianFilter(3))
        return img, scale
    return prepare


VARIANTS = {
    "up->med": make("up->med", True, True),
    "med->up": make("med->up", True, True),
    "up": make("up->med", False, True),
    "med": make("med->up", True, False),
    "raw": make("up->med", False, False),
}

original = worker.prepare_page
axes: dict[str, dict[str, list[float]]] = {name: collections.defaultdict(list) for name in VARIANTS}

for variant, prepare in VARIANTS.items():
    worker.prepare_page = prepare
    for axis, name, ref in CASES:
        path = pathlib.Path("ocr-test") / "bench" / f"{axis}-{name}.png"
        if not path.exists():
            continue
        result = worker.process(path)
        text = "\n".join(page["text"] for page in result["ocr"]["pages"])
        axes[variant][axis].append(bench.cer(bench.normalise(ref), bench.normalise(text)))
worker.prepare_page = original

print(f"  {'axis':<10} " + " ".join(f"{v:>9}" for v in VARIANTS))
for axis in ("en", "degraded", "ar", "num", "hand"):
    cells = []
    for variant in VARIANTS:
        values = axes[variant].get(axis, [])
        cells.append(f"{sum(values) / len(values):>9.3f}" if values else f"{'—':>9}")
    print(f"  {axis:<10} " + " ".join(cells))

print("\n  overall mean over every case:")
for variant in VARIANTS:
    every = [v for values in axes[variant].values() for v in values]
    print(f"    {variant:<9} {sum(every) / len(every):.3f}   (n={len(every)})")

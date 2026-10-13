"""EXP-OCR-02e — how should the worker choose the language, now that Tesseract reads Arabic text with the
Latin model instead of returning nothing?

The worker's rule 2 is "script is decided per REGION", and with the Windows engine the trigger was the
returned text: a Latin read of an Arabic page came back empty, so the Arabic engine got its turn. That
trigger does not survive the swap. Tesseract's `eng` model happily returns confident garbage Latin for an
Arabic page — non-empty, and containing no Arabic character — so the Arabic pass never fires and the
stored text is that garbage. Measured through `process()`, the Arabic axis went to CER 0.882.

Four strategies, on the frozen cases:
  eng        the current first pass only (what production does today)
  ara        forced Arabic
  ara+eng    one pass, both models, Tesseract chooses per word
  osd        Tesseract's own orientation-and-script detection picks the model, per image
"""
from __future__ import annotations

import ocr_bench as bench
import pytesseract
from ownrag_engine.ocr import prepare_page, tesseract_cmd, tesseract_langs
from PIL import Image

pytesseract.pytesseract.tesseract_cmd = tesseract_cmd()

CASES = [
    ("ar-prose", bench.AR),
    ("ar-policy", "يحصل الموظف على واحد وعشرين يوم إجازة مدفوعة، وتزيد إلى ثلاثين يوم بعد خمس سنوات من الخدمة."),
    ("ar-report", "ترفع التقارير الشهرية إلى الإدارة خلال الأسبوع الأول من كل شهر، ويراجعها مدير القسم قبل الاعتماد."),
    ("ar-short", "اكتمل البناء الليلي في الساعة الثالثة صباحا."),
    ("ar-prose-18pt", bench.AR),
    ("ar-tashkeel", bench.AR_TASHKEEL),
    ("en-prose", bench.EN),
    ("num-digits", bench.NUM),
    ("degraded-prose-noise", bench.EN),
    ("degraded-prose-blur", bench.EN),
]


def page_image(name):
    path = bench.OUT / f"{name}.png"
    if not path.exists():
        return None
    return prepare_page(Image.open(path))[0]


def read(img, lang):
    return bench.normalise(pytesseract.image_to_string(img, lang=lang))


def osd_lang(img) -> str:
    try:
        osd = pytesseract.image_to_osd(img, output_type=pytesseract.Output.DICT)
        script = (osd.get("script") or "").lower()
        return "ara" if "arabic" in script else "eng"
    except Exception:
        return "eng"


print(f"  {'case':<24} {'eng':>8} {'ara':>8} {'ara+eng':>8} {'osd':>8}   osd picks")
for name, ref in CASES:
    img = page_image(name)
    if img is None:
        print(f"  {name}: no render")
        continue
    ref_n = bench.normalise(ref)
    picked = osd_lang(img)
    cells = []
    for lang in ("eng", "ara", "ara+eng", picked):
        cells.append(bench.cer(ref_n, read(img, lang)))
    print(f"  {name:<24} {cells[0]:>8.3f} {cells[1]:>8.3f} {cells[2]:>8.3f} {cells[3]:>8.3f}   {picked}")

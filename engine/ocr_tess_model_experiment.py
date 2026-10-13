"""EXP-OCR-02f — does a perfect per-region language decision beat the combined model?

Rule 2 of the worker says the script is decided per REGION, and the swap replaced that with one combined
`ara+eng` model that lets Tesseract decide per word. On the frozen Arabic axis the combined model leaves
one case far behind (the tashkeel render), so this asks the fair question in the production path: if the
worker knew the region was Arabic and used `ara` alone, would it do better than `ara+eng`?

Both runs go through `process()`, so the page preparation (upscale, median) and the whole retry ladder are
identical; only the model string differs.
"""
from __future__ import annotations

import ocr_bench as bench
from ownrag_engine import ocr as worker

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
]


def run(model: str) -> dict[str, float]:
    worker.TESSERACT_MODEL = model
    out = {}
    for name, ref in CASES:
        path = bench.OUT / f"{name}.png"
        if not path.exists():
            continue
        result = worker.process(path)
        text = "\n".join(page["text"] for page in result["ocr"]["pages"])
        out[name] = bench.cer(bench.normalise(ref), bench.normalise(text))
    return out


combined = run("ara+eng")
arabic_only = run("ara")

print(f"  {'case':<24} {'ara+eng':>9} {'ara':>9}   winner")
for name, _ in CASES:
    if name not in combined:
        continue
    a, b = combined[name], arabic_only[name]
    print(f"  {name:<24} {a:>9.3f} {b:>9.3f}   {'ara' if b < a - 0.01 else 'ara+eng' if a < b - 0.01 else 'tie'}")

print("\n  Arabic cases only (prose, policy, report, short, 18pt, tashkeel):")
arabic_cases = [n for n in combined if n.startswith("ar-")]
for model_name, values in (("ara+eng", combined), ("ara", arabic_only)):
    mean = sum(values[n] for n in arabic_cases) / len(arabic_cases)
    print(f"    {model_name:<9} mean CER over {len(arabic_cases)} Arabic cases = {mean:.3f}")

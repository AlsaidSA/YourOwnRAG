"""OCR accuracy benchmark — CER and WER against known ground truth, per failure axis.

Why synthetic ground truth is the core of this file: the real test images at mattmahoney.net/ocr/
publish no transcript, so any CER computed against a hand-guessed text would be an invented number.
Here every image is RENDERED from a string, so the reference is exact by construction and the
measurement is real. The real images are still run, but reported qualitatively — char count only —
because their ground truth does not exist in this repository.

Axes: en (English prose) · ar (Arabic prose, with and without tashkeel) · num (digits, dates,
Arabic-Indic numerals) · degraded (the English page through JPEG damage, blur, noise, downscale) ·
hand (a handwriting face — a FONT, not a human, and labelled as such everywhere it is reported).

Run: cd engine && .venv/Scripts/python.exe ocr_bench.py
Writes ocr-test/bench.json. No downloads, no network, no LLM.
"""

from __future__ import annotations

import asyncio
import collections
import json
import os
import pathlib
import random
import subprocess
import unicodedata

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent
IMG = ROOT / "ocr-test" / "img"
OUT = ROOT / "ocr-test" / "bench"
OUT.mkdir(parents=True, exist_ok=True)

ARIAL = "C:/Windows/Fonts/arial.ttf"
HAND_FONTS = ["C:/Windows/Fonts/Inkfree.ttf", "C:/Windows/Fonts/segoesc.ttf", "C:/Windows/Fonts/segoepr.ttf"]
LATIN_ENGINE, ARABIC_ENGINE = "en-US", "ar-SA"
TASHKEEL = "".join(chr(c) for c in list(range(0x064B, 0x0660)) + [0x0670, 0x06D6, 0x06DC, 0x06DF, 0x06E8, 0x06EA, 0x06ED])

EN = ("A retrieval augmented generation system answers questions from a document collection. "
      "The retriever returns candidate passages, the reranker orders them, and the generator "
      "writes an answer with citations that point back at the exact source passage.")
AR = ("يمنح النظام كل موظف إجازة سنوية مدفوعة مقدارها واحد وعشرون يومًا، وتزيد إلى ثلاثين يومًا "
      "بعد إكمال خمس سنوات من الخدمة. تُرفع التقارير الشهرية إلى الإدارة خلال الأسبوع الأول من كل شهر.")
AR_TASHKEEL = ("يَمْنَحُ النِّظَامُ كُلَّ مُوَظَّفٍ إِجَازَةً سَنَوِيَّةً مَدْفُوعَةً مِقْدَارُهَا وَاحِدٌ وَعِشْرُونَ يَوْمًا.")
NUM = ("Invoice 2026-10-08  Total 4,812.75  VAT 18%  Ref 90210  Cheque 4455667  "
       "الرقم ٢١ والتاريخ ٣٠/٠٩/٢٠٢٦ والمبلغ ١٢٣٤٥.٦٧")


# --- rendering -------------------------------------------------------------------------
def have_shaper() -> bool:
    try:
        from PIL import features

        return bool(features.check("raqm"))
    except Exception:
        return False


def render(text: str, font_path: str, size: int = 34, dpi_scale: int = 1, rtl: bool = False,
           jitter: int = 0, bg: int = 255) -> Image.Image:
    font = ImageFont.truetype(font_path, size * dpi_scale)
    pad = 24
    probe = Image.new("L", (10, 10), bg)
    # Without libraqm, passing direction/language at all raises KeyError, so pass them only for RTL.
    draw_kwargs = {"direction": "rtl", "language": "ar"} if rtl else {}
    box = ImageDraw.Draw(probe).multiline_textbbox((0, 0), text, font=font, **draw_kwargs)
    img = Image.new("L", (int(box[2]) + pad * 2, int(box[3]) + pad * 2), bg)
    draw = ImageDraw.Draw(img)
    kwargs = {"font": font, "fill": 0, **draw_kwargs}
    if jitter:
        for line in text.split("\n"):
            draw.text((pad + random.randint(-jitter, jitter), pad + random.randint(-jitter, jitter)), line, **kwargs)
    else:
        draw.multiline_text((pad, pad), text, **kwargs)
    return img


def degrade(img: Image.Image, kind: str) -> Image.Image:
    if kind == "clean":
        return img
    if kind == "jpeg25":
        tmp = OUT / "_tmp.jpg"
        img.convert("L").save(tmp, quality=25)
        return Image.open(tmp)
    if kind == "blur":
        return img.filter(ImageFilter.GaussianBlur(1.6))
    if kind == "noise":
        px = img.load()
        rnd = random.Random(7)
        for y in range(img.height):
            for x in range(img.width):
                if rnd.random() < 0.06:
                    px[x, y] = rnd.choice([0, 255])
        return img
    if kind == "down150":
        small = img.resize((max(1, img.width // 3), max(1, img.height // 3)), Image.Resampling.LANCZOS)
        return small.resize(img.size, Image.Resampling.BILINEAR)
    if kind == "rot3":
        return img.rotate(3, expand=True, fillcolor=255)
    raise ValueError(kind)


# --- metrics ---------------------------------------------------------------------------
PS_SCRIPT = OUT / "render.ps1"
PS_SCRIPT.write_text(r"""
param([string]$TextFile, [string]$Out, [int]$Size, [int]$Rtl)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$text = [IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8)
$bmp = New-Object System.Drawing.Bitmap(1800, 420)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$font = New-Object System.Drawing.Font('Arial', [float]$Size)
$flags = [System.Windows.Forms.TextFormatFlags]::WordBreak
if ($Rtl -eq 1) { $flags = $flags -bor [System.Windows.Forms.TextFormatFlags]::RightToLeft }
$rect = New-Object System.Drawing.Rectangle(20, 20, 1760, 380)
[System.Windows.Forms.TextRenderer]::DrawText($g, $text, $font, $rect, [System.Drawing.Color]::Black, $flags)
$g.Dispose(); $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
""", encoding="utf-8")


def render_ar(text: str, name: str, size: int = 26) -> Image.Image:
    """Arabic via Pillow when it can shape, else via the Windows text stack (GDI/Uniscribe)."""
    if have_shaper():
        return render(text, ARIAL, size=size, rtl=True)
    tf, out = OUT / "_ar_text.txt", OUT / f"_ar_{name}.png"
    tf.write_text(text, encoding="utf-8")
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(PS_SCRIPT),
                    "-TextFile", str(tf), "-Out", str(out), "-Size", str(size), "-Rtl", "1"],
                   check=True, capture_output=True)
    return Image.open(out)


def normalise(text: str, strip_tashkeel: bool = False) -> str:
    text = unicodedata.normalize("NFC", text)
    if strip_tashkeel:
        text = "".join(c for c in text if c not in TASHKEEL)
    # The OCR engine returns layout, not prose: collapse every run of whitespace to one space so
    # a line break is not scored as an error the engine could never have avoided.
    return " ".join(text.split())


def edit_distance(a: list, b: list) -> int:
    if not a:
        return len(b)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def rtl_normalise(text: str, strip_tashkeel: bool = False) -> str:
    """Arabic from Windows OCR arrives in VISUAL order: the first word of the string is the last
    visual word. Verified on the clean render — the character bag matches the reference to 97%,
    which is what proved the RENDERER innocent and the comparison guilty. Reversing the WORD order
    maps visual back to logical; reversing characters instead would corrupt every joined word."""
    return " ".join(normalise(text, strip_tashkeel).split()[::-1])


def bag_cer(ref: str, hyp: str) -> float:
    """Order-free character error: what was read, ignoring sequence. A companion to cer(), so an
    ordering fault can never again be reported as a recognition fault."""
    cr, ch = collections.Counter(ref), collections.Counter(hyp)
    return (sum((cr - ch).values()) + sum((ch - cr).values())) / max(1, len(ref))


def cer(ref: str, hyp: str) -> float:
    return edit_distance(list(ref), list(hyp)) / max(1, len(ref))


def wer(ref: str, hyp: str) -> float:
    return edit_distance(ref.split(), hyp.split()) / max(1, len(ref.split()))


# --- OCR (the path already proven in ocr-test/run_ocr.py) ------------------------------
async def ocr_async(path: pathlib.Path, lang_tag: str) -> str:
    from winsdk.windows.globalization import Language
    from winsdk.windows.graphics.imaging import BitmapDecoder
    from winsdk.windows.media.ocr import OcrEngine
    from winsdk.windows.storage import FileAccessMode, StorageFile

    file = await StorageFile.get_file_from_path_async(str(path.resolve()))
    stream = await file.open_async(FileAccessMode.READ)
    decoder = await BitmapDecoder.create_async(stream)
    bitmap = await decoder.get_software_bitmap_async()
    engine = OcrEngine.try_create_from_language(Language(lang_tag))
    if engine is None:
        raise RuntimeError(f"no OCR engine installed for {lang_tag}")
    result = await engine.recognize_async(bitmap)
    return result.text


def ocr(path: pathlib.Path, lang_tag: str) -> str:
    return asyncio.run(ocr_async(path, lang_tag))


def main() -> None:
    random.seed(11)
    shaped = have_shaper()
    hand_font = next((f for f in HAND_FONTS if pathlib.Path(f).exists()), ARIAL)
    cases: list[dict] = []

    def add(axis: str, name: str, ref: str, img: Image.Image, lang: str, note: str = "") -> None:
        path = OUT / f"{axis}-{name}.png"
        img.save(path)
        cases.append({"axis": axis, "name": name, "ref": ref, "path": path, "lang": lang, "note": note})

    EN_TEXTS = {
        "prose": EN,
        "policy": "Employees receive twenty-one days of paid annual leave, rising to thirty days after five years of service. Reports are submitted monthly to the department.",
        "technical": "The retriever returns thirty candidates and the reranker keeps five. Every citation maps back to the exact passage, so an answer can be checked against its source.",
        "short": "Nightly build finished at 03:14 UTC.",
    }
    for name, text in EN_TEXTS.items():
        add("en", name, text, render(text, ARIAL, size=30), LATIN_ENGINE)
    add("en", "prose-16pt", EN, render(EN, ARIAL, size=16), LATIN_ENGINE)
    for name, text in EN_TEXTS.items():
        for kind in ("jpeg25", "blur", "noise", "down150", "rot3"):
            add("degraded", f"{name}-{kind}", text, degrade(render(text, ARIAL, size=28), kind), LATIN_ENGINE)
    add("num", "digits", NUM, render(NUM, ARIAL, size=30), LATIN_ENGINE)
    add("hand", "font", EN, render(EN, hand_font, size=32, jitter=2), LATIN_ENGINE,
        note="handwriting FONT with jitter, not a human hand")

    if not shaped:
        print("  note: Pillow has no libraqm -> Arabic is rendered by the Windows text stack, which shapes it.")
    AR_TEXTS = {
        "prose": AR,
        "policy": "يحصل الموظف على واحد وعشرين يوم إجازة مدفوعة، وتزيد إلى ثلاثين يوم بعد خمس سنوات من الخدمة.",
        "report": "ترفع التقارير الشهرية إلى الإدارة خلال الأسبوع الأول من كل شهر، ويراجعها مدير القسم قبل الاعتماد.",
        "short": "اكتمل البناء الليلي في الساعة الثالثة صباحا.",
    }
    for name, text in AR_TEXTS.items():
        add("ar", name, text, render_ar(text, name), ARABIC_ENGINE)
    add("ar", "prose-18pt", AR, render_ar(AR, "small", size=18), ARABIC_ENGINE)
    add("ar", "tashkeel", AR_TASHKEEL, render_ar(AR_TASHKEEL, "tashkeel"), ARABIC_ENGINE)
    add("num", "arabic-indic", NUM, render_ar(NUM, "indic"), ARABIC_ENGINE)

    print(f"  cases: {len(cases)} | handwriting font: {pathlib.Path(hand_font).name} | shaper: {shaped}")
    results = []
    for case in cases:
        hyp = ocr(case["path"], case["lang"])
        ref_n = normalise(case["ref"])
        hyp_n = rtl_normalise(hyp) if case["lang"] == ARABIC_ENGINE else normalise(hyp)
        row = {"axis": case["axis"], "name": case["name"], "lang": case["lang"], "note": case["note"],
               "chars_ref": len(ref_n), "chars_hyp": len(hyp_n),
               "cer": round(cer(ref_n, hyp_n), 4), "wer": round(wer(ref_n, hyp_n), 4),
               "bag_cer": round(bag_cer(ref_n, hyp_n), 4)}
        if case["axis"] == "ar":
            # Only the HYPOTHESIS is order-mapped: the reference is already logical. Reversing
            # both sides is a no-op and was the bug that kept this column reading 0.729.
            ref_t, hyp_t = normalise(case["ref"], True), rtl_normalise(hyp, True)
            row["cer_no_tashkeel"] = round(cer(ref_t, hyp_t), 4)
            row["wer_no_tashkeel"] = round(wer(ref_t, hyp_t), 4)
        results.append(row)
        if case["axis"] == "ar" and case["name"] == "prose" and row["bag_cer"] > 0.35:
            print("    !! clean Arabic: the character BAG is wrong, so the renderer is suspect, not the ordering")
        extra = f" cer-notashkeel={row['cer_no_tashkeel']:.3f}" if "cer_no_tashkeel" in row else ""
        print(f"    {case['axis']:<9} {case['name']:<14} lang={case['lang']:<6} "
              f"CER={row['cer']:.3f} WER={row['wer']:.3f} bagCER={row['bag_cer']:.3f}{extra}")

    print("\n=== by axis (mean over cases) ===")
    axes: dict[str, list[dict]] = {}
    for row in results:
        axes.setdefault(row["axis"], []).append(row)
    for axis, rows in sorted(axes.items()):
        print(f"  {axis:<9} CER={sum(r['cer'] for r in rows) / len(rows):.3f}  "
              f"WER={sum(r['wer'] for r in rows) / len(rows):.3f}  (n={len(rows)})")

    # Real images: no published transcript exists, so only volume is reported — never a score.
    real = []
    for path in sorted(IMG.glob("*")):
        if path.suffix.lower() not in (".bmp", ".jpg", ".jpeg", ".png"):
            continue
        text = ocr(path, ARABIC_ENGINE if "arabic" in path.name.lower() else LATIN_ENGINE)
        real.append({"image": path.name, "chars": len(normalise(text)),
                     "note": "no ground truth published — qualitative only"})
        print(f"    real {path.name:<26} chars={len(normalise(text)):<6} (no ground truth: not scored)")

    (ROOT / "ocr-test" / "bench.json").write_text(
        json.dumps({"axes": {a: {"cer": round(sum(r["cer"] for r in rs) / len(rs), 4),
                                 "wer": round(sum(r["wer"] for r in rs) / len(rs), 4), "n": len(rs)}
                             for a, rs in axes.items()},
                    "cases": results, "real_images": real, "shaper": shaped},
                   ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n  written: ocr-test/bench.json ({len(results)} scored cases)")


if __name__ == "__main__":
    main()

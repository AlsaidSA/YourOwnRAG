"""OCR worker — EXP-OCR-01. Page/region OCR with script detection, numeric validation, quarantine.

Rules baked in, each taken from a measured finding in OCR-BENCH-FREEZE.md (that file and the benchmark
are untouched by this module; this is new behaviour under a new experiment id):

  1. OCR only what the ingestion guard flagged NEEDS_OCR — page-level, never the whole document.
  2. Script is decided per REGION. en-US reads no Arabic-Indic digit at all and ar-SA mangles Latin
     groupings, so a mixed line cannot be decided once for the document.
  3. A numeric region whose text fails validation is upscaled and retried — down150 was the only
     degradation in the frozen run that cost accuracy.
  4. Numeric strings are validated before indexing. The battery caught two magnitude errors where
     every printed digit still looked plausible.
  5. A token that fails validation after the retry is QUARANTINED, never quietly indexed.
  6. Every region carries page/bbox/engine/scale metadata so a citation can point at the page.
  7. OCR text is returned in a separate structure from native text. Nothing is merged, so the OCR
     contribution stays auditable.
"""

from __future__ import annotations

import asyncio
import pathlib
import re
import tempfile

from PIL import Image

ARABIC = re.compile(r"[\u0600-\u06FF\u0750-\u077F]")
ARABIC_INDIC = re.compile(r"[\u0660-\u0669\u06F0-\u06F9]")
NUMTOK = re.compile(r"[0-9\u0660-\u0669\u06F0-\u06F9]+(?:[.,/\-\u066B\u066C][0-9\u0660-\u0669\u06F0-\u06F9]+)*")
LATIN_ENGINE, ARABIC_ENGINE = "en-US", "ar-SA"
MIN_NUMERIC_HEIGHT = 40          # px: a shorter numeric region is upscaled before the retry
RETRY_SCALE = 3.0
DEFAULT_DPI = 200


def script_of(text: str) -> str:
    """Per-region script decision. Arabic-Indic digits alone are enough to demand the Arabic engine."""
    return ARABIC_ENGINE if (ARABIC.search(text) or ARABIC_INDIC.search(text)) else LATIN_ENGINE


def validate_number(token: str) -> tuple[bool, str]:
    """Structural validation of one numeric token, aimed at the failures the battery measured."""
    if not NUMTOK.fullmatch(token):
        return False, "not a numeric token"
    digits = re.sub(r"\D", "", token)           # \d is Unicode-aware: Arabic-Indic digits count
    if not 1 <= len(digits) <= 18:
        return False, f"implausible digit count ({len(digits)})"
    decimals = token.count(".") + token.count("\u066B")
    if decimals > 1:
        return False, f"{decimals} decimal separators — a separator was misread"
    if decimals and ("," in token or "٬" in token):
        # Both separator kinds appear. That is normal US grouping (1,250.00) and also normal
        # European (1.250,00) - what is NOT normal is a comma standing in for the decimal point,
        # which is what a low-res render produced: 1,234,567 came back as 1.234,567, a different
        # magnitude in the same digits. The last separator decides the convention, so compare them.
        last_decimal = max(token.rfind("."), token.rfind("٫"))
        if any(token.rfind(c) > last_decimal for c in (",", "٬")):
            return False, "separator convention flipped - the comma is standing in as the decimal point"
    groups = re.split(r"[,\u066C]", re.split(r"[.\u066B]", token)[0])
    if any(len(g) != 3 for g in groups[1:]):
        return False, "thousands grouping is not 3-digit"
    if decimals and len(re.split(r"[.\u066B]", token)[-1]) == 3 and len(groups) > 1:
        return False, "ambiguous: 3 digits after the decimal separator with grouping present"
    return True, "ok"


async def _read_words(path: pathlib.Path, lang: str) -> tuple[str, list[dict]]:
    from winsdk.windows.globalization import Language
    from winsdk.windows.graphics.imaging import BitmapDecoder
    from winsdk.windows.media.ocr import OcrEngine
    from winsdk.windows.storage import FileAccessMode, StorageFile

    file = await StorageFile.get_file_from_path_async(str(path.resolve()))
    stream = await file.open_async(FileAccessMode.READ)
    decoder = await BitmapDecoder.create_async(stream)
    bitmap = await decoder.get_software_bitmap_async()
    engine = OcrEngine.try_create_from_language(Language(lang))
    if engine is None:
        raise RuntimeError(f"no OCR engine installed for {lang}")
    result = await engine.recognize_async(bitmap)
    words = []
    for line in result.lines:
        for word in line.words:
            rect = word.bounding_rect
            words.append({"text": word.text, "x": int(rect.x), "y": int(rect.y),
                          "w": int(rect.width), "h": int(rect.height), "line": line.text})
    return result.text, words


def _recognise(img: Image.Image, lang: str) -> tuple[str, list[dict]]:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False, dir=tempfile.gettempdir()) as handle:
        tmp = pathlib.Path(handle.name)
    img.save(tmp)
    try:
        return asyncio.run(_read_words(tmp, lang))
    finally:
        tmp.unlink(missing_ok=True)


def read_region(img: Image.Image, page: int, bbox: tuple | None = None, hint: str | None = None,
                rerender=None) -> dict:
    """OCR one region, choosing the engine from the text that actually came back."""
    crop = img.crop(bbox) if bbox else img
    engine = hint or LATIN_ENGINE
    text, words = _recognise(crop, engine)
    if engine == LATIN_ENGINE and (ARABIC.search(text) or ARABIC_INDIC.search(text) or not text.strip()):
        # Either Arabic came back through the Latin engine, or nothing did: try the Arabic engine and
        # keep whichever reading carries more recognised characters.
        alt_text, alt_words = _recognise(crop, ARABIC_ENGINE)
        if len(alt_text.strip()) > len(text.strip()):
            text, words, engine = alt_text, alt_words, ARABIC_ENGINE
    # A whole-page region reports the full page rectangle rather than nothing, so a citation always
    # has somewhere to point and the shape matches the numeric sub-boxes.
    return {"page": page, "bbox": list(bbox) if bbox else [0, 0, img.width, img.height], "engine": engine,
            "text": text, "words": words, "rerender_region": rerender}


def validate_and_retry(region: dict, img: Image.Image) -> dict:
    """Validate every numeric token in the region; upscale+retry the failures; quarantine the rest."""
    accepted: list[str] = []
    quarantined: list[dict] = []
    retried: list[dict] = []
    for token in NUMTOK.findall(region["text"]):
        ok, why = validate_number(token)
        if ok:
            accepted.append(token)
            continue
        word = next((w for w in region["words"] if w["text"] == token), None)
        fixed = None
        if word is not None:
            pad = 4
            box = (max(0, word["x"] - pad), max(0, word["y"] - pad),
                   word["x"] + word["w"] + pad, word["y"] + word["h"] + pad)
            if box[3] - box[1] < MIN_NUMERIC_HEIGHT:
                small = img.crop(box)
                big = small.resize((int(small.width * RETRY_SCALE), int(small.height * RETRY_SCALE)),
                                   Image.Resampling.LANCZOS)
                retry_text, _ = _recognise(big, region["engine"])
                for candidate in NUMTOK.findall(retry_text):
                    if validate_number(candidate)[0]:
                        fixed = candidate
                        retried.append({"was": token, "now": candidate, "scale": RETRY_SCALE, "bbox": list(box)})
                        break
        if fixed is None and callable(region.get("rerender_region")):
            # Upscaling a low-res crop only interpolates: measured, it recovered nothing. A page
            # we rendered ourselves can be rendered AGAIN with more real pixels, which is the
            # failable-and-fixable case this worker exists for.
            fresh = region["rerender_region"](box)
            fresh_text, _ = _recognise(fresh, region["engine"])
            for candidate in NUMTOK.findall(fresh_text):
                if validate_number(candidate)[0]:
                    fixed = candidate
                    retried.append({"was": token, "now": candidate, "scale": 2.0,
                                    "bbox": list(box), "via": "rerender"})
                    break
        if fixed:
            accepted.append(fixed)
        else:
            quarantined.append({"page": region["page"], "token": token, "reason": why,
                                "bbox": list(region["bbox"]) if region["bbox"] else None})
    region["accepted_numbers"] = accepted
    region["quarantined"] = quarantined
    region["retried"] = retried
    return region


def page_types(path: pathlib.Path) -> list[str]:
    """Classify every page as 'native' or 'needs_ocr' — the guard decides, not this worker."""
    if path.suffix.lower() == ".pdf":
        import pymupdf

        doc = pymupdf.open(path)
        kinds = ["native" if page.get_text("text").strip() else "needs_ocr" for page in doc]
        doc.close()
        return kinds
    image_suffixes = (".png", ".bmp", ".jpg", ".jpeg", ".tif", ".tiff")
    return ["needs_ocr" if path.suffix.lower() in image_suffixes else "native"]


def process(path: pathlib.Path, native_pages: list[str] | None = None) -> dict:
    """OCR only the pages the guard flagged. Returns OCR and native text as separate structures."""
    path = pathlib.Path(path)
    kinds = page_types(path)
    ocr_pages: list[dict] = []
    quarantine: list[dict] = []
    no_text_pages: list[int] = []
    for index, kind in enumerate(kinds, start=1):
        if kind != "needs_ocr":
            continue                                   # rule 1: never OCR a page that has native text
        if path.suffix.lower() == ".pdf":
            import pymupdf

            doc = pymupdf.open(path)
            pix = doc[index - 1].get_pixmap(dpi=DEFAULT_DPI)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            doc.close()
        else:
            img = Image.open(path).convert("RGB")
        rerender = make_rerender(path, index) if path.suffix.lower() == ".pdf" else None
        region = read_region(img, index, rerender=rerender)
        region = validate_and_retry(region, img)
        if not region["text"].strip():
            # A flagged page that yields NOTHING is not a page with nothing on it. Upscale the whole
            # page once and retry before accepting silence; either way the state is recorded, so a
            # silent OCR_DONE with zero output can never be returned.
            big = img.resize((img.width * 2, img.height * 2), Image.Resampling.LANCZOS)
            retry = validate_and_retry(read_region(big, index), big)
            retry["whole_page_retry"] = True
            if retry["text"].strip():
                retry["recovered_from_empty"] = True
                region = retry
            else:
                region["no_text"] = True
                region["whole_page_retry"] = True
                no_text_pages.append(index)
        ocr_pages.append(region)
        quarantine.extend(region["quarantined"])
    return {
        "source_file": str(path),
        "native": {"pages": list(native_pages or []), "text_source": "native"},   # rule 7: never merged
        "ocr": {"pages": ocr_pages, "text_source": "ocr"},
        "quarantined": quarantine,
        "no_text_pages": no_text_pages,
        "status": ("NEEDS_OCR_NO_TEXT" if no_text_pages else
                   "NEEDS_OCR_QUARANTINE" if quarantine else
                   "OCR_DONE" if any(p["text"].strip() for p in ocr_pages) else "NO_OCR_NEEDED"),
    }


def make_rerender(path: pathlib.Path, page_index: int, base_dpi: int = DEFAULT_DPI):
    """Return a callable that crops the same page from a 2x-DPI render, or None if there is no source."""
    def rerender(box):
        import pymupdf

        doc = pymupdf.open(path)
        pix = doc[page_index - 1].get_pixmap(dpi=base_dpi * 2)
        big = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        doc.close()
        return big.crop((box[0] * 2, box[1] * 2, box[2] * 2, box[3] * 2))
    return rerender


def ocr_chunks_for(path: pathlib.Path, chunk_size: int = 1200) -> dict:
    """OCR chunks only, each carrying page/bbox/source. Native chunks are never returned from here, so
    the caller keeps two separate lists and the OCR contribution stays auditable."""
    result = process(path)
    chunks = []
    for page in result["ocr"]["pages"]:
        text = page["text"].strip()
        if not text:
            continue
        chunks.append({"content": text, "page": page["page"], "bbox": page["bbox"], "source": "ocr",
                       "engine": page["engine"], "numbers": page["accepted_numbers"],
                       "quarantined": page["quarantined"]})
    return {"ocr_chunks": chunks, "quarantined": result["quarantined"], "status": result["status"],
            "no_text_pages": result["no_text_pages"], "ocr_source": "ocr"}

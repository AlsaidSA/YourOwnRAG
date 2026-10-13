"""OCR worker — EXP-OCR-01, backend swapped to Tesseract under EXP-OCR-02.

Backend: Tesseract (pytesseract + the tesseract binary). The Windows engine this worker used to call
(Windows.Media.Ocr via winsdk) is kept only in the frozen benchmark, which is the record of what that
backend measured; nothing in the pipeline calls it any more. Everything above `_read_words` — the
per-region script decision, numeric validation, the upscale/rerender retries, quarantine and the
provenance metadata — is unchanged by the swap.

Rules baked in, each taken from a measured finding in OCR-BENCH-FREEZE.md (that file and the benchmark
are untouched by this module; this is new behaviour under a new experiment id):

  1. OCR only what the ingestion guard flagged NEEDS_OCR — page-level, never the whole document.
  2. Script is decided per REGION, and with Tesseract that decision is finer still: every read uses the
     combined ara+eng model and Tesseract picks per WORD. The Windows engine needed a per-region switch
     because en-US read no Arabic-Indic digit at all and ar-SA mangled Latin groupings, so a mixed line
     could not be decided once for the document; the swap replaced that trigger with a model set, and
     EXP-OCR-02e measured it better on every case carrying both scripts. The region still RECORDS its
     script, which is what the pipeline, the tests and the stored provenance read.
  3. A numeric region whose text fails validation is upscaled and retried — down150 was the only
     degradation in the frozen run that cost accuracy.
  4. Numeric strings are validated before indexing. The battery caught two magnitude errors where
     every printed digit still looked plausible.
  5. A token that fails validation after the retry is QUARANTINED, never quietly indexed.
  6. Every region carries page/bbox/engine/scale metadata so a citation can point at the page.
  7. OCR text is returned in a separate structure from native text. Nothing is merged, so the OCR
     contribution stays auditable.

The engine labels ("en-US"/"ar-SA") are kept as the pipeline's vocabulary so every existing caller,
test and stored provenance row keeps its meaning; the mapping to Tesseract's language codes happens
only at the call.
"""

from __future__ import annotations

import os
import pathlib
import re
import shutil
import tempfile

from PIL import Image, ImageFilter

ARABIC = re.compile(r"[\u0600-\u06FF\u0750-\u077F]")
ARABIC_INDIC = re.compile(r"[\u0660-\u0669\u06F0-\u06F9]")
NUMTOK = re.compile(r"[0-9\u0660-\u0669\u06F0-\u06F9]+(?:[.,/\-\u066B\u066C][0-9\u0660-\u0669\u06F0-\u06F9]+)*")
LATIN_ENGINE, ARABIC_ENGINE = "en-US", "ar-SA"
MIN_NUMERIC_HEIGHT = 40          # px: a shorter numeric region is upscaled before the retry
RETRY_SCALE = 3.0
DEFAULT_DPI = 200

# Page preparation, measured on the frozen cases through the production path (EXP-OCR-02g, axis means):
#
#   axis      upscale   median   both     winsdk (recorded)
#   en          0.009    0.071   0.016     0.002
#   degraded    0.214    0.090   0.197     0.024
#   ar          0.065    0.212   0.221     0.172
#   num         0.277    0.335   0.321     0.509
#   hand        0.028    0.137   0.137     0.266
#
# Upscale alone is best or near-best on four axes and is what ships: Arabic 0.065 against 0.172 for the
# Windows engine, numerics 0.277 against 0.509, the handwriting font 0.028 against 0.266. The median pass
# is a switch, not a default, because it trades axes rather than adding: it is the only thing that repairs
# salt-and-pepper noise (0.090 against 0.214) and it costs clean text and Arabic to get there. The
# upscale is not optional — Tesseract asks for ~300 DPI input and the guard's 200 DPI render is below it.
PAGE_UPSCALE = 2.0
DENOISE_MEDIAN = 0               # 0 disables; 3 is the measured denoise pass (see the table above)
UPSCALE_MAX_SIDE = 3500          # px: a page already this large is at Tesseract's happy resolution

# Tesseract's vocabulary, chosen here and nowhere else.
TESSERACT_LANG = {LATIN_ENGINE: "eng", ARABIC_ENGINE: "ara"}
# Measured under EXP-OCR-02e: one pass with BOTH models beats either model alone on every case that
# carries both scripts (mixed numeric line 0.339 vs 0.366; Arabic policy 0.011, report 0.010, short
# 0.000 — all of which the Latin model alone reads as confident garbage) and costs nothing on pure
# Latin (clean page 0.000, blurred page 0.000). Tesseract then chooses the model per WORD, which is
# strictly finer than the per-region decision this worker used to make with the Windows engine — that
# engine returned nothing for Arabic, so "the text contains Arabic" was a working trigger; Tesseract's
# `eng` model instead returns plausible-looking Latin, and that trigger silently stopped firing.
TESSERACT_MODEL = "ara+eng"
TESSERACT_CANDIDATES = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
)


def tesseract_cmd() -> str:
    """Find the Tesseract binary: explicit override, then PATH, then the usual install locations."""
    override = os.environ.get("OWNRAG_TESSERACT_CMD")
    if override:
        if not pathlib.Path(override).exists():
            raise RuntimeError(f"OWNRAG_TESSERACT_CMD points at nothing: {override}")
        return override
    found = shutil.which("tesseract")
    if found:
        return found
    for candidate in TESSERACT_CANDIDATES:
        if candidate and pathlib.Path(candidate).exists():
            return candidate
    raise RuntimeError(
        "Tesseract is not installed. Install it (winget install UB-Mannheim.TesseractOCR) or point "
        "OWNRAG_TESSERACT_CMD at tesseract.exe; the OCR worker cannot read a scanned page without it."
    )


def tessdata_dir() -> pathlib.Path | None:
    """Where Tesseract keeps its language data: TESSDATA_PREFIX, else beside the binary."""
    env = os.environ.get("TESSDATA_PREFIX")
    if env:
        candidate = pathlib.Path(env)
        return candidate / "tessdata" if candidate.name != "tessdata" else candidate
    beside = pathlib.Path(tesseract_cmd()).parent / "tessdata"
    return beside if beside.is_dir() else None


def tesseract_langs(lang: str, tessdata: str | None = None) -> tuple[str, str | None]:
    """Return (model string, tessdata dir) for one region, naming any language data missing.

    The model string is the combined `ara+eng` whenever both are installed, whatever the region's script
    label says; a region's label still decides the provenance recorded against it, and still decides the
    model when only one of the two is on disk.
    """
    directory = pathlib.Path(tessdata) if tessdata else tessdata_dir()
    wanted = TESSERACT_LANG.get(lang, "eng")
    if directory is None:
        return TESSERACT_MODEL, None
    installed = {p.stem for p in directory.glob("*.traineddata")}
    if set(TESSERACT_MODEL.split("+")) <= installed:
        return TESSERACT_MODEL, str(directory)
    if wanted in installed:
        return wanted, str(directory)
    raise RuntimeError(f"Tesseract has no {wanted}.traineddata in {directory} — "
                       f"install the {wanted.upper()} language data")


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


def _read_words(path: pathlib.Path, lang: str) -> tuple[str, list[dict]]:
    """Read one image with Tesseract: its text, and its words with boxes in the image's own pixels.

    Word boxes are the reason this is not a one-line call to `image_to_string`: the numeric retry has
    to crop the exact region a bad token came from, so the recogniser must report where every word was.
    """
    import pytesseract
    from pytesseract import Output

    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd()
    code, _ = tesseract_langs(lang)
    # No --tessdata-dir: Tesseract resolves its own data relative to the binary, and passing the path
    # through the config string breaks on a directory name containing a space (a quoted path lands
    # mid-filename and every model fails to load). tessdata_dir() exists to say which models are
    # installed, not to be handed to the CLI.
    data = pytesseract.image_to_data(Image.open(path), lang=code, output_type=Output.DICT)

    grouped: dict[tuple[int, int, int], list[dict]] = {}
    for index, raw in enumerate(data.get("text", [])):
        word = (raw or "").strip()
        if not word:
            continue
        try:
            confidence = float(data["conf"][index])
        except (KeyError, TypeError, ValueError):
            confidence = -1.0
        if confidence < 0:
            # -1 marks a box Tesseract looked at and found no word in; keeping it would put empty
            # tokens into the numeric validator's word lookup.
            continue
        key = (data["block_num"][index], data["par_num"][index], data["line_num"][index])
        grouped.setdefault(key, []).append({
            "text": word,
            "x": int(data["left"][index]), "y": int(data["top"][index]),
            "w": int(data["width"][index]), "h": int(data["height"][index]),
        })

    words: list[dict] = []
    line_texts: list[str] = []
    # Rows are taken in the order Tesseract emitted them, and a line ends when its (block, paragraph,
    # line) key changes. Sorting the keys instead — the obvious-looking thing to do — reorders wrapped
    # right-to-left paragraphs and cost 0.5 CER on the frozen Arabic prose page, because Tesseract's own
    # row order is the reading order and block/paragraph numbering is not.
    for key, line in grouped.items():
        text = " ".join(word["text"] for word in line)
        line_texts.append(text)
        for word in line:
            words.append({**word, "line": text})
    return "\n".join(line_texts), words


def _recognise(img: Image.Image, lang: str) -> tuple[str, list[dict]]:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False, dir=tempfile.gettempdir()) as handle:
        tmp = pathlib.Path(handle.name)
    img.save(tmp)
    try:
        return _read_words(tmp, lang)
    finally:
        tmp.unlink(missing_ok=True)


def read_region(img: Image.Image, page: int, bbox: tuple | None = None, hint: str | None = None,
                rerender=None) -> dict:
    """OCR one region, and label it by the script that came back.

    There is no second pass any more. The read uses the combined model (see TESSERACT_MODEL), so
    Tesseract decides per word rather than this worker deciding per region; the recorded `engine` is the
    region's script decision, the label the pipeline, the tests and the stored provenance speak.
    """
    crop = img.crop(bbox) if bbox else img
    label = hint or LATIN_ENGINE
    text, words = _recognise(crop, label)
    model, _ = tesseract_langs(label)
    # A whole-page region reports the full page rectangle rather than nothing, so a citation always
    # has somewhere to point and the shape matches the numeric sub-boxes.
    return {"page": page, "bbox": list(bbox) if bbox else [0, 0, img.width, img.height], "engine": script_of(text),
            "model": model, "text": text, "words": words, "rerender_region": rerender}


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


def prepare_page(img: Image.Image) -> tuple[Image.Image, float]:
    """Bring a page image up to the resolution Tesseract reads best, and optionally denoise it.

    Grayscale first: it is what Tesseract does internally anyway, it makes the median pass three times
    cheaper, and the measurement was made on grayscale, so what ships is what was measured.

    The constants above come from a sweep of five variants through this function (EXP-OCR-02g: upscale,
    median, both orders of the two, and raw). Two findings survive that sweep, and one earlier claim does
    not. What ships is the upscale alone, because it is best or near-best on four axes and the filter trades
    Arabic away for speckle. If the filter is enabled, it belongs BEFORE the upscale — 0.156 against 0.181
    pooled — since median at 1x merges thin glyphs (Arabic policy 1.000) while upscaling alone enlarges
    salt-and-pepper (0.940, which is why the pass exists at all).

    One caveat worth keeping: the first draft of this docstring quoted 0.016 for filtering-then-upscaling
    against 0.527 the other way, and that pair is not attributable — those two runs also differed in the
    line-assembly code, so the numbers mixed two variables. The sweep above is the clean measurement; quote
    it, not the pair.
    """
    img = img.convert("L")
    if DENOISE_MEDIAN:
        img = img.filter(ImageFilter.MedianFilter(DENOISE_MEDIAN))
    scale = 1.0
    if max(img.size) < UPSCALE_MAX_SIDE:
        scale = PAGE_UPSCALE
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
    return img, scale


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
        original = img.size
        prepared, scale = prepare_page(img)
        region = read_region(prepared, index, rerender=rerender)
        region["scale"] = scale
        if scale != 1.0:
            # Word boxes stay in the prepared image's pixels — that is what the numeric retries crop
            # from — but the page bbox goes back to the source page's own coordinates, so a citation
            # rectangle means the same thing it meant before the backend swap.
            region["bbox"] = [0, 0, original[0], original[1]]
        region = validate_and_retry(region, prepared)
        if not region["text"].strip():
            # A flagged page that yields NOTHING is not a page with nothing on it. Upscale the whole
            # page once and retry before accepting silence; either way the state is recorded, so a
            # silent OCR_DONE with zero output can never be returned.
            big = prepared.resize((prepared.width * 2, prepared.height * 2), Image.Resampling.LANCZOS)
            retry = validate_and_retry(read_region(big, index), big)
            retry["bbox"] = [0, 0, original[0], original[1]]
            retry["scale"] = scale * 2
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

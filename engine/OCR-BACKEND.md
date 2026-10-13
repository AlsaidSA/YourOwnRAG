# OCR backend — Tesseract (EXP-OCR-02)

The worker in `ownrag_engine/ocr.py` used the OCR engine built into Windows (`Windows.Media.Ocr`, via
`winsdk`). It now uses **Tesseract**. This file records what changed, why each setting is what it is, and
where the swap is worse — because it is worse on one axis and that is worth knowing before you deploy it.

The frozen benchmark (`ocr_bench.py`), its record (`OCR-BENCH-FREEZE.md`) and the frozen numbers in it are
untouched. The swap was measured against them with a second runner, `ocr_bench_tesseract.py`, which imports
the frozen benchmark and replaces its single backend seam, so both backends are scored on the same cases,
the same renders, the same seed and the same metrics.

## Install

Tesseract is a native program, not a Python package; the Python side is only the binding.

```bash
winget install --id UB-Mannheim.TesseractOCR -e --accept-package-agreements --accept-source-agreements
pip install pytesseract                     # also in engine/requirements.txt
```

The installer ships `eng` only. Arabic needs its language data downloaded from the official tessdata
repository into `C:\Program Files\Tesseract-OCR\tessdata\` (or any directory named `tessdata` pointed at by
`TESSDATA_PREFIX`):

```
ara.traineddata   2.5 MB    https://github.com/tesseract-ocr/tessdata/raw/main/ara.traineddata
eng.traineddata  23.4 MB    https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata
```

Two overrides exist for machines that do not follow the default layout: `OWNRAG_TESSERACT_CMD` (full path to
`tesseract.exe`) and `TESSDATA_PREFIX` (the directory that *contains* `tessdata`). If the binary is missing
the worker raises a message naming both, rather than failing a scan with a stack trace inside ingestion.

## What the swap measured

Mean CER per axis, on the frozen cases, through the production path (`process()` — the same retry ladder,
the same page preparation that ships). Lower is better.

| axis | cases | Windows engine | Tesseract | |
|---|---|---|---|---|
| `ar` Arabic | 6 | 0.172 | **0.065** | better |
| `degraded` | 20 | **0.024** | 0.214 | worse |
| `en` clean Latin | 5 | **0.002** | 0.009 | worse |
| `hand` handwriting font | 1 | 0.266 | **0.028** | better |
| `num` numeric | 2 | 0.509 | **0.277** | better |

Arabic, per case: prose 0.065 · policy 0.011 · report 0.010 · short 0.000 · prose-18pt 0.016 · tashkeel
0.288. Numeric, per case: Latin+Arabic digits 0.340 · Arabic-Indic 0.214.

The honest summary: **better on Arabic, better on numbers, much better on handwriting, level on clean
Latin, clearly worse on the salt-and-pepper axis.** The `degraded` axis is five degradations × four texts;
the loss is concentrated in the `noise` cases (6 % salt-and-pepper pixels), where the Windows engine is
unusually strong. A median pre-pass repairs that axis (0.214 → 0.090) and costs Arabic and clean Latin to
do it, so it is a switch rather than a default — see `DENOISE_MEDIAN` in `ocr.py`, which carries the full
table in its comment.

Cost: median 0.34 s per page image, slowest 0.59 s, against roughly 0.2 s for the Windows engine. Ingestion
is already a background job and only pages the guard flags `NEEDS_OCR` reach OCR at all, so a PDF with a
text layer never pays it.

## The settings, and the measurement behind each

| Setting | Value | Why |
|---|---|---|
| model | `ara+eng` | One pass with both models beats either alone on every case carrying both scripts, and costs nothing on pure Latin. Tesseract then picks the model per **word**, which is finer than the per-region decision the worker used to make — see the trap below. |
| input scale | grayscale, upscale 2× (`PAGE_UPSCALE`) | Tesseract asks for ~300 DPI input; the guard renders pages at 200 DPI. Upscaling is what makes Arabic work: prose 0.065 with it, 0.527 without. |
| denoise | off (`DENOISE_MEDIAN = 0`) | Trades axes rather than adding. Enable it (3) if your scans are speckled. |
| psm | Tesseract's default | Swept 3/4/6 and made no difference on any frozen case. |
| script detection | not used | Tesseract's own OSD picked the wrong model on short Arabic pages and on the mixed numeric page, so the combined model replaced the decision entirely. |

**The trap the swap introduced, for anyone changing this later:** with the Windows engine the worker
detected Arabic by looking at what came back — an Arabic page read with the Latin engine returned *nothing*,
so the Arabic pass fired. Tesseract's `eng` model instead returns confident garbage Latin for Arabic text,
so that trigger silently stopped firing and the Arabic axis scored 0.882 through the production path while
every isolated recogniser test looked fine. Measure the production path, not the recogniser.

## What did not change

Numeric validation, the upscale/rerender retries, quarantine (`available_int=0` with the reason persisted),
`NEEDS_OCR_NO_TEXT` / `NEEDS_OCR_QUARANTINE`, the page/bbox/provenance metadata, and the rule that OCR text
never merges with native text. The engine labels `en-US` / `ar-SA` remain the pipeline's vocabulary; a
region's label is now its script decision and the model used is recorded beside it.

The defect logged in `OCR-FREEZE.md` on 2026-10-10 — a number the retry "fixes" is still indexed in its
malformed form — is **unchanged by this swap**, because it lives in the validation path, not the recogniser.
It still needs a decision and a new experiment id.

## Reproduce

```bash
cd engine
.venv/Scripts/python.exe ocr_worker_test.py          # 26 checks, the worker's rules
.venv/Scripts/python.exe ocr_integration_test.py     # 17 checks, end to end
.venv/Scripts/python.exe ocr_bench_tesseract.py      # the frozen cases, scored for Tesseract
.venv/Scripts/python.exe ocr_bench.py                # the frozen run's own backend — see the note below
```

`ocr_bench.py` still calls the Windows engine and `winsdk` is **not installed** any more, so that last line
fails with `ModuleNotFoundError` by design: `pip install winsdk` first if you need to re-produce the
2026-10-08 record on a Windows box. Nothing else in the engine imports it.

The configuration experiments are kept beside them — `ocr_tess_prep_experiment.py` (page preparation),
`ocr_tess_language_experiment.py` (model choice), `ocr_tess_model_experiment.py` (combined vs Arabic-only
through the production path), plus the earlier scale/denoise sweeps.

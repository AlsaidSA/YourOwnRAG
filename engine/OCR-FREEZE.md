# OCR integration — FROZEN (EXP-OCR-01)

Verified against the live database and a restarted engine. 2026-10-08.
OCR is an **independent, deterministic subsystem**: no LLM is involved anywhere in this path
(Windows.Media.Ocr, per-region), so OCR quality is never a model-availability question.

## States

| State | Set when | Retrieval effect |
|---|---|---|
| `DONE` | pieces indexed normally | indexed; provenance per chunk |
| `NEEDS_OCR` | guard found an image/binary payload (`needs_ocr:<fmt>`) | OCR attempted; chunks carry `source='ocr'` |
| `NEEDS_OCR_NO_TEXT` | a deferred page yielded no text at all (named in the message) | nothing indexed from that page |
| `NEEDS_OCR_QUARANTINE` | a chunk carries an unvalidated numeric token | chunk kept for audit with `available_int=0` |
| `REJECTED` | no usable text and not an OCR case (`rejected:no-native-text`) | nothing indexed |

## Provenance and citations

- `chunk.source` is `native` or `ocr`; every pre-existing row backfilled to `native` (5,665 rows).
- `chunk.page` is the 1-based page; citations resolve to the right page for both paths.
- `chunk.bbox` is `''` for native text and the **full page rectangle** for whole-page OCR
  (`[0, 0, w, h]` at the raster resolution), or the numeric sub-box for retry crops.
- A mixed PDF keeps both paths in one document: text page `source='native'`, image page `source='ocr'`.

## Write path

One chokepoint: an 18-column INSERT into `chunk` (`…, page, vector, vec_kind, create_time,
source, bbox, quarantine`) plus one `token_index` INSERT. Columns were added through the existing
`MIGRATIONS` list in `core.py`, not a new mechanism.

Reindex clears by `document_id` for chunks and by each old chunk's own `id` for `token_index`.
The `token_index` half previously used `document_id` and therefore deleted nothing, leaving
orphaned index rows on every reindex; fixed and verified at delta 0.

## Numeric structural validation

Tokenised with `NUMTOK`; a token is accepted only if its structure parses:
exactly one decimal separator, and the **last** separator present is the decimal one.
Accepted: `1,250.00`, `1,234,567`, `2026-10-08`, `٤٥٦٧٨`.
Rejected: `4.812.75` (two decimal separators), `1.234,567` / `1.250,00` (swapped separators —
different magnitude, identical digits). Separation rule: `1,234,567` must not become `1.234,567`.

## Per-region language selection

Selected per region, never per document: Arabic script or Arabic-Indic digits → `ar-SA`;
Latin → `en-US`; mixed (`Ref 90210 رقم ٢١`) → `ar-SA`.

## Quarantine

A chunk whose page carries an unvalidated number is **kept for audit and withheld from retrieval**:
`available_int=0`, with the reason persisted in `chunk.quarantine` as JSON
(`[{"page":1,"token":"4.812.75","reason":"2 decimal separators…"}]`), and the document reports
`NEEDS_OCR_QUARANTINE` rather than `DONE`. Retrieval filters on `available_int = 1`
(`retrieval.py:334`), so no extra exclusion code was needed.

Verified live: `bad.png` → `NEEDS_OCR_QUARANTINE`, `available_int=0`, reason persisted, unreachable
by four different queries; the valid control page → `DONE`, `available_int=1`.

## Retry behaviour

First pass `DEFAULT_DPI=200`; a flagged page that yields nothing triggers a whole-page re-render at
`RETRY_SCALE=3.0` (×3). A flagged page never ends `OCR_DONE` with zero output.

## Known limitations

- **200→400 DPI recovery: UNPROVEN.** Measured over 5 sizes × 3 resolutions (150/200/400 dpi):
  where OCR fails here it fails by **legibility, not resolution** — below 9 pt the number is absent
  at every DPI, at 9 pt it is correct at all three. No size produced a wrong low-DPI reading that a
  higher DPI recovered. The upscale-retry therefore does not rescue this class of failure.
- **A plausible numeric misread can still pass validation.** At 8 pt / 200 dpi the engine returned
  `432.75` for `4,812.75` — a well-formed number. Validation is *structural*; it catches malformed
  tokens, not confidently wrong digits, and no upscale corrected it.
- Arabic tashkeel is dropped: `cer_notashkeel` 0.016 on the diacritised line, letters ~98.4%
  (bagCER 0.441).
- Arabic-Indic digits are an engine/script limitation (bagCER 0.036–0.030); `en-US` cannot see them,
  `ar-SA` mangles Latin groupings.
- Handwriting is poor: CER 0.266 / WER 0.694 (n=1).
- Numeric separators, not glyphs, are the dominant numeric failure mode.

## Frozen OCR accuracy benchmark (34 cases)

en 0.002/0.006/0.002 · degraded 0.023/0.069/0.036 (n=20) · ar 0.172/0.387/0.030 (n=6) ·
hand 0.266/0.694/0.379 (n=1). Numeric battery: 26/36 exact. Comparator rules pinned:
RTL word-order mapping on the hypothesis **only**, bagCER beside every sequence CER, exact token
match for numbers, whitespace collapsed + NFC. A test must never touch a real vendor provider.

## Evidence

`OCR-BENCH-FREEZE.md`, `ocr_bench.py`, `ocr_num_bench.py`, `ocr-test/bench.json`,
`ocr-test/bench_num.json`, `ocr-test/orphans_snapshot.json`, `EXPERIMENTS.md`, `ingest_guard_test.py`
(12/0), `ocr_worker_test.py` (27/0), `ocr_integration_test.py`.

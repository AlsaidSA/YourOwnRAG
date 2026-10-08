# OCR benchmark — FROZEN 2026-10-08

Engine under test: Windows.Media.Ocr (`winsdk`), en-US for Latin script, ar-SA for Arabic.
Not the RAG engine — no LLM, no retrieval, no network. Ground truth exists by construction: every
scored image is rendered from a known string. The real mattmahoney.net images are run for volume only
and are **never scored**, because no transcript for them is published in this repository.

## Frozen comparator rules (these were the bug three times — do not relax)
1. **RTL order:** ar-SA returns Arabic in VISUAL order. `rtl_normalise()` word-reverses the
   **hypothesis only**. The reference is already logical. Reversing both sides is a silent no-op.
2. **Always report `bag_cer` (order-free character bag) beside sequence CER.** An ordering fault must
   never again be reportable as a recognition fault. Arabic prose: bagCER 0.03 vs seqCER 0.47.
3. **Numbers are judged by EXACT token match**, in the separate battery — never by CER. `2026-10-08`
   read as `2026-10-09` has CER 0.09 and is entirely wrong.
4. Whitespace collapsed; NFC normalisation; tashkeel stripped only for the companion column.

## Frozen results — 34 scored cases
| axis | n | CER | WER | bagCER |
|---|---|---|---|---|
| ar | 6 | 0.172 | 0.387 | 0.107 |
| degraded | 20 | 0.024 | 0.069 | 0.031 |
| en | 5 | 0.002 | 0.006 | 0.002 |
| hand | 1 | 0.266 | 0.694 | 0.379 |
| num | 2 | 0.509 | 0.531 | 0.223 |

`hand` is a handwriting **font** (Inkfree) with jitter — not a human hand; keep the label on it.

## Separate numeric battery — 36 measurements, exact 26/36
Exact-string accuracy is the verdict. 10 failures, and the taxonomy matters more than the rate:
- `date` [ar-SA] ref=['٣٠/٠٩/٢٠٢٦'] -> got=['٠١٠٩١٢٠٢']
- `decimal` [ar-SA] ref=['١٢٣٤٥.٦٧'] -> got=['١٢٣٤٥٦٧']
- `decimal-lowres` [en-US] ref=['4,812.75'] -> got=['4.812.75']
- `thousands` [en-US] ref=['1,234,567'] -> got=[]
- `id` [ar-SA] ref=['٤٥٦٧٨'] -> got=['٨']
- `indic` [ar-SA] ref=['٣٠'] -> got=[]
- `indic` [ar-SA] ref=['١٢٣٤٥'] -> got=[]
- `indic` [ar-SA] ref=['٤٥٦٧٨٩٠'] -> got=['٥٢٧٨٩٠']
- `mixed` [en-US] ref=['90210', '٢١'] -> got=['90210']
- `mixed-lowres` [ar-SA] ref=['1,250.00'] -> got=['1,250']

Two are **magnitude errors** (`١٢٣٤٥.٦٧`->`١٢٣٤٥٦٧`, `1,250.00`->`1,250`): the decimal point is lost and
every printed digit still looks plausible. That is why OCR numbers must never be indexed unchecked.

## Known limitations — accepted, do not "fix" in-engine now
- **Arabic-Indic numerals**: engine/script limitation. Two of four short numerals returned *nothing*.
  A tuning pass will not fix it; it needs a different engine or a per-field retry path.
- **Tashkeel**: dropped by the engine. The letters are read correctly (cer-notashkeel 0.016 on the
  diacritized line); the marks are not.
- **Residual Arabic sequence error (~0.17)**: structural — punctuation and line layout. Unexplained,
  not solved. Do not attribute it to recognition without a bag-metric check.
- **`en-US` cannot read Arabic-Indic digits at all**; `ar-SA` mangles Latin groupings. Engine selection
  for mixed-script lines must be per-region, not global.

## Re-run / invalidate
    ./.venv/Scripts/python.exe ocr_bench.py        # -> ocr-test/bench.json
    ./.venv/Scripts/python.exe ocr_num_bench.py    # -> ocr-test/bench_num.json
Any change to the comparator, the case set, the OCR engine or the font stack **invalidates this freeze**
and requires a new dated file. Next step beyond the freeze: the OCR worker with numeric
validation/retry — do not index OCR output without a per-field format check.

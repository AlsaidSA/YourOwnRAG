# RAG evaluation log

Everything measured against the same 5-paper arXiv corpus (`kb_36c2754c177641ce`, 1,069 chunks),
with the 12-test suite (`bench_rag_suite.py`) kept wired in as a regression check throughout, and
`bench_rag_50.py` (46 questions, five axes) as the standing benchmark.

## Known-good configuration

```
chunking 512 / overlap 80        (OWNRAG_CHUNK_SIZE / OWNRAG_CHUNK_OVERLAP)
retrieve 30 candidates           (request body top_k)
LLM rerank -> keep 5, floor 3, no refill of unranked passages, no document cap
```

Score: **89 / 100**, 43/46 corrected baseline (`bench_50.json`); 90 / 100 on the tuned 12-test suite.

## Experiments

| # | Change | Result | Verdict |
|---|---|---|---|
| 1 | baseline — hardcoded 6-passage window | 72/100, 8/12 | baseline |
| 2 | window 6 → 20 (settable per request via `payload["top_k"]`) | **85/100, 11/12** | **keep** — evidence recall was already 60/70/90; the model was being shown the evidence and the window was discarding it |
| 3 | retrieve 30 → LLM rerank → keep 8 | **88/100, 11/12** | **keep** — adversarial 70 → 85, recovered the test the wide window had cost |
| 4 | keep 8 → 5, floor 3, stop refilling with unranked passages | **90/100, 12/12** | **keep** — refilling empty slots with what the model passed over was how distractors re-entered |
| 5 | chunking 256 / overlap 128 | 85/100, 11/12 | **revert — failed** |
| 6 | per-document cap, max 2 of the 5 kept passages | 89/100, 42/46 | **revert — failed** |
| 7 | rerank pool 20 → cap 2/doc over the 20 (not the 5) | Arabic 0/3 recovered, 92→91; English 89→85 (adversarial 96→73) | **revert — failed** |

### 5 — chunking 256/128 (failed)

Chased a suspected fidelity defect: a chunk boundary allegedly splitting "175 billion" so a passage
began with the orphaned text `n parameters`. **The defect did not exist.** Both corpora contain zero
boundary fragments and the intact figure in 15 (256/128) and 10 (512/80) chunks; the model had elided
the number itself while paraphrasing. Cost 5 points on the two axes that need context breadth
(multi-hop 88 → 76, adversarial 100 → 80) because 3.2× the chunks behind the same 30-candidate window
means each passage covers ~⅓ the text. **Lesson: verify a fidelity hypothesis against the corpus
before re-ingesting to fix it.**

### 6 — per-document cap (failed)

Added to stop the reranker collapsing a cross-document answer onto one paper (the attribution failure:
bert sat at rank 10 of 30 and the kept 5 were all gpt3). The cap preserved adversarial cleanliness —
the one thing it was safe for — but recovered neither target and cost a pass.

Cause: the reranker is asked to name only **5** passages, and the cap is applied to that five-item
list. If the ranking is five passages from one document, capping it at two leaves nothing else to
choose from, and the floor-relaxation refills from the same overflow. **You cannot diversify a
five-item list when there is no sixth item.** A cap would only be meaningful if the reranker ranked a
longer list (~20) and the cap selected 5 from that, so bert at rank 10 was inside the pool.

### 7 — rerank pool 20 → cap 2/doc over the 20 (failed)

Implemented exactly the ~20-pool the note above asked for: `llm_rerank(..., keep=20)` then
`select_with_cap(ranked, 5, 2)` (new pure helper, `retrieval.select_with_cap`). It did **not** recover
the three Arabic cases and cost points on both corpora.

```
Arabic (34 q, re-scored with the Arabic refusal detector)
  direct 9/10→8/10  semantic 8/10  negative 10/10  terminology 3/4
  OVERALL 30/34 (92) → 29/34 (91)          target docs recovered: 0 of 3
English (bench_rag_50, 46 q)
  direct 90  multi-hop 96  negative 85  semantic 79  adversarial 96→73
  OVERALL 89 → 85, 42/46 → 36/46
```

**Why it cannot recover the Arabic cases — the pool never reaches 20.** The three target documents are
not in the pool the reranker sees. The engine's chat path runs `retrieval.search` with the assistant's
own `similarity_threshold` (**0.2**, the `POST /chats` default), which shrinks 30 raw candidates to
4–9 for these questions; `arabic-admin.txt` (raw rank 27) and `arabic-leave.txt` (raw rank 23) are
filtered out entirely, and `wiki-اللغة العربية.txt` (raw rank 5) too. Those ranks only exist at
`similarity_threshold: 0.0` (the `/datasets/search` probe body). No selection mechanism over the pool
can cite a document the pool does not contain — the recall shortfall is upstream of selection.

**Why it costs the adversarial axis — the cap injects the distractors it was meant to avoid.** English
does retrieve 30 candidates, so `llm_rerank(..., 20)` runs and the cap applies. But forcing ≤2 per
document guarantees ≥3 documents in a 5-slot context: 6 of 10 adversarial tests dropped to
`no_distractors=False`, e.g. the GPT-3 pool ranked 19 GPT-3 chunks + 1 word2vec, and the cap pulled
word2vec in. The adversarial axis measures exactly "cite only this paper"; a diversification cap is
the opposite of what it needs. Same class of error as experiment 6, one level removed.

**Lesson: the cap and the target were never in the same pool.** Two separate defects were being blamed
on selection — an upstream recall/threshold problem (Arabic) and an anti-diversity requirement
(adversarial) — and a selection change can only trade one against the other.

## Measurements that did not move (and should not have)

Evidence recall stayed **60 / 70 / 90 % by test** (40 / 45 / 75 by fact, MRR 0.325) through
experiments 2–4. Widening what the model is shown cannot change what retrieval finds, and reporting
it as a gain would be wrong. `bench_diagnostics.py` reports Recall@5/10/20 plus the gold-chunk rank
per test; the useful output was the rank distribution — every test whose gold chunk ranked 1–2
passed, every test whose gold ranked 8 or worse failed.

## Benchmark corrections (a new baseline, not an improvement)

Four questions were rewritten after the failures were read: the ResNet layer count was graded on a
bare `"152"` (now the variant designation) and the word2vec corpus size asserted one reading of a
source that reports both words and tokens (now accepts either). The word2vec fix worked; the ResNet
one changed nothing, which showed the failure was real rather than a badly written question. Score
89 either way — the corrections made the questions fairer, they did not make the system better.

## Open issues (deferred)

- **ResNet-152's designation is never stated** (2 of 46 tests, direct and adversarial). The verifier
  confirms it is in the corpus, retrieval returns ResNet passages, and the model still does not say it
  in two independent phrasings. Not a context-breadth problem; needs its own investigation.
- **The attribution failure** (1 test) — understood, not fixed: reranker shortlist of 5, all one
  document. Revisit if the Arabic work shows the same reranking behaviour.

## Arabic — findings (logged, not fixed)

Corpus `kb_f1a1d24c6cb94b77` ("Arabic smoke"): 8 documents, 143 chunks — 5 real Arabic Wikipedia
articles plus 3 authored documents carrying the normalisation matrix.

- **Normalisation is already sufficient — do not add it speculatively.** 11/12 probes passed with no
  Arabic-specific code: a bare `ا` query found `إجازة`, tashkeel matched in both directions, `٢١` and
  Latin `30` both retrieved, and the `ال` and `و` clitics did not break matching. The tokenizer
  appears to strip hamza and diacritics at index time — the console's keyword chips render `الاداره`
  for `الإدارة` — which would explain the tolerance. **This is inference, not verified in code.**
- **Arabic BM25 similarity is not a refusal signal.** The out-of-corpus probe ("ما هي عاصمة أستراليا؟")
  scored 0.748 while correct answers scored 0.75–0.84 — the negative sits inside the positive band.
  Never gate refusal on a similarity threshold in Arabic; score refusals on whether the model declines.
- **RTL: logged, deferred.** The console sets no `dir` anywhere (`html` and `body` both None), so
  Arabic content inherits `direction: ltr` and `text-align: left`. Nothing is clipped or hidden, so
  content is readable; mixed Arabic/Latin runs are where alignment will visibly suffer. The fix when
  taken is `dir="auto"` (or `unicode-bidi: plaintext`) on content surfaces — not a mirrored UI.

## Arabic baseline — FROZEN (`bench_arabic.json`, 34 questions)

```
1 direct        9/10    97
2 semantic      8/10    94
3 negative     10/10    85      <- all ten refused correctly
4 terminology   3/4     92
OVERALL        30/34    92      (mean of the four axes)
```

Not comparable to the English 89 as a like-for-like figure: different axes (no multi-hop, no
adversarial), and the Arabic negative axis is 10/10 clean refusals. Do not read 92 > 89 as Arabic
being better.

**The harness was wrong before the system was.** The first pass reported five negatives as "ANSWERED
AN OUT-OF-CORPUS QUESTION" — all five had in fact refused in Arabic (`لا تحتوي المقاطع المذكورة على أي
معلومات عن…`). `bench_rag_suite.REFUSAL` is an English regex and does not match Arabic refusal
phrasing, so it scored correct refusals as hallucinations. Re-scored from the stored answers with an
Arabic detector; **no re-run was needed** because the answers were on disk. Same class of error as the
English refusal false-pass — the detector is part of the instrument and has to be validated per language.

**All four genuine failures share one signature: `facts <all found> / docs_ok=False`.** Every expected
fact appears in the answer, and the cited document is a different one — one monthly-report question was
cited to the Red Sea article. Retrieval found the evidence and the model stated it; the **citation is
attached to the wrong document**. That is 4 of 34 (12%) against 1 of 46 (2%) in English, and it is the
one Arabic-specific weakness this baseline exposes. The single terminology failure is an over-refusal:
the corpus mentions the terms and the model declined anyway.

Do not investigate the citation mismatch yet — the baseline is frozen first, and the RTL and
normalisation findings stay logged-but-unfixed until the evidence says which is worth the change.


## OCR evaluation frozen (2026-10-08)
Prose/degraded/Arabic accuracy is frozen in `OCR-BENCH-FREEZE.md`, with the numeric battery kept separate
(exact-match metric, 26/36). Comparator rules are pinned there — RTL word-order on the
hypothesis only, bagCER beside sequence CER, exact tokens for numbers. Arabic-Indic numerals are recorded
as an engine/script limitation, not a bug to tune away. Next: the OCR worker with numeric validation/retry.

## EXP-OCR-01 - OCR worker (page/region OCR, per-region script, numeric validation, quarantine)
New module `ownrag_engine/ocr.py` and `ocr_worker_test.py`; the frozen benchmark is imported from, never
edited. Not yet wired into ingestion. Retry path proven on the case the battery measured
(`4,812.75` -> `4.812.75`): the failing numeric region is upscaled x3 and re-validated, and quarantined
when unrecoverable. A flagged page that yields no text returns `NEEDS_OCR_NO_TEXT` after a whole-page
upscale, never a silent `OCR_DONE` with zero output. Validator gap found during this work: a low-res
`1,234,567` read back as `1.234,567` - separators swapped, a different magnitude in the same digits - so
mixed separators are now rejected.

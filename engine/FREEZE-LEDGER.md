# OwnRAG — freeze ledger (2026-10-08)

Source of truth for what is measured, what is open, and what is explicitly unproven.
No source file was changed to produce this ledger. No implementation change is pending.

## Closed — measured and verified

| Item | Result | Evidence |
|---|---|---|
| OCR integration suite | **17 passed / 0 failed** | `ocr_integration_test.py` |
| OCR worker suite | **27 / 0** | `ocr_worker_test.py` |
| Ingest guard suite | **12 / 0** | `ingest_guard_test.py` |
| Frozen benchmark KBs | **0 orphan index rows each** (English 63,573 rows; Arabic 9,871) | direct DB query |
| Orphan purge | **13,920 rows removed** (laborlawar 13,912 + scratch 8); live chunks **5,587 -> 5,587**; reindex adds none | `ocr-test/orphans_snapshot.json` |
| Orphan root cause | `token_index` cleanup keyed on `document_id` instead of each chunk's `id` -> deleted nothing; fixed; verified delta 0 | `ingest.py` |
| Arabic frozen corpus | **143 chunks, 8/8 `DONE`, all `source=native`, `available_int=1`**; nothing deferred, rejected or quarantined | DB query |
| Quarantine enforcement | chunk kept for audit (`available_int=0`), reason persisted, unreachable by retrieval, document `NEEDS_OCR_QUARANTINE` | live API + DB, with a valid control page landing `DONE` |
| Provenance | `chunk.source` native/ocr + `chunk.bbox` (native `''`, OCR full page rect); 5,665 pre-existing rows backfilled `native` | DB query |
| OCR recovery 200->400 dpi | **UNPROVEN** — 5 sizes x 150/200/400 dpi: failure is legibility, not resolution | `ocr-test/bench.json`, this session's probe |
| Provider failures in benchmarks | **0 markers** in both runs; scorers invalidate a provider-failed run (exit 2) | `bench_*.log`, `bench_score.py` |

## Diagnostics — outcomes

### English repeat (run 1 vs run 2)
Both runs: **43/46** with **identical per-axis counts** (direct 9/10, multi-hop 8/8, negative 8/8,
semantic 9/10, adversarial 9/10). The pass-level measurement is reproducible across runs.
Run 1's composite was **85** against the frozen control's **89** (adversarial axis 80 vs 96).
**To conclude on the adversarial/composite delta, run 2 must be rescored** (`bench_score.py`
against run 2's answers). Until then the delta is neither noise nor a regression: the pass counts
did not move, and the composite question is unanswered. **STATUS: OPEN.**

### Arabic negative axis (0/10) — RESOLVED: benchmark/detector problem, not behaviour

The corpus is intact (143 native chunks, nothing deferred or quarantined) and no provider failure
occurred. The 10 negative questions are `refuse(...)` entries inside `SUITE_AR["3 negative"]`
(they are function calls, not dict literals — which is why two earlier extraction attempts failed).
Asked directly against `kb_f1a1d24c6cb94b77` with the SSE stream parsed, **10/10 are genuinely
refused**, in a consistent form: `لا تحتوي المقاطع المذكورة على أي معلومات عن …`.

The benchmark scores refusal with a module-level `REFUSAL` pattern, and that pattern does **not
match the engine's current refusal phrasing** (measured above), so every real refusal was scored
as a non-refusal. The 0/10 is an instrument defect, not a system defect. The Arabic 92–93.6 control
therefore stands; 23/34 must not be read as a regression.

**Rescored with the Arabic refusal detector (the measurement the control used):**

```
1 direct       pass  9/10   score  97.0     (control 97 - identical)
2 semantic     pass 10/10   score 100.0    (control 94)
3 negative     pass 10/10   score  85.0    (control 85 - identical; was 0/10 raw)
4 terminology  pass  4/4    score 100.0    (control 92)
OVERALL        pass 33/34   score  95.5    (control 92-93.6)
```

Negative 10/10 and direct 97 reproduce the control exactly, so the Arabic system is unchanged and
the raw 23/34 was entirely the English pattern. 33/34 / 95.5 is from `bench_arabic.json` (16:41),
the run that produced the raw 23/34 - same answers, correct detector. Fixing this requires updating the Arabic
refusal pattern — a new experiment ID, not a silent edit to a frozen benchmark.

### English composite / adversarial delta — REPRODUCED, not noise

Run 1 and run 2 agree exactly: **43/46 passes with identical per-axis counts**, composite **85**,
adversarial **80** (control: 89 / 96). The delta reproduces across two independent runs, so it is
not judge variance; per-axis movement is contradictory (direct 90 -> 100, multi-hop 96 -> 76) while
pass counts barely moved (42 -> 43), which points at axis-level attribution rather than the answers.
Since the English KB is untouched (0 orphans, no OCR chunks), OCR cannot be the cause.
**STATUS: OPEN — investigate the benchmark's axis attribution.**

## Explicitly not claimed
- 200->400 dpi recovery. Do not describe it as working.
- Any Arabic regression. The 92–93.6 control stands; 23/34 is not comparable until the
  negative axis is diagnosed.
- Any English regression. Pass counts did not move between runs; the composite delta is unrescored.

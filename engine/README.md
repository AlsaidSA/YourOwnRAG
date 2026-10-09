# OwnRAG local engine

A second, self-contained implementation of the OwnRAG HTTP contract — the same routes
`web/src/api/endpoints.ts` calls and the same `{code, data, message, total}` envelope the preserved
the upstream Go backend serves. It exists so OwnRAG is fully functional on one machine with **no
container runtime**: no Docker, no Elasticsearch, no MySQL, no MinIO, no NATS.

Upstream's Go backend is untouched and remains the production engine. This one is the local
engine, and the console cannot tell the difference — switch between them by pointing the proxy at
whichever is running.

```
python serve.py                      # http://127.0.0.1:9380
```

Then run the console (`cd web && npm run dev`) and it flips from **Demo data** to **Live** on its
own, because its connectivity probe now succeeds.

---

## What is real

| Stage | Implementation |
|---|---|
| **Parsing** | PyMuPDF for PDF (page by page, so citations carry a page number), python-docx for DOCX (paragraphs + tables), openpyxl for XLSX (per sheet), stdlib `csv` for CSV/TSV, slide XML for PPTX, a tag-stripping reader for HTML, and text fallbacks for everything else. Legacy binary `.xls` gets a printable-run extraction instead of a failure. |
| **Chunking** | Each method has its own logic — they are not aliases. `laws` splits on article boundaries (`المادة`/`Article`/`§`), `qa` on Q/A markers, `book`/`paper`/`manual` on headings, `email` on mail headers, `table` groups rows under a header, `presentation` treats a slide as a unit, `one` keeps the document whole. |
| **Tokenising** | Latin + Arabic, with Arabic diacritics stripped and alef/teh-marbuta/yeh variants folded, so `الأجور` and `الاجور` match. This is what makes the Arabic retrieval in `smoke_test.py` work. |
| **Lexical index** | A real BM25 inverted index (`token_index`) built during ingestion — not a scan at query time. |
| **Vector index** | Real float32 vectors, L2-normalised, stored per chunk. Built-in encoder is sublinear TF over word tokens plus character 3-grams (partial Arabic morphology) hashed into 768 dimensions with a process-stable CRC32 — deliberately *not* Python's salted `hash()`, which would stop matching after a restart. |
| **Search** | Hybrid: BM25 + cosine over the vector index, fused by `vector_similarity_weight` exactly as the contract describes, with a threshold, optional lexical rerank (query-term recall + proximity + a length prior) and the per-component scores the console's meters display. |
| **Chat** | Real SSE streaming in the frame shape `web/src/api/chat-stream.ts` parses, real sessions and messages persisted, citations carried from the retriever (not from the model). |
| **Agents** | Real graph storage and versioning; a run walks the DSL, resolves the retrieval node's knowledge bases, retrieves, answers, writes an agent log and bumps the run count. |
| **Everything else** | Datasets, documents, chunks, ingestion summaries and logs, tags, providers and per-model enablement, API tokens, connectors, MCP servers, memories, files — all persisted in SQLite and served from it. |

**Linking a provider is enough.** When you save an endpoint and a key, the engine calls that
endpoint's `/models` and enables the **chat** models it lists, so the next question uses them. A
provider with an empty model list is exactly what silently leaves answers on the built-in path.
Only chat models are registered automatically — switching the embedding model without re-ingesting
would leave one corpus with two encoders. The Models screen's **Fetch models** button re-runs this
at any time, and `POST /api/v1/providers/{provider}/instances/{instance}/models/discover` (body
`{"kinds": ["chat"]}`, or `["embedding"]` / `["rerank"]` when you mean it) does the same over HTTP.
An endpoint that does not answer `/models` is not an error — add the model name by hand instead.

## Data sources (connectors)

**Sync now** on the Data sources screen really pulls: what it fetches is written into the knowledge
base's own directory and then goes through the same parse → chunk → index path as an upload, so the
result is searchable and citable like anything else. `GET /api/v1/connectors/sources` returns this
table, and the add dialog builds its fields from it — the console cannot offer a credential field
for a source that would ignore it.

| Source | What sync does |
|---|---|
| **Web crawl** | Fetches every address you list and ingests the page. HTML, plain text, PDF and Markdown are stored with the extension their `Content-Type` implies. |
| **Google Drive** | Lists the objects matching your query and pulls them. Google-native documents (Docs, Sheets, Slides) are exported to text; other files are downloaded under their own name and parsed normally. Needs a token with `drive.readonly` — set it on the connector, or `OWNRAG_GOOGLE_TOKEN` in `engine/.env`. |
| **Gmail** | Reads the messages matching your query and ingests subject + body as text. Needs `gmail.readonly` (same token variable). |
| **SharePoint** | Lists a Microsoft Graph drive folder and downloads its files. Needs a Graph token with `Files.Read.All` (`OWNRAG_GRAPH_TOKEN`). |
| **Amazon S3, Notion, Confluence, Slack, Discord, Box** | **Not implemented.** Sync reports exactly what the source needs instead of reporting an empty success. |

**Test connection** performs a real listing and writes nothing. **Sync now** reports what it wrote
(`documents_synced`, a message, and a connector-log entry). A **paused** connector refuses to sync
rather than running silently. Deleting a knowledge base a connector points at leaves the connector
in place, reporting the missing target.

```bash
cd engine && .venv/Scripts/python.exe connectors_test.py    # 21 checks
```

## What is honest

- **No model configured** (the default): embeddings are the built-in lexical vectors and answers
  are **extractive** — sentences scored against the question, cited, and emitted only if they exist
  in your corpus. It cannot hallucinate, and it will not paraphrase. Every such answer ends with a
  line saying so, `/system/version` reports `lexical-built-in` / `extractive-built-in`, and the
  Models screen shows it as the engine's only "provider".
- **Scanned PDFs and images need OCR**, which this engine does not include. Ingestion fails with
  that message rather than indexing an empty document.
- **No cross-encoder rerank model.** Rerank is lexical; the retrieval screen labels it.
- **Not a distributed system.** One process, one SQLite file, in-process threads for parsing. It is
  built for a laptop or a single small server, not a cluster.

## Turning on real models (optional, no code change)

Create `engine/.env` from `.env.example` and set any OpenAI-compatible endpoint:

```bash
OWNRAG_LLM_BASE_URL=https://api.deepseek.com/v1
OWNRAG_LLM_API_KEY=...            # your key, in this file only
OWNRAG_LLM_MODEL=deepseek-chat

OWNRAG_EMBEDDING_BASE_URL=https://api.openai.com/v1
OWNRAG_EMBEDDING_API_KEY=...
OWNRAG_EMBEDDING_MODEL=text-embedding-3-small
```

Restart the engine and every answer becomes generated and grounded on the numbered passages, and
every chunk is embedded semantically. `/api/v1/datasets/{id}/embedding/check` reports when a
corpus holds chunks from two different encoders, so a model swap can't silently degrade retrieval.
Local runtimes work too — Ollama, vLLM and LM Studio all expose the same endpoints.

## Bring your own model

Add a provider on the console's **Models** screen: the dialog lists what the engine reports from
`GET /api/v1/providers/catalog` — searchable, each vendor's well-known endpoint already filled in —
so you pick a provider instead of typing a name and hoping. Then paste the key and enable the models
you want. The engine picks that up **on the next question — no restart** — and the Models screen's
connection state is read from the same rows the resolver uses, so it cannot show "connected" for a
provider nothing calls.

Selection order: **the model the assistant asked for → the newest enabled model in the database →
`engine/.env` → the built-in local implementations.** The chat settings dialog's model choice is
honoured as `model@provider`, so pinning one assistant to a model no longer silently rides whichever
provider was added last. A provider with a blank API base works for the well-known services (OpenAI,
DeepSeek, OpenRouter, Groq, Mistral, Ollama, vLLM, LM Studio …); anything else needs its base
spelled out, and Azure always does, because its URL carries your resource name. A provider with no
usable base is not selected — the answer says so instead of failing silently.

Two consequences worth knowing:

- **Chat/rerank** switch instantly. **Embeddings** do not: switching encoder changes the vector
  space, so existing vectors are marked stale rather than mixed with new ones — retrieval falls back
  to BM25 for those chunks until they are re-ingested. `GET /api/v1/datasets/{id}/embedding/check`
  reports exactly which chunks are behind.
- Removing a provider is `DELETE /api/v1/providers/{name}`; disconnecting an instance clears its
  credentials so it stops being selected.

`providers_test.py` proves this without any key: it runs a stub OpenAI-compatible endpoint in-process,
adds the provider through the same calls the console makes, asserts the answer text came from the
stub, then disables it and asserts the answer reverts to extractive.

## Tests

```bash
# 56 checks: the whole pipeline over real files, straight at the engine's HTTP surface
./.venv/Scripts/python.exe smoke_test.py
# 34 checks: the same ground through the console's own dev proxy (needs the console up)
./.venv/Scripts/python.exe check_console_path.py
# 40 checks: drives the console in a real browser — sign-in, upload, ingest, retrieve, cite
./.venv/Scripts/python.exe ui_test.py
# 21 checks: bring your own model — a provider added through the API answers, then is disabled
./.venv/Scripts/python.exe providers_test.py
```

`smoke_test.py` builds genuine fixtures (`samples/`: a multi-page PDF, a Markdown file with Arabic
content) and asserts on observable outcomes — that the retrieved chunk actually contains the answer,
that Arabic queries reach Arabic chunks, that the streamed answer cites its sources.

`ui_test.py` needs the console running on 5173 and asserts against the engine rather than the page's
own copy, so a passing UI cannot disguise an empty result: it uploads a file through the dialog,
waits for the engine to report `DONE`, checks the chunk text came from the file, then reads the
retrieved passage and the inline citation chips out of the rendered page. Screenshots of each step
land in `screenshots/`.

## Files

```
engine/
├── serve.py                     entrypoint (uvicorn, port 9380)
├── requirements.txt
├── .env.example
├── smoke_test.py                end-to-end pipeline test
├── check_console_path.py        console↔engine integration test
├── ui_test.py                   browser test against the running console
├── providers_test.py            bring-your-own-model test (stub endpoint, no key needed)
├── screenshots/                 evidence captured by ui_test.py
├── samples/                     generated test fixtures
├── data/                        SQLite database + uploaded files (gitignored)
└── ownrag_engine/
    ├── core.py        config, SQLite schema, migrations, tokenising
    ├── ingest.py      parse → chunk → index
    ├── retrieval.py   vectors, BM25, fusion, rerank
    ├── answering.py   extractive + LLM answers, SSE framing
    └── api.py         the HTTP contract
```

---

Modified for OwnRAG from the upstream Apache-2.0 project; see NOTICE. Copyright 2026 The InfiniFlow
Authors, Apache-2.0. The contract this engine implements is theirs; the implementation is new.

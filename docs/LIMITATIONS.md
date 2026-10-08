# Limitations and honest status

This document exists so nobody has to guess which parts of OwnRAG are real. It is a working
redesign of the console on top of a preserved backend, with a local engine so the whole product
runs on one machine — not a finished product, and not a claim that upstream's functionality was
rewritten.

## What is real

- **The backend is untouched.** No file under `internal/`, `cmd/`, `rag/`, `docker/`, `conf/`
  or `sdk/` was modified. Every one of the upstream HTTP routes still exists and still
  behaves as upstream intended.
- **There is a second, working engine** (`engine/`) that implements the same contract on a
  single machine with no containers: real PDF/DOCX/XLSX/CSV/PPTX parsing, per-method chunking,
  a real BM25 inverted index, real float32 vectors, hybrid fusion and lexical rerank, streamed
  cited answers, persisted sessions and agents. It is verified by three executable test suites, all
  passing: `engine/smoke_test.py` (56 checks against the engine's own HTTP surface),
  `engine/check_console_path.py` (34 checks through the console's own dev proxy) and
  `engine/ui_test.py` (40 checks driving the console in a real browser — sign-in, an upload
  through the dialog, ingestion, the document viewer, retrieval, citation chips, every route).
  See `engine/README.md` for exactly what is real in it and what it does not do (no OCR, no
  cross-encoder rerank, single-process).
- **The console is a real application.** It builds (`vite build`), type-checks
  (`tsc --noEmit`) and runs (`vite dev`), and every screen fetches through the same axios
  client with no mocked transport in the live path.
- **The API contract is preserved, not re-invented.** `web/src/api/endpoints.ts` mirrors the
  upstream paths and the upstream response envelope (`{code, data, message, total}`, code 0 =
  success, HTTP 200 even for errors).
- **The screens are wired to real endpoints** — knowledge bases, documents, chunks, ingestion
  summaries, retrieval, chats and sessions, agents, providers and models, connectors,
  memory, MCP servers, API tokens, system version, team members. Each page's header comment
  names the endpoints it calls.
- **List, search and paging are server-side.** The knowledge-base document list sends
  `keywords` / `run` / `page` / `page_size` — the parameter names the live handler actually
  reads (`internal/handler/document.go`) — and renders the server's total. The bundled demo
  transport honours the same names, so live and demo are one code path.
- **Every async surface renders loading, empty, error and loaded states**, and long
  operations poll until they settle.
- **Attribution is kept, including dependencies'.** See `web/THIRD-PARTY-NOTICES.md`; notably
  the agent canvas deliberately leaves React Flow's attribution badge visible even though
  its licence permits hiding it.

## What is demo-only

The console bundles a sample corpus (`web/src/api/demo/`) that activates **only** when the
API is unreachable or when you choose it deliberately at sign-in. It is labelled in the top
bar with the reason, and it is never presented as live data. Writes in demo mode mutate the
in-memory seed and are discarded on reload.

Consequences worth stating plainly:

- Numbers on the Overview while in demo mode are seeded, not measured.
- There is **no** time-series or event-stream endpoint in the API contract. The Overview
  therefore derives everything from resources that do exist (knowledge bases, ingestion
  summaries, connectors, agents, `/system/version`). Where a question cannot be answered from
  those, the panel says so instead of drawing a chart. Throughput and latency graphs do not
  exist in either mode — they were not faked.

## What still depends on the upstream UI

The redesign covers the product surfaces named in the brief. The upstream console at
`legacy/ragflow-web/` is preserved because a handful of deep editors were **not** rewritten in
this pass, and pretending otherwise would be worse than saying it:

- the chunk-level visual editor with bounding-box highlighting over rendered pages,
- the knowledge-graph visualiser,
- the dataflow/pipeline (ingestion canvas) editor,
- the admin console (users, roles, services, monitoring),
- chat-channel and bot publishing surfaces.

Those screens exist and work in `legacy/ragflow-web/`; own them from the OwnRAG console by
linking out, or port them onto the OwnRAG primitives. The API for all of them is preserved, so
the port is a UI task only.

## What was not done at all

- **The console has no unit or component tests.** It is covered end to end instead, by
  `engine/ui_test.py`, which drives the running application in Chromium and asserts against the
  engine's API. That is a real regression net but a slow one — about five minutes, and both
  servers must be up. Unit tests for the components and the query layer are the first thing to add
  next. The upstream Go and frontend test suites are untouched and still describe upstream
  behaviour.
- **The live path has been exercised against the local engine, not against upstream's Go
  backend.** Both `check_console_path.py` and `ui_test.py` drive sign-in, knowledge-base creation,
  a real multipart upload, ingestion with polled progress, retrieval, streamed cited chat and
  deletion, and every check passes. What has *not* been observed end to end is the upstream stack —
  MySQL, MinIO, Elasticsearch, Kvrocks, NATS and the Go server — because no container runtime was
  available on the machine this was built on. The console talks to both through identical paths,
  but treat first-run wiring against an upstream deployment as unverified.
- **The engine is not a replacement for the upstream backend.** It is single-process, SQLite-backed
  and intended for a laptop or one small server: no distributed ingestion, no sharding, no
  concurrent multi-tenant isolation, no OCR, no cross-encoder rerank, and its built-in vectors
  are lexical rather than semantic until you configure an embedding endpoint.
- **No i18n migration.** The upstream console is localised into 20+ languages; the new console
  is English-only, with copy written directly in components. Text is not extracted into
  message catalogues yet, so adding a second language is a real piece of work.
- **No accessibility audit with a screen reader.** Keyboard paths, focus visibility, contrast
  and semantics were designed in, but none of it has been verified with assistive technology.
- **No packaging.** There is no OwnRAG container image for the console and no compose file
  that serves `web/dist`; the console runs from the Vite dev server or any static host.

## Known simplifications in the new console

Smaller than the gaps above, but real. Each is a deliberate trade-off, not an oversight:

- **Chunk lists paginate on the client.** The document viewer fetches a document's chunks in
  one request and pages them locally. Typical documents are fine; a document with tens of
  thousands of chunks will load a large payload. Wire it to the chunk endpoint's paging when a
  real corpus makes it hurt.
- **Team management is read-only.** The Settings → Team tab lists members and roles and says
  so. Invitations and role changes go through the tenants API from the operator side; the
  console does not pretend to offer them.
- **Appearance and ingestion defaults are device-local.** Those preferences are stored in
  `localStorage` and labelled as such, because there is no endpoint for per-user preferences.
- **"Delete workspace" is presented disabled**, with the operator command shown instead — no
  endpoint exists, and a button that silently does nothing would be worse.
- **The retrieval score panel only describes the current run.** It derives result count,
  mean score, a similarity histogram and the vector/keyword blend from the chunks the API
  returned. There is no endpoint for cross-query or historical metrics, so it does not invent
  them.
- **Chat feedback is optimistic.** Thumb-up/down writes to the message endpoint when the
  backend models it; in demo mode the toggle is held in memory and discarded on reload.
- **No chunk-level visual editor.** The upstream console's bounding-box chunk editor over
  rendered pages is not in the new console; its data endpoints (`…/chunks/:chunk_id`,
  positions) are exposed and the preserved UI still has it.

## Operational requirements

The console is a static bundle that proxies to whichever engine is running on **:9380**.

- **Local engine** — Python 3.11 and the packages in `engine/requirements.txt`. Nothing else: no
  containers, no database server, no object store. It writes a SQLite file and the uploaded files
  under `engine/data/`.
- **Upstream backend** — the full runtime services: MySQL/PostgreSQL, MinIO, Elasticsearch or
  Infinity, Kvrocks and NATS, plus a model provider for anything that calls a model. Without
  those, only the local engine or demo mode is meaningful.

## Naming that was deliberately left alone

Renaming functional identifiers was avoided where it would break compatibility: environment
variables, database table names, image names, package/module identifiers, upstream file paths
and the upstream API's own naming (`datasets` for knowledge bases, `documents`, `parser_id`,
`chunk_method`, `*_kwd` fields). Those are contract, not branding. See
[`BRANDING-MAP.md`](BRANDING-MAP.md) for the full inventory of what changed and what did not.

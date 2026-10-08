# DERIVED-WORK — Statement of Changes to RAGFlow

This document is the file-level statement of modification required by Section
4(b) of the Apache License, Version 2.0 ("You must cause any modified files to
carry prominent notices stating that You changed the files"). It records exactly
what OwnRAG changed, moved, added, and left untouched relative to the upstream
RAGFlow project.

Every figure below was measured from this working tree; none is estimated.

## 1. Provenance

| Item | Value |
| --- | --- |
| Upstream project | RAGFlow — `https://github.com/infiniflow/ragflow` |
| Upstream copyright holder | The InfiniFlow Authors |
| Upstream license | Apache License, Version 2.0 |
| Fork point (upstream commit) | `2400ca8eb51432b1d304266d0de9ca232d9b53fa` |
| Fork-point commit subject | `feat(agent,ingestion): carry the grep/bm25 contracts and index declared titles (#20542)` |
| Product name | OwnRAG |
| Product tagline | "Your data. Your models. Your RAG." |
| OwnRAG copyright line | `Copyright 2026 OwnRAG contributors` |

The repository `LICENSE` file is the stock, unmodified Apache License 2.0 text
(201 lines; the Appendix still contains the literal `[yyyy] [name of copyright
owner]` placeholders). OwnRAG does not edit the LICENSE. Attribution for the
derivative work is in `NOTICE`.

## 2. What was moved (the upstream console)

The upstream React console was relocated with `git mv` from `web/` to
`legacy/ragflow-web/`.

- The move is a **pure rename**: `git diff` for the rename set reports
  **1786 files changed, 0 insertions(+), 0 deletions(-)**. No upstream file
  content was altered in the move.
- `legacy/ragflow-web/` contains **1786 files** (no `node_modules`; nothing
  vendored). Of these, **1510** are front-end code files
  (`.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.scss`, `.less`, `.html`); the balance
  is assets (`.svg`, `.woff2`, `.png`), config, and JSON.
- **523** files carry the upstream Apache-2.0 per-file header block, i.e. the
  exact line `Licensed under the Apache License, Version 2.0`; **525** files
  mention `Copyright`; **524** mention `InfiniFlow`.
- The canonical upstream header retained in those files is:

  ```text
  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.

  Licensed under the Apache License, Version 2.0 (the "License");
  ...
  ```

- `legacy/ragflow-web/` is treated as a **frozen upstream snapshot**. It is
  referenced for behavior and license compliance only. It is not built, not
  imported by the new console, and must not be edited (see `docs/BRAND-RULES.md`).

Legacy package identity (for the record): `legacy/ragflow-web/package.json`
declares version `1.0.0`, `"private": true`, description
`"RAGFlow Web Frontend migrated to Vite"`, author `"bill"`.

## 3. What was added (the new OwnRAG console)

A brand-new console is being written in `web/`. It currently holds
**84 files** (excluding `node_modules` and `dist`), 75 of them under
`src/`:

- Stack: Vite + React 18 + TypeScript + Tailwind CSS v4 + Radix UI.
- `web/package.json`: `"name": "ownrag-web"`, version `0.1.0`,
  `"license": "Apache-2.0"`, `"author": "OwnRAG contributors"`.
- Design tokens live in `web/src/styles/tokens.css` (raw values are prefixed
  `--or-`); the Tailwind theme layer is `web/src/styles/globals.css`.
- The console is a new client of the **preserved** backend: it targets the
  existing HTTP contract `/api/v1/*` (REST) and `/v1/*` — see
  `web/src/api/endpoints.ts`. It does not introduce a new protocol.
- New OwnRAG source files carry a derived-work header, currently present in
  **5** files (`web/src/api/client.ts`, `web/src/api/chat-stream.ts`,
  `web/src/api/endpoints.ts`, `web/src/store/auth.ts`,
  `web/src/styles/tokens.css`), of the form:

  ```text
  Copyright 2026 OwnRAG contributors
  Derived from RAGFlow (https://github.com/infiniflow/ragflow),
  Copyright 2026 The InfiniFlow Authors. Licensed under the Apache License, Version 2.0.
  ```

- The console is **functionally complete at the shell level and in active
  expansion at the screen level**: `web/src/main.tsx`, `app.tsx` and `routes.tsx`
  are present, the design system (12 primitive modules), the app shell
  (sidebar, topbar, command palette), the API layer, the query layer and the
  screen set are in place. It type-checks clean and produces a production build.
  `web/` is untracked in git. Refresh these counts as work continues.

## 4. What was added (the local engine)

`engine/` is new, original code — no upstream file was copied into it. It is a second
implementation of the same HTTP contract the preserved backend serves, written so the console can
run end to end on one machine without the upstream runtime services (MySQL, MinIO, Elasticsearch,
Kvrocks, NATS). The Go backend is neither modified nor replaced by it; both answer on `:9380` and
the console cannot tell them apart.

| File | Lines | What it does |
|---|---:|---|
| `engine/ownrag_engine/core.py` | 312 | configuration, SQLite storage, schema and in-place migrations, response envelope |
| `engine/ownrag_engine/ingest.py` | 477 | real parsing (PyMuPDF page by page, python-docx, openpyxl, CSV/TSV/HTML/text), chunking, indexing |
| `engine/ownrag_engine/retrieval.py` | 319 | hashed vector index, inverted BM25, hybrid fusion, rerank |
| `engine/ownrag_engine/answering.py` | 246 | extractive answering (default) and model-generated answering, SSE framing |
| `engine/ownrag_engine/api.py` | 2,238 | the `/api/v1/*` surface |
| `engine/serve.py` | 41 | entrypoint (`python serve.py` → `http://127.0.0.1:9380`) |
| `engine/smoke_test.py` | 380 | drives the engine's own HTTP surface end to end |
| `engine/ui_test.py` | 360 | drives the console in a real browser and asserts against the engine |

Test suites are counted with the code because they are the evidence for the claims above:
`engine/smoke_test.py` exercises login, knowledge-base creation, a real PDF and Markdown upload,
parsing, chunking, indexing, retrieval and a streamed cited answer; `engine/ui_test.py` drives the
console's actual interface — sign-in, the live indicator, knowledge-base creation, an upload
through the dialog, ingestion, the document viewer, retrieval, citation chips and every route.

## 5. What was preserved (the backend — not modified)

Backend and tooling trees are unchanged. Measured file counts:

| Tree | Files | Status |
| --- | --- | --- |
| `internal/` | 2776 | unmodified |
| `cmd/` | 5 | unmodified |
| `rag/` | 49 | unmodified |
| `docker/` | 21 | unmodified |
| `sdk/` | 21 | unmodified |
| `conf/` | 89 | unmodified |

`git status` shows only two kinds of change in the tree: the 1786 staged renames
under `legacy/ragflow-web/` and the untracked `web/` directory. No tracked
backend or tooling file is modified. The HTTP contract the console relies on is
served by this untouched backend: `conf/service_conf.yaml` sets the API server
to `http_port: 9380` (line 5) and the admin surface to `http_port: 9381`
(line 29).

## 6. Documentation additions

`docs/` previously held 145 upstream files (108 `.md`, 9 `.mdx`, 28 `.json`
category files). OwnRAG adds two brand-governance documents to it:

- `docs/BRANDING-MAP.md` — upstream-name → OwnRAG-name mapping and where upstream
  branding still lives.
- `docs/BRAND-RULES.md` — rules contributors follow when branding the fork.

## 7. Change classes in one view

| Change | Mechanism | Evidence |
| --- | --- | --- |
| `web/` → `legacy/ragflow-web/` | `git mv` (pure rename, 0 content diff) | 1786 renames in `git status`; `git diff` = 0 insertions/deletions |
| New console `web/` | new, untracked files | 22 files, `ownrag-web` package |
| Backend `internal/ cmd/ rag/ docker/ sdk/ conf/` | none | absent from `git status` |
| `LICENSE` | none (stock Apache-2.0) | 201 lines, placeholders intact |
| `NOTICE`, this file, `docs/BRAND-*.md` | new OwnRAG files | this change set |

## 8. Compliance notes

- Apache-2.0 §4(a): recipients receive a copy of the License — `LICENSE` is
  retained at the root.
- Apache-2.0 §4(b): modified files carry notices of change — however, no upstream
  file was modified (the console move is a pure rename); the new console files
  carry a `Derived from RAGFlow` header.
- Apache-2.0 §4(c): all upstream copyright, patent, trademark, and attribution
  notices are retained — the 523 per-file InfiniFlow headers in
  `legacy/ragflow-web/` are untouched.
- Apache-2.0 §4(d): upstream ships no NOTICE file, so no upstream notice text is
  required; `NOTICE` records attribution voluntarily.
- Apache-2.0 §6: "RAGFlow"/"InfiniFlow" are used only to describe origin; no
  endorsement is implied.

# BRAND-RULES — OwnRAG contributor rules

Rules for branding and attribution in this fork. They exist to keep the fork
legally clean (Apache-2.0) and to keep the product coherent. If a rule and a
convenience conflict, the rule wins.

## 1. The product name

- Product name is **OwnRAG** (one word, capital O, capital RAG). Not "Ownrag",
  not "Own RAG" in running prose, not "ownrag" except where a machine identifier
  requires lowercase.
- Tagline is **"Your data. Your models. Your RAG."** — three sentences, periods,
  no Oxford comma after "models".
- The tagline's promise is literal: OwnRAG is self-hosted and the user owns their
  data and models. Do not write marketing copy that contradicts self-hosting.

## 2. Do not touch the frozen snapshot — `legacy/`

- `legacy/ragflow-web/` is a **frozen upstream snapshot** (1786 files). Never
  edit, rename, reformat, or rebrand anything under `legacy/`.
- Its 523 per-file InfiniFlow Apache-2.0 headers are **license obligations** and
  must be preserved exactly. Deleting them is a compliance failure, not a
  cleanup.
- `legacy/` is reference-only: do not import from it, do not build it, do not
  wire it into the new console. The new console is independent.

## 3. Do not touch the backend

- `internal/`, `cmd/`, `rag/`, `docker/`, `sdk/`, `conf/` are out of scope for
  branding. Capability preservation is the point of the fork; backend code,
  config, and CLI strings stay as upstream.
- **Never** rename HTTP paths, ports, or payload fields to fit a brand. The
  contract `/api/v1/*` and `/v1/*` (ports 9380 / 9381) is shared with the
  backend and existing clients. Rename the **label**, never the wire name. E.g.
  the UI says "knowledge base" while the API resource stays `datasets`.

## 4. File headers for new OwnRAG source

Every new source file under `web/` (and other OwnRAG-authored code) gets the
derived-work header:

```text
Copyright 2026 OwnRAG contributors
Derived from RAGFlow (https://github.com/infiniflow/ragflow),
Copyright 2026 The InfiniFlow Authors. Licensed under the Apache License, Version 2.0.
```

Wrapped in the file's comment syntax (`/* ... */` for CSS/TS at the top of the
file). This header is what satisfies Apache-2.0 §4(b) ("state that You changed
the files") and §4(c) (retain upstream attribution). Do not paraphrase it and do
not drop the InfiniFlow line — the attribution of origin is required.

## 5. Attribution and trademark discipline

- Keep the root `LICENSE` file **unmodified** (stock Apache-2.0). OwnRAG's own
  attribution lives in `NOTICE` and `DERIVED-WORK.md`, not by editing the
  license text.
- Use "RAGFlow" and "InfiniFlow" **only** to describe origin and to preserve
  attribution (Apache-2.0 §6). Never imply that OwnRAG is affiliated with,
  endorsed by, or sponsored by InfiniFlow or the RAGFlow project.
- When the codebase or docs add or move files, update `DERIVED-WORK.md` in the
  same change. It is a factual record and must stay accurate.
- Never present RAGFlow-originated work as OwnRAG-original, and never strip
  upstream copyright notices from files.

## 6. Design-token and naming conventions

- Raw design tokens are prefixed `--or-` (OwnRAG). Components consume **semantic**
  utilities (`bg-surface-1`, `text-ink-2`, `border-line`), never raw `--or-*`
  values directly and never upstream RAGFlow class names.
- The accent is "OwnRAG Signal" (`--or-accent`, teal-green on OKLCH hue `178`).
  Do not swap in the default indigo/violet used by generic AI products.
- Console is dark-first: `.dark` is the default posture; light (`:root`) is the
  alternate. Do not invert this default.
- Machine identifiers (package name, storage keys) use lowercase `ownrag`
  (e.g. package `ownrag-web`, `localStorage` key `ownrag.theme`).

## 7. Documentation

- OwnRAG brand docs live in `docs/` next to the upstream docs:
  `BRANDING-MAP.md` (what maps to what) and `BRAND-RULES.md` (this file).
- Upstream `docs/` and `README*.md` remain RAGFlow-branded unless a dedicated
  rebranding task changes them. Do not do drive-by renames of upstream docs —
  keep brand changes reviewable.

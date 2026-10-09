# BRAND-RULES — OwnRAG contributor rules

Rules for branding and attribution in this fork. They exist to keep the project
legally clean (Apache-2.0) and the product coherent. If a rule and a convenience
conflict, the rule wins.

## 1. The product name

- Product name is **OwnRAG** (one word, capital O, capital RAG). Not "Ownrag",
  not "Own RAG" in running prose, not "ownrag" except where a machine identifier
  requires lowercase.
- Tagline is **"Your data. Your models. Your RAG."** — three sentences, periods,
  no Oxford comma after "models".
- The tagline's promise is literal: OwnRAG is self-hosted and the user owns their
  data and models. Do not write marketing copy that contradicts self-hosting.
- **The upstream project's name does not appear in product-facing text.** The
  console, the home page, the API, error messages and the README never name it.
  Attribution is not marketing: it belongs in the files listed in section 5.

## 2. Do not touch the frozen snapshot — `legacy/`

- `legacy/upstream-web/` is a **frozen snapshot of the upstream console** (1786
  files). Never edit, rename, reformat, or rebrand anything under `legacy/`.
- Its 523 per-file Apache-2.0 headers are **licence obligations** and must be
  preserved exactly. Deleting them is a compliance failure, not a cleanup. This
  is also why the snapshot still carries upstream branding: preserving it is the
  compliant choice, and it is out of the product's surface.
- `legacy/` is reference-only: do not import from it, do not build it, do not
  wire it into the new console. The new console is independent.

## 3. Do not touch the backend

- `internal/`, `cmd/`, `rag/`, `docker/`, `conf/` are out of scope for branding.
  Capability preservation is the point of the fork; backend code, config, CLI
  strings, module path, table names and environment variables stay as upstream.
  The Go module is still named `ragflow`, which is why most remaining
  occurrences of the name live under `internal/` — renaming it is a source
  change to the preserved backend, not a branding task.
- **Never** rename HTTP paths, ports, or payload fields to fit a brand. The
  contract `/api/v1/*` and `/v1/*` (ports 9380 / 9381) is shared with the backend
  and existing clients. Rename the **label**, never the wire name. E.g. the UI
  says "knowledge base" while the API resource stays `datasets`.

## 4. File headers for new OwnRAG source

Every new source file under `web/` (and other OwnRAG-authored code) gets the
derived-work header:

```text
Copyright 2026 OwnRAG contributors
Modified from an upstream Apache-2.0 project; see NOTICE for origin and attribution.
Copyright 2026 The InfiniFlow Authors. Licensed under the Apache License, Version 2.0.
```

Wrapped in the file's comment syntax (`/* ... */` for CSS/TS at the top of the
file). This header satisfies Apache-2.0 §4(b) ("state that You changed the
files") and §4(c) (retain upstream's copyright, attribution and licence
notices). Do not paraphrase it and do not drop the copyright line — retaining it
is required, and it is the only place within a source file where the upstream
holder is named.

## 5. Attribution and trademark discipline

- Keep the root `LICENSE` file **unmodified** (stock Apache-2.0). OwnRAG's own
  attribution lives in `NOTICE` and `DERIVED-WORK.md`, not by editing the
  licence text.
- **The name appears in exactly three places by design:** `NOTICE`,
  `DERIVED-WORK.md`, and the preserved material (`internal/`, `cmd/`,
  `docker/`, `conf/`, `ragflow_deps/`, `legacy/upstream-web/`). Reproducing the
  upstream NOTICE is required by Apache-2.0 §4(d). Anywhere else is a bug —
  `grep -ri ragflow` outside those paths should return nothing.
- Never imply that OwnRAG is affiliated with, endorsed by, or sponsored by the
  upstream project or its company. Non-affiliation is stated in `NOTICE` and
  `DERIVED-WORK.md`.
- When the codebase or docs add or move files, update `DERIVED-WORK.md` in the
  same change. It is a factual record and must stay accurate.
- Never present upstream-originated work as OwnRAG-original, and never strip
  upstream copyright notices from files.

## 6. Design-token and naming conventions

- Raw design tokens are prefixed `--or-` (OwnRAG). Components consume **semantic**
  utilities (`bg-surface-1`, `text-ink-2`, `border-line`), never raw `--or-*`
  values directly and never upstream class names.
- The accent is "OwnRAG Signal" (`--or-accent`, teal-green on OKLCH hue `178`).
  Do not swap in the default indigo/violet used by generic AI products.
- Console is dark-first: `.dark` is the default posture; light (`:root`) is the
  alternate. Do not invert this default.
- Machine identifiers (package name, storage keys) use lowercase `ownrag`
  (e.g. package `ownrag-web`, `localStorage` key `ownrag.theme`).

## 7. Documentation

- Product documentation lives in `docs/`: `GO-LIVE.md`, `SECURITY.md`,
  `DESIGN-SYSTEM.md`, `LIMITATIONS.md`, and this file.
- Upstream documentation is not shipped. If a document only made sense while
  naming upstream internals (an architecture walkthrough of the inherited Go
  services, a rebranding map), it belongs in the local archive, not in the
  repository.
- Keep brand changes reviewable: do not do drive-by renames of files under
  `internal/`, `cmd/`, `docker/` or `conf/`.

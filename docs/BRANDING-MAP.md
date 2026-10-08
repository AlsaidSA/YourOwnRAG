# BRANDING-MAP — RAGFlow → OwnRAG

Where upstream RAGFlow naming lives, what OwnRAG renames, and what must stay
identical. Every path and count here was verified against the working tree.

## 1. Identity

| Concept | Upstream (RAGFlow) | OwnRAG |
| --- | --- | --- |
| Product name | RAGFlow | **OwnRAG** |
| Tagline | — | **Your data. Your models. Your RAG.** |
| Console package name | `legacy/ragflow-web/package.json` → no name field; description `"RAGFlow Web Frontend migrated to Vite"` | `web/package.json` → `"name": "ownrag-web"` |
| Console package author | `"bill"` (legacy) | `"OwnRAG contributors"` |
| Copyright line (new files) | `Copyright 2026 The InfiniFlow Authors. All Rights Reserved.` | `Copyright 2026 OwnRAG contributors` |
| License | Apache-2.0 | Apache-2.0 (unchanged) |
| Accent colour | (RAGFlow palette) | **"OwnRAG Signal"** — a teal-green set on hue channel `178` in OKLCH |

## 2. Where upstream branding still lives (by design)

- **`legacy/ragflow-web/`** — 1786 files, a frozen upstream snapshot. 523 of them
  carry the per-file InfiniFlow Apache-2.0 header; 524 mention `InfiniFlow`; 216
  contain the string `ragflow`. This directory is **not** rebranded. It exists for
  reference and license compliance only.
- **Root `README*.md`** (README.md + 10 translations) — still RAGFlow-branded
  marketing text and badges. These are upstream docs; rebranding them is a
  separate, out-of-scope task.
- **`docs/`** — 145 upstream documentation files (108 `.md`, 9 `.mdx`, 28 `.json`
  category files) still use RAGFlow naming and links. The two OwnRAG brand files
  (`BRANDING-MAP.md`, `BRAND-RULES.md`) are added alongside them.
- **Backend** — Go module path, `conf/`, `docker/` image names, and CLI strings
  carry RAGFlow naming. These are intentionally untouched (capability
  preservation).

## 3. What OwnRAG renames

Only the **new** console and the new brand docs use OwnRAG naming. Concretely:

- `web/` (new console) — package `ownrag-web`, `<title>OwnRAG</title>`,
  meta description "OwnRAG — Your data. Your models. Your RAG. Self-hosted
  retrieval-augmented generation you fully own."
- Design tokens `web/src/styles/tokens.css` — raw custom properties prefixed
  `--or-`; accent token `--or-accent` ("OwnRAG Signal").
- Theme storage key `ownrag.theme` (`web/index.html`).
- `NOTICE` and `DERIVED-WORK.md` at the repository root.

## 4. What must NOT be renamed (contract/back-compat)

These are shared with the preserved backend and with existing clients; renaming
them breaks the fork's core promise (the backend is the point).

| Surface | Value | Source of truth |
| --- | --- | --- |
| REST API prefix | `/api/v1/*` | `web/src/api/endpoints.ts`, `internal/router/*` |
| Web API prefix | `/v1/*` | `web/src/api/endpoints.ts` |
| API server port | `9380` | `conf/service_conf.yaml:5` |
| Admin port | `9381` | `conf/service_conf.yaml:29` |

### Resource-name mapping (UI label ↔ upstream API term)

The console may present friendlier labels, but the wire path keeps the upstream
resource name. The clearest example:

| Console label | Upstream API resource | Endpoint base |
| --- | --- | --- |
| Knowledge base | `datasets` | `/api/v1/datasets` |

Chat, agents, providers/models, connectors, MCP, files, memory, and searches all
keep the upstream API term on the wire (`/api/v1/chats`, `/api/v1/agents`,
`/api/v1/providers`, `/api/v1/connectors`, `/api/v1/mcp/servers`,
`/api/v1/files`, `/api/v1/memories`, `/api/v1/searches`).

## 5. Visual identity quick reference

| Token | Role |
| --- | --- |
| `--or-accent` | "OwnRAG Signal" teal-green accent (not the default indigo/violet) |
| `--or-canvas` / `--or-surface-1..3` | layered near-neutral surfaces, faint cool cast |
| `--or-line` / `--or-line-strong` | hairline structure (depth comes from hairlines, not heavy borders) |
| `--or-ink`, `--or-ink-2`, `--or-ink-3` | text ramp |
| Posture | `:root` = light, `.dark` = console default (dark-first) |

## 6. Package / stack snapshot (new console)

Vite + React 18 + TypeScript + Tailwind CSS v4 + Radix UI primitives
(`@radix-ui/react-*`), `@tanstack/react-query`, `zustand`, `zod`, `axios`,
`react-router`, `lucide-react`. Dev tooling: `@tailwindcss/vite`, `tailwindcss`
v4, `typescript` 5.9, `vite` 7.

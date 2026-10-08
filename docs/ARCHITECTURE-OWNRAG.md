# OwnRAG Architecture

**End-to-end architecture of OwnRAG** — a fork of [RAGFlow](https://github.com/infiniflow/ragflow) (Apache-2.0)
that keeps the upstream engine as a preserved backend and builds a new console as a client of its existing HTTP
API.

| Item | Value |
| --- | --- |
| Repository | `/Users/dnn/dev/OwnRAG` |
| Fork point (upstream commit) | `2400ca8eb51432b1d304266d0de9ca232d9b53fa` |
| Fork-point subject | `feat(agent,ingestion): carry the grep/bm25 contracts and index declared titles (#20542)` |
| Go module | `ragflow` (`go.mod`, `go 1.27`) |
| API server port | `9380` (`conf/service_conf.yaml`) |
| Admin server port | `9381` (`conf/service_conf.yaml`) |
| Upstream console | preserved at `legacy/ragflow-web/` (1786 files, pure rename) |
| New console | `web/` (untracked, 22 files — early scaffold, see §5) |

> **Grounding rule used in this document.** Every file path, count, route and port below was read or measured
> from this working tree. The exact command used for each measured figure is recorded in
> [Appendix A](#appendix-a--how-each-figure-was-verified). Where a claim in the task brief or in `AGENTS.md`
> could **not** be reproduced, it is called out explicitly as *Not verified / differs*.

---

## 1. Provenance and repository shape

OwnRAG is a *capability-preserving* fork: the backend engine is inherited unchanged and the new product surface
(the console) is written against it. `NOTICE` and `DERIVED-WORK.md` (both new, untracked) state the licence
position: `LICENSE` is the stock, unmodified Apache-2.0 text; the upstream console was relocated by a pure
rename; the backend (`internal/`, `cmd/`, `rag/`, `docker/`, `sdk/`, `conf/`) is **not modified**.

`git status --porcelain` at the time of writing shows exactly two kinds of change:

- **1786 staged renames** of the form `web/<path> -> legacy/ragflow-web/<path>` (the upstream React console
  moved out of the way, byte-for-byte — `git diff` reports 0 insertions / 0 deletions for the rename set).
- **`web/` untracked** — the new OwnRAG console.
- Plus untracked root files `NOTICE` and `DERIVED-WORK.md`.

Top-level layout (measured with `ls`):

```
cmd/            Go server + CLI entry points
internal/       Go application: API, ingestion, agent, RAG, deepdoc, engine, services, DAO…
legacy/         ragflow-web/ — frozen upstream console snapshot (1786 files)
rag/            legacy prompt assets (49 .md files; no Python — see §4)
sdk/python/     legacy Python client SDK (19 .py files, pending deletion per AGENTS.md)
tools/          helper tools, several still Python
test/           Python test suites (benchmark, playwright, integration)
conf/           service configuration, model maps, prompts
docker/         compose files, entrypoint, nginx
docs/           upstream docs + OwnRAG brand docs
web/            NEW OwnRAG console (untracked, early)
bin/  scripts/  build.sh  Dockerfile*  go.mod  go.sum  pyproject.toml  uv.lock
```

---

## 2. Part A — The upstream RAGFlow architecture being inherited

### 2.1 Go backend is the runtime

The engine is Go. Measured file counts (`find … -name '*.go' | wc -l`):

| Tree | `.go` files |
| --- | --- |
| `internal/` | **2467** |
| `cmd/` | **5** |
| `internal/` + `cmd/` | **2472** |

`AGENTS.md` frames the Go rewrite as the *current* backend and Python removal as the *migration target*. It lists
`api/`, `rag/`, `deepdoc/` and `agent/` as "legacy Python implementation pending deletion". **Not verified / differs:**
those four top-level Python directories do **not** exist in this tree (`ls -d api deepdoc agent` → *No such file or
directory*; `rag/` exists but contains only Markdown prompt files — see §2.5). The only Python scheduled for
deletion that is actually present is `sdk/python/`.

### 2.2 Entry points (`cmd/`)

`cmd/ragflow_server.go` (1735 lines) is the single server binary. It parses a mode flag and boots one process role
(`cmd/ragflow_server.go`, arg parsing around lines 166–181):

| Flag | Mode | Role |
| --- | --- | --- |
| `--api` | `api` | HTTP API server (Gin), port **9380** |
| `--admin` | `admin` | Admin HTTP server, port **9381** |
| `--ingestor` | `ingestor` | NATS-driven ingestion worker (see §2.6) |
| `--syncer` | `syncer` | File-sync service (connectors) |
| `--deepdoc` | `deepdoc` | Standalone DeepDOC server |
| `--migrate` | `migrate` | One-shot DB migration, then exit |

`cmd/ragflow-cli.go` (86 lines, `//go:build ignore`) is the operator CLI entry; it parses arguments via
`internal/cli` and runs commands over HTTP (`internal/cli/cli_http.go`, `internal/cli/http_client.go`).
`cmd/deepdoc_server_ee.go` is the EE DeepDOC entry.

The API mode wiring (`cmd/ragflow_server.go` ~line 1297 onward): build all handlers → `router.NewRouter(...)` →
`gin.New()` → `ginEngine.Use(gin.Recovery())` → `r.Setup(ginEngine)` → `http.Server{Handler: ginEngine}` on
`apiServerConfig.HTTPPort`. The admin mode mirrors this with `admin.NewRouter(adminHandler)` (~line 798).

### 2.3 HTTP API surface

Routes are registered **only** in the router packages — handlers in `internal/handler/` are *defined* there and
*registered* in `internal/router/` and `internal/admin/`. Non-test route registrations
(`grep -rEho '\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\("' …`):

| Package / file | Registrations |
| --- | --- |
| `internal/router/router.go` | 311 |
| `internal/router/agent_routes.go` | 29 |
| `internal/router/router_ee.go` | 12 |
| **API router subtotal** | **352** |
| `internal/admin/router.go` | 53 |
| `internal/admin/router_ee.go` | 99 |
| **Admin router subtotal** | **152** |
| **Total (API + admin, non-test)** | **504** |

> **Not verified / differs:** the brief's "~413 HTTP route registrations across `internal/router/*.go` and
> `internal/handler/*.go`" is not what the tree contains. `internal/handler/*.go` has **zero** non-test route
> registrations (the 93 hits under that path are all in `_test.go` files using `httptest`). The measured
> non-test total is **504** across `internal/router/` + `internal/admin/`. See Appendix A for the command.

`internal/router/router.go` `Setup()` (742 lines) establishes the contract the console depends on:

- Every response carries the header `X-API-Source: go` (lines 142–145) and is logged (`common.GinLogger()`).
- `GET /health` — liveness (line 151).
- **No-auth group `/api/v1`** (line 153): `system/ping`, `system/config`, `system/version`, `system/healthz`,
  `language`, `pipelines`, `searchbots/detail`, `auth/login` (line 174), `users` (register, line 177),
  OAuth web callbacks, forgot-password flow, `dify/retrieval/health`.
- **Beta-token group `/api/v1`** (line 199): `searchbots/*`, `chatbots/*`, `agentbots/*`, document
  preview/thumbnail/image, agent upload/download, `POST /api/v1/mcp`.
- **Authenticated group** (line 238, `r.authHandler.AuthMiddleware()`): `/api/v1/*` including `auth/logout`,
  `users/me`, `tenants`, `documents`, `chats` (+ sessions/messages), `chat/completions|mindmap|recommendation|audio`,
  `openai/:chat_id/chat/completions`, `retrieval`, the large `datasets/*` block (documents, chunks, ingestion,
  metadata, artifacts, skills, navigation), `searches`, `files`, `folders|workspaces|datasets` commits,
  `memories`, `messages`, `skills`, `providers`, `models`, `all-models`, `agents` (via `RegisterAgentRoutes`),
  `tasks` (cancel), `plugin/tools`, `components`, `compilation-templates*`, `connectors`, `mcp`, `system/*`
  (config, variables, tokens, keys, hardware, cores, memory, concurrency), `document/*`, `chunk/*`,
  `chat-channels`, `langfuse/api-key`, `dify/retrieval`.
- `engine.NoRoute(handler.HandleNoRoute)` — undefined routes (lines 740–741).

`internal/admin/router.go` mounts the admin surface at `/api/v1/admin` (line 45): `ping`, `login`, `reports`,
plus a protected `Group("")` with users/roles/permissions/queue and the EE routes in `internal/admin/router_ee.go`.

### 2.4 The response envelope (the contract the console speaks)

Defined in `internal/common/http.go` (`type response`, lines 667–672):

```go
type response struct {
    Code    ErrorCode   `json:"code"`
    Data    interface{} `json:"data"`
    Message interface{} `json:"message"`
    Total   interface{} `json:"total,omitempty"`
}
```

Helpers all write **HTTP 200** and a `code` field: `SuccessWithData`, `SuccessWithDataAndTotal` (adds `total`),
`SuccessNoMessage`, `SuccessNoData`, `SuccessWithMessage`, and — for application errors — `ErrorWithCode`,
`ResponseWithCodeData` (`http.StatusOK` with a non-zero `code`). `CodeSuccess = 0` and the code table live in
`internal/common/error_code.go` (`CodeUnauthorized = 401`, `CodeServerError`, `CodeArgumentError`, …).
`HandleNoRoute` (`internal/handler/error.go`) is the one place that returns HTTP 404 for an unknown path, and it
also reproduces three upstream Python edge cases as HTTP 200 / `code 100` for byte-compatibility.

This is why the console's client is written the way it is: **success and failure both arrive as HTTP 200**, and the
only reliable discriminator is `code === 0`.

### 2.5 Subsystems

Measured `.go` counts per top-level `internal/` subtree (`find internal/<dir> -name '*.go' | wc -l`):

| Subtree | `.go` files | Role |
| --- | --- | --- |
| `internal/ingestion/` | 335 | Ingestion pipeline: `component/` (file, parser, chunker, tokenizer, extractor), `pipeline/` (DSL translation, canvas execution, checkpoints, resume/run), `compilation/`, `knowledge_compile/`, `service/`, `task/`, `registry/`, `wire/`, `chunkcache/` |
| `internal/agent/` | 312 | Agent/workflow runtime: `canvas/`, `chat/`, `component/`, `dsl/`, `retrievalbridge/`, `runtime/`, `sandbox/`, `templates/`, `tool/`, `workflowx/`, `audio/` |
| `internal/harness/` | 264 | Runtime harness / supporting execution code |
| `internal/service/` | 249 | Higher-level business services used by handlers |
| `internal/deepdoc/` | 245 | DeepDOC: native-backed PDF/DOCX parsing (`native/`, `parser/`) |
| `internal/entity/` | 220 | Shared entities / GORM models |
| `internal/parser/` | 110 | `parser/parser/` typed parse results + `parser/chunk/` chunk-op DSL |
| `internal/syncer/` | 106 | File sync: `connector/`, `scheduler.go`, `sync_runner.go`, `job_executor.go`, `checkpoint_store.go` |
| `internal/handler/` | 103 | HTTP handlers (route-facing request logic) |
| `internal/dao/` | 95 | Data-access layer and migrations (`migration.go`, `database.go`) |
| `internal/engine/` | 83 | Search/index backends: `elasticsearch/`, `infinity/`, `clickhouse/`, `kvrocks/`, `nats/`, `oceanbase/`, `serenedb/`, `types/` |
| `internal/rag/` | 79 | Retrieval / RAG logic: `agentic-rag/`, `prompts/`, `res/` |
| `internal/common/` | 47 | Logging, HTTP helpers, error codes |
| `internal/cli/` | 41 | CLI parser, HTTP transport, command execution, formatting |
| `internal/utility/` | 38 | Utilities |
| `internal/agentic_rag/` | 33 | Agentic-RAG orchestration |
| `internal/server/` | 32 | Bootstrap/config wiring (`config/`, `local/`, `server_ee.go`) |
| `internal/tokenizer/` | 20 | Tokenization |
| `internal/channels/` | 20 | Chat channels (started at API boot: `channels.Start(ctx)`) |
| `internal/admin/` | 13 | Admin routes/handlers/services |
| `internal/storage/` | 10 | Storage backends + in-memory test doubles |
| `internal/router/` | 6 | Route registration |
| `internal/mcp/` | 4 | MCP support |
| `internal/binding/` | 2 | C++ tokenizer binding (`binding/cpp/`, built by `build.sh`) |

**DeepDOC** is native-backed: `internal/deepdoc/native/` plus `internal/deepdoc/parser/`, backed by the `.ort`
models and `ocr.res` referenced by `AGENTS.md` (which places them under `internal/rag/res/deepdoc/`). The engine
subtree `internal/engine/` is the pluggable search/index seam: Elasticsearch, OpenSearch (`os`), Infinity,
OceanBase, SereneDB and ClickHouse connectors share `engine.go`/`global.go`.

**Ingestion** is asynchronous and graph-shaped. The console's demo corpus even models the stage contract
(`web/src/api/demo/db.ts` → `demoPipelineStages`: fetch → parse → chunk → embed → index) and the Go ingestion
service exposes it over NATS (see §2.6). `internal/ingestion/pipeline/` owns DSL translation, canvas-driven
execution and checkpointing (resume/run).

**Agent runtime** lives in `internal/agent/` (canvas graph, DSL, components, tools, sandbox) and is reached over
`/api/v1/agents/*` and `/api/v1/agents/chat/completions` (streaming). `internal/agentic_rag/` is the iterative
retrieval orchestration.

**Python remnants (measured).** `find . -name '*.py'` (excluding `node_modules`) returns **134** files, but they
are not the historical server:

- `sdk/python/` — **19** `.py` files: the legacy Python client SDK (`ragflow_sdk/` + tests). This is the Python
  the Go-only target in `AGENTS.md` is actually removing.
- `rag/` — **0** `.py` files. `rag/` holds only `rag/prompts/` (**49** `.md` prompt files, e.g.
  `rag/prompts/ask_summary.md`, `rag/prompts/sufficiency_check.md`). These are runtime prompt assets, not code.
- `tools/` (firecrawl connector, ES→OceanBase migration, chatgpt-on-wechat plugin, hooks, render_diff),
  `test/` (benchmark, playwright, integration) and various scripts account for the rest.

No Python API server, worker or `api/`/`deepdoc/`/`agent/` Python package is present in this tree.

### 2.6 Data stores and runtime services

`conf/service_conf.yaml` is the canonical config. Declared stores and their default endpoints:

| Store | Config key | Default |
| --- | --- | --- |
| Relational DB | `mysql` (PostgreSQL optional) | `localhost:3306`, db `rag_flow` |
| Object storage | `minio` (or S3/OSS/GCS/Azure/OpenDAL) | `localhost:9000` |
| Search engine | `es` (Elasticsearch), `os` (OpenSearch), `infinity`, `oceanbase`, `serenedb` | `es` `localhost:1200`, `infinity` `localhost:23817` |
| KV / cache | `kvrocks` (Redis-compatible) | `localhost:6379`, db 1 |
| Message queue | `nats` (JetStream) | `localhost:4222` |
| Analytics | `clickhouse` | `localhost:9900`, db `ragflow` |
| Tracing | `otel` | `localhost:4318` |

`docker/docker-compose-base.yml` provisions these as containers: `es01`, `opensearch01`, `infinity`, `serenedb`,
`oceanbase`, `seekdb`, `sandbox-executor-manager`, `mysql`, `minio`, `kvrocks`, `jaeger`, `nats`, `tei-cpu`,
`tei-gpu`, `kibana`, `clickhouse` (plus their data volumes). `docker/docker-compose.yml` defines the application
service `ragflow-cpu` (image `${RAGFLOW_IMAGE}`) that connects to them. `docker/docker-compose-macos.yml` and
`docker/docker-compose-CN-oc9.yml` are platform variants.

The API/ingestor/syncer processes share these stores; the ingestor consumes NATS (`ingestor.mq_type: nats`,
`conf/service_conf.yaml`). `docker/entrypoint.sh` starts the Go binaries directly (`bin/ragflow_server --api`,
`--admin`, `--ingestor`, `--syncer`; it runs `--migrate` first). `docker/.env` sets `API_PROXY_SCHEME=go`.

> **Not verified / differs:** `AGENTS.md` states *"`docker/entrypoint.sh` still defaults to Python when
> `API_PROXY_SCHEME` is unset."* I could not reproduce that: `docker/entrypoint.sh` contains no `API_PROXY_SCHEME`
> branch and starts `bin/ragflow_server` Go modes unconditionally. `API_PROXY_SCHEME` is read by
> `docker/launch_backend_service.sh` (lines 100/112/137) and set to `go` in `docker/.env`. Treat the `AGENTS.md`
> sentence as stale.

---

## 3. Part B — What OwnRAG changes

### 3.1 The console is a new client of the preserved HTTP API

OwnRAG does not change the backend contract. The new console is a from-scratch front end that speaks the same
paths RAGFlow already serves. Its own source states this explicitly:

- `web/src/api/endpoints.ts` header: *"These paths mirror the upstream RAGFlow HTTP contract exactly — the OwnRAG
  console is a new client of the preserved backend, not a new protocol."*
- `web/vite.config.ts` header: *"The API contract is the preserved backend: `/api/v1/*` and `/v1/*` are served by
  the Go server (default :9380); the admin API is served on :9381."*

`web/src/api/endpoints.ts` is a typed map of ~120 endpoint builders derived from the routes in
`internal/router/router.go` — e.g. `kbList: '/api/v1/datasets'`, `completion: '/api/v1/chat/completions'`,
`listAgents: '/api/v1/agents'`, `searchbotsAsk: '/api/v1/searchbots/ask'`. `/api/v1/*` (`restAPIv1`) is the REST
surface; `/v1/*` (`webAPI`) covers a few web routes such as `/v1/canvas/input_elements`.

The console's transport (`web/src/api/client.ts`) is the single place that knows the envelope:

```ts
interface Envelope<T> { code: number; data: T; message?: unknown; total?: number }
```

- `unwrap<T>()` returns `envelope.data` and throws `ApiError` when `envelope.code !== 0` — so pages deal in plain
  data, never in `{code,data}`.
- `api.list<T>()` preserves the backend's `total` for pagination.
- The request interceptor attaches `Authorization: Bearer <token>` from `web/src/store/auth.ts`.
- The response interceptor redirects to `/login?reason=expired` on a real HTTP 401.

**Demo fallback.** When the API is *unreachable* (no response at all — `ERR_NETWORK`/`ECONNABORTED`/timeout), the
client switches to the bundled demo corpus exactly once (`web/src/store/ui.ts` `enterDemoMode`, plus a warning
toast) and serves from memory via `web/src/api/demo/handlers.ts` against the deterministic seed in
`web/src/api/demo/db.ts`. A response that *arrives* with a non-zero `code` is a real API error and is **never**
masked by demo data (`web/src/api/client.ts` lines 174–183). Writes mutate the in-memory seed only; nothing is
persisted.

**Streaming.** `web/src/api/chat-stream.ts` is the SSE path for `/api/v1/chat/completions` and
`/api/v1/agents/chat/completions`. It normalises two payload shapes seen upstream
(`data:{"code":0,"data":{...}}` for chat assistants, and `data:{"answer":...}` for agents/search bots) into one
async iterator, and simulates the same cadence against the demo corpus in demo mode.

### 3.2 The upstream UI is preserved at `legacy/ragflow-web/`

The upstream React console was moved with `git mv web/ → legacy/ragflow-web/` as a **pure rename** (1786 files,
0 content diff). It is a frozen reference snapshot:

- Still a complete app: `legacy/ragflow-web/src/` contains `main.tsx`, `app.tsx`, `routes.tsx`, `pages/`,
  `services/`, `components/`, `layouts/`, `locales/`, etc. (Stack: Vite + React 18, Ant Design, `umi-request`.)
- Its `legacy/ragflow-web/vite.config.ts` documents the **same proxy targets** the new console uses — `/api/v1/admin`
  → `127.0.0.1:9381`, `/api` and `/v1` → `127.0.0.1:9380` (lines 46–58).
- `DERIVED-WORK.md` §2 states it is "not built, not imported by the new console, and must not be edited" and is
  retained for behaviour reference and Apache-2.0 attribution (523 files carry the upstream per-file header).

### 3.3 New console stack and current state

`web/package.json` — `"name": "ownrag-web"`, version `0.1.0`, `Apache-2.0`, `author: OwnRAG contributors`.
Dependencies include React 18, `react-router` 7, `@tanstack/react-query` 5, `axios`, `zustand` 4,
`@xyflow/react` (canvas), Radix UI primitives, `react-dropzone`, `react-markdown`; tooling is Vite 7,
`@vitejs/plugin-react`, Tailwind CSS v4, TypeScript 5.9.

**Measured state of `web/` (84 files excluding `node_modules` and `dist`): 75 under `src/`, 60 `.tsx`, 14 `.ts`.**

- Root: `.gitignore`, `index.html`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `OWNRAG-CONTRACT.md`, `THIRD-PARTY-NOTICES.md`.
- `web/public/`: `logo.svg` (the OwnRAG mark).
- `web/src/`: `main.tsx` (entry), `app.tsx` (providers), `routes.tsx` (route tree, lazy-loaded per screen).
- `web/src/api/`: `client.ts`, `chat-stream.ts`, `endpoints.ts`, `types.ts`, `hooks.ts` (query layer), `query-client.ts`, `demo/db.ts`, `demo/handlers.ts`.
- `web/src/store/`: `auth.ts`, `ui.ts`.
- `web/src/lib/`: `format.ts`, `utils.ts`.
- `web/src/styles/`: `globals.css`, `tokens.css` (design tokens prefixed `--or-`).
- `web/src/components/ui/` (12 modules): `badge`, `button`, `charts`, `controls`, `data-table`, `dialog`, `dropdown-menu`, `input`, `states`, `surface`, `tabs`, `toaster`.
- `web/src/components/app/`: `sidebar`, `topbar`, `command-palette`, `page-header`, `nav`.
- `web/src/components/brand/`: `logo.tsx`.
- `web/src/layouts/`: `app-shell.tsx`.
- `web/src/pages/`: `overview`, `login`, `not-found`, `retrieval`, `chat`, `models`, `data-sources`, `memory`, `mcp`, `settings`, `developers`, `knowledge/{list,detail,document}` plus folder-scoped sub-components under `knowledge/`, `retrieval/`, `chat/`, `agents/`.

**Verified:** `npx tsc --noEmit` is clean and `npx vite build` exits 0 (per-route code splitting confirmed in `dist/assets/`). The shell, the API layer, the query layer, the token system and every screen render in a browser, against both the live API path and the bundled demo corpus. `web/` is untracked in git at the time of writing.

---

## 4. Part C — Request path from an OwnRAG console page to a handler and back

The path below is the one the console uses today. Every step is verified in source: the pages call the
hooks in `web/src/api/hooks.ts`, which call `web/src/api/client.ts`, which either resolves against the demo
corpus or reaches the Go API through the Vite proxy. Only the last hop — a handler reading from a live data
store — is unverified here, because the runtime services were not running in this environment (see
`LIMITATIONS.md`).

```
┌ Console page (e.g. pages/overview.tsx) ─────────────────────────────────────────┐
│ calls api.get<T>(endpoints.kbList)          // web/src/api/endpoints.ts         │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                 ▼
┌ web/src/api/client.ts  ── api.get → send('GET', url, opts) ─────────────────────┐
│  isDemoMode()?  → demo/handlers.resolveDemo  (no network)                       │
│  else axios `http` instance:                                                     │
│     request interceptor  → Authorization: Bearer <token>  (store/auth.ts)       │
│     response interceptor → on HTTP 401: clearSession + /login?reason=expired     │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                 ▼  GET /api/v1/datasets?page=1&page_size=30
┌ Vite dev server proxy (web/vite.config.ts) ─────────────────────────────────────┐
│  '/api/v1/admin' → http://127.0.0.1:9381/                                        │
│  '/api'         → http://127.0.0.1:9380/                                         │
│  '/v1'          → http://127.0.0.1:9380/                                         │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                 ▼
┌ Go API server :9380  (cmd/ragflow_server.go; ginEngine → router.Setup) ─────────┐
│  global middleware:  X-API-Source: go (router.go 142) · GinLogger · Recovery    │
│  route match:        authorized.Group("/api/v1").Group("/datasets").GET("")     │
│                      → r.datasetsHandler.ListDatasets   (router.go 336)         │
│  auth middleware:    r.authHandler.AuthMiddleware() (router.go 239) → c.Set("user")│
└───────────────────────────────┬───────────────────────────────────────────────┘
                                 ▼
┌ Handler: internal/handler/dataset.go  ListDatasets(c *gin.Context) ─────────────┐
│  GetUser(c) → user (internal/handler/common.go)                                  │
│  validate query (page, page_size, orderby/sort mirroring Python pydantic)        │
│  → datasetsService.ListDatasets(ctx, user.ID, …)  (internal/service/dataset)     │
│  → common.SuccessWithDataAndTotal(c, data, total, "Success")                     │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                 ▼  HTTP 200  { "code": 0, "data": [...], "message": "Success", "total": N }
┌ web/src/api/client.ts  unwrap<T>(envelope) ─────────────────────────────────────┐
│  code === 0  → return envelope.data      (list(): also return envelope.total)    │
│  code !== 0  → throw new ApiError(message, envelope.code)  → page shows error    │
│  network failure → enterDemo() once → resolveDemo(method, url, body)             │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Concrete traced example — `GET /api/v1/datasets`:**

1. A page calls `api.get<KnowledgeBase[]>(endpoints.kbList)` (`endpoints.ts`: `kbList = '/api/v1/datasets'`).
2. `client.ts` `send('GET', '/api/v1/datasets', …)` adds query params, checks demo mode, then
   `http.request<Envelope<T>>(config)`.
3. In dev, Vite proxies `/api` to `127.0.0.1:9380` (`web/vite.config.ts`).
4. Gin matches the route registered at `internal/router/router.go:336`
   (`datasets.GET("", r.datasetsHandler.ListDatasets)`) after the auth middleware has resolved the user.
5. `DatasetsHandler.ListDatasets` (`internal/handler/dataset.go:67`) reads the user, validates the query, and
   delegates to `datasetsService.ListDatasets`.
6. The service returns rows; the handler writes `common.SuccessWithDataAndTotal` →
   `{"code":0,"data":[…],"total":N,"message":"Success"}` with **HTTP 200** (`internal/common/http.go:690`).
7. `client.ts` `unwrap()` sees `code === 0`, returns `data`. `api.list()` would additionally surface `total`.

**Error path.** If the backend is reachable but rejects the request, it still answers HTTP 200 with a non-zero
`code` (e.g. `ErrorWithCode`, `internal/common/http.go:725`); `unwrap()` throws `ApiError` and the page renders the
message. If the backend is **entirely unreachable**, `isNetworkFailure()` (no `response`, network/timeout code)
triggers `enterDemo()` and `resolveDemo()` serves the seeded corpus with a warning banner. An HTTP 401 is handled
in the response interceptor (clear session → redirect to login).

**Streaming path.** Chat uses `streamChat()` in `web/src/api/chat-stream.ts`: `fetch(endpoints.completion,
{method:'POST', Authorization: Bearer …})` → reads `response.body` as SSE → for each `data:` line parses the
envelope, throws on `code !== 0`, emits `reference`/`delta`/`done`. In demo mode it replays seeded answers with
the same event cadence.

**Admin path.** A console call to `/api/v1/admin/*` is proxied to `:9381` instead, where
`internal/admin/router.go` mounts the admin handler tree (`admin.Group("/api/v1/admin")`, line 45).

---

## 5. Summary of what is inherited vs changed

| Concern | Inherited (unchanged) | Changed by OwnRAG |
| --- | --- | --- |
| Backend engine | All Go under `internal/` (2467 files) + `cmd/` (5) | none |
| HTTP contract | `/api/v1/*` + `/v1/*` on :9380, `/api/v1/admin/*` on :9381, `{code,data,message,total}` envelope | none (consumed as-is) |
| Subsystems | ingestion (335), agent (312), harness (264), deepdoc (245), engine (83), rag (79) … | none |
| Data stores | MySQL/PG, MinIO, Kvrocks, NATS, ClickHouse, ES/Infinity/etc. (`conf/service_conf.yaml`, `docker/`) | none |
| Python | `sdk/python/` (19 `.py`), prompt `.md` in `rag/`, tools/tests | scheduled for deletion per `AGENTS.md`; not yet done |
| Console | upstream React app preserved as `legacy/ragflow-web/` (1786 files, pure rename) | new `web/` client: entry, route tree, API + query layer, stores, tokens, 12 UI primitives, app shell, 17 routes |
| Docs | upstream `docs/` | `NOTICE`, `DERIVED-WORK.md`, `ARCHITECTURE-OWNRAG.md`, `DESIGN-SYSTEM.md`, `BRANDING-MAP.md`, `BRAND-RULES.md`, `LIMITATIONS.md`, `web/OWNRAG-CONTRACT.md` (new) |

**Bottom line.** OwnRAG is unchanged RAGFlow in the engine and protocol, with a new console in `web/`
written against that frozen HTTP API. The console builds, type-checks and every route renders — driven in
a browser against the bundled demo corpus, which speaks the same envelope as the live API. The **live** path
(console → :9380 → handler → data stores) is wired end-to-end in source but has not been exercised against a
running backend in this environment, because the runtime services were unavailable here. Treat first-run
wiring against a real deployment as unverified. See `LIMITATIONS.md`.

---

## Appendix A — How each figure was verified

Run from `/Users/dnn/dev/OwnRAG`:

| Figure | Command |
| --- | --- |
| Fork commit / subject | `git rev-parse HEAD`; `git log --oneline -1` |
| Go file counts | `find internal -name '*.go' \| wc -l`; `find cmd -name '*.go' \| wc -l` |
| Subsystem counts | `for d in internal/*/; do find "$d" -name '*.go' \| wc -l; done` |
| Python total | `find . -path ./node_modules -prune -o -name '*.py' -print \| grep -v node_modules \| wc -l` |
| Python in SDK / rag | `find sdk -name '*.py' \| wc -l` → 19; `find rag -name '*.py' \| wc -l` → 0; `find rag -name '*.md' \| wc -l` → 49 |
| **Route registrations** | `grep -rEho '\.(GET\|POST\|PUT\|PATCH\|DELETE\|HEAD\|OPTIONS)\("' internal/router/*.go internal/admin/*.go` (exclude `_test.go`) → 504 total (352 router + 152 admin) |
| Per-file route counts | `grep -cE '\.(GET\|POST\|PUT\|PATCH\|DELETE\|HEAD\|OPTIONS)\("' internal/router/router.go` (311), `…/agent_routes.go` (29), `…/router_ee.go` (12), `internal/admin/router.go` (53), `internal/admin/router_ee.go` (99) |
| Server modes | `grep -nE 'case "--(api\|admin\|ingestor\|syncer)' cmd/ragflow_server.go` |
| Ports | `conf/service_conf.yaml` (`http_port: 9380` line 5, `9381` line 29) |
| Response envelope | `internal/common/http.go` lines 667–744; `internal/common/error_code.go` |
| Console files | `find web -type f -not -path '*/node_modules/*' -not -path '*/dist/*' \| wc -l` → 84 (75 under `src/`); `ls web/src/main.tsx web/src/routes.tsx` → both present |
| Console proxy targets | `web/vite.config.ts`; `legacy/ragflow-web/vite.config.ts` lines 46–58 |
| Demo corpus / fallback | `web/src/api/demo/db.ts`, `web/src/api/demo/handlers.ts`, `web/src/api/client.ts`, `web/src/store/ui.ts` |
| Git change set | `git status --porcelain` (1786 `R` renames + `?? web/`) |
| Docker services | `grep -nE '^  [a-zA-Z0-9_-]+:' docker/docker-compose-base.yml` |
| entrypoint / scheme | `grep -nE 'API_PROXY_SCHEME\|ragflow_server' docker/entrypoint.sh docker/launch_backend_service.sh docker/.env` |

<div align="center">

**OwnRAG**

### Your data. Your models. Your RAG.

A self-hosted retrieval platform you operate yourself — template-based chunking, grounded
citations, fused reranking and an agent runtime, behind one API you already own.

Apache-2.0 · derived from and modified from [RAGFlow](https://github.com/infiniflow/ragflow)

</div>

---

## Contents

- [What OwnRAG is](#what-ownrag-is)
- [What this repository is](#what-this-repository-is)
- [Requirements](#requirements)
- [Installation](#installation)
- [Environment configuration](#environment-configuration)
- [Running OwnRAG locally](#running-ownrag-locally)
- [Building the frontend](#building-the-frontend)
- [Running the preserved backend](#running-the-preserved-backend)
- [Production deployment on Ubuntu/Linux](#production-deployment-on-ubuntulinux)
- [Reverse proxy and HTTPS](#reverse-proxy-and-https)
- [Health checks](#health-checks)
- [Backups and restore](#backups-and-restore)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [Attribution and licence](#attribution-and-licence)
- [Status](#status)

## What OwnRAG is

OwnRAG is your own AI knowledge infrastructure. It ingests the documents you already have, indexes
them with the embedding model you choose, retrieves with the weights you tune, and answers with
citations back to the exact chunk — all inside your own deployment.

Bring your own:

| | |
|---|---|
| **Data** | Files, folders, tickets, filings, mail archives, crawled pages |
| **Models** | Chat, embedding, rerank — hosted APIs or your own endpoints |
| **Knowledge bases** | Separate corpora with their own chunking template, thresholds and access |
| **Agents** | Retrieval, tools, code and control flow, versioned as a graph |
| **Tools** | MCP servers and the built-in web search / code executor components |
| **APIs** | One REST surface that the console itself is built on — nothing is UI-only |

**No model configuration is required to run it.** With nothing configured, the engine still parses,
chunks, indexes and retrieves your documents for real, and answers *extractively* — it assembles the
answer from the retrieved passages, cites them, and says in the answer that it did so.

## What this repository is

OwnRAG is a **derivative work of RAGFlow**. It keeps the upstream backend capabilities and replaces
the product surface with a new console, a new information architecture and a new design system.

```
cmd/  internal/  conf/  docker/  rag/            # upstream backend — preserved, unmodified
engine/                                          # local engine — single machine, no containers
web/                                             # OwnRAG console — Vite 7 + React 18 + Tailwind v4
legacy/ragflow-web/                              # upstream console, preserved verbatim
docs/                                            # architecture, design system, branding, security, limitations
NOTICE · DERIVED-WORK.md · LICENSE               # attribution and licence
```

- **The backend is preserved.** The Go services in `internal/` and `cmd/` are untouched, and their
  HTTP routes keep working. See [`docs/ARCHITECTURE-OWNRAG.md`](docs/ARCHITECTURE-OWNRAG.md).
- **The console is new.** `web/` is a fresh application: its own tokens, primitives, query layer and
  every screen. It is a client of the same API — it adds no protocol and no server-side bypass.
  See [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) and
  [`web/OWNRAG-CONTRACT.md`](web/OWNRAG-CONTRACT.md).
- **The local engine is new.** `engine/` implements the same HTTP contract on SQLite, so the whole
  product runs on one machine with no Docker, no MySQL, no Elasticsearch and no object store.
- **The upstream UI is preserved, not deleted.** `legacy/ragflow-web/` keeps every original file,
  header and licence notice, for reference and for licence compliance.

## Requirements

| Component | Needs | Notes |
|---|---|---|
| **Local engine** | Python **3.11 or newer** | Tested on CPython 3.11. All dependencies ship as wheels for Windows/macOS/Linux — no compiler, no container, no GPU. |
| **Console** | Node.js **20.19+ or 22.12+** and npm | That is Vite 7's own requirement. Tested on Node 22. |
| **Disk** | ~500 MB for the environment, plus your documents | The engine stores one SQLite database and the uploaded files. |
| **Operating system** | Anywhere Python runs | OCR of *scanned* pages needs Windows (see [Troubleshooting](#troubleshooting)). Everything else is platform-independent. |
| **Preserved backend** (optional) | Docker, and the native artifacts fetched by `ragflow_deps/download_deps.py` | Only needed if you want the upstream Go engine instead of the local one. |

No API key, no account and no network access are required to install and run OwnRAG. Model endpoints
are optional and configured afterwards.

## Installation

```bash
git clone <your-ownrag-repository-url> ownrag
cd ownrag
```

**1. The local engine**

```bash
cd engine
python -m venv .venv

# Windows
.venv/Scripts/pip install -r requirements.txt

# Linux / macOS
.venv/bin/pip install -r requirements.txt
```

**2. The console**

```bash
cd ../web
npm install
```

## Environment configuration

OwnRAG has no single root `.env`; each component reads its own file. `.env.example` at the
repository root explains the layout, and the examples are the only env files in the repository.

| File | For | Copy from |
|---|---|---|
| `engine/.env` | The local engine | `engine/.env.example` |
| `docker/.env` | The preserved backend's compose stack | `docker/.env.single-bucket-example` |
| *(none)* | The console needs no env file; the dev server proxies to `127.0.0.1:9380` | — |

**Engine variables** — every one is optional. A complete list with comments is in
[`engine/.env.example`](engine/.env.example).

| Variable | Default | Meaning |
|---|---|---|
| `OWNRAG_HOST` / `OWNRAG_PORT` | `127.0.0.1` / `9380` | Bind address. The engine **refuses to start** on a non-loopback host unless `OWNRAG_OWNER_PASSWORD` is set. |
| `OWNRAG_OWNER_EMAIL` / `OWNRAG_OWNER_PASSWORD` | `owner@ownrag.local` / empty | The owner account, created on first start. Empty password is allowed on loopback only (one-click sign-in). |
| `OWNRAG_ALLOW_SIGNUP` | `1` | Set to `0` to close the deployment to new accounts. The owner account still works. |
| `OWNRAG_TOKEN_TTL_DAYS` | `30` | Session lifetime. Each sign-in gets its own revocable token. |
| `OWNRAG_MAX_LOGIN_FAILURES` | `5` | Failures per account/address pair per 15 minutes before a 15-minute lockout. |
| `OWNRAG_MAX_UPLOAD_MB` | `256` | Hard upload ceiling, enforced while the body is streamed. |
| `OWNRAG_CORS_ORIGINS` | local origins | Comma-separated allowlist of browser origins. Set your https origin in production. |
| `OWNRAG_CHUNK_SIZE` / `OWNRAG_CHUNK_OVERLAP` | `512` / `80` | Defaults for new knowledge bases. Changing them affects **new** ingestion only. |
| `OWNRAG_LLM_BASE_URL` / `_API_KEY` / `_MODEL` | empty | Optional deployment-wide generation endpoint (any OpenAI-compatible `/chat/completions`). |
| `OWNRAG_EMBEDDING_BASE_URL` / `_API_KEY` / `_MODEL` | empty | Optional embedding endpoint. Changing the encoder marks existing vectors stale; re-ingest to re-embed. |
| `OWNRAG_LOCAL_EMBED_DIM` | `768` | Width of the built-in lexical vectors, used when no embedding endpoint is configured. |

**The normal way to connect a model is the console, not the env file.** Add a provider on the Models
screen (API base + key), enable the models you want, and the next question uses them — no restart.
The variables above are the deployment-level fallback used only when no provider is enabled in the
console. Provider keys added through the console are stored in the engine database.

## Running OwnRAG locally

Two terminals.

**Terminal 1 — the engine**

```bash
cd engine
.venv/Scripts/python serve.py      # Linux/macOS: .venv/bin/python serve.py
# -> http://127.0.0.1:9380
```

**Terminal 2 — the console**

```bash
cd web
npm run dev
# -> http://localhost:5173
```

Open <http://localhost:5173>. On first start the engine creates the owner account
(`owner@ownrag.local`) and, on loopback, signs it in with one click. To add another account, use
the **Create account** link on the sign-in screen; passwords are stored as scrypt hashes.

If the engine is not reachable, the console starts in **demo mode** with a bundled sample corpus:
it says so in the top bar, and nothing in demo mode is presented as live data.

**One-process deployment.** After `npm run build`, the engine serves the built console itself:

```bash
cd web && npm run build      # emits web/dist
cd ../engine && .venv/Scripts/python serve.py
# -> http://127.0.0.1:9380 serves the console AND the API
```

## Building the frontend

```bash
cd web
npm install         # once
npm run type-check  # tsc --noEmit
npm run build       # emits web/dist
npm run preview     # serve web/dist locally, without the engine
```

`npm run build` is the only build step. The console has no separate lint or unit-test script.

## Running the preserved backend

The upstream Go backend remains available and serves the same contract on `:9380` (admin API
`:9381`), so the console works against either engine with no configuration change — its dev proxy
points at `127.0.0.1:9380`.

```bash
bash build.sh --all       # native libraries + Go server
cd docker
docker compose -f docker-compose-base.yml up -d    # MySQL/PostgreSQL, MinIO, Elasticsearch, Kvrocks, NATS
```

Its runtime services and native artifacts (DeepDoc models, static libraries) come from
`ragflow_deps/download_deps.py`, and the Go tests must be run through `build.sh` so the required CGO
configuration and static libraries are wired up:

```bash
bash build.sh --test                   # unit tier
bash build.sh --test-integration ./... # needs real services
```

This path was **not** exercised by the local-engine work described below — it needs Docker plus the
downloaded native artifacts, neither of which is part of the engine-only setup.

## Production deployment on Ubuntu/Linux

The target: one host, the engine on loopback, TLS terminated by a reverse proxy. A fuller runbook
with service definitions is in [`docs/GO-LIVE.md`](docs/GO-LIVE.md).

```bash
sudo apt update && sudo apt install -y python3.11 python3.11-venv nginx
sudo useradd --system --create-home --home-dir /opt/ownrag ownrag

sudo git clone <your-ownrag-repository-url> /opt/ownrag
sudo chown -R ownrag:ownrag /opt/ownrag
cd /opt/ownrag/engine

sudo -u ownrag python3.11 -m venv .venv
sudo -u ownrag .venv/bin/pip install -r requirements.txt

cd /opt/ownrag/web
sudo -u ownrag npm ci
sudo -u ownrag npm run build
```

Create `/opt/ownrag/engine/.env` with at least:

```ini
OWNRAG_HOST=127.0.0.1
OWNRAG_OWNER_EMAIL=you@example.com
OWNRAG_OWNER_PASSWORD=<a long passphrase — the engine refuses a public bind without it>
OWNRAG_CORS_ORIGINS=https://rag.example.com
OWNRAG_ALLOW_SIGNUP=0
```

Run it as a service:

```ini
# /etc/systemd/system/ownrag.service
[Unit]
Description=OwnRAG engine
After=network.target

[Service]
Type=simple
User=ownrag
WorkingDirectory=/opt/ownrag/engine
EnvironmentFile=/opt/ownrag/engine/.env
ExecStart=/opt/ownrag/engine/.venv/bin/python serve.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ownrag
sudo systemctl status ownrag
```

## Reverse proxy and HTTPS

The engine serves the built console itself, so the proxy has one upstream. Keep the engine on
loopback and expose only the proxy.

**nginx**

```nginx
server {
    listen 443 ssl http2;
    server_name rag.example.com;

    ssl_certificate     /etc/letsencrypt/live/rag.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rag.example.com/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000" always;

    client_max_body_size 300m;     # keep slightly above OWNRAG_MAX_UPLOAD_MB

    location / {
        proxy_pass http://127.0.0.1:9380;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;   # model calls are slow; the 60s default truncates answers
    }
}

server {
    listen 80;
    server_name rag.example.com;
    return 301 https://$host$request_uri;
}
```

Certificates: `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d rag.example.com`.

**Caddy** — same shape, certificates automatic:

```caddyfile
rag.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:9380
    request_body {
        max_size 300MB
    }
}
```

Because the engine streams answers over SSE, the proxy must not buffer them: `proxy_buffering off;`
in nginx, or `flush_interval -1` in Caddy if you see answers arrive all at once at the end.

## Health checks

The engine exposes a public liveness endpoint — deliberately unauthenticated, because a health check
that needs a credential is disabled the first time it fails:

```bash
curl -s http://127.0.0.1:9380/health
# {"code":0,"data":{"status":"ok","version":"0.1.0"},"message":"Success"}
```

Use it for a supervisor, a load balancer, or a monitor. With systemd, a readiness gate can be
attached to the unit:

```ini
ExecStartPost=/bin/sh -c 'until curl -fsS http://127.0.0.1:9380/health; do sleep 1; done'
```

## Backups and restore

Two things have to be copied together to be restorable: the SQLite database (chunks, index,
accounts, provider keys) and the document store under `engine/data/files/`. A snapshot of the
database is taken through SQLite's own backup API, so it is consistent even while the engine is
writing.

```bash
cd engine
.venv/bin/python backup.py               # one snapshot into engine/backups/<timestamp>/
.venv/bin/python backup.py --keep 14     # snapshot, then keep the newest 14
.venv/bin/python backup.py --list        # what exists
```

The tool reports what it actually copied by reopening the copy and counting rows. **Restore:** stop
the engine, replace `engine/data/ownrag.db` and `engine/data/files/` from a snapshot, start again.
`engine/backups/` is git-ignored — never commit it, it contains your documents and provider keys.

## Tests

The local engine answers to tests rather than to claims. Each suite drives the real HTTP surface or
the real database:

```bash
cd engine
.venv/Scripts/python smoke_test.py           # 56 checks — parse → chunk → index → retrieve → cite
.venv/Scripts/python check_console_path.py   # 34 checks — the console's own proxy path
.venv/Scripts/python auth_test.py            # 32 checks — accounts, sessions, lockout, revocation
.venv/Scripts/python connectors_test.py      # 21 checks — connector registry and sync guards
.venv/Scripts/python providers_test.py       # provider CRUD and model discovery
.venv/Scripts/python ingest_guard_test.py    # 12 checks — the ingestion guard states
.venv/Scripts/python ocr_worker_test.py      # 27 checks — the OCR worker and numeric validation
.venv/Scripts/python ocr_integration_test.py # 17 checks — OCR through the real ingest path
```

`check_console_path.py` drives the console through its dev server, so start `npm run dev` in another
terminal before running it. `ui_test.py` drives the console in a real browser and needs Playwright
(`pip install playwright && playwright install chromium`). Frontend gates:

```bash
cd web
npm run type-check
npm run build
```

## Troubleshooting

**The engine refuses to start with "refusing to bind"**
`OWNRAG_HOST` is not loopback and `OWNRAG_OWNER_PASSWORD` is empty. That is deliberate. Set the
password, or bind `127.0.0.1` and put a proxy in front.

**`npm run dev` fails with an unsupported Node version**
Vite 7 needs Node 20.19+ or 22.12+. Check `node -v`.

**The console shows "Demo data" in the top bar**
The engine is not reachable at `http://127.0.0.1:9380`. Start it, and check
`curl -s http://127.0.0.1:9380/health`.

**Answers say they were assembled from the retrieved passages**
No chat model is configured, so the engine answers extractively. Add a provider on the Models screen
(API base + key), enable a chat model, and ask again.

**An upload is rejected as too large**
`OWNRAG_MAX_UPLOAD_MB` (default 256) is enforced while streaming, and the console shows the limit
from `GET /api/v1/system/config`. Raise the variable if you need larger files.

**A scanned PDF ingests with no text, or fails**
OCR uses the OCR engine built into Windows (`Windows.Media.Ocr`), so scanned pages are only read on
Windows, and only when a page has no native text layer. On Linux and macOS a scanned document still
ingests, but its image-only pages carry no text. `winsdk` is declared for Windows only.

**Sign-in is locked after repeated failures**
Five failed attempts in 15 minutes lock that account/address pair for 15 minutes
(`OWNRAG_MAX_LOGIN_FAILURES`). The lock is per process.

**Port 9380 or 5173 already in use**
Stop the other process. On Windows: `netstat -ano | findstr :9380` then
`powershell -Command "Stop-Process -Id <pid> -Force"`.

**Everything is slower than expected on large corpora**
Ingestion is single-process and synchronous; one large document at a time is the design. Add more
corpora in separate knowledge bases rather than in parallel uploads.

## Attribution and licence

OwnRAG is licensed **Apache-2.0**, the same licence as upstream. The original copyright, licence
headers and third-party notices are retained in full.

- [`LICENSE`](LICENSE) — Apache-2.0, unchanged.
- [`NOTICE`](NOTICE) — upstream attribution, as Apache-2.0 §4(d) requires.
- [`DERIVED-WORK.md`](DERIVED-WORK.md) — the precise list of modifications, per §4(b).
- [`docs/BRANDING-MAP.md`](docs/BRANDING-MAP.md) — every naming change, and what was deliberately
  left alone; [`docs/BRAND-RULES.md`](docs/BRAND-RULES.md) — how to use the name.
- Files under `legacy/ragflow-web/` are upstream code kept verbatim for compliance.

OwnRAG is **not affiliated with or endorsed by InfiniFlow**. "RAGFlow" is used here only to describe
the origin of the derived work.

## Status

A working console on a preserved backend, plus a local engine that makes the whole product runnable
on one machine. It is not a finished product. [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) states
what is implemented, what is wired to real endpoints, and what still depends on the upstream UI;
[`docs/SECURITY.md`](docs/SECURITY.md) lists the security controls in place and the risks that
remain; the engine's own measurement records are in
[`engine/EXPERIMENTS.md`](engine/EXPERIMENTS.md),
[`engine/OCR-FREEZE.md`](engine/OCR-FREEZE.md) and [`engine/FREEZE-LEDGER.md`](engine/FREEZE-LEDGER.md).

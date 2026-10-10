<div align="center">

**OwnRAG**

### Your data. Your models. Your RAG.

A self-hosted retrieval platform with configurable chunking, grounded citations,
fused reranking, and agent workflows — behind one API you control.

Apache-2.0 · See NOTICE for attribution

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

OwnRAG is self-hosted AI knowledge infrastructure for ingesting, indexing,
and retrieving documents with grounded answers and citations.

| Component | Description |
|---|---|
| **Data** | Files, folders, tickets, emails, archives, and web pages |
| **Models** | Chat, embedding, and reranking endpoints |
| **Knowledge bases** | Separate corpora with configurable chunking and retrieval |
| **Agents** | Versioned workflows with tools and code execution |
| **Tools** | MCP servers, web search, and code execution |
| **APIs** | One REST API for the console and external clients |

**No model configuration is required.** Without a chat model, OwnRAG still
indexes and retrieves documents and generates extractive answers with citations.

## What this repository is

OwnRAG is a derivative work of an upstream Apache-2.0 RAG platform with a
redesigned console and a local engine.



cmd/ internal/ conf/ docker/ rag/ # Preserved Go backend engine/ # Local Python engine with SQLite web/ # React console legacy/upstream-web/ # Original console, preserved docs/ # Architecture, design, and security NOTICE · DERIVED-WORK.md · LICENSE # Attribution and licence


- **Backend:** Original Go services and HTTP routes are preserved.
- **Console:** `web/` uses the existing API.
- **Local engine:** `engine/` runs on one machine without Docker or external databases.
- **Original UI:** `legacy/upstream-web/` preserves upstream files and licence notices.

See `NOTICE`, `DERIVED-WORK.md`, `docs/DESIGN-SYSTEM.md`, and
`web/OWNRAG-CONTRACT.md`.

## Requirements

| Component | Requirement |
|---|---|
| Local engine | Python 3.11+ |
| Console | Node.js 20.19+ or 22.12+, and npm |
| Disk | Approximately 500 MB, plus document storage |
| Operating system | Windows, Linux, or macOS |
| Preserved backend | Docker and required native dependencies |

No API key, GPU, or external database is required for the local engine.

**Note:** OCR for scanned, image-only PDF pages currently requires Windows.

## Installation

Clone the repository:



git clone <your-ownrag-repository-url> ownrag cd ownrag


### 1. Install the local engine



cd engine python -m venv .venv


Windows:



.venv\Scripts\python -m pip install -r requirements.txt


Linux/macOS:



.venv/bin/python -m pip install -r requirements.txt


### 2. Install the console



cd ../web npm install


## Environment configuration

Each component has its own environment file.

| File | Purpose |
|---|---|
| `engine/.env` | Local engine configuration |
| `docker/.env` | Preserved backend configuration |
| Console | No environment file required for local development |

Copy `engine/.env.example` to `engine/.env` if custom settings are needed.



cp engine/.env.example engine/.env


On Windows, copy the file using PowerShell:



Copy-Item engine/.env.example engine/.env


### Important engine variables

| Variable | Default | Purpose |
|---|---|---|
| `OWNRAG_HOST` | `127.0.0.1` | Bind address |
| `OWNRAG_PORT` | `9380` | Engine port |
| `OWNRAG_OWNER_EMAIL` | `owner@ownrag.local` | Initial owner account |
| `OWNRAG_OWNER_PASSWORD` | Empty | Owner password |
| `OWNRAG_ALLOW_SIGNUP` | `1` | Allow account registration |
| `OWNRAG_MAX_UPLOAD_MB` | `256` | Maximum upload size |
| `OWNRAG_CORS_ORIGINS` | Local origins | Allowed browser origins |
| `OWNRAG_CHUNK_SIZE` | `512` | Default chunk size |
| `OWNRAG_CHUNK_OVERLAP` | `80` | Default chunk overlap |

See [`engine/.env.example`](engine/.env.example) for all available variables.

**Configure models through the console.** Open **Models**, add a provider URL
and API key, then enable the required models. Changes take effect without
restarting the engine.

## Running OwnRAG locally

Use two terminals.

### Terminal 1 — Engine



cd engine


Windows:



.venv\Scripts\python serve.py


Linux/macOS:



.venv/bin/python serve.py


The engine runs at `http://127.0.0.1:9380`.

### Terminal 2 — Console



cd web npm run dev


Open `http://localhost:5173`.

If the engine is unavailable, the console displays clearly labelled demo data.

### Single-process deployment

Build the console, then start the engine:



cd web npm run build

cd ../engine


Windows:



.venv\Scripts\python serve.py


Linux/macOS:



.venv/bin/python serve.py


The engine serves the built console and API at `http://127.0.0.1:9380`.

## Building the frontend



cd web npm install npm run type-check npm run build npm run preview


The production build is generated in `web/dist`.

## Running the preserved backend

The upstream Go backend remains available as an alternative to the local engine.



bash build.sh --all


Start the supporting services:



cd docker docker compose -f docker-compose-base.yml up -d


The backend requires Docker, supporting services, and downloaded native dependencies.

Run tests through the build script from the repository root:



bash build.sh --test bash build.sh --test-integration ./...


## Production deployment on Ubuntu/Linux

Run the engine as a dedicated service behind an HTTPS reverse proxy.

Install dependencies:



sudo apt update sudo apt install -y python3.11 python3.11-venv nginx sudo useradd --system --create-home --home-dir /opt/ownrag ownrag


Clone the repository and set permissions:



sudo git clone <your-ownrag-repository-url> /opt/ownrag sudo chown -R ownrag:ownrag /opt/ownrag


Install engine dependencies:



cd /opt/ownrag/engine

sudo -u ownrag python3.11 -m venv .venv sudo -u ownrag .venv/bin/python -m pip install -r requirements.txt


Build the console:



cd /opt/ownrag/web

sudo -u ownrag npm ci sudo -u ownrag npm run build


Configure `/opt/ownrag/engine/.env`:



OWNRAGHOST=127.0.0.1 OWNRAGOWNEREMAIL=you@example.com OWNRAGOWNERPASSWORD=<strong-passphrase> OWNRAGCORSORIGINS=https://rag.example.com OWNRAGALLOW_SIGNUP=0


Create `/etc/systemd/system/ownrag.service`:



[Unit] Description=OwnRAG engine After=network.target

[Service] Type=simple User=ownrag WorkingDirectory=/opt/ownrag/engine EnvironmentFile=/opt/ownrag/engine/.env ExecStart=/opt/ownrag/engine/.venv/bin/python serve.py Restart=always RestartSec=3

[Install] WantedBy=multi-user.target


Enable the service:



sudo systemctl daemon-reload sudo systemctl enable --now ownrag sudo systemctl status ownrag


See [`docs/GO-LIVE.md`](docs/GO-LIVE.md) for the complete deployment guide.

## Reverse proxy and HTTPS

Keep the engine bound to loopback and expose it through Nginx or Caddy.

### Nginx



server { listen 443 ssl; http2 on; server_name rag.example.com;

sslcertificate /etc/letsencrypt/live/rag.example.com/fullchain.pem; sslcertificate_key /etc/letsencrypt/live/rag.example.com/privkey.pem;

add_header Strict-Transport-Security "max-age=31536000" always;

clientmaxbody_size 300m;

location / { proxypass http://127.0.0.1:9380; proxyhttpversion 1.1; proxysetheader Host $host; proxysetheader X-Real-IP $remoteaddr; proxysetheader X-Forwarded-For $proxyaddxforwardedfor; proxyreadtimeout 300s; proxy_buffering off; } }

server { listen 80; servername rag.example.com; return 301 https://$host$requesturi; }


Obtain certificates:



sudo apt install certbot python3-certbot-nginx sudo certbot --nginx -d rag.example.com


### Caddy



rag.example.com { encode zstd gzip reverseproxy 127.0.0.1:9380 requestbody { max_size 300MB } }


Keep SSE response buffering disabled so streamed answers arrive progressively.

## Health checks

Check engine availability:



curl -fsS http://127.0.0.1:9380/health


A successful response includes `"status":"ok"`.

Use this endpoint for monitoring and service checks.

## Backups and restore

Back up the SQLite database and uploaded files together.



cd engine .venv/bin/python backup.py .venv/bin/python backup.py --keep 14 .venv/bin/python backup.py --list


To restore:

1. Stop the engine.
2. Restore `engine/data/ownrag.db` and `engine/data/files/` from the same backup.
3. Restart the engine.

**Never commit backups to Git.** They may contain documents and provider keys.

## Tests

Run the local engine tests from `engine/`:



cd engine

.venv/bin/python smoketest.py .venv/bin/python checkconsolepath.py .venv/bin/python authtest.py .venv/bin/python connectorstest.py .venv/bin/python providerstest.py .venv/bin/python ingestguardtest.py .venv/bin/python ocrworkertest.py .venv/bin/python ocrintegrationtest.py


`check_console_path.py` requires the frontend development server.

Browser UI tests require Playwright and Chromium:



python -m pip install playwright python -m playwright install chromium


Run frontend checks:



cd web npm run type-check npm run build


## Troubleshooting

| Problem | Solution |
|---|---|
| Engine refuses public binding | Set a strong owner password or bind to loopback. |
| Unsupported Node.js version | Install Node.js 20.19+ or 22.12+. |
| Console shows demo data | Start the engine and check `/health`. |
| Answers are extractive | Configure and enable a chat model. |
| Upload exceeds the limit | Increase `OWNRAG_MAX_UPLOAD_MB`. |
| Scanned PDF has no text | OCR currently requires Windows. |
| Login is temporarily locked | Wait 15 minutes after repeated failed attempts. |
| Port is already in use | Stop the conflicting process or change the port. |
| Ingestion is slow | Large documents are processed synchronously, one at a time. |

## Attribution and licence

OwnRAG is licensed under **Apache-2.0**, the same licence as the upstream project.

- [`LICENSE`](LICENSE) — Apache-2.0 licence.
- [`NOTICE`](NOTICE) — Upstream attribution.
- [`DERIVED-WORK.md`](DERIVED-WORK.md) — Summary of modifications.
- `legacy/upstream-web/` — Preserved upstream code and licence notices.

OwnRAG is not affiliated with or endorsed by the upstream project's maintainers.

## Status

OwnRAG includes a redesigned console, a preserved Go backend, and a local
engine for single-machine deployments.

**It is a working project, not a finished product.**

See [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) for implementation status,
[`docs/SECURITY.md`](docs/SECURITY.md) for security considerations, and
`engine/EXPERIMENTS.md`, `engine/OCR-FREEZE.md`, and
`engine/FREEZE-LEDGER.md` for measurement records.

<div align="center">

**OwnRAG**

### Your data. Your models. Your RAG.

A self-hosted retrieval platform you operate yourself — template-based chunking,
grounded citations, fused reranking, and an agent runtime, behind one API you own.

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

OwnRAG is self-hosted AI knowledge infrastructure for ingesting, indexing, and
retrieving your documents with grounded answers and citations.

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

OwnRAG is a derivative work of an upstream Apache-2.0 RAG platform, with a new
console and a local engine.



cmd/ internal/ conf/ docker/ rag/ # Preserved Go backend engine/ # Local Python engine with SQLite web/ # React console legacy/upstream-web/ # Original console, preserved docs/ # Architecture, design, and security NOTICE · DERIVED-WORK.md · LICENSE # Attribution and licence


- **Backend:** Original Go services and HTTP routes are preserved.
- **Console:** `web/` provides a redesigned interface using the existing API.
- **Local engine:** `engine/` runs on one machine without Docker or external databases.
- **Original UI:** `legacy/upstream-web/` preserves upstream files and licence notices.

See `NOTICE`, `DERIVED-WORK.md`, `docs/DESIGN-SYSTEM.md`, and
`web/OWNRAG-CONTRACT.md`.

## Requirements


Component	Requirement
Local engine	Python 3.11+
Console	Node.js 20.19+ or 22.12+, and npm
Disk	Approximately 500 MB, plus document storage
Operating system	Windows, Linux, or macOS
Preserved backend	Docker and required native dependencies

No API key, GPU, or external database is required for the local engine.

Note: OCR for scanned, image-only PDF pages currently requires Windows.

Installation

Clone the repository:

git clone <your-ownrag-repository-url> ownrag
cd ownrag


1. Install the local engine

cd engine
python -m venv .venv


Windows:

.venv\Scripts\pip install -r requirements.txt


Linux/macOS:

.venv/bin/pip install -r requirements.txt


2. Install the console

cd ../web
npm install

Environment configuration

Each component has its own environment file.

File	Purpose
engine/.env	Local engine configuration
docker/.env	Preserved backend configuration
Console	No environment file required for local development

Copy engine/.env.example to engine/.env when custom settings are needed.

Variable	Default	Purpose
OWNRAG_HOST	127.0.0.1	Bind address
OWNRAG_PORT	9380	Engine port
OWNRAG_OWNER_EMAIL	owner@ownrag.local	Initial owner account
OWNRAG_OWNER_PASSWORD	Empty	Owner password
OWNRAG_ALLOW_SIGNUP	1	Allow registration
OWNRAG_MAX_UPLOAD_MB	256	Maximum upload size
OWNRAG_CORS_ORIGINS	Local origins	Allowed browser origins
OWNRAG_CHUNK_SIZE	512	Default chunk size
OWNRAG_CHUNK_OVERLAP	80	Default chunk overlap

See engine/.env.example for all available variables.

Model configuration: Open Models in the console, add a provider URL and API key, then enable the required models. Changes take effect without restarting the engine.

Running OwnRAG locally

Start the engine in the first terminal:

cd engine
.venv/bin/python serve.py


On Windows, use:

.venv\Scripts\python serve.py


The engine runs at http://127.0.0.1:9380.

Start the console in a second terminal:

cd web
npm run dev


Open http://localhost:5173.

If the engine is unavailable, the console displays clearly labelled demo data.

Single-process deployment: Build the console and run the engine:

cd web && npm run build
cd ../engine && .venv/bin/python serve.py


The engine then serves the console and API at http://127.0.0.1:9380.

Building the frontend
cd web
npm run type-check
npm run build
npm run preview


The production build is generated in web/dist.

Running the preserved backend

The upstream Go backend remains available as an alternative to the local engine.

bash build.sh --all
cd docker
docker compose -f docker-compose-base.yml up -d


The backend requires Docker, supporting services, and downloaded native dependencies.

Run tests through the build script:

bash build.sh --test
bash build.sh --test-integration ./...

Production deployment on Ubuntu/Linux

Run the engine as a dedicated service behind an HTTPS reverse proxy.

Install dependencies:

sudo apt update
sudo apt install -y python3.11 python3.11-venv nginx


Create a service account, clone the repository into /opt/ownrag, install the engine dependencies, and build the frontend.

Configure /opt/ownrag/engine/.env:

OWNRAG_HOST=127.0.0.1
OWNRAG_OWNER_EMAIL=you@example.com
OWNRAG_OWNER_PASSWORD=<strong-passphrase>
OWNRAG_CORS_ORIGINS=https://rag.example.com
OWNRAG_ALLOW_SIGNUP=0


Create /etc/systemd/system/ownrag.service:

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


Enable the service:

sudo systemctl daemon-reload
sudo systemctl enable --now ownrag
sudo systemctl status ownrag


See docs/GO-LIVE.md for the complete deployment guide.

Reverse proxy and HTTPS

Keep the engine bound to loopback and expose it through Nginx or Caddy.

For Nginx, configure HTTPS certificates, request-size limits, and a longer proxy timeout. Disable response buffering to support streamed answers.

location / {
    proxy_pass http://127.0.0.1:9380;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 300s;
    proxy_buffering off;
}


Obtain certificates with Certbot:

sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d rag.example.com


Caddy can also provide automatic HTTPS. See docs/GO-LIVE.md for full proxy configuration.

Health checks

Check engine availability:

curl -s http://127.0.0.1:9380/health


A successful response includes "status":"ok". Use this endpoint for monitoring and service health checks.

Backups and restore

Back up the SQLite database and uploaded files together.

cd engine
.venv/bin/python backup.py
.venv/bin/python backup.py --keep 14
.venv/bin/python backup.py --list


To restore, stop the engine and replace engine/data/ownrag.db and engine/data/files/ with the corresponding backup contents.

Never commit backups to Git. They may contain documents and provider keys.

Tests

Run the engine tests from engine/:

.venv/bin/python smoke_test.py
.venv/bin/python check_console_path.py
.venv/bin/python auth_test.py
.venv/bin/python connectors_test.py
.venv/bin/python providers_test.py
.venv/bin/python ingest_guard_test.py
.venv/bin/python ocr_worker_test.py
.venv/bin/python ocr_integration_test.py


These cover ingestion, retrieval, citations, authentication, connectors, providers, and OCR.

check_console_path.py requires the frontend development server. Browser UI tests require Playwright and Chromium.

Run frontend checks from web/:

npm run type-check
npm run build

Troubleshooting
Problem	Solution
Engine refuses public binding	Set a strong owner password or bind to loopback.
Unsupported Node.js version	Install Node.js 20.19+ or 22.12+.
Console shows demo data	Start the engine and check /health.
Answers are extractive	Configure and enable a chat model.
Upload exceeds the limit	Increase OWNRAG_MAX_UPLOAD_MB.
Scanned PDF has no text	OCR currently requires Windows.
Login is temporarily locked	Wait 15 minutes after repeated failed attempts.
Port is already in use	Stop the conflicting process or change the port.
Ingestion is slow	Large documents are processed synchronously, one at a time.
Attribution and licence

OwnRAG is licensed under Apache-2.0, the same licence as the upstream project.

LICENSE — Apache-2.0 licence.
NOTICE — Upstream attribution.
DERIVED-WORK.md — Summary of modifications.
legacy/upstream-web/ — Preserved upstream code and licence notices.

OwnRAG is not affiliated with or endorsed by the upstream project's maintainers.

Status

OwnRAG includes a redesigned console, a preserved Go backend, and a local engine for single-machine deployments.

It is a working project, not a finished product.

See docs/LIMITATIONS.md for implementation status, docs/SECURITY.md for security considerations, and engine/EXPERIMENTS.md, engine/OCR-FREEZE.md, and engine/FREEZE-LEDGER.md for measurement records.

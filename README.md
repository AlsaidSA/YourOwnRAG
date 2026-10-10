OwnRAG

<div align="center">

Your data. Your models. Your RAG.

A self-hosted RAG platform with configurable chunking, grounded citations, fused reranking, and agent workflows — all behind one API you control.

Apache-2.0 · See NOTICE for attribution

</div>

Contents
Overview
Architecture
Requirements
Installation and configuration
Running locally
Production deployment
Health checks and backups
Tests
Troubleshooting
License and status
1. Overview

OwnRAG is self-hosted AI knowledge infrastructure for ingesting, indexing, and retrieving your documents with cited answers.

Data: Files, emails, tickets, archives, and web pages.
Models: Chat, embedding, and reranking endpoints.
Knowledge bases: Independent corpora with configurable retrieval settings.
Agents: Versioned workflows with tools and code execution.
Integrations: MCP servers, web search, and a unified REST API.

No model is required to get started. Without a chat model, OwnRAG still indexes and retrieves documents and generates extractive answers with citations.

2. Architecture
Directory	Purpose
engine/	Local Python engine backed by SQLite.
web/	New React console using Vite 7 and Tailwind CSS 4.
cmd/, internal/, conf/, rag/, docker/	Preserved upstream Go backend.
legacy/upstream-web/	Original upstream console, retained for compliance.
docs/	Architecture, security, design, and limitations.

The local engine runs on one machine without Docker or external databases. The preserved Go backend remains available as an alternative.

See DERIVED-WORK.md and web/OWNRAG-CONTRACT.md for details.

3. Requirements
Python 3.11+
Node.js 20.19+ or 22.12+, with npm
Approximately 500 MB of disk space, plus documents
Windows, Linux, or macOS

No API key, GPU, or external database is required for the local engine.

Limitation: OCR for scanned, image-only PDF pages currently requires Windows.

4. Installation

Clone the repository:

git clone <your-ownrag-repository-url> ownrag
cd ownrag


Install the engine:

cd engine
python -m venv .venv


Windows:

.venv\Scripts\pip install -r requirements.txt


Linux/macOS:

.venv/bin/pip install -r requirements.txt


Install the console:

cd ../web
npm install

5. Configuration

Copy engine/.env.example to engine/.env if you need custom settings.

Variable	Default	Purpose
OWNRAG_HOST	127.0.0.1	Bind address
OWNRAG_PORT	9380	API port
OWNRAG_OWNER_EMAIL	owner@ownrag.local	Initial owner account
OWNRAG_OWNER_PASSWORD	Empty	Owner password
OWNRAG_ALLOW_SIGNUP	1	Allow registration
OWNRAG_MAX_UPLOAD_MB	256	Upload size limit
OWNRAG_CORS_ORIGINS	Local origins	Allowed browser origins
OWNRAG_CHUNK_SIZE	512	Default chunk size
OWNRAG_CHUNK_OVERLAP	80	Default chunk overlap

All variables are optional. See engine/.env.example for the complete list.

Connect models

Open Models in the console, add a provider URL and API key, and enable the models you need. Changes take effect without restarting the engine.

6. Running Locally

Start the engine:

cd engine


Windows:

.venv\Scripts\python serve.py


Linux/macOS:

.venv/bin/python serve.py


In a second terminal, start the console:

cd web
npm run dev


Open http://localhost:5173.

The engine API is available at http://127.0.0.1:9380. If the engine is unavailable, the console displays demo data clearly.

Build and serve everything together
cd web
npm run build
cd ../engine
.venv/bin/python serve.py


Open http://127.0.0.1:9380.

7. Frontend Build
cd web
npm run type-check
npm run build
npm run preview


The production build is generated in web/dist.

8. Preserved Go Backend

The upstream backend requires Docker and additional native dependencies.

bash build.sh --all
cd docker
docker compose -f docker-compose-base.yml up -d


Run its tests through the build script:

bash build.sh --test
bash build.sh --test-integration ./...


See the upstream build instructions for native dependency setup.

9. Production Deployment

For Ubuntu/Linux, run the engine as a dedicated systemd service behind an HTTPS reverse proxy.

Install dependencies:

sudo apt update
sudo apt install -y python3.11 python3.11-venv nginx


Create a dedicated service account, clone the repository into /opt/ownrag, install the engine dependencies, and build the frontend.

Configure /opt/ownrag/engine/.env:

OWNRAG_HOST=127.0.0.1
OWNRAG_OWNER_EMAIL=you@example.com
OWNRAG_OWNER_PASSWORD=<strong-passphrase>
OWNRAG_CORS_ORIGINS=https://rag.example.com
OWNRAG_ALLOW_SIGNUP=0


Run the engine through systemd and configure Nginx or Caddy to proxy HTTPS traffic to 127.0.0.1:9380.

Production essentials:

Keep the engine bound to loopback.
Use a strong owner password and HTTPS.
Set the correct CORS origins.
Disable SSE response buffering.
Allow sufficient upload size and proxy timeout.

See docs/GO-LIVE.md for the complete deployment guide.

10. Health Checks
curl -s http://127.0.0.1:9380/health


A healthy response includes "status":"ok".

Use this endpoint for monitoring and service checks.

11. Backups and Restore

Back up both the SQLite database and uploaded files.

cd engine
.venv/bin/python backup.py
.venv/bin/python backup.py --keep 14
.venv/bin/python backup.py --list


To restore, stop the engine and replace engine/data/ownrag.db and engine/data/files/ with the corresponding backup contents.

Never commit backups to Git. They may contain documents and provider keys.

12. Tests

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

Run frontend checks from web/:

npm run type-check
npm run build


check_console_path.py requires the development server. Browser UI tests require Playwright and Chromium.

13. Troubleshooting
Problem	Solution
Engine refuses public binding	Set OWNRAG_OWNER_PASSWORD or bind to loopback.
Unsupported Node version	Install a supported Node.js version.
Console shows demo data	Start the engine and check /health.
Answers are extractive	Configure and enable a chat model.
Upload too large	Increase OWNRAG_MAX_UPLOAD_MB.
Scanned PDF has no text	OCR currently requires Windows.
Login temporarily locked	Wait 15 minutes after repeated failed attempts.
Port already in use	Stop the conflicting process or change the port.
Large ingestion jobs are slow	Ingestion is synchronous and processes one large document at a time.
14. License and Attribution

OwnRAG is licensed under Apache-2.0.

LICENSE — License terms.
NOTICE — Upstream attribution.
DERIVED-WORK.md — Summary of modifications.
legacy/upstream-web/ — Preserved upstream code and notices.

OwnRAG is not affiliated with or endorsed by the upstream project's maintainers.

15. Status

OwnRAG provides a redesigned console, a preserved Go backend, and a local engine for single-machine deployments.

It is a working project, not a finished product.

For implementation details, security considerations, and known limitations, see:

docs/LIMITATIONS.md
docs/SECURITY.md
engine/EXPERIMENTS.md
engine/OCR-FREEZE.md
engine/FREEZE-LEDGER.md

# Going live — OwnRAG

The engine and the console run on your own host. This is the shortest path from a working local
install to something reachable, with the security controls from `docs/SECURITY.md` in place.

---

## 0. What goes live

| Piece | What it is | Where it runs |
|---|---|---|
| Engine | `engine/serve.py` — FastAPI on the preserved `/api/v1` contract | one process, loopback or behind a proxy |
| Console | `web/` — Vite + React, built to `web/dist` | served by the engine, or by the proxy |
| Data | SQLite (`engine/data/ownrag.db`) + uploaded files (`engine/data/files/`) | local disk, back it up |

There is no orchestration and no queue to operate: one process, one database, one file tree.

---

## 1. Configure, then start

```bash
cd engine
cp .env.example .env        # if present; otherwise create it
```

| Variable | Default | Why it matters |
|---|---|---|
| `OWNRAG_OWNER_PASSWORD` | *(empty)* | **Required off loopback.** The engine refuses to bind a non-loopback address without it, and it is the administrator credential. |
| `OWNRAG_ALLOW_SIGNUP` | `1` | `0` closes the deployment to new accounts while keeping existing ones. |
| `OWNRAG_TOKEN_TTL_DAYS` | `30` | Session lifetime. `0` disables expiry (single-operator local use only). |
| `OWNRAG_MAX_LOGIN_FAILURES` | `5` | Failures per 15 minutes before an account/address pair locks for 15 minutes. |
| `OWNRAG_MAX_UPLOAD_MB` | `256` | Hard upload ceiling, enforced while streaming. |
| `OWNRAG_CORS_ORIGINS` | local origins | Comma-separated origin allowlist. Set the https origin when the console is served from a domain. |
| `OWNRAG_CHUNK_SIZE` / `OWNRAG_CHUNK_OVERLAP` | `512` / `80` | Changing either needs a **full re-ingest**; treat it as an experiment, not a setting. |

Build the console once so the engine can serve it:

```bash
cd web && npm ci && npm run build      # -> web/dist
cd ../engine && ./.venv/Scripts/python.exe serve.py
```

Start the engine with the owner password set, on loopback, and let the proxy be the only public
surface:

```bash
OWNRAG_OWNER_PASSWORD='<a long passphrase>' ./.venv/Scripts/python.exe serve.py
```

The engine serves `web/dist` itself when it exists, so `http://127.0.0.1:9380/` is the product. API
paths are still guarded; an unmatched `/api/*` path answers 404 rather than a page of HTML.

---

## 2. TLS at the proxy (required before any non-loopback exposure)

**Caddy** — two lines, automatic certificates:

```caddyfile
rag.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:9380
    request_body {
        max_size 300MB        # slightly above OWNRAG_MAX_UPLOAD_MB, which the engine enforces itself
    }
    rate_limit {
        zone auth { match path /api/v1/auth/login /api/v1/users ; key {remote_host} ; events 20 ; window 1m }
    }
}
```

**nginx** — the same shape:

```nginx
server {
    listen 443 ssl http2;
    server_name rag.example.com;
    ssl_certificate     /etc/letsencrypt/live/rag.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rag.example.com/privkey.pem;

    client_max_body_size 300m;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'" always;

    location / {
        proxy_pass http://127.0.0.1:9380;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;        # model calls are slow; the default 60s truncates answers
    }

    limit_req_zone $binary_remote_addr zone=auth:10m rate=20r/m;
    location = /api/v1/auth/login { limit_req zone=auth burst=5 nodelay; proxy_pass http://127.0.0.1:9380; }
}
```

Both configs keep the engine on loopback, where it needs no TLS of its own. **Never** expose 9380
directly to the internet: without a proxy there is no TLS, no request-body limit, and no rate limit.

---

## 3. Supervision

**systemd** (Linux):

```ini
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
# the health endpoint doubles as the liveness probe
ExecStartPost=/bin/sh -c 'until curl -fsS http://127.0.0.1:9380/health; do sleep 1; done'

[Install]
WantedBy=multi-user.target
```

**Windows** (Task Scheduler, or NSSM as a service):

```powershell
# runs at boot, restarts on failure, logs where you can find them
schtasks /create /tn "OwnRAG engine" /sc onstart /ru SYSTEM /rl HIGHEST ^
  /tr "C:\ownrag\engine\.venv\Scripts\python.exe C:\ownrag\engine\serve.py"
```

Whichever you use, probe `GET /health` — it is public precisely so a monitor can reach it. A
long-running engine should also have log rotation; on Windows, `Start-Process` redirection (as in
`docs/` examples) grows the file without bound.

---

## 4. Backups

```bash
cd engine && ./.venv/Scripts/python.exe backup.py            # -> engine/backups/<timestamp>/
cd engine && ./.venv/Scripts/python.exe backup.py --keep 14  # prune to the last 14 snapshots
```

`backup.py` copies the database through SQLite's own backup API (consistent even while the engine is
writing) and archives the document store beside it. Schedule it; a retrieval system whose index and
files are not backed up together cannot be restored to a consistent state.

Restore = stop the engine, replace `engine/data/ownrag.db` and `engine/data/files/`, start again.

---

## 5. Go-live checklist

- [ ] `OWNRAG_OWNER_PASSWORD` set to a long passphrase (the engine refuses a public bind without it).
- [ ] Console built (`web/dist` exists) and served — by the engine or the proxy.
- [ ] TLS terminating at the proxy, engine on loopback only.
- [ ] `OWNRAG_CORS_ORIGINS` set to the real https origin.
- [ ] `GET /health` monitored, with a restart policy.
- [ ] `backup.py` scheduled, and one restore rehearsed.
- [ ] `auth_test.py` green against the live deployment (`32 passed, 0 failed`).
- [ ] Sign-up policy decided: leave `OWNRAG_ALLOW_SIGNUP=1`, or close it to new accounts.
- [ ] `engine/data/ownrag.db` permissions restricted — provider keys are stored in it in plain text.
- [ ] One account created per human; none shared, because the audit trail attributes actions to a
      session, and a shared login makes that trail worthless.

# Security review — OwnRAG

Scope: the OwnRAG engine (`engine/ownrag_engine/`) and console (`web/`), reviewed as a system that
accepts accounts from the internet. Dates: 2026-10-08. Status is what was **verified**, not what was
intended; anything unverified is marked as such.

The preserved upstream Go backend (`internal/`, `cmd/`, `rag/`, `docker/`, `sdk/`) is out of scope
here: it is unmodified, was not started during this review, and the console does not depend on it.

---

## 1. Fixed in this pass, with evidence

### Critical — credentials were stored and compared in plaintext

`user.password` held the literal password, `login` compared it with `==`, and
`init_db` synced the owner's password from `.env` into the row as text. A single database file — or
its backup, or a stray copy — disclosed every credential, and `==` comparison leaks length and
prefix through timing. Registration was also **inverted**: `POST /api/v1/users` required the *owner's*
password to be repeated, so accounts could only be created on an engine with no password configured,
and then with any password value at all.

Now: `engine/ownrag_engine/auth.py` hashes with **scrypt** (`hashlib.scrypt`, n=2^14, r=8, p=1,
per-password salt) into a self-describing `scrypt$n$r$p$salt$hash` value, verifies with
`hmac.compare_digest`, and upgrades a legacy plaintext row on the next successful sign-in. Sign-up
validates the email shape and the password policy, hashes before insert, and returns a session.

```
password column holds a scrypt hash          PASS
the plaintext password is nowhere in the row PASS
```

### Critical — an unowned session was an administrator

`GET /api/v1/users/me` ignored the token and always returned the **owner** row, and the token table
had no owner column, so any token — including the 255 sessions minted before accounts existed — read
back as the owner with `is_admin: true`.

Now: `api_token.user_id` and `api_token.expires_at` exist via the standard `MIGRATIONS` list, tokens
are minted against their user, startup **backfills legacy tokens to the owner**, and `users/me`
resolves strictly from the token — an ownerless token is refused rather than promoted.

```
the token row records its user                PASS
no token is stored against no user            PASS
users/me returns the signed-up account        PASS
users/me does not report the owner            PASS
```

### High — no throttling, no lockout, no expiry

Authentication could be brute-forced at line rate, and no session ever ended.

Now: five failures inside fifteen minutes lock an account/address pair for fifteen minutes; failures
are recorded per email **and** per client address; a successful sign-in clears them; sessions carry a
TTL (default 30 days, `OWNRAG_TOKEN_TTL_DAYS`) and expired rows are deleted on use and pruned at
startup; `POST /auth/logout` revokes exactly the presented token.

```
wrong password refused (x5)                   PASS
the account is locked after repeated failures PASS
the lock also blocks the correct password     PASS
the token row has an expiry in the future     PASS
the revoked token stops working               PASS
```

### High — the failure signal distinguished registered from unregistered addresses

"No account with that email on this engine" versus "Incorrect password" told an attacker which
addresses are real. Both paths now answer `Incorrect email or password`, and an unknown address still
does an equivalent amount of work.

```
unknown email and wrong password share one message PASS
```

### High — uploads streamed to disk without a limit

`/system/config` advertised `maxFileSize: 256 MB` and nothing enforced it: the handler copied blocks
to disk until the client stopped. A single request could fill the volume.

Now: the streaming loop counts bytes, and on exceeding the cap it closes, **unlinks the partial
file**, and answers 400. `maxFileSize` reports the real value (`OWNRAG_MAX_UPLOAD_MB`, default 256).

```
upload cap (1 MB ceiling, 3 MB file) -> 400 "larger than the 1 MB limit"
files left in the KB folder: 0        PASS - a rejected upload leaves nothing
```

### Medium — no audit trail

Nothing recorded who signed in, or that anyone tried. `audit_log` (id, at, event, email, ip, detail)
now receives `signup`, `login_ok`, `login_failed`, `login_locked`, `login_unknown_email`.

```
audited: signup / login_ok / login_failed / login_locked / login_unknown_email   PASS
```

### Medium — no health endpoint, no security headers

A supervisor had nothing to probe, and responses carried no baseline headers.
`GET /health` is public by design (a health check that needs a credential is disabled the first time
it fails); every response now sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`.

```
health (public, no token)       200
security headers                all four present
```

### Already sound before this pass, re-verified

- `/api/*`, `/v1/*`, `/openapi.json` and `/redoc` require a token; `/system/version` no longer
  publishes the owner email, the storage path, or `password_required: false`.
- CORS is an origin allowlist with `allow_credentials=False`.
- A non-loopback bind **refuses to start** without `OWNRAG_OWNER_PASSWORD`
  (`assert_public_bind_is_secured`, `core.py:346`); loopback keeps one-click local sign-in.
- Provider API keys are never returned by the API (only `has_api_key`), `.gitignore` covers `.env`,
  the database and logs, no secret appears in a log, and every outbound call carries a timeout.

---

## 2. Open risks, stated plainly

| Risk | Why it is open | Mitigation available today |
|---|---|---|
| **No TLS** | Terminated by a reverse proxy, not the app. | Put Caddy/nginx in front; `docs/GO-LIVE.md` has a working config. Until then, do not bind off loopback. |
| **Provider keys are plaintext in SQLite** | Encrypting at rest needs a key-management decision (KMS, OS keyring, passphrase) that changes how the engine starts. | Restrict file permissions on `engine/data/ownrag.db`; treat the file as a secret. |
| **Lockout and rate limits are per-process** | In-memory state; two workers would each allow five attempts. | Run one worker (the engine is a single-process design anyway), or move the counter to the database before scaling out. |
| **No global request rate limit** | Only the auth path is throttled. | Reverse-proxy rate limiting. |
| **Single worker, synchronous SQLite, blocking model calls in async handlers** | One slow model turn stalls other requests. | One worker by design; scale with processes only after moving the counters to shared state. |
| **No backup or restore routine** | Needs an operational decision about destination and retention. | `engine/backup.py` takes a consistent copy of the database plus the document store. |
| **No supervision or log rotation** | Depends on the host's init system. | `docs/GO-LIVE.md` documents the service definition. |
| **No per-user authorization on knowledge bases** | Every account currently sees the same corpus; the preserved contract has no scoping for this. | Run one tenant per deployment until scoping exists. |
| **`/health` reveals the engine version** | Minor: helpful for a defender, also helpful for an attacker matching a known bug. | Strip it at the proxy if that trade is not wanted. |

---

## 3. How to re-run the verification

```bash
cd engine && ./.venv/Scripts/python.exe serve.py          # engine
PYTHONUTF8=1 ./.venv/Scripts/python.exe auth_test.py     # 32 checks, accounts + sessions
cd ../web && npm run type-check && npm run build          # console gates
```

The auth suite drives the real HTTP surface, so it exercises the wiring rather than the helpers. It
never registers a real vendor provider and creates throwaway `@example.test` accounts only.

# Security review — OwnRAG

Scope: the OwnRAG engine (`engine/ownrag_engine/`) and console (`web/`), reviewed as a system that
accepts accounts from the internet. Dates: 2026-10-08. Status is what was **verified**, not what was
intended; anything unverified is marked as such.

The preserved upstream Go backend (`internal/`, `cmd/`, `rag/`, `docker/`, `sdk/`) is out of scope
here: it is unmodified, was not started during this review, and the console does not depend on it.

---

## 1. Fixed in this pass, with evidence

### Workspace invitations hold no reusable secret

An invitation is the only credential someone can hold *before* they have an account, so it is treated
like one. The token is 32 bytes of `secrets.token_urlsafe` stored **only as a SHA-256 hash** — a
stolen database yields no usable link. It is shown to the inviter exactly once, expires after
`OWNRAG_INVITE_TTL_DAYS` (default 7), and can be revoked or rotated by resending, which invalidates
the previous link. Accepting it creates an account with the role the invitation carried; only the
workspace owner may issue an `admin` invitation, so one admin cannot escalate sideways. The invitee
chooses their own password, checked against the same policy as sign-up and stored as an scrypt hash.

Removing a member deletes their sessions in the same step as the membership, so removal takes effect
immediately instead of when their token happens to expire. The engine — not the console — enforces
every one of these rules; the console only hides controls that would fail.

### Critical — one account could read another account's workspace

Reported by the owner: signing in with a new account showed the owner's data sources and knowledge
bases. Measured on a brand-new signup: all 20 knowledge bases, all 49 documents, 30 assistants, the
owner's provider configuration (including a keyed instance) and the API-key list, and retrieval
happily searched the owner's knowledge base. The engine had no visibility filter at all: every
`dataset.created_by` read `owner@ownrag.local` and nothing ever consulted it.

`engine/ownrag_engine/access.py` now holds the rule and `api.py` enforces it before any handler runs:

- the owner and admins see the whole workspace; **a member sees what they created**, plus anything
  marked `permission = 'team'`;
- a resource id is recognisable by its prefix, so the guard sits at the path and covers every route
  under `/api/v1/datasets/kb_*` and `/api/v1/chats/chat_*` — another account's knowledge base is out
  of reach by guessing its id, not only by reading a listing;
- the routes that name their assistant or their knowledge bases in the **body** — `/chat/completions`,
  `/agents/chat/completions`, `/searchbots/ask`, `/searchbots/retrieval_test` — are checked where they
  resolve them, because a path guard cannot see a body. A member naming the owner's assistant used to
  receive HTTP 200 and an answer stream whose citations carried the owner's document text;
- `/providers*`, `/memories*` and `/system/tokens` are manager-only (a member could read provider
  configuration and revoke API keys);
- the listings (`/datasets`, `/documents`, `/chats`, tag aggregation), retrieval and ingest filter by
  the same rule, and creating a knowledge base attributes it to its creator rather than the owner;
- an **API key** has no user by design and acts for the workspace, so keys keep working under the
  scoping; an ownerless *session* is deliberately not treated that way and is still claimed for the
  owner at startup.

A blank `created_by` belongs to nobody, so only managers see it — which is why the 1,157 assistants
that predate the column needed no data backfill.

```
a new account sees none of the owner's knowledge bases, documents or assistants   PASS
every direct call at the owner's knowledge base by id is refused (403)             PASS
deleting it as a member leaves it intact                                           PASS
naming the owner's knowledge base in retrieval returns nothing                     PASS
provider configuration, the API-key list and memories are refused to a member      PASS
a member's own knowledge base is created, attributed to them and readable          PASS
the owner's listings and search still work (control)                               PASS
the owner's assistant answers, and refuses a member with no content (control)      PASS
the agent route does not answer a member from the owner's corpus                   PASS
the API key still reaches the workspace (control)                                  PASS
```

Suite: `engine/isolation_test.py`. The console itself was not changed: it renders whatever the engine
returns, and the pages a member is not entitled to (`Models`, `API`) now answer 403, so they show an
error state instead of data. That last part is inferred from the API behaviour, not driven in a
browser during this pass.

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

### High — a locked write took the engine down until it was restarted

Found while testing the isolation suite, which held a second connection open against the database. The
engine's login handler died on its own write:

```
api.py:427  x("UPDATE user SET last_login = ? WHERE id = ?", ...)
core.py:517 conn.execute(sql, args)
sqlite3.OperationalError: database is locked
```

That 500 was the smaller half of it. The shared connection was left in a broken transaction, so **every
later request, sign-in included, answered 500** until the process was restarted — eleven of them were
logged. A transient collision with any other writer was therefore an outage, not a retry.

Now `core.connect` sets a busy timeout (`BUSY_TIMEOUT_SECONDS`, 15 s) so a lock held for a moment is
waited for rather than treated as fatal, and `core._write` rolls back a failed write so the connection
is left clean. Reproduced deliberately, with the write lock held by a separate process:

```
a lock held 5s:  the sign-in waits 4.6s and succeeds              PASS
a lock held 20s: one sign-in fails after 16.5s                    PASS (the timeout is honest)
                 the NEXT sign-in succeeds in 3.1s                PASS — no restart needed
the engine stayed up and healthy throughout                       PASS
the isolation, team, auth, smoke and console suites all pass on that same engine
```

The rule this leaves behind: nothing may hold a write connection against `engine/data/ownrag.db` while
the engine is serving. A test that needs to inspect the file opens it briefly per statement
(`isolation_test.db_read` / `db_write`) or goes through the API.

### High — a new account landed in the owner's workspace, and removal deleted the account

Reported: *"I created a new account and it shows 'Only the workspace owner and admins may do that' on
the Models tab, why is a new account added to the same workspace as the owner, and why does deleting an
account's access delete the whole account?"* They are all one assumption — that the engine has exactly
one workspace.

* `POST /users` inserted the **constant** tenant id, so every signup became a member of the owner's
  workspace and appeared in its team list. A new account now gets a workspace of its own; joining
  someone else's is a deliberate act, and an invitation is how it happens.
* `team.members()` reads an empty `tenant_id` as "belongs to whoever is asking"
  (`COALESCE(NULLIF(tenant_id,''), ?)`), so a row without a workspace appeared in *every* roster.
  Startup now places such accounts in the owner's workspace explicitly, once; the coercion stays only
  as a safety net. `/tenants` and `/users/me` also reported the constant rather than the caller's
  workspace, which meant every account saw the same one.
* `DELETE /tenants/{id}/users/{user_id}` ran `DELETE FROM user` — revoking someone's access destroyed
  their account, and orphaned the knowledge bases it had created. It now ends their sessions and moves
  the account, with its knowledge bases, to a workspace of its own. Removing access is not deleting a
  person.
* `GET /tenants/{tenant_id}/users` had **no caller check at all**: any signed-in account could read any
  workspace's roster. It now answers only for the caller's own workspace.

The console hid nothing, so a member who clicked "Models" — gated in the engine to the owner and admins
— got a red "Something went wrong" panel. `nav.ts` now marks the manager-only surfaces and the sidebar
does not offer them to a member: the console hides what the engine refuses, and never becomes the
authority itself.

Measured on a fresh signup, against the running engine:

```
probe-…@example.test signs up    its workspace tenant_396bd0988ace4fc2, member_count 1, role member
                                 the owner's roster: owner@ownrag.local, test@test.com — no probe
                                 probe reads the owner's roster -> 403 "That workspace belongs to another account"
                                 probe calls /providers      -> 403 (the Models page it may not use)
```

Corrected since: that was the wrong call. The owner really could see another workspace's knowledge base,
and it showed up in the console as somebody else's knowledge base in their own list — the mirror image of
the leak recorded next. A manager now reaches their own workspace in full and nothing outside it.

### Critical — every account could read every workspace's data sources, logs and agents

Reported: *"I created a new account test1 and it has access to the data source that owner have."*
Measured with `engine/surface_probe.py`; a fresh account signing in saw the owner's **4 connectors**
(names, schedules and target knowledge base ids), **100 rows of sync log**, and the owner's **3 agents**
with their full DSL. The mirror image showed on the owner's side: their Knowledge page listed `test1c`, a
knowledge base created by that new account in a workspace of its own.

One cause covered both directions. Content was scoped by `created_by` alone, and the connector, agent,
file and MCP-server listings were scoped by nothing at all — `SELECT * FROM connector` for whoever asked,
so every account saw every workspace's rows.

`access.sees_row` is now the single rule and every surface goes through it: a row belongs to a workspace,
only that workspace's accounts may reach it, and inside it a manager sees the workspace while a member
sees what it created. Listings filter with `access.in_workspace`; by-id reads go through the path guard
for `conn_`, `agent_`, `mcp_` and `file_` ids exactly as `kb_` and `chat_` already did; and the four
creates stamp the creator's workspace instead of the constant.

```
before                                      after
data sources   4 of the owner's             0 rows
sync logs      100 rows                     0 rows
agents         3 of the owner's             0 rows
owner's KBs    20 + test1c (another         20 — test1c is visible only to test1, as it should be
               workspace's)
```

Two defects surfaced while proving it, both caught by the new checks rather than by reading: the tool
server guard looked for its id in the wrong path segment (`/mcp/servers/{id}` puts it third, so a member
read the owner's server by id and got 200), and the file checks passed vacuously until the suite created
a file row of its own to protect.

### High — a new account was a member of the workspace it had just created, and only the owner had models

Reported: *"why do you only give models and memory for the owner? all accounts are supposed to have that,
and why is my new account considered a member? it is supposed to be the owner because it is new."*

**Cause.** `team.role_of` derives a role from `is_admin` while the `role` column is empty, and `POST /users`
inserted `is_admin = 0` with no role — so an account that had just created its own workspace was recorded as
a **member of it**. Models, Memory and Developers are manager-only surfaces, so an account could not reach
the configuration of the workspace it owned, and only the original owner ever saw those pages.

**Fix.** A signup creates and **owns** its workspace: `role = 'owner'` and `is_admin = 1` are written in the
same INSERT as the workspace. An account alone in a workspace was corrected once at startup, logged by
address (`test1@test.com now owns its own workspace`). The manager-only listings are per workspace:
`GET /providers`, `/memories` and `/system/tokens` filter through `access.in_workspace`, and the rank gates
that used to be the whole check now sit on top of a row-level one.

The engine's **default model** is deliberately shared — it is what every workspace starts with, and every
account sees it on the Models page. A workspace's **own** configured models, memory stores and API keys are
not, which is what the isolation suite asserts with fixtures of its own.

Three defects this change exposed, all fixed and covered:

- `access.may_reach_chat` answered True for any manager **before** reading the row. That was safe while
  exactly one account was a manager; with one per workspace it let an owner of one workspace read another's
  assistant by id (HTTP 200). The row decides now.
- `GET /memories/{id}` had only a rank check, so the same account could read another workspace's memory
  store by id. It checks the row like every other by-id route.
- A key minted from the console was stored with no `user_id`, so `api_token` held a row nobody owned.

**Verified.** Isolation **82/0** (was 66), team 57/0, auth 32/0, smoke 56/0, console-path 34/0,
`surface_probe.py` **0 leaks**, 0 engine 500s. An account signed up against the running engine and the
console was read with that session: the sidebar offers `... | Models | Data sources | Memory | MCP servers |
Developers | Settings` and both pages render content instead of a 403. The owner's nav is unchanged, and
`test1@test.com` — the account from the report — owns its workspace.

### High — the engine's own model did not count as a model, so one provider answered every workspace

Reported: *"why its using deepseek!!!!"*, against a brand-new assistant in a brand-new workspace.

**Cause, traced end to end.** `active_model` treated "no `base_url`" as "not configured". The engine's own
provider has none *by design* — it serves its models in-process — so `extractive-built-in` was dropped from
every selection and the only candidate left was the single registered external provider. `ORDER BY
pm.create_time DESC` picked `deepseek-flash`; `active_model` never looked at the workspace, so every
workspace got the owner's provider whether or not it owned one; and `POST /chats` wrote
`model_mode()["generation"]` into the new assistant's `llm.model_name`. The ask path sends that stamp back as
the pinned model, so every answer was routed to api.deepseek.com with the owner's key — which the vendor
rejects (401) — and every answer degraded to the extractive fallback behind a "model call failed" prefix.
(That was the state then: the same key now authenticates — see the model-choice section below.)
The sticker on the chat header was accurate about an intent nobody had expressed.

**Fix.** The engine's own provider counts as configured without an address (`in_process`); its chat model
resolves to the extractive mode rather than an endpoint that does not exist; its embedding model keeps
returning an empty `base_url`, which is what `retrieval.vector_kind`/`embed_texts` test for (so no
re-ingest). The engine's own model answers unless an assistant pins a model, and `active_model` takes the
asking workspace, so an external provider serves only the workspace that added it. Assistants whose pin names
a model their own workspace cannot use are re-pinned at startup — 28 were, and the assistant from the report
now resolves to `extractive-built-in`. **Registration no longer reroutes every chat in every deployment.**

Verified: a new assistant is stamped `extractive-built-in`; a real ask returns an answer with a citation;
isolation 82/0, team 57/0, auth 32/0, smoke 56/0, console-path 34/0, `surface_probe.py` 0 leaks, 0 engine
500s, and **0 requests to api.deepseek.com** in the engine log for the whole run.

Three defects this exposed, all fixed:

- **A failed rerank narrowed the context.** A rejected key answers with a plain error body, which parses
  fine and yields an empty ranking — and the padding then took the context down to the floor of three, so a
  failed rerank silently *shrank* what the model was given, the opposite of what that function promises.
  An empty ranking now keeps the retrieval order. This is also why the agent smoke check had been passing:
  the narrowed three passages happened to contain the word it looked for.
- **A check that asserts a word in free text passes for whatever reason the context size gives it.** The
  agent check required "token" in the answer; it now asserts the answer is drawn from the agent's documents
  and cites them.
- **A minted API key recorded no owner** (from the previous change) — see that section.
- **A controlled dialog that never closes takes a second confirmation for the next item — and a delete
  control is where stale UI state costs data, not a click.** Reported as *"why when i delete a specific model
  provider its also show me the deleting confimation popup again for the second provider?"*. Two defects: the
  confirmation was wired `onConfirm={() => remove.mutate(name)}` while `ConfirmDialog`'s confirm button
  `preventDefault()`s, so **nothing closed the dialog** — the two other call sites (`developers.tsx`,
  `memory.tsx`) already clear their target with `mutate(id, { onSuccess: () => setTarget(null) })`, and this
  one did not; and the provider card was mounted **without a `key`**, so when the list refetched React reused
  the instance and re-rendered it for the *next* provider with the dialog still open and re-titled. The
  operator confirmed that second dialog, and the engine logged `removed deepseek (2 model(s)), re-pinned 1
  assistant(s)` — their provider and the key in it were deleted. Fixed: the dialog closes on success (a
  failure keeps it open to retry), and the card is keyed by provider name so no provider's state can outlive
  it. Verified in the browser with two providers: removing the first closes the dialog, does not raise it
  again over the second, and removing the second behaves the same.
  **Recovered:** the provider row and its two model rows were restored from the `2026-10-08` backup. The key
  in that backup is the **older** one, which the vendor rejects (401) — the working key existed only in the
  deleted row (35 chars; `.env` holds no key) and is not recoverable from here. Paste it into that provider's
  instance to use it again; the row, its address and its two models are back in place.

**The credential was switched off, not deleted — and it works again.** At the time the vendor rejected that
key (401), so a pin on it could only degrade an answer behind a "model call failed" prefix; both models were
left `enabled = 0` with the row and the key intact. **Superseded:** the key now authenticates — verified live,
`GET /models` **200** and a one-token completion **200** for both `deepseek-flash` and `deepseek-v4-pro` — and
both models are enabled again (not by this work; the operator's). Which changed, the key or the vendor, cannot
be told from here, so the check is recorded rather than explained. Switching them off also let the startup
re-resolution correct every pin: **1,152 assistants were re-pinned** and no row named DeepSeek at the time. Those rows are
benchmark, smoke and e2e leftovers — 1,020 of them named `suite` — accumulated since 10-06 without sweeping
themselves; they are the user's data and were left in place. Separately, `_agent_dsl` binds the oldest dataset
in the whole table (`ORDER BY create_time LIMIT 1`, no tenant filter), so an agent can be pointed at another
workspace's knowledge base; logged, not changed.

Final numbers for the change: a live ask through the assistant the console opens returns 5 cited passages,
no DeepSeek and no failed-call text; isolation 82/0, team 57/0, auth 32/0, smoke 56/0, console-path 34/0,
`surface_probe.py` 0 leaks, 0 engine 500s, **0 requests to api.deepseek.com**.

### High — the chat could not switch models, because the picker was handed one option

Reported: *"why i cant use my model with the chat tab? its suppose that i ca switch between my models
providers"*.

**Cause, two of them.** `GET /api/v1/users/me/models` — the list behind the Model dropdown in assistant
settings — returned **a single label**: `{chat: [model_mode()["generation"]]}`, i.e. whatever was already
resolved. So the dropdown offered exactly the model that was already answering, and a provider that was
registered, keyed and switched on could still not be picked. Separately, the chat header printed that model as
a static badge, so the tab itself had no affordance at all.

**Fix.** The endpoint returns every chat model the workspace may pin, in the engine's own stamp form
(`extractive-built-in`, `llm:<model>`), the engine's own model first because it needs no key and cannot fail;
`@provider` is appended only where a workspace serves the same model name twice, so the picker stays
readable; address-less providers, other workspaces' providers and `origin = "test"` fixtures are excluded.
The header's model is now a menu that writes the pin through the existing `PATCH /chats/{id}`, lists the
models the workspace can use, and shows the one it cannot — a pin whose provider was removed or whose model
was switched off — as visible but unpickable, so the header never names a model that did not answer. Switching
a model on under Models invalidates that list at once rather than after its five-minute stale time. No engine
model-selection logic changed: the picker now reaches the rule that already existed.

**The rule it depends on.** A pin is honoured only inside the workspace that owns the provider, so a chat in
one workspace is never answered — or billed — through another workspace's key.

**Verified.** Isolation **100/0**, six new checks: the engine's own model is offered first; a workspace is
offered its own provider's models; another workspace is not offered them; `active_model` with the other
workspace's tenant does not resolve the provider while the owner's own tenant does; the fixture is removed
again. Live in the browser: the menu lists `extractive-built-in`, `llm:deepseek-flash`, `llm:deepseek-v4-pro`;
picking DeepSeek changes the header; the ask that follows is stored as **DeepSeek prose with a citation in
4.9 s** and carries no extractive fallback, against 5.9 s for the same question through the engine's own API.
Suites: team 57/0, auth 32/0, smoke 56/0, console-path 34/0, `surface_probe.py` 0 leaks, `tsc` clean, 0 engine
500s.

**A fixture lesson, again.** The first version of that test created its provider with `"base_url"`; the field
is **`api_base`**, and it arrives through the instance route — the console's own two-step flow. The provider
therefore had no address, was correctly unusable, and the check failed for a reason that had nothing to do
with the picker. Rebuilt to use the real flow: a provider with no address being unusable is part of what the
fixture should prove, not an accident of how it was written.

### High — the provider family resolved by name alone, so a manager reached another workspace's provider

Reported: *"why theres no option to delete a model provider?"* The route existed (`DELETE
/api/v1/providers/{provider}`, reachable over the API the whole time) — the console had simply never grown
the action. Wiring a button onto it required fixing what it did first.

**Cause.** Every route in the family resolved its provider with `SELECT * FROM provider WHERE name = ?`.
Names are unique engine-wide while a provider now belongs to a workspace, so a manager could read, edit,
disconnect or delete another workspace's provider — and a delete by name would have taken **both rows** if
two workspaces ever used the same name. `GET /models` also listed every workspace's models, and
`GET /models/default` reported one workspace's resolution to all of them.

**Fix.** One rule, `_provider_row(name, actor)`: the caller's own workspace, or the engine's built-in (which
is in-process and shown to every workspace because nothing about it is billed). All twelve lookups go
through it; `GET /models` and `GET /models/default` are scoped the same way. Removal refuses the engine's own
model, deletes the provider's models with it, and re-resolves the assistants pinned to a model it served, so
no chat keeps printing a provider that is gone. `_provider_payload` carries `removable`, so the console hides
the action rather than hardcoding the engine's provider name.

**Verified.** A live browser run: a fixture provider created, selected, removed through the console's own
button and confirm, gone from the listing; the engine's own card offers no Remove. Isolation **93/0** (11 new
checks: the engine's model cannot be removed and survives, another workspace sees none of its instances,
cannot add a model to it, cannot remove it, and it survives the attempt; the owner can, its models go with it,
and no model row is left pointing at a provider that is gone). team 57/0, auth 32/0, smoke 56/0,
console-path 34/0, `surface_probe.py` 0 leaks, 0 engine 500s.

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
| **`/health` reveals the engine version** | Minor: helpful for a defender, also helpful for an attacker matching a known bug. | Strip it at the proxy if that trade is not wanted. |

---

## 3. How to re-run the verification

```bash
cd engine && ./.venv/Scripts/python.exe serve.py          # engine
PYTHONUTF8=1 ./.venv/Scripts/python.exe isolation_test.py  # workspace scoping
PYTHONUTF8=1 ./.venv/Scripts/python.exe surface_probe.py   # what a new account can reach
PYTHONUTF8=1 ./.venv/Scripts/python.exe team_test.py       # invitations, roles, removal
PYTHONUTF8=1 ./.venv/Scripts/python.exe auth_test.py       # accounts + sessions
PYTHONUTF8=1 ./.venv/Scripts/python.exe db_lock_test.py    # a held lock must not brick the engine
cd ../web && npm run type-check && npm run build           # console gates
```

`db_lock_test.py` holds SQLite's write lock from a separate process for 5 s and then 20 s, so it takes
about half a minute on purpose: it fails if a short lock is not waited for, if a long one is not
reported honestly, or if the engine cannot serve the next request afterwards.

These suites drive the real HTTP surface, so they exercise the wiring rather than the helpers. They
never register a real vendor provider and create throwaway `@example.test` accounts only, which they
sweep at the end.

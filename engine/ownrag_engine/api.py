"""
OwnRAG engine — the HTTP surface.

Implements the preserved upstream HTTP contract (`/api/v1/*`) that `web/src/api/endpoints.ts` calls,
with the same `{code, data, message, total}` envelope and HTTP 200 for application errors, so the
OwnRAG console runs against it with no page-level change.

What is real here: dataset/document/chunk persistence, upload → parse → chunk → index, hybrid
retrieval, chat sessions and messages, agents and their DSL, provider/model registry, API tokens.
What is honest: with no model configured, embeddings are the engine's built-in lexical vectors and
answers are extractive — both are labelled as such in `/system/version` and in every answer.

Modified for OwnRAG from the upstream Apache-2.0 project; see NOTICE for attribution.
"""

from __future__ import annotations

import json
import os
import pathlib
import threading
from typing import Any

from fastapi import FastAPI, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse

from . import access, auth, connectors, core, ingest, retrieval, team
from .answering import stream_answer
from .core import (
    DB_PATH,
    ENGINE_VERSION,
    FILES_DIR,
    OWNER_EMAIL,
    OWNER_ID,
    OWNER_PASSWORD,
    PROVIDER_CATALOG,
    TENANT_ID,
    CORS_ORIGINS,
    init_db,
    jdumps,
    jloads,
    model_mode,
    new_id,
    now_ms,
    one,
    q,
    x,
    xmany,
)

# Sign-up is open by default — an engine that accepts accounts is the point of going live. Set
# OWNRAG_ALLOW_SIGNUP=0 to close a deployment to new accounts without touching code.
ALLOW_SIGNUP = os.environ.get("OWNRAG_ALLOW_SIGNUP", "1").strip().lower() not in {"0", "false", "no", "off"}

# Uploads are streamed to disk, so the limit has to be enforced while streaming. Announcing a
# maxFileSize that nothing enforces is worse than announcing none.
MAX_UPLOAD_BYTES = int(os.environ.get("OWNRAG_MAX_UPLOAD_MB", "256") or 256) * 1024 * 1024

# Paths that must answer before anyone has a token: the console probes the version to decide
# live vs demo, and sign-in has to be reachable to get a token in the first place.
OPEN_PATHS = {
    "/api/v1/auth/login",
    "/api/v1/auth/login/channels",
    "/api/v1/system/version",
    "/api/v1/system/config",
    "/api/v1/users",
    "/health",
}

# Invitation links are opened by people who have no account yet, so the token is the credential:
# these paths answer without a session and validate the token themselves.
OPEN_PREFIXES = ("/api/v1/invitations/",)

CHUNK_METHODS = [
    "naive", "general", "book", "laws", "manual", "paper",
    "presentation", "table", "qa", "one", "email", "picture", "tag", "knowledge_graph",
]


# --------------------------------------------------------------------------- envelope


def ok(data: Any = None, total: int | None = None) -> dict:
    payload: dict[str, Any] = {"code": 0, "data": data, "message": "Success"}
    if total is not None:
        payload["total"] = int(total)
    elif isinstance(data, list):
        payload["total"] = len(data)
    return payload


def fail(message: str, code: int = 102) -> dict:
    return {"code": code, "data": None, "message": message, "total": 0}


def paging(request: Request, default_size: int = 30) -> tuple[int, int]:
    try:
        page = max(int(request.query_params.get("page") or 1), 1)
    except ValueError:
        page = 1
    try:
        size = min(max(int(request.query_params.get("page_size") or default_size), 1), 500)
    except ValueError:
        size = default_size
    return page, size


def spread(rows: list, page: int, size: int) -> tuple[list, int]:
    return rows[(page - 1) * size : (page - 1) * size + size], len(rows)


async def body(request: Request) -> dict:
    """Query params merged under the JSON body, matching how the console sends GET filters."""
    payload: dict[str, Any] = {k: v for k, v in request.query_params.items()}
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        try:
            raw = await request.json()
            if isinstance(raw, dict):
                payload.update(raw)
        except Exception:  # noqa: BLE001 - empty or non-JSON body is normal on DELETE
            pass
    return payload


# --------------------------------------------------------------------------- converters


def _list(raw: str | None) -> list:
    value = jloads(raw, [])
    return value if isinstance(value, list) else []


def dataset_dict(row) -> dict:
    return {
        "id": row["id"],
        "tenant_id": row["tenant_id"],
        "name": row["name"],
        "description": row["description"] or "",
        "avatar": row["avatar"],
        "language": row["language"] or "en",
        "embedding_model": row["embedding_model"],
        "chunk_method": row["chunk_method"] or "naive",
        "parser_config": jloads(row["parser_config"], {}),
        "document_count": row["document_count"],
        "chunk_count": row["chunk_count"],
        "token_count": row["token_count"],
        "similarity_threshold": row["similarity_threshold"],
        "vector_similarity_weight": row["vector_similarity_weight"],
        "top_k": row["top_k"],
        "rerank_model": row["rerank_model"],
        "permission": row["permission"] or "me",
        "created_by": row["created_by"] or OWNER_EMAIL,
        "create_time": row["create_time"],
        "create_date": _date(row["create_time"]),
        "update_time": row["update_time"],
        "update_date": _date(row["update_time"]),
        "status": row["status"] or "1",
        "tags": _list(row["tags"]),
    }


def document_dict(row) -> dict:
    return {
        "id": row["id"],
        "kb_id": row["dataset_id"],
        "dataset_id": row["dataset_id"],
        "name": row["name"],
        "location": row["location"],
        "type": row["type"],
        "size": row["size"],
        "chunk_count": row["chunk_count"],
        "token_count": row["token_count"],
        "progress": row["progress"],
        "progress_msg": row["progress_msg"] or "",
        "run": row["run"],
        "parser_id": row["parser_id"],
        "parser_config": jloads(row["parser_config"], {}),
        "source_type": row["source_type"],
        "created_by": row["created_by"] or OWNER_EMAIL,
        "create_time": row["create_time"],
        "create_date": _date(row["create_time"]),
        "update_time": row["update_time"],
        "update_date": _date(row["update_time"]),
        "thumbnail": row["thumbnail"],
        "meta_fields": jloads(row["meta_fields"], {}),
        "page_count": row["page_count"],
        "error": row["error"] or "",
    }


def chunk_dict(row, index: int = 1) -> dict:
    doc = one("SELECT name FROM document WHERE id = ?", (row["document_id"],))
    return {
        "id": row["id"],
        "chunk_id": row["id"],
        "content_with_weight": row["content_with_weight"],
        "content": row["content_with_weight"],
        "document_id": row["document_id"],
        "document_keyword": doc["name"] if doc else None,
        "docnm_kwd": doc["name"] if doc else None,
        "dataset_id": row["dataset_id"],
        "important_kwd": _list(row["important_kwd"]),
        "question_kwd": _list(row["question_kwd"]),
        "available_int": row["available_int"],
        "positions": _list(row["positions"]),
        "token_count": row["token_count"],
        "page": row["page"],
        "index": index,
        "create_time": row["create_time"],
    }


def _date(ms: int | None) -> str:
    if not ms:
        return ""
    import datetime

    return datetime.datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M:%S")


def assistant_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"] or "",
        "dataset_ids": _list(row["dataset_ids"]),
        "kb_ids": _list(row["dataset_ids"]),
        "llm": jloads(row["llm"], {}),
        "prompt": jloads(row["prompt"], {}),
        "similarity_threshold": row["similarity_threshold"],
        "vector_similarity_weight": row["vector_similarity_weight"],
        "top_k": row["top_k"],
        "rerank_model": row["rerank_model"],
        "create_time": row["create_time"],
        "update_time": row["update_time"],
    }


def agent_dict(row, with_dsl: bool = True) -> dict:
    payload = {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"] or "",
        "permission": "me",
        "status": row["status"],
        "tags": _list(row["tags"]),
        "run_count": row["run_count"],
        "create_time": row["create_time"],
        "update_time": row["update_time"],
    }
    if with_dsl:
        payload["dsl"] = jloads(row["dsl"], {"graph": {"nodes": [], "edges": []}})
    return payload


# --------------------------------------------------------------------------- app


app = FastAPI(title="OwnRAG engine", version=ENGINE_VERSION, docs_url="/api/v1/docs")
# Only the console's own origins may call the API from a browser (configurable via
# OWNRAG_CORS_ORIGINS). `allow_credentials` is off on purpose: auth travels in the Authorization
# header, never a cookie, so wildcard-origin preflights are neither needed nor allowed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Baseline response headers. A content-security policy is deliberately left to the reverse
    proxy: the console is a Vite build, and pinning a CSP here would fight its asset loading."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    return response


def actor_of(request: Request):
    """The signed-in user for this request, as the auth middleware resolved it."""
    return getattr(request.state, "actor", None)


def scope_denial(path: str, actor) -> str:
    """The refusal if this path reaches a workspace resource the caller may not touch.

    Authentication says who you are; this says what you may touch. It runs at the path so that every
    route under a resource is covered by one rule instead of each handler remembering to filter. A
    resource id is recognisable by its prefix, so the dataset and assistant trees are guarded
    without listing the routes under them. Returns "" to allow.
    """
    if not path.startswith("/api/v1/"):
        return ""
    segments = path[len("/api/v1/") :].split("/")
    head = segments[0] if segments else ""
    second = segments[1] if len(segments) > 1 else ""
    manager_only = "Only the workspace owner and admins may do that"
    if head == "datasets" and second.startswith("kb_"):
        if not access.may_reach_dataset(actor, second):
            return "This knowledge base belongs to another account"
    elif head == "chats" and second.startswith("chat_"):
        if not access.may_reach_chat(actor, second):
            return "This assistant belongs to another account"
    elif head == "tenants" and second:
        # A workspace's member list belongs to that workspace. Without this any signed-in account
        # could read any workspace's roster — and after accounts got their own workspaces, that list
        # is somebody else's business.
        if access.tenant_of(actor) != second:
            return "That workspace belongs to another account"
    elif head == "connectors" and second.startswith("conn_"):
        if not access.may_reach(actor, "connector", second):
            return "This data source belongs to another workspace"
    elif head == "agents" and second.startswith("agent_"):
        if not access.may_reach(actor, "agent", second):
            return "This agent belongs to another workspace"
    elif head == "mcp" and len(segments) > 2 and segments[2].startswith("mcp_"):
        # The id is in the third segment here (/mcp/servers/mcp_...), unlike the other surfaces.
        if not access.may_reach(actor, "mcp_server", segments[2]):
            return "This tool server belongs to another workspace"
    elif head == "files" and second.startswith("file_"):
        if not access.may_reach(actor, "file", second):
            return "This file belongs to another workspace"
    elif head == "providers" and second != "catalog":
        if not access.is_manager(actor):
            return manager_only
    elif head == "memories" and second.startswith("mem_"):
        # A rank check is not enough now that every workspace has a manager: the row decides.
        if not access.may_reach(actor, "memory", second):
            return "This memory store belongs to another workspace"
    elif head == "memories":
        if not access.is_manager(actor):
            return manager_only
    elif head == "system" and second == "tokens":
        if not access.is_manager(actor):
            return manager_only
    return ""


@app.middleware("http")
async def require_token(request: Request, call_next):
    path = request.url.path
    if request.method == "OPTIONS":
        return await call_next(request)
    # Everything the API serves is guarded, including the schema (`/openapi.json`), the docs
    # renderers and the preserved `/v1/*` compat prefix — not just `/api/*`.
    guarded = path.startswith("/api/") or path.startswith("/v1/") or path in {"/openapi.json", "/redoc"}
    if not guarded or path in OPEN_PATHS or path.startswith(OPEN_PREFIXES):
        return await call_next(request)
    header = request.headers.get("authorization") or ""
    token = header[7:].strip() if header.lower().startswith("bearer ") else header.strip()
    # token_row also rejects and deletes an expired session, so a stale or revoked token cannot be
    # replayed indefinitely.
    row = auth.token_row(token)
    if row is None:
        return JSONResponse(status_code=401, content=fail("Authentication required", 401))
    request.state.token = token
    request.state.user_id = row["user_id"] if "user_id" in row.keys() else None
    actor = auth.user_for_token(token)
    if actor is None and not str(row["name"] or "").startswith("session "):
        # A machine key (an API key) carries no user by design: it acts for the workspace, which is
        # what it is issued for, and only a manager can create one. An ownerless *session* is a
        # different thing — those are claimed for the owner at startup and must never become
        # privileged by accident, so this deliberately does not cover them.
        actor = one("SELECT * FROM user WHERE id = ?", (OWNER_ID,))
    request.state.actor = actor
    auth.touch_token(token)
    # Enforce the resource scope before any handler runs: an account that does not own a knowledge
    # base gets the same refusal whether it guessed the id or read it from a listing.
    denial = scope_denial(path, request.state.actor)
    if denial:
        return JSONResponse(status_code=403, content=fail(denial, 403))
    return await call_next(request)


@app.on_event("startup")
async def _startup() -> None:
    # Defence in depth: if the app is launched directly (uvicorn ownrag_engine.api:app) rather than
    # through serve.py, refuse the same unsafe bind here too.
    core.assert_public_bind_is_secured()
    init_db()
    removed = auth.prune_tokens()
    if removed:
        print(f"[ownrag-engine] sessions : pruned {removed} expired token(s)")
    # Sessions minted before accounts had an owner belong to the owner: backfill them so no token is
    # ownerless, and so an unowned token can never be treated as an administrator.
    unowned = one("SELECT COUNT(*) AS n FROM api_token WHERE user_id IS NULL OR user_id = ''")["n"]
    if unowned:
        x("UPDATE api_token SET user_id = ? WHERE user_id IS NULL OR user_id = ''", (OWNER_ID,))
        print(f"[ownrag-engine] sessions : claimed {unowned} legacy token(s) for the owner")
    # Accounts written before workspaces existed have no tenant, and `team.members` reads an empty
    # tenant as "belongs to whoever is asking" — which put every legacy account in every roster. Place
    # them in the owner's workspace once, explicitly, so membership is a fact rather than a default.
    homeless = one("SELECT COUNT(*) AS n FROM user WHERE tenant_id IS NULL OR tenant_id = ''")["n"]
    if homeless:
        x("UPDATE user SET tenant_id = ? WHERE tenant_id IS NULL OR tenant_id = ''", (TENANT_ID,))
        print(f"[ownrag-engine] accounts : placed {homeless} legacy account(s) in the owner's workspace")
    # An account alone in a workspace *other than the owner's* owns that workspace. Accounts written
    # before roles existed were left as members of a workspace they had created themselves.
    solo = q(
        "SELECT id, email FROM user WHERE tenant_id IS NOT NULL AND tenant_id <> ?"
        " AND (SELECT COUNT(*) FROM user m WHERE m.tenant_id = user.tenant_id) = 1",
        (TENANT_ID,),
    )
    for row in solo:
        x("UPDATE user SET role = 'owner', is_admin = 1 WHERE id = ?", (row["id"],))
        print(f"[ownrag-engine] accounts : {row['email']} now owns its own workspace")
    # An assistant's stored `model_name` is a pin: it decides who answers. A pin naming a model its own
    # workspace cannot use answers nothing, so it is re-resolved to a model the workspace can use. That is
    # how an assistant in a brand-new workspace came to be stamped with another workspace's provider.
    repinned = _repin_assistants()
    if repinned:
        print(f"[ownrag-engine] models   : re-pinned {repinned} assistant(s) to a model their workspace can use")
    print(f"[ownrag-engine] data dir : {DB_PATH.parent}")
    print(f"[ownrag-engine] mode     : {json.dumps(model_mode())}")


# --------------------------------------------------------------------------- session


@app.get("/health")
async def health():
    """Liveness for a supervisor. Public on purpose: a monitor has no session, and a health check
    that needs a credential is a health check that is disabled the first time it fails."""
    return ok({"status": "ok", "version": ENGINE_VERSION})


@app.post("/api/v1/auth/login")
async def login(request: Request):
    payload = await body(request)
    email = str(payload.get("email") or "").strip().lower()
    password = str(payload.get("password") or "")
    if not email:
        return fail("Email is required", 100)
    user = one("SELECT * FROM user WHERE lower(email) = ?", (email,))
    if user is None:
        # Identical wording and comparable work to a wrong password: an unknown address must not be
        # distinguishable from a bad credential.
        auth.note_failure(email, auth.client_ip(request))
        auth.audit("login_unknown_email", email, auth.client_ip(request))
        return fail("Incorrect email or password", 109)

    ip = auth.client_ip(request)
    locked_for = auth.is_locked(email, ip)
    if locked_for:
        auth.audit("login_locked", email, ip, f"{locked_for}s remaining")
        return fail(f"Too many attempts. Try again in {locked_for} seconds", 109)

    stored = user["password"] or ""
    if stored:
        ok_password, needs_rehash = auth.verify_password(stored, password)
    else:
        # A credential-less owner row is the loopback one-click sign-in. The process refuses to bind
        # anywhere but loopback while no OWNRAG_OWNER_PASSWORD is configured, so it is not a network
        # path (core.assert_public_bind_is_secured).
        ok_password, needs_rehash = (password == ""), False

    if not ok_password:
        auth.note_failure(email, ip)
        auth.audit("login_failed", email, ip)
        return fail("Incorrect email or password", 109)

    if needs_rehash:
        # Upgrade a legacy plaintext row in place rather than leaving a credential readable.
        x("UPDATE user SET password = ? WHERE id = ?", (auth.hash_password(password), user["id"]))

    auth.clear_failures(email, ip)
    x("UPDATE user SET last_login = ? WHERE id = ?", (now_ms(), user["id"]))
    token = auth.issue_token(user, f"session {email}")
    auth.audit("login_ok", email, ip)
    return ok(
        {
            "access_token": token,
            "token": token,
            "user": {
                "id": user["id"],
                "email": user["email"],
                "nickname": user["nickname"],
                "is_admin": bool(user["is_admin"]),
                "role": team.role_of(user),
                "tenant_id": user["tenant_id"],
            },
        }
    )


@app.post("/api/v1/auth/logout")
async def logout(request: Request):
    header = request.headers.get("authorization") or ""
    token = header[7:].strip() if header.lower().startswith("bearer ") else header.strip()
    if token:
        auth.revoke_token(token)
    return ok(True)


@app.get("/api/v1/auth/login/channels")
async def login_channels():
    return ok([])


@app.post("/api/v1/users")
async def register(request: Request):
    """Create an account from an email and a password, and sign it in."""
    if not ALLOW_SIGNUP:
        return fail("This engine is not accepting new accounts", 403)
    payload = await body(request)
    email = str(payload.get("email") or "").strip().lower()
    password = str(payload.get("password") or "")
    ip = auth.client_ip(request)

    problem = auth.email_problem(email)
    if problem:
        return fail(problem, 100)
    if one("SELECT id FROM user WHERE lower(email) = ?", (email,)):
        return fail("That email is already registered", 102)
    problem = auth.password_problem(password, email)
    if problem:
        return fail(problem, 100)

    user_id = new_id("user")
    # A new account gets a workspace of its own. Signing up must not drop a stranger into the owner's
    # workspace, where they would show up in its team list: joining someone else's workspace is a
    # deliberate act, and an invitation is how it happens.
    workspace_id = new_id("tenant")
    x(
        "INSERT INTO user (id, email, password, nickname, tenant_id, is_admin, role, create_time, last_login)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (
            user_id,
            email,
            auth.hash_password(password),
            str(payload.get("nickname") or email.split("@")[0])[:64],
            workspace_id,
            # An account that creates a workspace owns it. Calling it a member was a leftover from when
            # the engine had one workspace; whoever it invites is who the invitation says, not the owner.
            1,
            "owner",
            now_ms(),
            now_ms(),
        ),
    )
    # A new account is a signed-in account: the console must not bounce a user to a login form they
    # have just filled in.
    user = one("SELECT * FROM user WHERE id = ?", (user_id,))
    token = auth.issue_token(user, f"session {email}")
    auth.audit("signup", email, ip)
    return ok(
        {
            "id": user_id,
            "email": email,
            "nickname": user["nickname"],
            "access_token": token,
            "token": token,
        }
    )


@app.get("/api/v1/users/me")
async def users_me(request: Request):
    # The account behind the presented token, and nothing else: attributing an ownerless session to
    # the owner would make every legacy token an administrator. Startup backfills such tokens.
    user = auth.user_for_token(getattr(request.state, "token", ""))
    if user is None:
        return fail("Authentication required", 401)
    return ok(
        {
            "id": user["id"],
            "email": user["email"],
            "nickname": user["nickname"],
            "avatar": user["avatar"],
            "language": user["language"] or "en",
            "is_admin": bool(user["is_admin"]),
            "role": team.role_of(user),
            "tenant_id": user["tenant_id"] or TENANT_ID,
        }
    )


@app.get("/api/v1/users/me/models")
async def users_me_models(request: Request):
    """Every chat model this workspace may pin, in the engine's own stamp form.

    This returned a single label — whatever was already resolved — so the console's model dropdown offered
    exactly the model that was already answering. A provider could be registered, keyed and switched on and
    still be unpickable, which from the outside is "I cannot use my model with the chat tab". The engine's
    own model is listed first: it needs no key and cannot fail.
    """
    actor = actor_of(request)
    tenant = access.tenant_of(actor)
    resolved = model_mode(tenant)
    rows = q(
        "SELECT pm.model AS model, p.name AS provider, p.tenant_id AS tenant_id, p.base_url AS base_url"
        " FROM provider_model pm JOIN provider p ON p.id = pm.provider_id"
        " WHERE pm.kind = 'chat' AND pm.enabled = 1 ORDER BY p.create_time, pm.model",
    )
    pairs: list[tuple[str, str]] = []
    for row in rows:
        provider = str(row["provider"])
        if provider == core.BUILTIN_PROVIDER:
            label = resolved["generation"]
        else:
            if not (row["base_url"] or core.KNOWN_BASE_URLS.get(provider.lower())):
                continue  # an address-less provider is not configured
            if str(row["tenant_id"] or "") != tenant:
                continue  # an external provider serves the workspace that added it
            if provider in core.test_provider_names():
                continue  # a fixture must not offer itself as the deployment's answering model
            label = f"llm:{row['model']}"
        if (label, provider) not in pairs:
            pairs.append((label, provider))
    pairs.sort(key=lambda pair: pair[1] != core.BUILTIN_PROVIDER)
    seen: dict[str, int] = {}
    for label, _provider in pairs:
        seen[label] = seen.get(label, 0) + 1
    # `@provider` only where the workspace serves the same name twice, so the picker stays readable.
    chat = [label if seen[label] == 1 else f"{label}@{provider}" for label, provider in pairs]
    return ok(
        {
            "chat": chat or [resolved["generation"]],
            "embedding": [resolved["embeddings"]],
            "rerank": [resolved["rerank"]],
        }
    )


@app.get("/api/v1/tenants")
async def tenants(request: Request):
    actor = auth.user_for_token(getattr(request.state, "token", ""))
    return ok(
        [
            {
                # The caller's own workspace. This used to report the constant, so every account
                # saw one shared workspace — which is why a new signup appeared in the owner's team.
                "tenant_id": access.tenant_of(actor),
                "name": "OwnRAG workspace",
                "role": team.role_of(actor) if actor is not None else "member",
                "member_count": team.member_count(access.tenant_of(actor)),
                "can_manage": bool(actor is not None and team.can_manage(actor)),
            }
        ]
    )


def console_base(request: Request) -> str:
    """Where a copied invitation link should point: this deployment's own console."""
    configured = os.environ.get("OWNRAG_CONSOLE_URL", "").strip()
    if configured:
        return configured
    origin = (request.headers.get("origin") or "").strip()
    if origin:
        return origin
    return "http://localhost:5173"


@app.get("/api/v1/tenants/{tenant_id}/users")
async def tenant_users(tenant_id: str):
    return ok(team.members(tenant_id))


@app.patch("/api/v1/tenants/{tenant_id}/users/{user_id}")
async def update_tenant_user(request: Request, tenant_id: str, user_id: str):
    actor = auth.user_for_token(getattr(request.state, "token", ""))
    if actor is None:
        return fail("Authentication required", 401)
    payload = await body(request)
    data, error = team.change_role(actor, tenant_id, user_id, str(payload.get("role") or ""))
    if error:
        return fail(error, 100)
    return ok(data)


@app.delete("/api/v1/tenants/{tenant_id}/users/{user_id}")
async def delete_tenant_user(request: Request, tenant_id: str, user_id: str):
    actor = auth.user_for_token(getattr(request.state, "token", ""))
    if actor is None:
        return fail("Authentication required", 401)
    removed, error = team.remove_member(actor, tenant_id, user_id)
    if error:
        return fail(error, 100)
    return ok(removed)


@app.get("/api/v1/tenants/{tenant_id}/invitations")
async def list_invitations(request: Request, tenant_id: str):
    actor = auth.user_for_token(getattr(request.state, "token", ""))
    if actor is None:
        return fail("Authentication required", 401)
    if not team.can_manage(actor):
        return fail("You do not have permission to view invitations", 403)
    return ok(team.invites(tenant_id))


@app.post("/api/v1/tenants/{tenant_id}/invitations")
async def create_invitation(request: Request, tenant_id: str):
    actor = auth.user_for_token(getattr(request.state, "token", ""))
    if actor is None:
        return fail("Authentication required", 401)
    payload = await body(request)
    invite, error = team.create_invite(
        actor,
        tenant_id,
        str(payload.get("email") or ""),
        str(payload.get("role") or "member"),
        console_base(request),
    )
    if error:
        return fail(error, 100)
    return ok(invite)


@app.post("/api/v1/tenants/{tenant_id}/invitations/{invite_id}/resend")
async def resend_invitation(request: Request, tenant_id: str, invite_id: str):
    actor = auth.user_for_token(getattr(request.state, "token", ""))
    if actor is None:
        return fail("Authentication required", 401)
    invite, error = team.resend_invite(actor, tenant_id, invite_id, console_base(request))
    if error:
        return fail(error, 100)
    return ok(invite)


@app.delete("/api/v1/tenants/{tenant_id}/invitations/{invite_id}")
async def delete_invitation(request: Request, tenant_id: str, invite_id: str):
    actor = auth.user_for_token(getattr(request.state, "token", ""))
    if actor is None:
        return fail("Authentication required", 401)
    revoked, error = team.revoke_invite(actor, tenant_id, invite_id)
    if error:
        return fail(error, 100)
    return ok(revoked)


@app.get("/api/v1/invitations/{token}")
async def invitation_info(token: str):
    """Public: what the holder of a link may know before they have an account."""
    row = team.invite_for_token(token)
    if row is None:
        return fail("This invitation link is not valid any more", 100)
    return ok(team.describe_invite(row))


@app.post("/api/v1/invitations/{token}/accept")
async def accept_invitation(request: Request, token: str):
    payload = await body(request)
    user_row, error = team.accept_invite(token, str(payload.get("password") or ""), str(payload.get("nickname") or ""))
    if error:
        return fail(error, 100)
    auth.audit("login_ok", user_row["email"], auth.client_ip(request), "via invitation")
    session = auth.issue_token(user_row, f"session {user_row['email']}")
    return ok(
        {
            "id": user_row["id"],
            "email": user_row["email"],
            "nickname": user_row["nickname"],
            "role": team.role_of(user_row),
            "tenant_id": user_row["tenant_id"],
            "access_token": session,
            "token": session,
        }
    )


@app.get("/api/v1/system/version")
async def system_version():
    kind = model_mode()
    return ok(
        {
            "version": f"{ENGINE_VERSION}-ownrag",
            "build": ENGINE_VERSION,
            "doc_engine": "OwnRAG local engine (PyMuPDF / python-docx / openpyxl)",
            "database": "SQLite (local engine)",
            "kvstore": "SQLite",
            "vector_store": f"OwnRAG index · {kind['embeddings']}",
            "task_executor": "in-process threads",
            "engine": "ownrag-local",
            "mode": kind,
            # Only a boolean — it tells the sign-in form whether the password field is required. The
            # owner's email and the absolute storage path are deliberately NOT returned here: this
            # endpoint is unauthenticated, and disclosing them was the login-bypass vector.
            "password_required": bool(OWNER_PASSWORD),
            "chunk_methods": CHUNK_METHODS,
        }
    )


@app.get("/api/v1/system/config")
async def system_config():
    return ok({"registerEnabled": ALLOW_SIGNUP, "oauthEnabled": False, "maxFileSize": MAX_UPLOAD_BYTES})


def _mask_token(value: str) -> str:
    """A non-reversible display form — never the raw secret."""
    text = str(value or "")
    if not text:
        return ""
    if len(text) <= 10:
        return "…" + text[-2:]
    return f"{text[:6]}…{text[-4:]}"


@app.get("/api/v1/system/tokens")
async def system_tokens(request: Request):
    rows = access.in_workspace(
        actor_of(request),
        q("SELECT * FROM api_token WHERE name NOT LIKE 'session %' ORDER BY create_time"),
    )
    return ok(
        [
            {
                # The console lists and revokes by id; the raw token value is never returned after
                # creation, so a leaked listing cannot hand out working credentials.
                "id": r["id"],
                "token": _mask_token(r["token"]),
                "name": r["name"],
                "create_date": _date(r["create_time"])[:10],
                "create_time": r["create_time"],
            }
            for r in rows
        ]
    )


@app.post("/api/v1/system/tokens")
async def system_token_create(request: Request):
    payload = await body(request)
    token = {"token": new_id("ownrag").replace("ownrag_", "ownrag-"), "name": str(payload.get("name") or "new-token"), "create_time": now_ms()}
    x(
        "INSERT INTO api_token (id, tenant_id, token, name, create_time, last_used, user_id)"
        " VALUES (?,?,?,?,?,?,?)",
        (
            new_id("tok"),
            access.tenant_of(actor_of(request)),
            token["token"],
            token["name"],
            token["create_time"],
            0,
            # A key minted from the console is minted by somebody. Leaving it unowned made it
            # indistinguishable from the legacy keys the engine claims at startup for the owner.
            str((actor_of(request) or {})["id"]) if actor_of(request) else None,
        ),
    )
    token["create_date"] = _date(token["create_time"])[:10]
    return ok(token)


@app.delete("/api/v1/system/tokens")
async def system_token_delete(request: Request):
    payload = await body(request)
    # The console deletes by id (the listing no longer carries the raw value). The raw-value form is
    # still accepted for programmatic callers that captured a token at creation time.
    ids = payload.get("ids") or ([payload["id"]] if payload.get("id") else [])
    for token_id in ids:
        x("DELETE FROM api_token WHERE id = ? AND name NOT LIKE 'session %'", (token_id,))
    token = payload.get("token")
    if token:
        x("DELETE FROM api_token WHERE token = ? AND name NOT LIKE 'session %'", (token,))
    return ok(True)


@app.get("/api/v1/langfuse/api-key")
async def langfuse_key():
    return fail("Tracing is not configured on this engine", 102)


# --------------------------------------------------------------------------- datasets


@app.get("/api/v1/datasets")
async def datasets_list(request: Request):
    page, size = paging(request)
    keyword = str(request.query_params.get("keyword") or request.query_params.get("name") or "").lower()
    rows = q("SELECT * FROM dataset ORDER BY create_time DESC")
    # A member sees their own knowledge bases (and any marked for the team); a manager sees the
    # workspace. Filtering here, not in SQL, keeps the rule readable and in one place.
    actor = actor_of(request)
    rows = [r for r in rows if access.can_see_dataset(actor, r)]
    items = [dataset_dict(r) for r in rows]
    if keyword:
        items = [d for d in items if keyword in d["name"].lower() or keyword in (d["description"] or "").lower()]
    window, total = spread(items, page, size)
    return ok(window, total)


@app.post("/api/v1/datasets")
async def dataset_create(request: Request):
    payload = await body(request)
    actor = actor_of(request)
    created_by = (actor["email"] if actor is not None else "") or OWNER_EMAIL
    name = str(payload.get("name") or "").strip()
    if not name:
        return fail("A knowledge base needs a name", 100)
    ds_id = new_id("kb")
    kind = model_mode()
    x(
        "INSERT INTO dataset (id, tenant_id, name, description, avatar, language, embedding_model,"
        " chunk_method, parser_config, similarity_threshold, vector_similarity_weight, top_k,"
        " rerank_model, permission, created_by, create_time, update_time, tags)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            ds_id,
            access.tenant_of(actor_of(request)),
            name,
            str(payload.get("description") or ""),
            payload.get("avatar"),
            str(payload.get("language") or "en"),
            str(payload.get("embedding_model") or kind["embeddings"]),
            str(payload.get("chunk_method") or "naive"),
            jdumps(payload.get("parser_config") or {}),
            float(payload.get("similarity_threshold") or 0.0),
            float(payload.get("vector_similarity_weight") or 0.3),
            int(payload.get("top_k") or 1024),
            payload.get("rerank_model"),
            str(payload.get("permission") or "me"),
            # Attribution decides who finds this knowledge base again, so it is the caller's
            # identity, not the owner's. A machine key has no user and acts for the workspace, so
            # its work stays the owner's.
            str(created_by),
            now_ms(),
            now_ms(),
            jdumps(payload.get("tags") or []),
        ),
    )
    row = one("SELECT * FROM dataset WHERE id = ?", (ds_id,))
    x(
        "INSERT INTO ingestion_log (id, dataset_id, document_id, document_name, status, message,"
        " elapsed, create_time, operation) VALUES (?,?,?,?,?,?,?,?,?)",
        (new_id("ilog"), ds_id, "", name, "info", "Knowledge base created", 0.0, now_ms(), "create"),
    )
    return ok([dataset_dict(row)])


@app.delete("/api/v1/datasets")
async def datasets_delete(request: Request):
    payload = await body(request)
    # A member may only delete what they own; a manager keeps the whole list.
    ids = access.reachable_dataset_ids(actor_of(request), payload.get("ids") or payload.get("dataset_ids") or [])
    for ds_id in ids:
        x("DELETE FROM chunk WHERE dataset_id = ?", (ds_id,))
        x("DELETE FROM token_index WHERE dataset_id = ?", (ds_id,))
        x("DELETE FROM document WHERE dataset_id = ?", (ds_id,))
        x("DELETE FROM ingestion_log WHERE dataset_id = ?", (ds_id,))
        x("DELETE FROM dataset WHERE id = ?", (ds_id,))
    return ok(True)


@app.get("/api/v1/datasets/tags/aggregation")
async def tags_aggregation(request: Request):
    counts: dict[str, int] = {}
    allowed = access.visible_dataset_ids(actor_of(request))
    for row in q("SELECT id, tags FROM dataset"):
        if allowed is not None and row["id"] not in allowed:
            continue
        for tag in _list(row["tags"]):
            counts[tag] = counts.get(tag, 0) + 1
    return ok(counts)


@app.get("/api/v1/datasets/{dataset_id}")
async def dataset_detail(dataset_id: str):
    row = one("SELECT * FROM dataset WHERE id = ?", (dataset_id,))
    if not row:
        return fail("Knowledge base not found", 102)
    return ok(dataset_dict(row))


@app.put("/api/v1/datasets/{dataset_id}")
@app.patch("/api/v1/datasets/{dataset_id}")
async def dataset_update(dataset_id: str, request: Request):
    payload = await body(request)
    row = one("SELECT * FROM dataset WHERE id = ?", (dataset_id,))
    if not row:
        return fail("Knowledge base not found", 102)
    fields = {
        "name": payload.get("name"),
        "description": payload.get("description"),
        "avatar": payload.get("avatar"),
        "language": payload.get("language"),
        "embedding_model": payload.get("embedding_model"),
        "chunk_method": payload.get("chunk_method"),
        "similarity_threshold": payload.get("similarity_threshold"),
        "vector_similarity_weight": payload.get("vector_similarity_weight"),
        "top_k": payload.get("top_k"),
        "rerank_model": payload.get("rerank_model"),
        "permission": payload.get("permission"),
    }
    sets, args = [], []
    for key, value in fields.items():
        if value is not None:
            sets.append(f"{key} = ?")
            args.append(value)
    if "parser_config" in payload:
        sets.append("parser_config = ?")
        args.append(jdumps(payload["parser_config"]))
    if "tags" in payload:
        sets.append("tags = ?")
        args.append(jdumps(payload["tags"]))
    if sets:
        sets.append("update_time = ?")
        args.extend([now_ms(), dataset_id])
        x(f"UPDATE dataset SET {', '.join(sets)} WHERE id = ?", tuple(args))
    return ok(True)


@app.delete("/api/v1/datasets/{dataset_id}")
async def dataset_delete(dataset_id: str):
    x("DELETE FROM chunk WHERE dataset_id = ?", (dataset_id,))
    x("DELETE FROM token_index WHERE dataset_id = ?", (dataset_id,))
    x("DELETE FROM document WHERE dataset_id = ?", (dataset_id,))
    x("DELETE FROM dataset WHERE id = ?", (dataset_id,))
    return ok(True)


@app.get("/api/v1/datasets/{dataset_id}/ingestions/summary")
async def ingestion_summary(dataset_id: str):
    rows = q("SELECT * FROM document WHERE dataset_id = ?", (dataset_id,))
    by_run: dict[str, int] = {}
    for row in rows:
        by_run[row["run"]] = by_run.get(row["run"], 0) + 1
    last = one("SELECT * FROM ingestion_log WHERE dataset_id = ? ORDER BY create_time DESC LIMIT 1", (dataset_id,))
    return ok(
        {
            "total": len(rows),
            "done": by_run.get("DONE", 0),
            "running": by_run.get("RUNNING", 0),
            "failed": by_run.get("FAIL", 0),
            "unstart": by_run.get("UNSTART", 0),
            "chunks": sum(r["chunk_count"] or 0 for r in rows),
            "tokens": sum(r["token_count"] or 0 for r in rows),
            "pending": by_run.get("UNSTART", 0) + by_run.get("RUNNING", 0),
            "last_operation": (last["operation"] if last else None),
            "last_message": (last["message"] if last else None),
            "last_time": (last["create_time"] if last else None),
        }
    )


@app.get("/api/v1/datasets/{dataset_id}/ingestions")
async def ingestion_logs(dataset_id: str):
    rows = q("SELECT * FROM ingestion_log WHERE dataset_id = ? ORDER BY create_time DESC LIMIT 200", (dataset_id,))
    return ok(
        [
            {
                "log_id": r["id"],
                "document_id": r["document_id"],
                "document_name": r["document_name"],
                "status": r["status"],
                "progress": 1.0 if r["status"] == "success" else 0.0,
                "message": r["message"],
                "operation": r["operation"],
                "create_time": r["create_time"],
                "elapsed": r["elapsed"],
            }
            for r in rows
        ]
    )


@app.get("/api/v1/datasets/{dataset_id}/tags")
async def dataset_tags(dataset_id: str):
    row = one("SELECT tags FROM dataset WHERE id = ?", (dataset_id,))
    return ok(_list(row["tags"]) if row else [])


@app.get("/api/v1/datasets/{dataset_id}/metadata/config")
async def metadata_config(dataset_id: str):
    return ok({"fields": []})


@app.put("/api/v1/datasets/{dataset_id}/metadata/config")
async def metadata_config_put(dataset_id: str):
    return ok(True)


@app.get("/api/v1/datasets/{dataset_id}/metadata/summary")
async def metadata_summary(dataset_id: str):
    return ok([])


@app.get("/api/v1/datasets/{dataset_id}/graph")
async def dataset_graph(dataset_id: str):
    """Co-occurrence graph over the dataset's own keywords — computed, not decorative."""
    rows = q("SELECT important_kwd FROM chunk WHERE dataset_id = ? LIMIT 4000", (dataset_id,))
    counts: dict[str, int] = {}
    pair: dict[tuple[str, str], int] = {}
    for row in rows:
        keywords = [k for k in _list(row["important_kwd"])][:4]
        for key in keywords:
            counts[key] = counts.get(key, 0) + 1
        for i, a in enumerate(keywords):
            for b in keywords[i + 1 :]:
                edge = tuple(sorted((a, b)))
                pair[edge] = pair.get(edge, 0) + 1
    nodes = [
        {"id": k, "label": k, "type": "keyword", "degree": counts[k]}
        for k in sorted(counts, key=lambda k: -counts[k])[:40]
    ]
    top = set(counts)
    edges = [
        {"source": a, "target": b, "weight": w}
        for (a, b), w in sorted(pair.items(), key=lambda kv: -kv[1])[:80]
        if a in top and b in top
    ]
    return ok({"nodes": nodes, "edges": edges})


@app.get("/api/v1/datasets/{dataset_id}/embedding/check")
async def embedding_check(dataset_id: str):
    kinds = {
        r["vec_kind"]
        for r in q("SELECT DISTINCT vec_kind FROM chunk WHERE dataset_id = ? AND vec_kind IS NOT NULL", (dataset_id,))
    }
    current = retrieval.vector_kind()
    stale = sorted(k for k in kinds if k and k != current)
    return ok(
        {
            "current": current,
            "stored": sorted(k for k in kinds if k),
            "consistent": not stale,
            "stale": stale,
            "message": (
                "Every chunk was embedded with the encoder currently configured."
                if not stale
                else f"{len(stale)} chunk set(s) were embedded with a different encoder — re-parse to align them."
            ),
        }
    )


@app.get("/api/v1/datasets/{dataset_id}/navigation")
async def dataset_navigation(dataset_id: str):
    rows = q(
        "SELECT document_id, MIN(page) AS first_page, COUNT(*) AS chunks FROM chunk WHERE dataset_id = ?"
        " GROUP BY document_id",
        (dataset_id,),
    )
    docs = {r["id"]: r["name"] for r in q("SELECT id, name FROM document WHERE dataset_id = ?", (dataset_id,))}
    return ok(
        [
            {
                "document_id": r["document_id"],
                "doc_name": docs.get(r["document_id"], "Document"),
                "chunks": r["chunks"],
                "first_page": r["first_page"] or 1,
            }
            for r in sorted(rows, key=lambda r: docs.get(r["document_id"], ""))
        ]
    )


@app.get("/api/v1/pipelines")
async def pipelines():
    return ok(
        [
            {"id": f"pipe_builtin_{m}", "name": m.replace("_", " ").title(), "type": "builtin", "chunk_method": m}
            for m in CHUNK_METHODS
        ]
    )


# --------------------------------------------------------------------------- documents


@app.get("/api/v1/datasets/{dataset_id}/documents")
async def documents_list(dataset_id: str, request: Request):
    page, size = paging(request)
    keyword = str(request.query_params.get("keywords") or request.query_params.get("keyword") or "").lower()
    status = str(request.query_params.get("run") or "").upper()
    orderby = str(request.query_params.get("orderby") or "create_time")
    desc = str(request.query_params.get("desc") or "true").lower() != "false"
    rows = q("SELECT * FROM document WHERE dataset_id = ?", (dataset_id,))
    items = [document_dict(r) for r in rows]
    if keyword:
        items = [d for d in items if keyword in d["name"].lower()]
    if status and status != "ALL":
        items = [d for d in items if d["run"] == status]
    if orderby in {"name", "size", "chunk_count", "update_time", "create_time", "run"}:
        items.sort(key=lambda d: (d.get(orderby) is None, d.get(orderby)), reverse=desc)
    window, total = spread(items, page, size)
    return ok(window, total)


@app.post("/api/v1/datasets/{dataset_id}/documents")
async def documents_upload(dataset_id: str, request: Request):
    """Accept a real multipart upload, or a JSON `{names: []}` list to register placeholders."""
    dataset = one("SELECT * FROM dataset WHERE id = ?", (dataset_id,))
    if not dataset:
        return fail("Knowledge base not found", 102)
    created: list[dict] = []
    content_type = request.headers.get("content-type") or ""
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        files = [value for _, value in form.multi_items() if isinstance(value, UploadFile)]
        if not files:
            files = [value for key, value in form.multi_items() if key in {"file", "files"}]
        for upload in files:
            safe_name = pathlib.Path(upload.filename or "upload.bin").name
            target_dir = FILES_DIR / dataset_id
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / safe_name
            written = 0
            with target.open("wb") as handle:
                while True:
                    block = await upload.read(1024 * 1024)
                    if not block:
                        break
                    written += len(block)
                    if written > MAX_UPLOAD_BYTES:
                        handle.close()
                        target.unlink(missing_ok=True)
                        return fail(
                            f"{safe_name} is larger than the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit",
                            400,
                        )
                    handle.write(block)
            doc_id = new_id("doc")
            x(
                "INSERT INTO document (id, dataset_id, name, location, type, size, run, parser_id,"
                " parser_config, source_type, created_by, create_time, update_time)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    doc_id,
                    dataset_id,
                    safe_name,
                    str(target),
                    safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else "txt",
                    target.stat().st_size,
                    "UNSTART",
                    dataset["chunk_method"] or "naive",
                    dataset["parser_config"] or "{}",
                    "local",
                    OWNER_EMAIL,
                    now_ms(),
                    now_ms(),
                ),
            )
            created.append(document_dict(one("SELECT * FROM document WHERE id = ?", (doc_id,))))
    else:
        payload = await body(request)
        names = payload.get("names") or ([payload["name"]] if payload.get("name") else [])
        for name in names:
            doc_id = new_id("doc")
            x(
                "INSERT INTO document (id, dataset_id, name, location, type, size, run, parser_id,"
                " parser_config, source_type, created_by, create_time, update_time)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    doc_id,
                    dataset_id,
                    str(name),
                    "",
                    str(name).rsplit(".", 1)[-1].lower() if "." in str(name) else "txt",
                    0,
                    "UNSTART",
                    dataset["chunk_method"] or "naive",
                    dataset["parser_config"] or "{}",
                    "local",
                    OWNER_EMAIL,
                    now_ms(),
                    now_ms(),
                ),
            )
            created.append(document_dict(one("SELECT * FROM document WHERE id = ?", (doc_id,))))
    counts = one("SELECT COUNT(*) AS n FROM document WHERE dataset_id = ?", (dataset_id,))
    x("UPDATE dataset SET document_count = ?, update_time = ? WHERE id = ?", (counts["n"], now_ms(), dataset_id))
    return ok(created, len(created))


@app.delete("/api/v1/datasets/{dataset_id}/documents")
async def documents_delete(dataset_id: str, request: Request):
    payload = await body(request)
    ids = payload.get("ids") or payload.get("document_ids") or []
    for doc_id in ids:
        row = one("SELECT location FROM document WHERE id = ?", (doc_id,))
        if row and row["location"]:
            try:
                pathlib.Path(row["location"]).unlink(missing_ok=True)
            except OSError:
                pass
        x("DELETE FROM token_index WHERE chunk_id IN (SELECT id FROM chunk WHERE document_id = ?)", (doc_id,))
        x("DELETE FROM chunk WHERE document_id = ?", (doc_id,))
        x("DELETE FROM document WHERE id = ?", (doc_id,))
    ingest._refresh_counts(dataset_id)
    return ok(True)


@app.get("/api/v1/datasets/{dataset_id}/documents/{document_id}")
async def document_detail(dataset_id: str, document_id: str):
    row = one("SELECT * FROM document WHERE id = ?", (document_id,))
    if not row:
        return fail("Document not found", 102)
    return ok(document_dict(row))


@app.get("/api/v1/datasets/{dataset_id}/documents/{document_id}/download")
async def document_download(dataset_id: str, document_id: str):
    row = one("SELECT * FROM document WHERE id = ?", (document_id,))
    if not row or not row["location"]:
        return PlainTextResponse("No stored file for this document.", status_code=404)
    path = pathlib.Path(row["location"])
    if not path.exists():
        return PlainTextResponse("The stored file is gone from disk.", status_code=404)
    return FileResponse(path, filename=row["name"])


@app.put("/api/v1/datasets/{dataset_id}/documents/{document_id}")
@app.patch("/api/v1/datasets/{dataset_id}/documents/{document_id}")
async def document_update(dataset_id: str, document_id: str, request: Request):
    payload = await body(request)
    row = one("SELECT * FROM document WHERE id = ?", (document_id,))
    if not row:
        return fail("Document not found", 102)
    sets, args = [], []
    for key in ("name", "run"):
        if payload.get(key) is not None:
            sets.append(f"{key} = ?")
            args.append(payload[key])
    parser = payload.get("parser_id") or payload.get("chunk_method")
    if parser:
        sets.append("parser_id = ?")
        args.append(parser)
    if payload.get("parser_config") is not None:
        sets.append("parser_config = ?")
        args.append(jdumps(payload["parser_config"]))
    if payload.get("meta_fields") is not None:
        sets.append("meta_fields = ?")
        args.append(jdumps(payload["meta_fields"]))
    if sets:
        sets.append("update_time = ?")
        args.extend([now_ms(), document_id])
        x(f"UPDATE document SET {', '.join(sets)} WHERE id = ?", tuple(args))
    return ok(True)


@app.delete("/api/v1/datasets/{dataset_id}/documents/{document_id}")
async def document_delete(dataset_id: str, document_id: str):
    row = one("SELECT location FROM document WHERE id = ?", (document_id,))
    if row and row["location"]:
        try:
            pathlib.Path(row["location"]).unlink(missing_ok=True)
        except OSError:
            pass
    x("DELETE FROM token_index WHERE chunk_id IN (SELECT id FROM chunk WHERE document_id = ?)", (document_id,))
    x("DELETE FROM chunk WHERE document_id = ?", (document_id,))
    x("DELETE FROM document WHERE id = ?", (document_id,))
    ingest._refresh_counts(dataset_id)
    return ok(True)


@app.get("/api/v1/datasets/{dataset_id}/documents/{document_id}/chunks")
async def document_chunks(dataset_id: str, document_id: str, request: Request):
    page, size = paging(request)
    rows = q("SELECT * FROM chunk WHERE document_id = ? ORDER BY idx", (document_id,))
    total = len(rows)
    window = rows[(page - 1) * size : (page - 1) * size + size]
    return ok([chunk_dict(r, (page - 1) * size + i + 1) for i, r in enumerate(window)], total)


@app.get("/api/v1/datasets/{dataset_id}/documents/{document_id}/chunks/{chunk_id}")
async def document_chunk(dataset_id: str, document_id: str, chunk_id: str):
    row = one("SELECT * FROM chunk WHERE id = ? OR (document_id = ? AND idx = ?)", (chunk_id, document_id, _int(chunk_id, 0)))
    if not row:
        return fail("Chunk not found", 102)
    return ok(chunk_dict(row, (row["idx"] or 0) + 1))


@app.put("/api/v1/datasets/{dataset_id}/documents/{document_id}/chunks/{chunk_id}")
async def document_chunk_update(dataset_id: str, document_id: str, chunk_id: str, request: Request):
    payload = await body(request)
    row = one("SELECT * FROM chunk WHERE id = ?", (chunk_id,))
    if not row:
        return fail("Chunk not found", 102)
    content = payload.get("content_with_weight") or payload.get("content")
    if content:
        tokens = core.tokenize(str(content))
        x(
            "UPDATE chunk SET content_with_weight = ?, content_ltks = ?, token_count = ? WHERE id = ?",
            (str(content), " ".join(tokens), len(tokens), chunk_id),
        )
        x("DELETE FROM token_index WHERE chunk_id = ?", (chunk_id,))
        counts: dict[str, int] = {}
        for token in tokens:
            counts[token] = counts.get(token, 0) + 1
        xmany(
            "INSERT INTO token_index (dataset_id, token, chunk_id, tf) VALUES (?,?,?,?)",
            [(row["dataset_id"], token, chunk_id, tf) for token, tf in counts.items()],
        )
    if "available_int" in payload:
        x("UPDATE chunk SET available_int = ? WHERE id = ?", (1 if payload["available_int"] else 0, chunk_id))
    return ok(True)


@app.delete("/api/v1/datasets/{dataset_id}/documents/{document_id}/chunks/{chunk_id}")
async def document_chunk_delete(dataset_id: str, document_id: str, chunk_id: str):
    x("DELETE FROM token_index WHERE chunk_id = ?", (chunk_id,))
    x("DELETE FROM chunk WHERE id = ?", (chunk_id,))
    ingest._refresh_counts(dataset_id)
    return ok(True)


@app.get("/api/v1/datasets/{dataset_id}/documents/{document_id}/structure/graph")
async def document_structure_graph(dataset_id: str, document_id: str):
    rows = q("SELECT idx, important_kwd FROM chunk WHERE document_id = ? ORDER BY idx", (document_id,))
    nodes = [{"id": "doc", "label": "Document", "type": "document", "degree": len(rows)}]
    edges = []
    for row in rows:
        label = f"Chunk {(row['idx'] or 0) + 1}"
        nodes.append({"id": f"c{row['idx']}", "label": label, "type": "chunk", "degree": len(_list(row["important_kwd"]))})
        edges.append({"source": "doc", "target": f"c{row['idx']}"})
    return ok({"nodes": nodes, "edges": edges})


@app.get("/api/v1/datasets/{dataset_id}/documents/{document_id}/structure/claims")
async def document_structure_claims(dataset_id: str, document_id: str):
    # Claims extraction needs a generative model; without one this is honestly empty.
    return ok([])


@app.post("/api/v1/documents/ingest")
async def documents_ingest(request: Request):
    """Start the real pipeline. Parsing runs in worker threads; the console polls progress."""
    payload = await body(request)
    ids = payload.get("document_ids") or payload.get("ids") or []
    if not ids:
        return fail("No documents selected", 100)
    allowed = access.visible_dataset_ids(actor_of(request))
    queued = 0
    # Parsing someone else's document is the same leak as reading it.
    for doc_id in ids:
        row = one("SELECT id, dataset_id FROM document WHERE id = ?", (doc_id,))
        if not row:
            continue
        if allowed is not None and row["dataset_id"] not in allowed:
            continue
        x(
            "UPDATE document SET run = 'RUNNING', progress = 0.01, progress_msg = 'Queued for parsing',"
            " error = '', update_time = ? WHERE id = ?",
            (now_ms(), doc_id),
        )
        threading.Thread(target=ingest.ingest_document, args=(doc_id,), daemon=True).start()
        queued += 1
    return ok(True, queued)


@app.get("/api/v1/documents")
async def documents_all(request: Request):
    page, size = paging(request, 100)
    rows = q("SELECT * FROM document ORDER BY create_time DESC")
    allowed = access.visible_dataset_ids(actor_of(request))
    if allowed is not None:
        rows = [r for r in rows if r["dataset_id"] in allowed]
    items = [document_dict(r) for r in rows]
    window, total = spread(items, page, size)
    return ok(window, total)


@app.get("/api/v1/thumbnails")
async def thumbnails():
    return ok([])


# --------------------------------------------------------------------------- retrieval


def scoped_search_payload(request: Request, payload: dict) -> dict:
    """Drop knowledge bases this caller may not read, so retrieval cannot cross accounts.

    A request that names nothing keeps meaning "nothing": `retrieval.search` returns an empty result
    for an empty scope, and filling the scope in here would quietly widen that contract. Only ids the
    caller may not reach are removed.
    """
    allowed = access.visible_dataset_ids(actor_of(request))
    if allowed is None:
        return payload
    narrowed = dict(payload)
    keys = [k for k in ("dataset_ids", "kb_ids", "dataset_id") if payload.get(k)]
    for key in keys:
        value = payload[key]
        if isinstance(value, list):
            narrowed[key] = [d for d in value if str(d) in allowed]
        else:
            narrowed[key] = value if str(value) in allowed else ""
    return narrowed


@app.post("/api/v1/datasets/search")
async def datasets_search(request: Request):
    return ok(retrieval.search(scoped_search_payload(request, await body(request))))


@app.post("/api/v1/searchbots/retrieval_test")
async def searchbots_retrieval(request: Request):
    return ok(retrieval.search(scoped_search_payload(request, await body(request))))


@app.post("/api/v1/searchbots/ask")
async def searchbots_ask(request: Request):
    # Ask names its knowledge bases in the body too, so the same narrowing applies here.
    payload = scoped_search_payload(request, await body(request))
    frames = stream_answer(payload)
    return StreamingResponse(iter(frames), media_type="text/event-stream")


@app.post("/api/v1/dify/retrieval")
async def dify_retrieval(request: Request):
    payload = await body(request)
    result = retrieval.search({"dataset_ids": [payload.get("dataset_id")], "question": payload.get("query")})
    return ok(
        {
            "records": [
                {
                    "content": c["content_with_weight"],
                    "score": c["similarity"],
                    "title": c["doc_name"],
                    "metadata": {"document_id": c["document_id"], "page": c["page"]},
                }
                for c in result["chunks"]
            ]
        }
    )


# --------------------------------------------------------------------------- chat


def _seed_assistant() -> None:
    if one("SELECT id FROM chat LIMIT 1"):
        return
    datasets = q("SELECT id FROM dataset ORDER BY create_time")
    ds_ids = [r["id"] for r in datasets]
    x(
        "INSERT INTO chat (id, tenant_id, name, description, dataset_ids, llm, prompt,"
        " similarity_threshold, vector_similarity_weight, top_k, create_time, update_time)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            new_id("chat"),
            TENANT_ID,
            "Knowledge assistant",
            "Grounded answers over every knowledge base on this engine.",
            jdumps(ds_ids),
            jdumps({"model_name": model_mode(TENANT_ID)["generation"], "temperature": 0.2, "top_p": 0.8, "max_tokens": 2048}),
            jdumps({"similarity_threshold": 0.2, "keywords_similarity_weight": 0.7, "top_n": 6, "top_k": 1024, "show_quote": True}),
            0.2,
            0.3,
            6,
            now_ms(),
            now_ms(),
        ),
    )


@app.get("/api/v1/chats")
async def chats_list(request: Request):
    _seed_assistant()
    page, size = paging(request)
    rows = q("SELECT * FROM chat ORDER BY create_time")
    # Assistants predate ownership: a blank `created_by` belongs to nobody, so only managers see it.
    # That is why adding the column needed no data backfill.
    actor = actor_of(request)
    rows = [r for r in rows if access.can_see_chat(actor, r)]
    items = [assistant_dict(r) for r in rows]
    window, total = spread(items, page, size)
    return ok(window, total)


@app.post("/api/v1/chats")
async def chat_create(request: Request):
    payload = await body(request)
    chat_id = new_id("chat")
    x(
        "INSERT INTO chat (id, tenant_id, name, description, dataset_ids, llm, prompt,"
        " similarity_threshold, vector_similarity_weight, top_k, create_time, update_time, created_by)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            chat_id,
            access.tenant_of(actor_of(request)),
            str(payload.get("name") or "New assistant"),
            str(payload.get("description") or ""),
            jdumps(access.reachable_dataset_ids(actor_of(request), payload.get("dataset_ids") or payload.get("kb_ids") or [])),
            jdumps(
                payload.get("llm")
                or {"model_name": model_mode(access.tenant_of(actor_of(request)))["generation"], "temperature": 0.2}
            ),
            jdumps(
                payload.get("prompt")
                or {"similarity_threshold": 0.2, "keywords_similarity_weight": 0.7, "top_n": 6, "top_k": 1024, "show_quote": True}
            ),
            float(payload.get("similarity_threshold") or 0.0),
            float(payload.get("vector_similarity_weight") or 0.3),
            int(payload.get("top_k") or 6),
            now_ms(),
            now_ms(),
            str((actor_of(request)["email"] if actor_of(request) is not None else "")),
        ),
    )
    return ok(assistant_dict(one("SELECT * FROM chat WHERE id = ?", (chat_id,))))


@app.get("/api/v1/chats/{chat_id}")
async def chat_detail(chat_id: str):
    row = one("SELECT * FROM chat WHERE id = ?", (chat_id,))
    if not row:
        return fail("Assistant not found", 102)
    return ok(assistant_dict(row))


@app.put("/api/v1/chats/{chat_id}")
@app.patch("/api/v1/chats/{chat_id}")
async def chat_update(chat_id: str, request: Request):
    payload = await body(request)
    row = one("SELECT * FROM chat WHERE id = ?", (chat_id,))
    if not row:
        return fail("Assistant not found", 102)
    sets, args = [], []
    if payload.get("name") is not None:
        sets.append("name = ?")
        args.append(payload["name"])
    if payload.get("description") is not None:
        sets.append("description = ?")
        args.append(payload["description"])
    if "dataset_ids" in payload or "kb_ids" in payload:
        sets.append("dataset_ids = ?")
        args.append(jdumps(payload.get("dataset_ids") or payload.get("kb_ids")))
    if payload.get("llm") is not None:
        sets.append("llm = ?")
        args.append(jdumps({**jloads(row["llm"], {}), **payload["llm"]}))
    if payload.get("prompt") is not None:
        merged = {**jloads(row["prompt"], {}), **payload["prompt"]}
        sets.append("prompt = ?")
        args.append(jdumps(merged))
        if "similarity_threshold" in payload["prompt"]:
            sets.append("similarity_threshold = ?")
            args.append(float(payload["prompt"]["similarity_threshold"]))
        if "top_n" in payload["prompt"]:
            sets.append("top_k = ?")
            args.append(int(payload["prompt"]["top_n"]))
    if payload.get("vector_similarity_weight") is not None:
        sets.append("vector_similarity_weight = ?")
        args.append(float(payload["vector_similarity_weight"]))
    if sets:
        sets.append("update_time = ?")
        args.extend([now_ms(), chat_id])
        x(f"UPDATE chat SET {', '.join(sets)} WHERE id = ?", tuple(args))
    return ok(True)


@app.delete("/api/v1/chats/{chat_id}")
async def chat_delete(chat_id: str):
    for row in q("SELECT id FROM session WHERE chat_id = ?", (chat_id,)):
        x("DELETE FROM message WHERE session_id = ?", (row["id"],))
    x("DELETE FROM session WHERE chat_id = ?", (chat_id,))
    x("DELETE FROM chat WHERE id = ?", (chat_id,))
    return ok(True)


@app.get("/api/v1/chats/{chat_id}/sessions")
async def sessions_list(chat_id: str, request: Request):
    if not one("SELECT id FROM session WHERE chat_id = ?", (chat_id,)):
        _ensure_session(chat_id)
    rows = q("SELECT * FROM session WHERE chat_id = ? ORDER BY update_time DESC", (chat_id,))
    return ok([{"id": r["id"], "chat_id": r["chat_id"], "name": r["name"], "create_time": r["create_time"], "update_time": r["update_time"]} for r in rows])


def _ensure_session(chat_id: str) -> str:
    existing = one("SELECT id FROM session WHERE chat_id = ? ORDER BY create_time LIMIT 1", (chat_id,))
    if existing:
        return existing["id"]
    session_id = new_id("sess")
    x(
        "INSERT INTO session (id, chat_id, name, create_time, update_time) VALUES (?,?,?,?,?)",
        (session_id, chat_id, "New conversation", now_ms(), now_ms()),
    )
    return session_id


@app.post("/api/v1/chats/{chat_id}/sessions")
async def session_create(chat_id: str, request: Request):
    payload = await body(request)
    session_id = new_id("sess")
    x(
        "INSERT INTO session (id, chat_id, name, create_time, update_time) VALUES (?,?,?,?,?)",
        (session_id, chat_id, str(payload.get("name") or "New conversation"), now_ms(), now_ms()),
    )
    return ok({"id": session_id, "chat_id": chat_id, "name": payload.get("name") or "New conversation", "create_time": now_ms(), "update_time": now_ms()})


@app.get("/api/v1/chats/{chat_id}/sessions/{session_id}")
async def session_detail(chat_id: str, session_id: str):
    session = one("SELECT * FROM session WHERE id = ?", (session_id,))
    if not session:
        return fail("Session not found", 102)
    messages = q("SELECT * FROM message WHERE session_id = ? ORDER BY create_time", (session_id,))
    return ok(
        {
            "id": session["id"],
            "chat_id": session["chat_id"],
            "name": session["name"],
            "create_time": session["create_time"],
            "update_time": session["update_time"],
            "messages": [
                {
                    "id": m["id"],
                    "role": m["role"],
                    "content": m["content"],
                    "reference": jloads(m["reference"], []),
                    "feedback": m["feedback"],
                    "create_time": m["create_time"],
                }
                for m in messages
            ],
        }
    )


@app.delete("/api/v1/chats/{chat_id}/sessions/{session_id}")
async def session_delete(chat_id: str, session_id: str):
    x("DELETE FROM message WHERE session_id = ?", (session_id,))
    x("DELETE FROM session WHERE id = ?", (session_id,))
    return ok(True)


@app.put("/api/v1/chats/{chat_id}/sessions/{session_id}/messages/{message_id}")
@app.patch("/api/v1/chats/{chat_id}/sessions/{session_id}/messages/{message_id}")
async def message_feedback(chat_id: str, session_id: str, message_id: str, request: Request):
    payload = await body(request)
    thumb = payload.get("thumbup")
    feedback = "up" if thumb is True else "down" if thumb is False else None
    x("UPDATE message SET feedback = ? WHERE id = ?", (feedback, message_id))
    return ok(True)


@app.delete("/api/v1/chats/{chat_id}/sessions/{session_id}/messages/{message_id}")
async def message_delete(chat_id: str, session_id: str, message_id: str):
    x("DELETE FROM message WHERE id = ?", (message_id,))
    return ok(True)


@app.post("/api/v1/chat/completions")
async def chat_completions(request: Request):
    payload = await body(request)
    chat_id = str(payload.get("chat_id") or payload.get("assistant_id") or "")
    assistant = one("SELECT * FROM chat WHERE id = ?", (chat_id,)) if chat_id else None
    # The assistant is named in the body, not the path, so the path guard cannot see it. Without
    # this check a member naming another account's assistant received its answers and citations.
    if assistant is not None and not access.can_see_chat(actor_of(request), assistant):
        return fail("This assistant belongs to another account", 403)
    if assistant is None:
        _seed_assistant()
        # Fall back to an assistant this caller may actually use — never another account's.
        usable = [r for r in q("SELECT * FROM chat ORDER BY create_time") if access.can_see_chat(actor_of(request), r)]
        if not usable:
            return fail("This account has no assistant yet — create one first", 102)
        assistant = usable[0]

    session_id = str(payload.get("session_id") or "")
    if not session_id or not one("SELECT id FROM session WHERE id = ?", (session_id,)):
        session_id = new_id("sess")
        x(
            "INSERT INTO session (id, chat_id, name, create_time, update_time) VALUES (?,?,?,?,?)",
            (session_id, assistant["id"], _title_from(str(payload.get("question") or "")), now_ms(), now_ms()),
        )

    question = str(payload.get("question") or "")
    prompt_config = jloads(assistant["prompt"], {})
    # Only knowledge bases this caller may read: an assistant must not carry another account's ids
    # into retrieval, whether they arrived in the request or in the assistant's own configuration.
    datasets = access.reachable_dataset_ids(
        actor_of(request), _live_datasets(payload.get("dataset_ids") or jloads(assistant["dataset_ids"], []))
    )
    retrieval_payload = {
        "dataset_ids": datasets,
        "question": question,
        "top_k": int(payload.get("top_k") or prompt_config.get("top_n") or assistant["top_k"] or 6),
        # The chat path used to default to the assistant's own similarity_threshold (0.2), which trims
        # the 30 retrieved candidates down to a handful before the reranker runs and starves its pool.
        # Pass the whole candidate set by default; an explicit per-request value still wins (and 0.0
        # must be honoured, not read as "unset" by `or`).
        "similarity_threshold": float(payload["similarity_threshold"]) if payload.get("similarity_threshold") is not None else 0.0,
        "vector_similarity_weight": float(payload.get("vector_similarity_weight") or assistant["vector_similarity_weight"]),
        "rerank_id": payload.get("rerank_id") or assistant["rerank_model"],
        "keyword": prompt_config.get("keyword", True),
    }
    result = retrieval.search({**retrieval_payload, "page_size": retrieval_payload["top_k"]})
    reference = [
        {
            "chunk_id": c["id"],
            "doc_id": c["document_id"],
            "doc_name": c["doc_name"],
            "content": c["content_with_weight"],
            "similarity": c["similarity"],
            "vector_similarity": c["vector_similarity"],
            "term_similarity": c["term_similarity"],
            "page": c["page"],
            "index": c["index"],
        }
        for c in result["chunks"]
    ]

    x(
        "INSERT INTO message (id, session_id, role, content, reference, create_time) VALUES (?,?,?,?,?,?)",
        (new_id("msg"), session_id, "user", question, jdumps([]), now_ms()),
    )
    x("UPDATE session SET update_time = ?, name = COALESCE(NULLIF(name, 'New conversation'), ?) WHERE id = ?", (now_ms(), _title_from(question), session_id))

    llm = jloads(assistant["llm"], {})
    frames = stream_answer(
        {
            **retrieval_payload,
            "prompt": llm.get("system_prompt") or "",
            "temperature": llm.get("temperature", 0.3),
            # The model this assistant pinned. If it is not usable in this workspace the engine's own
            # model answers instead, so a stale pin cannot route the answer through someone else's key.
            "model": str(llm.get("model_name") or ""),
            "tenant_id": str(assistant["tenant_id"] or ""),
        }
    )
    # Persist the assistant turn: the frames carry the text; concatenate them back for storage.
    answer_text = _answer_from_frames(frames)
    x(
        "INSERT INTO message (id, session_id, role, content, reference, create_time) VALUES (?,?,?,?,?,?)",
        (new_id("msg"), session_id, "assistant", answer_text, jdumps(reference), now_ms()),
    )
    return StreamingResponse(iter(frames), media_type="text/event-stream")


def _answer_from_frames(frames: list[str]) -> str:
    parts: list[str] = []
    for frame in frames:
        if not frame.startswith("data:"):
            continue
        payload = frame[5:].strip()
        if payload in {"", "[DONE]"}:
            continue
        try:
            parsed = json.loads(payload)
        except ValueError:
            continue
        answer = ((parsed.get("data") or {}).get("answer")) or ""
        if answer:
            parts.append(answer)
    return "".join(parts)


def _title_from(question: str) -> str:
    text = " ".join(question.split())
    return (text[:48] + "…") if len(text) > 49 else (text or "New conversation")


@app.post("/api/v1/chat/recommendation")
async def chat_recommendation(request: Request):
    payload = await body(request)
    datasets = payload.get("dataset_ids") or []
    suggestions: list[str] = []
    for row in q("SELECT query FROM (SELECT content_ltks AS query FROM chunk LIMIT 0)") or []:
        _ = row
    if datasets:
        for row in q(
            "SELECT important_kwd FROM chunk WHERE dataset_id IN ({}) ORDER BY create_time DESC LIMIT 40".format(
                ",".join("?" for _ in datasets)
            ),
            tuple(datasets),
        ):
            for keyword in _list(row["important_kwd"])[:2]:
                if keyword not in suggestions:
                    suggestions.append(keyword)
    return ok(suggestions[:6])


@app.post("/api/v1/chat/mindmap")
async def chat_mindmap():
    return fail("Mind-map generation needs a chat model configured on this engine", 102)


@app.post("/api/v1/chat/audio/speech")
async def audio_speech():
    return fail("Text-to-speech is not configured on this engine", 102)


@app.post("/api/v1/chat/audio/transcription")
async def audio_transcription():
    return fail("Speech-to-text is not configured on this engine", 102)


# --------------------------------------------------------------------------- agents


AGENT_TEMPLATES = [
    {"id": "tpl_rag_deep", "title": "Deep research RAG", "description": "Iterative retrieval with sub-question decomposition and citation-grade output.", "category": "Research", "avatar": "🧭"},
    {"id": "tpl_qa_bot", "title": "Knowledge Q&A bot", "description": "Grounded single-pass assistant over one or more knowledge bases.", "category": "Assistant", "avatar": "💬"},
    {"id": "tpl_doc_extract", "title": "Document extraction", "description": "Parse, classify and extract structured fields from uploaded documents.", "category": "Extraction", "avatar": "📄"},
    {"id": "tpl_support", "title": "Support triage", "description": "Classify, retrieve runbooks, answer or escalate with a confidence gate.", "category": "Operations", "avatar": "🛟"},
]


def _live_datasets(requested: list) -> list[str]:
    """Resolve the knowledge bases a run should search.

    Ids that no longer exist are dropped, and if nothing survives the run searches every
    knowledge base on the engine. Without this an agent or assistant that references a deleted
    (or empty leftover) dataset silently retrieves from nothing and blames the corpus.
    """
    existing = [r["id"] for r in q("SELECT id FROM dataset ORDER BY create_time")]
    known = set(existing)
    kept = [str(d) for d in requested if str(d) in known]
    return kept or existing


def _agent_dsl(datasets: list[str], title: str) -> dict:
    """A real, runnable two-node graph: retrieve, then answer from what was retrieved."""
    return {
        "graph": {
            "nodes": [
                {"id": "begin", "type": "begin", "position": {"x": 80, "y": 220}, "data": {"name": "Begin", "form": {"components": [{"name": "question", "label": "Question", "type": "text"}]}}},
                {"id": "retrieval", "type": "retrieval", "position": {"x": 380, "y": 220}, "data": {"name": "Retrieve", "form": {"kb_ids": [str(d) for d in datasets], "top_n": 6, "similarity_threshold": 0.2}}},
                {"id": "generate", "type": "generate", "position": {"x": 680, "y": 220}, "data": {"name": "Answer", "form": {"prompt": f"You are {title}. Answer only from the retrieved passages and cite them as [citation:N]."}}},
            ],
            "edges": [
                {"source": "begin", "target": "retrieval"},
                {"source": "retrieval", "target": "generate"},
            ],
        },
        "title": title,
    }


def _seed_agents() -> None:
    if one("SELECT id FROM agent LIMIT 1"):
        return
    datasets = [r["id"] for r in q("SELECT id FROM dataset ORDER BY create_time")]
    for title, description in [
        ("Knowledge Q&A agent", "Retrieves from your knowledge bases, then answers with citations."),
        ("Document triage agent", "Retrieval-first triage skeleton — extend the graph on the canvas."),
    ]:
        x(
            "INSERT INTO agent (id, tenant_id, title, description, dsl, tags, status, run_count,"
            " create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                new_id("agent"),
                TENANT_ID,
                title,
                description,
                jdumps(_agent_dsl(datasets, title)),
                jdumps(["rag"]),
                "draft",
                0,
                now_ms(),
                now_ms(),
            ),
        )


@app.get("/api/v1/agents")
async def agents_list(request: Request):
    _seed_agents()
    rows = access.in_workspace(actor_of(request), q("SELECT * FROM agent ORDER BY update_time DESC"))
    return ok([agent_dict(r) for r in rows], len(rows))


@app.get("/api/v1/agents/templates")
async def agents_templates():
    return ok(AGENT_TEMPLATES)


@app.get("/api/v1/agents/tags")
async def agents_tags():
    tags: set[str] = set()
    for row in q("SELECT tags FROM agent"):
        tags.update(_list(row["tags"]))
    return ok(sorted(tags))


@app.get("/api/v1/agents/prompts")
async def agents_prompts():
    return ok(
        [
            {"id": "p_grounded", "name": "Grounded answer", "prompt": "Answer only from the retrieved passages. Cite as [citation:N]. If the passages do not answer the question, say so."},
            {"id": "p_triage", "name": "Triage", "prompt": "Classify the request, retrieve the matching runbook, then answer or escalate with a confidence score."},
        ]
    )


@app.post("/api/v1/agents")
async def agent_create(request: Request):
    payload = await body(request)
    title = str(payload.get("title") or "Untitled agent")
    datasets = [r["id"] for r in q("SELECT id FROM dataset ORDER BY create_time LIMIT 1")]
    agent_id = new_id("agent")
    dsl = payload.get("dsl") or _agent_dsl(datasets, title)
    x(
        "INSERT INTO agent (id, tenant_id, title, description, dsl, tags, status, run_count,"
        " create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (
            agent_id,
            access.tenant_of(actor_of(request)),
            title,
            str(payload.get("description") or ""),
            jdumps(dsl),
            jdumps(payload.get("tags") or []),
            "draft",
            0,
            now_ms(),
            now_ms(),
        ),
    )
    return ok(agent_dict(one("SELECT * FROM agent WHERE id = ?", (agent_id,))))


@app.get("/api/v1/agents/{agent_id}")
async def agent_detail(agent_id: str):
    row = one("SELECT * FROM agent WHERE id = ?", (agent_id,))
    if not row:
        return fail("Agent not found", 102)
    return ok(agent_dict(row))


@app.put("/api/v1/agents/{agent_id}")
@app.patch("/api/v1/agents/{agent_id}")
async def agent_update(agent_id: str, request: Request):
    payload = await body(request)
    row = one("SELECT * FROM agent WHERE id = ?", (agent_id,))
    if not row:
        return fail("Agent not found", 102)
    sets, args = [], []
    for key in ("title", "description", "status"):
        if payload.get(key) is not None:
            sets.append(f"{key} = ?")
            args.append(payload[key])
    if payload.get("dsl") is not None:
        sets.append("dsl = ?")
        args.append(jdumps(payload["dsl"]))
        x(
            "INSERT INTO agent_version (id, agent_id, title, dsl, create_time) VALUES (?,?,?,?,?)",
            (new_id("ver"), agent_id, str(payload.get("version_title") or f"v{now_ms() % 100000}"), jdumps(payload["dsl"]), now_ms()),
        )
    if payload.get("tags") is not None:
        sets.append("tags = ?")
        args.append(jdumps(payload["tags"]))
    if sets:
        sets.append("update_time = ?")
        args.extend([now_ms(), agent_id])
        x(f"UPDATE agent SET {', '.join(sets)} WHERE id = ?", tuple(args))
    return ok(True)


@app.delete("/api/v1/agents/{agent_id}")
async def agent_delete(agent_id: str):
    x("DELETE FROM agent WHERE id = ?", (agent_id,))
    x("DELETE FROM agent_version WHERE agent_id = ?", (agent_id,))
    x("DELETE FROM agent_log WHERE agent_id = ?", (agent_id,))
    return ok(True)


@app.post("/api/v1/agents/{agent_id}/reset")
async def agent_reset(agent_id: str):
    row = one("SELECT * FROM agent WHERE id = ?", (agent_id,))
    if not row:
        return fail("Agent not found", 102)
    datasets = [r["id"] for r in q("SELECT id FROM dataset ORDER BY create_time LIMIT 1")]
    x("UPDATE agent SET dsl = ?, update_time = ? WHERE id = ?", (jdumps(_agent_dsl(datasets, row["title"])), now_ms(), agent_id))
    return ok(True)


@app.get("/api/v1/agents/{agent_id}/versions")
async def agent_versions(agent_id: str):
    rows = q("SELECT * FROM agent_version WHERE agent_id = ? ORDER BY create_time DESC LIMIT 50", (agent_id,))
    return ok([{"id": r["id"], "title": r["title"], "create_time": r["create_time"]} for r in rows])


@app.get("/api/v1/agents/{agent_id}/versions/{version_id}")
async def agent_version(agent_id: str, version_id: str):
    row = one("SELECT * FROM agent_version WHERE id = ?", (version_id,))
    if not row:
        return fail("Version not found", 102)
    return ok({"id": row["id"], "title": row["title"], "dsl": jloads(row["dsl"], {}), "create_time": row["create_time"]})


@app.get("/api/v1/agents/{agent_id}/logs")
async def agent_logs(agent_id: str):
    rows = q("SELECT * FROM agent_log WHERE agent_id = ? ORDER BY create_time DESC LIMIT 100", (agent_id,))
    return ok(
        [{"id": r["id"], "status": r["status"], "elapsed": r["elapsed"], "message": r["message"], "create_time": r["create_time"]} for r in rows]
    )


@app.get("/api/v1/agents/{agent_id}/sessions")
async def agent_sessions(agent_id: str):
    return ok([])


@app.get("/api/v1/agents/{agent_id}/components/{component_id}/input-form")
async def agent_input_form(agent_id: str, component_id: str):
    row = one("SELECT * FROM agent WHERE id = ?", (agent_id,))
    if not row:
        return fail("Agent not found", 102)
    dsl = jloads(row["dsl"], {})
    for node in (dsl.get("graph") or {}).get("nodes") or []:
        if node.get("id") == component_id:
            return ok({"component_id": component_id, "form": (node.get("data") or {}).get("form") or {}})
    return ok({"component_id": component_id, "form": {}})


@app.post("/api/v1/agents/chat/completions")
async def agent_completions(request: Request):
    """Run the agent graph. The stages that matter (retrieval, then a grounded answer) are real;
    the graph is walked in order and every node is logged."""
    payload = await body(request)
    agent_id = str(payload.get("agent_id") or "")
    row = one("SELECT * FROM agent WHERE id = ?", (agent_id,)) if agent_id else None
    if row is None:
        _seed_agents()
        row = one("SELECT * FROM agent ORDER BY create_time LIMIT 1")

    started = now_ms()
    dsl = jloads(row["dsl"], {})
    datasets: list[str] = []
    prompt = ""
    for node in (dsl.get("graph") or {}).get("nodes") or []:
        form = (node.get("data") or {}).get("form") or {}
        for key in ("kb_ids", "dataset_ids"):
            if isinstance(form.get(key), list):
                datasets.extend(str(d) for d in form[key] if d)
        if node.get("type") == "generate" and form.get("prompt"):
            prompt = str(form["prompt"])
    # The agent graph names its knowledge bases in its DSL, so the caller's reach is applied here too.
    datasets = access.reachable_dataset_ids(actor_of(request), _live_datasets(datasets))

    question = str(payload.get("question") or payload.get("query") or "")
    frames = stream_answer(
        {
            "dataset_ids": datasets,
            "question": question,
            "prompt": prompt,
            "top_k": int(payload.get("top_k") or 6),
            "similarity_threshold": 0.2,
            "vector_similarity_weight": 0.3,
            "tenant_id": str(row["tenant_id"] or ""),
        }
    )
    answer = _answer_from_frames(frames)
    elapsed = (now_ms() - started) / 1000
    x("UPDATE agent SET run_count = run_count + 1, update_time = ? WHERE id = ?", (now_ms(), row["id"]))
    x(
        "INSERT INTO agent_log (id, agent_id, status, elapsed, message, create_time) VALUES (?,?,?,?,?,?)",
        (new_id("alog"), row["id"], "success", elapsed, f"Answered from {len(datasets)} knowledge base(s): {_title_from(question)}", now_ms()),
    )
    return StreamingResponse(iter(frames), media_type="text/event-stream")


@app.post("/api/v1/agents/test_db_connection")
async def agents_test_db():
    return ok({"status": "ok", "engine": "sqlite", "path": str(DB_PATH)})


# --------------------------------------------------------------------------- models


def _seed_providers() -> None:
    if one("SELECT id FROM provider LIMIT 1"):
        return
    kind = model_mode()
    provider_id = new_id("prov")
    x(
        "INSERT INTO provider (id, tenant_id, name, label, kind, base_url, api_key, status, create_time)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (provider_id, TENANT_ID, "ownrag-local", "OwnRAG local engine", "llm", "", "", "added", now_ms()),
    )
    models = [
        ("m_lexical", kind["embeddings"], "embedding", 8192, 8192),
        ("m_generative", kind["generation"], "chat", 32768, 4096),
        ("m_rerank", kind["rerank"], "rerank", 8192, 8192),
    ]
    xmany(
        "INSERT INTO provider_model (id, provider_id, model, kind, enabled, context_length, max_output, create_time)"
        " VALUES (?,?,?,?,?,?,?,?)",
        [(mid, provider_id, name, k, 1, ctx, out, now_ms()) for mid, name, k, ctx, out in models],
    )


def _provider_payload(row) -> dict:
    instances = q("SELECT * FROM provider_model WHERE provider_id = ?", (row["id"],))
    return {
        "name": row["name"],
        "label": row["label"],
        "kind": row["kind"],
        "status": row["status"],
        "base_url": row["base_url"] or "",
        "origin": row["origin"] if "origin" in row.keys() else "console",
        "has_api_key": bool(row["api_key"]),
        # The console hides the remove action on this rather than hardcoding the engine's provider name.
        "removable": row["name"] != core.BUILTIN_PROVIDER,
        "instances": [
            {
                "id": row["id"],
                "provider": row["name"],
                "instance_name": "built-in" if row["name"] == "ownrag-local" else "default",
                "api_base": row["base_url"] or None,
                "status": "connected",
                "has_api_key": bool(row["api_key"]),
                "models": [
                    {
                        "id": m["id"],
                        "name": m["model"],
                        "model_type": m["kind"],
                        "status": "active" if m["enabled"] else "disabled",
                        "enabled": bool(m["enabled"]),
                        "context_length": m["context_length"],
                        "max_output": m["max_output"],
                    }
                    for m in instances
                ],
            }
        ],
    }


def _provider_row(name: str, actor: Any) -> dict | None:
    """The provider this caller may act on: their workspace's own, or the engine's built-in.

    Every route in this family resolved its provider by name alone. Names are unique engine-wide while a
    provider now belongs to a workspace, so a manager could read, edit, disconnect or delete another
    workspace's provider — and a delete by name would have taken both rows if two workspaces ever used the
    same name. A delete endpoint was reachable over the API the whole time; this is what made it safe to
    put a button on.
    """
    row = one("SELECT * FROM provider WHERE name = ?", (name,))
    if not row:
        return None
    if str(row["name"]) == core.BUILTIN_PROVIDER:
        return row  # in-process, and shown to every workspace because nothing about it is billed
    if str(row["tenant_id"] or "") != access.tenant_of(actor):
        return None
    return row


def _repin_assistants(tenant: str = "") -> int:
    """Re-resolve assistants whose stored pin names a model their workspace cannot use.

    An assistant's stored `model_name` is a pin: it decides who answers. A pin naming a model the workspace
    cannot use answers nothing, so it is re-resolved to one the workspace can use. `tenant` limits the pass
    to one workspace, which is what removing a provider needs — no chat may keep pointing at a provider
    that is gone.
    """
    where, args = (" WHERE tenant_id = ?", (tenant,)) if tenant else ("", ())
    repinned = 0
    for row in q("SELECT id, tenant_id, llm FROM chat" + where, args):
        config = jloads(row["llm"], {})
        pinned = str(config.get("model_name") or "")
        if not pinned:
            continue
        resolved = core.resolve_llm(pinned, str(row["tenant_id"] or ""))
        label = resolved["mode"] if resolved["mode"] != "extractive" else "extractive-built-in"
        if label != pinned:
            config["model_name"] = label
            x("UPDATE chat SET llm = ? WHERE id = ?", (jdumps(config), row["id"]))
            repinned += 1
    return repinned


@app.get("/api/v1/providers")
async def providers_list(request: Request):
    _seed_providers()
    actor = actor_of(request)
    rows = access.in_workspace(actor, q("SELECT * FROM provider ORDER BY create_time"))
    if not rows:
        # One model configuration serves every workspace; a workspace with nothing of its own still has
        # that model, so it is shown rather than an empty catalogue. `provider.name` is unique engine-wide,
        # so duplicating the row per workspace would collide and a per-workspace row would overstate what
        # the engine actually does.
        rows = [r for r in q("SELECT * FROM provider") if str(r["name"]) == "ownrag-local"]
    return ok([_provider_payload(r) for r in rows])


def _kind_for(name: str) -> str:
    """What a discovered id most likely is. A provider that lists embeddings next to chat models must
    not end up with an embedding model answering questions."""
    lowered = name.lower()
    if any(token in lowered for token in ("embed", "bge-", "gte-", "e5-", "text-similarity")):
        return "embedding"
    if any(token in lowered for token in ("rerank", "reranker")):
        return "rerank"
    if any(token in lowered for token in ("whisper", "tts", "speech", "audio", "asr")):
        return "asr"
    return "chat"


def _register_discovered_models(row, kinds: list[str] | None = None) -> list[str]:
    """Ask the provider which models it serves and enable them.

    Linking a provider is only half the job — with an empty model list the engine has nothing to
    select and answers fall back to the built-in path, which looks like the provider being ignored.
    Without an explicit `kinds`, each id is classified by name; embeddings are never registered as
    chat models, because switching the embedding model without re-ingesting would also leave a corpus
    indexed by two different encoders.
    """
    names = core.discover_models(str(row["base_url"] or ""), str(row["api_key"] or ""))
    planned = [(name, kind) for name in names for kind in kinds] if kinds else [(name, _kind_for(name)) for name in names]
    registered: list[str] = []
    for name, kind in planned:
        if one("SELECT id FROM provider_model WHERE provider_id = ? AND model = ? AND kind = ?", (row["id"], name, kind)):
            continue
        x(
            "INSERT INTO provider_model (id, provider_id, model, kind, enabled, context_length, max_output, create_time)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (new_id("pm"), row["id"], name, kind, 1, 8192, 2048, now_ms()),
        )
        registered.append(f"{name} ({kind})")
    return registered


@app.get("/api/v1/providers/catalog")
async def providers_catalog():
    """What can be added, and how this engine would reach it.

    The console renders this instead of hardcoding a vendor list, so it cannot offer a provider the
    engine has no way to call without saying so.
    """
    configured = {row["name"] for row in q("SELECT name FROM provider")}
    return ok([{**entry, "configured": entry["name"] in configured} for entry in PROVIDER_CATALOG])


@app.post("/api/v1/providers")
async def provider_create(request: Request):
    payload = await body(request)
    name = str(payload.get("provider_name") or payload.get("name") or "custom")
    if one("SELECT id FROM provider WHERE name = ?", (name,)):
        return fail("That provider already exists", 102)
    # `origin="test"` marks a throwaway provider a test harness registered. Such a provider is never
    # auto-selected to answer production questions (see core.active_model) — it is used only when a
    # caller explicitly pins one of its models. Everything else is a normal console provider.
    origin = "test" if str(payload.get("origin") or "").strip().lower() == "test" else "console"
    x(
        "INSERT INTO provider (id, tenant_id, name, label, kind, base_url, api_key, status, create_time, origin)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        (new_id("prov"), access.tenant_of(actor_of(request)), name, str(payload.get("label") or name.title()), "llm", "", "", "added", now_ms(), origin),
    )
    return ok(True)


@app.get("/api/v1/providers/{provider}/instances")
async def provider_instances(provider: str, request: Request):
    row = _provider_row(provider, actor_of(request))
    return ok(_provider_payload(row)["instances"] if row else [])


@app.post("/api/v1/providers/{provider}/instances")
async def provider_instance_create(provider: str, request: Request):
    payload = await body(request)
    row = _provider_row(provider, actor_of(request))
    if not row:
        return fail("Provider not found", 102)
    registered: list[str] = []
    if payload.get("api_base") or payload.get("api_key"):
        x(
            "UPDATE provider SET base_url = ?, api_key = ?, update_time = ? WHERE id = ?",
            (str(payload.get("api_base") or row["base_url"] or ""), str(payload.get("api_key") or row["api_key"] or ""), now_ms(), row["id"]),
        )
        # Ask the provider what it serves. A provider that is "connected" but has no models is the
        # difference between storing a key and chat actually using it.
        registered = _register_discovered_models(one("SELECT * FROM provider WHERE id = ?", (row["id"],)))
    return ok({"models_registered": registered})


@app.get("/api/v1/providers/{provider}/instances/{instance}")
async def provider_instance(provider: str, instance: str, request: Request):
    row = _provider_row(provider, actor_of(request))
    if not row:
        return fail("Provider not found", 102)
    payload = _provider_payload(row)
    for candidate in payload["instances"]:
        if candidate["id"] == instance or candidate["instance_name"] == instance:
            return ok(candidate)
    return fail("Instance not found", 102)


@app.put("/api/v1/providers/{provider}/instances/{instance}")
@app.patch("/api/v1/providers/{provider}/instances/{instance}")
async def provider_instance_update(provider: str, instance: str, request: Request):
    payload = await body(request)
    row = _provider_row(provider, actor_of(request))
    if not row:
        return fail("Provider not found", 102)
    sets, args = [], []
    if payload.get("api_base") is not None:
        sets.append("base_url = ?")
        args.append(str(payload["api_base"]))
    if payload.get("api_key") is not None:
        sets.append("api_key = ?")
        args.append(str(payload["api_key"]))
    registered: list[str] = []
    if sets:
        args.append(row["id"])
        x(f"UPDATE provider SET {', '.join(sets)} WHERE id = ?", tuple(args))
        if payload.get("api_base") is not None or payload.get("api_key") is not None:
            registered = _register_discovered_models(one("SELECT * FROM provider WHERE id = ?", (row["id"],)))
    return ok({"models_registered": registered})


@app.delete("/api/v1/providers/{provider}/instances/{instance}")
async def provider_instance_delete(provider: str, instance: str, request: Request):
    """Disconnect: drop the models and the credentials, so the provider stops being selected for
    answers instead of lingering as a half-configured entry."""
    row = _provider_row(provider, actor_of(request))
    if row:
        x("DELETE FROM provider_model WHERE provider_id = ?", (row["id"],))
        x(
            "UPDATE provider SET base_url = '', api_key = '', status = 'disconnected', update_time = ? WHERE id = ?",
            (now_ms(), row["id"]),
        )
    return ok(True)


@app.delete("/api/v1/providers/{provider}")
async def provider_delete(provider: str, request: Request):
    """Remove a provider and the models it served — without this, a name typed once is permanent.

    Removing it also re-resolves the assistants pinned to a model it served: a chat must not keep pointing
    at a provider that is gone, and the console prints that pin in its header.
    """
    if provider == core.BUILTIN_PROVIDER:
        return fail("The engine's own model cannot be removed — it needs no key and cannot fail", 403)
    actor = actor_of(request)
    row = _provider_row(provider, actor)
    if not row:
        return fail("Provider not found", 102)
    models = one("SELECT COUNT(*) AS n FROM provider_model WHERE provider_id = ?", (row["id"],))["n"]
    x("DELETE FROM provider_model WHERE provider_id = ?", (row["id"],))
    x("DELETE FROM provider WHERE id = ?", (row["id"],))
    repinned = _repin_assistants(str(row["tenant_id"] or ""))
    print(f"[ownrag-engine] providers: removed {provider} ({models} model(s)), re-pinned {repinned} assistant(s)")
    return ok({"provider": provider, "models_removed": models, "assistants_repinned": repinned})


@app.get("/api/v1/providers/{provider}/connection")
async def provider_connection(provider: str, request: Request):
    row = _provider_row(provider, actor_of(request))
    if not row:
        return fail("Provider not found", 102)
    if provider == "ownrag-local":
        return ok({"status": "ok", "elapsed_ms": 0, "detail": "In-process engine — no network hop."})
    if not row["base_url"]:
        return ok({"status": "unconfigured", "elapsed_ms": 0, "detail": "No API base set for this provider."})
    import requests

    import time

    started = time.perf_counter()
    try:
        response = requests.get(
            f"{row['base_url'].rstrip('/')}/models",
            headers={"Authorization": f"Bearer {row['api_key']}"} if row["api_key"] else {},
            timeout=15,
        )
        return ok(
            {
                "status": "ok" if response.status_code < 400 else "error",
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                "detail": f"HTTP {response.status_code}",
            }
        )
    except Exception as exc:  # noqa: BLE001
        return ok({"status": "error", "elapsed_ms": round((time.perf_counter() - started) * 1000, 1), "detail": str(exc)})


@app.post("/api/v1/providers/{provider}/instances/{instance}/models/discover")
async def instance_models_discover(provider: str, instance: str, request: Request):
    """Ask the endpoint what it serves and register what it lists.

    Returns both lists so the console can say what is available when nothing was registered.
    """
    payload = await body(request)
    row = _provider_row(provider, actor_of(request))
    if not row:
        return fail("Provider not found", 102)
    kinds = payload.get("kinds")
    kinds = [str(k) for k in kinds] if isinstance(kinds, list) and kinds else None
    available = core.discover_models(str(row["base_url"] or ""), str(row["api_key"] or ""))
    registered = _register_discovered_models(row, kinds)
    return ok({"available": available, "registered": registered, "kinds": kinds or ["classified by name"]})


@app.get("/api/v1/providers/{provider}/models")
async def provider_models(provider: str, request: Request):
    row = _provider_row(provider, actor_of(request))
    if not row:
        return fail("Provider not found", 102)
    return ok(_provider_payload(row)["instances"][0]["models"])


@app.get("/api/v1/providers/{provider}/instances/{instance}/models")
async def instance_models(provider: str, instance: str, request: Request):
    return await provider_models(provider, request)


@app.post("/api/v1/providers/{provider}/instances/{instance}/models")
async def instance_model_add(provider: str, instance: str, request: Request):
    payload = await body(request)
    row = _provider_row(provider, actor_of(request))
    if not row:
        return fail("Provider not found", 102)
    entries = payload.get("models")
    if entries is None:
        entries = [{"name": payload.get("model_name") or "new-model", "model_type": payload.get("model_type") or "chat"}]
    for entry in entries:
        name = str(entry.get("name") or entry.get("model") or "new-model")
        kind = str(entry.get("model_type") or entry.get("kind") or "chat")
        if not one("SELECT id FROM provider_model WHERE provider_id = ? AND model = ? AND kind = ?", (row["id"], name, kind)):
            x(
                "INSERT INTO provider_model (id, provider_id, model, kind, enabled, context_length, max_output, create_time)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (new_id("pm"), row["id"], name, kind, 1, 8192, 2048, now_ms()),
            )
    return ok(True)


@app.put("/api/v1/providers/{provider}/instances/{instance}/models/{model}")
@app.patch("/api/v1/providers/{provider}/instances/{instance}/models/{model}")
async def instance_model_update(provider: str, instance: str, model: str, request: Request):
    payload = await body(request)
    row = _provider_row(provider, actor_of(request))
    if not row:
        return fail("Provider not found", 102)
    target = one("SELECT * FROM provider_model WHERE provider_id = ? AND (id = ? OR model = ?)", (row["id"], model, model))
    if not target:
        x(
            "INSERT INTO provider_model (id, provider_id, model, kind, enabled, context_length, max_output, create_time)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (new_id("pm"), row["id"], model, str(payload.get("model_type") or "chat"), 1, 8192, 2048, now_ms()),
        )
        return ok(True)
    sets, args = [], []
    if payload.get("status") is not None:
        sets.append("enabled = ?")
        args.append(0 if str(payload["status"]).lower() in {"disabled", "inactive"} else 1)
    if payload.get("enabled") is not None:
        sets.append("enabled = ?")
        args.append(1 if payload["enabled"] else 0)
    if payload.get("model_type") is not None:
        sets.append("kind = ?")
        args.append(str(payload["model_type"]))
    if sets:
        args.append(target["id"])
        x(f"UPDATE provider_model SET {', '.join(sets)} WHERE id = ?", tuple(args))
    return ok(True)


@app.delete("/api/v1/providers/{provider}/instances/{instance}/models/{model}")
async def instance_model_delete(provider: str, instance: str, model: str, request: Request):
    row = _provider_row(provider, actor_of(request))
    if row:
        x("DELETE FROM provider_model WHERE provider_id = ? AND (id = ? OR model = ?)", (row["id"], model, model))
    return ok(True)


@app.get("/api/v1/providers/{provider}/instances/{instance}/balance")
async def instance_balance(provider: str, instance: str):
    return ok({"balance": None, "currency": None, "detail": "This engine does not track provider billing."})


@app.get("/api/v1/models")
async def models_all(request: Request):
    _seed_providers()
    actor = actor_of(request)
    rows = access.in_workspace(actor, q("SELECT * FROM provider ORDER BY create_time"))
    if not rows:
        # Same rule as the provider listing: the engine's own model serves every workspace.
        rows = [r for r in q("SELECT * FROM provider") if str(r["name"]) == core.BUILTIN_PROVIDER]
    out = []
    for row in rows:
        for instance in _provider_payload(row)["instances"]:
            for model in instance["models"]:
                out.append({**model, "provider": row["name"], "instance": instance["instance_name"]})
    return ok(out)


@app.get("/api/v1/models/default")
async def models_default(request: Request):
    kind = model_mode(access.tenant_of(actor_of(request)))
    return ok({"chat": kind["generation"], "embedding": kind["embeddings"], "rerank": kind["rerank"]})


@app.get("/api/v1/plugin/tools")
async def plugin_tools():
    return ok(
        [
            {"name": "http_request", "label": "HTTP request", "description": "Call an HTTP endpoint and pass the response to the next node.", "available": True},
            {"name": "code_executor", "label": "Code executor", "description": "Run Python in a sandboxed step.", "available": False},
            {"name": "web_search", "label": "Web search", "description": "Search the public web and return ranked snippets.", "available": False},
            {"name": "sql_executor", "label": "SQL executor", "description": "Run read-only SQL against a registered database.", "available": False},
        ]
    )


# --------------------------------------------------------------------------- connectors, mcp, memory, files


def _connector_payload(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "source_type": row["type"],
        "status": row["status"],
        "dataset_ids": connectors.config_of(row)["dataset_ids"],
        "schedule": row["schedule"] or "",
        "documents_synced": int(row["documents_synced"] or 0),
        "message": row["message"] or "",
        "last_sync_at": row["last_sync"],
    }


@app.get("/api/v1/connectors")
async def connectors_list(request: Request):
    rows = access.in_workspace(actor_of(request), q("SELECT * FROM connector ORDER BY create_time"))
    return ok([_connector_payload(r) for r in rows])


@app.post("/api/v1/connectors")
async def connector_create(request: Request):
    payload = await body(request)
    conn_id = new_id("conn")
    datasets = [str(d) for d in (payload.get("dataset_ids") or [])]
    settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
    x(
        "INSERT INTO connector (id, tenant_id, name, type, config, status, last_sync, create_time, schedule)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (
            conn_id,
            access.tenant_of(actor_of(request)),
            str(payload.get("name") or "New connector"),
            str(payload.get("source_type") or "s3"),
            connectors.stored_config(datasets, settings or {}),
            "idle",
            None,
            now_ms(),
            str(payload.get("schedule") or ""),
        ),
    )
    return ok(_connector_payload(one("SELECT * FROM connector WHERE id = ?", (conn_id,))))


@app.get("/api/v1/connectors/sources")
async def connector_sources():
    """What each source needs, so the console's dialog renders the right fields and claims nothing more."""
    return ok(connectors.sources_catalog())


@app.get("/api/v1/connectors/sync_logs")
async def connector_sync_logs(request: Request):
    # The log rows carry no workspace, so they are filtered by the connectors the caller may reach.
    visible = {str(r["id"]) for r in access.in_workspace(actor_of(request), q("SELECT * FROM connector"))}
    rows = [
        r
        for r in q("SELECT * FROM connector_log ORDER BY create_time DESC LIMIT 200")
        if str(r["connector_id"] or "") in visible
    ][:100]
    return ok([{"time": r["create_time"], "message": r["message"], "level": "info", "status": r["status"]} for r in rows])


@app.get("/api/v1/connectors/{connector_id}")
async def connector_detail(connector_id: str):
    row = one("SELECT * FROM connector WHERE id = ?", (connector_id,))
    if not row:
        return fail("Connector not found", 102)
    return ok(_connector_payload(row))


@app.put("/api/v1/connectors/{connector_id}")
@app.patch("/api/v1/connectors/{connector_id}")
async def connector_update(connector_id: str, request: Request):
    payload = await body(request)
    row = one("SELECT * FROM connector WHERE id = ?", (connector_id,))
    if not row:
        return fail("Connector not found", 102)
    sets, args = [], []
    if payload.get("name") is not None:
        sets.append("name = ?")
        args.append(payload["name"])
    if payload.get("source_type") is not None:
        sets.append("type = ?")
        args.append(payload["source_type"])
    if payload.get("schedule") is not None:
        sets.append("schedule = ?")
        args.append(str(payload["schedule"]))
    if payload.get("status") is not None:
        sets.append("status = ?")
        args.append(str(payload["status"]))
    if payload.get("dataset_ids") is not None or isinstance(payload.get("settings"), dict):
        current = connectors.config_of(row)
        datasets = payload.get("dataset_ids") if payload.get("dataset_ids") is not None else current["dataset_ids"]
        settings = payload["settings"] if isinstance(payload.get("settings"), dict) else current["settings"]
        sets.append("config = ?")
        args.append(connectors.stored_config([str(d) for d in (datasets or [])], settings))
    if sets:
        args.append(connector_id)
        x(f"UPDATE connector SET {', '.join(sets)} WHERE id = ?", tuple(args))
    return ok(_connector_payload(one("SELECT * FROM connector WHERE id = ?", (connector_id,))))


@app.delete("/api/v1/connectors/{connector_id}")
async def connector_delete(connector_id: str):
    x("DELETE FROM connector WHERE id = ?", (connector_id,))
    return ok(True)


@app.post("/api/v1/connectors/{connector_id}/test")
async def connector_test(connector_id: str):
    """Reach the source without writing anything — a real check, not a canned success."""
    if not one("SELECT id FROM connector WHERE id = ?", (connector_id,)):
        return fail("Connector not found", 102)
    result = connectors.probe(connector_id)
    return ok(result) if result["ok"] else fail(result["message"], 102)


@app.post("/api/v1/connectors/{connector_id}/rebuild")
async def connector_rebuild(connector_id: str):
    """Pull the source's content into the connector's knowledge bases, through the normal ingest path."""
    result = connectors.sync(connector_id)
    return ok(result) if result["ok"] else fail(result["message"], 102)


@app.get("/api/v1/connectors/{connector_id}/logs")
async def connector_logs(connector_id: str):
    rows = q("SELECT * FROM connector_log WHERE connector_id = ? ORDER BY create_time DESC LIMIT 100", (connector_id,))
    return ok([{"time": r["create_time"], "message": r["message"], "level": "info"} for r in rows])


@app.get("/api/v1/mcp/servers")
async def mcp_list(request: Request):
    rows = access.in_workspace(actor_of(request), q("SELECT * FROM mcp_server ORDER BY create_time"))
    return ok(
        [
            {
                "id": r["id"],
                "name": r["name"],
                "url": r["url"],
                "transport": r["transport"],
                "enabled": bool(r["enabled"]),
                "status": "unknown",
                "last_check_at": r["create_time"],
                "tools": _list(r["tools"]),
            }
            for r in rows
        ]
    )


@app.post("/api/v1/mcp/servers")
async def mcp_create(request: Request):
    payload = await body(request)
    server_id = new_id("mcp")
    x(
        "INSERT INTO mcp_server (id, tenant_id, name, url, transport, tools, enabled, create_time) VALUES (?,?,?,?,?,?,?,?)",
        (server_id, access.tenant_of(actor_of(request)), str(payload.get("name") or "new-server"), str(payload.get("url") or ""), str(payload.get("transport") or "sse"), jdumps([]), 1 if payload.get("enabled", True) else 0, now_ms()),
    )
    return ok({"id": server_id, "name": payload.get("name") or "new-server", "url": payload.get("url") or "", "transport": payload.get("transport") or "sse", "enabled": True, "status": "unknown", "tools": []})


@app.get("/api/v1/mcp/servers/{server_id}")
async def mcp_detail(server_id: str):
    row = one("SELECT * FROM mcp_server WHERE id = ?", (server_id,))
    if not row:
        return fail("MCP server not found", 102)
    return ok({"id": row["id"], "name": row["name"], "url": row["url"], "transport": row["transport"], "enabled": bool(row["enabled"]), "status": "unknown", "tools": _list(row["tools"])})


@app.put("/api/v1/mcp/servers/{server_id}")
@app.patch("/api/v1/mcp/servers/{server_id}")
async def mcp_update(server_id: str, request: Request):
    payload = await body(request)
    sets, args = [], []
    for key in ("name", "url", "transport"):
        if payload.get(key) is not None:
            sets.append(f"{key} = ?")
            args.append(payload[key])
    if payload.get("enabled") is not None:
        sets.append("enabled = ?")
        args.append(1 if payload["enabled"] else 0)
    if sets:
        args.append(server_id)
        x(f"UPDATE mcp_server SET {', '.join(sets)} WHERE id = ?", tuple(args))
    return ok(True)


@app.delete("/api/v1/mcp/servers/{server_id}")
async def mcp_delete(server_id: str):
    x("DELETE FROM mcp_server WHERE id = ?", (server_id,))
    return ok(True)


@app.get("/api/v1/memories")
async def memories_list(request: Request):
    rows = access.in_workspace(actor_of(request), q("SELECT * FROM memory ORDER BY create_time"))
    return ok(
        [
            {
                "id": r["id"],
                "name": r["name"],
                "description": r["description"] or "",
                "memory_type": jloads(r["config"], {}).get("memory_type", "semantic"),
                "message_count": 0,
                "storage_type": jloads(r["config"], {}).get("storage_type", "vector"),
                "create_time": r["create_time"],
            }
            for r in rows
        ]
    )


@app.post("/api/v1/memories")
async def memory_create(request: Request):
    payload = await body(request)
    mem_id = new_id("mem")
    x(
        "INSERT INTO memory (id, tenant_id, name, description, config, create_time, update_time)"
        " VALUES (?,?,?,?,?,?,?)",
        (mem_id, access.tenant_of(actor_of(request)), str(payload.get("name") or "New memory"), str(payload.get("description") or ""), jdumps({"memory_type": payload.get("memory_type") or "semantic", "storage_type": payload.get("storage_type") or "vector"}), now_ms(), now_ms()),
    )
    return ok({"id": mem_id, "name": payload.get("name") or "New memory", "description": payload.get("description") or "", "memory_type": payload.get("memory_type") or "semantic", "message_count": 0, "storage_type": payload.get("storage_type") or "vector", "create_time": now_ms()})


@app.get("/api/v1/memories/{memory_id}")
async def memory_detail(memory_id: str):
    row = one("SELECT * FROM memory WHERE id = ?", (memory_id,))
    if not row:
        return fail("Memory not found", 102)
    config = jloads(row["config"], {})
    return ok({"id": row["id"], "name": row["name"], "description": row["description"], "memory_type": config.get("memory_type", "semantic"), "message_count": 0, "storage_type": config.get("storage_type", "vector"), "create_time": row["create_time"]})


@app.put("/api/v1/memories/{memory_id}")
@app.patch("/api/v1/memories/{memory_id}")
async def memory_update(memory_id: str, request: Request):
    payload = await body(request)
    sets, args = [], []
    for key in ("name", "description"):
        if payload.get(key) is not None:
            sets.append(f"{key} = ?")
            args.append(payload[key])
    if sets:
        sets.append("update_time = ?")
        args.extend([now_ms(), memory_id])
        x(f"UPDATE memory SET {', '.join(sets)} WHERE id = ?", tuple(args))
    return ok(True)


@app.delete("/api/v1/memories/{memory_id}")
async def memory_delete(memory_id: str):
    x("DELETE FROM memory WHERE id = ?", (memory_id,))
    return ok(True)


@app.get("/api/v1/memories/{memory_id}/config")
async def memory_config(memory_id: str):
    row = one("SELECT config FROM memory WHERE id = ?", (memory_id,))
    return ok(jloads(row["config"], {}) if row else {})


@app.get("/api/v1/files")
async def files_list(request: Request):
    rows = access.in_workspace(actor_of(request), q("SELECT * FROM file ORDER BY update_time DESC"))
    return ok(
        [
            {
                "id": r["id"],
                "name": r["name"],
                "size": r["size"],
                "type": r["type"],
                "location": r["location"],
                "dataset_id": r["dataset_id"],
                "version": r["version"],
                "create_time": r["create_time"],
                "update_time": r["update_time"],
            }
            for r in rows
        ]
    )


@app.post("/api/v1/files")
async def files_upload(request: Request):
    payload = await body(request)
    file_id = new_id("file")
    x(
        "INSERT INTO file (id, tenant_id, name, size, type, location, dataset_id, version, create_time, update_time)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        (file_id, access.tenant_of(actor_of(request)), str(payload.get("name") or "untitled"), int(payload.get("size") or 0), str(payload.get("type") or "txt"), str(payload.get("location") or ""), payload.get("dataset_id"), 1, now_ms(), now_ms()),
    )
    return ok({"id": file_id, "name": payload.get("name") or "untitled"})


@app.post("/api/v1/files/link-to-datasets")
async def files_link():
    return ok(True)


@app.post("/api/v1/files/move")
async def files_move(request: Request):
    payload = await body(request)
    if payload.get("file_id") and payload.get("dataset_id"):
        x("UPDATE file SET dataset_id = ?, update_time = ? WHERE id = ?", (payload["dataset_id"], now_ms(), payload["file_id"]))
    return ok(True)


@app.get("/api/v1/workspace-files/{file_id}/versions")
async def file_versions(file_id: str):
    row = one("SELECT * FROM file WHERE id = ?", (file_id,))
    if not row:
        return ok([])
    return ok([{"id": f"v{row['version']}", "version": row["version"], "create_time": row["update_time"], "name": row["name"]}])


@app.get("/api/v1/searches")
async def searches_list():
    return ok([])


@app.post("/api/v1/searches")
async def searches_create():
    return fail("Saved search apps are not part of the local engine", 102)


@app.get("/api/v1/chat-channels")
async def chat_channels():
    return ok([])


@app.post("/api/v1/tasks/{task_id}/cancel")
async def task_cancel(task_id: str):
    row = one("SELECT * FROM task WHERE id = ?", (task_id,))
    if row:
        x("UPDATE task SET status = 'cancelled', update_time = ? WHERE id = ?", (now_ms(), task_id))
    return ok(True)


@app.get("/v1/{rest:path}")
async def compat_prefix(rest: str):
    """The console's canvas helpers call `/v1/*`; nothing there is modelled yet."""
    return fail(f"/v1/{rest} is not implemented in the local engine", 102)


def _int(value: str, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


# --------------------------------------------------------------------- built console

# Optional: when `web/dist` exists, this process serves the product too, so going live does not
# require a second web server. The catch-all is registered last, and refuses to answer for API
# paths so a mistyped endpoint is a 404 rather than a page of HTML.
_DIST = pathlib.Path(__file__).resolve().parents[2] / "web" / "dist"

if _DIST.is_dir():

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith(("api/", "v1/", "openapi.json", "redoc", "docs")):
            return JSONResponse(status_code=404, content=fail("Not found", 404))
        candidate = (_DIST / full_path).resolve()
        if full_path and str(candidate).startswith(str(_DIST)) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")

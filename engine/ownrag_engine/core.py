"""
OwnRAG engine — configuration, storage and shared helpers.

This is a second, self-contained implementation of the OwnRAG HTTP contract (the same paths
`web/src/api/endpoints.ts` calls and the same `{code, data, message, total}` envelope the
preserved Go backend uses). It exists so a single machine with no container runtime can run a
real RAG pipeline: real parsing, real chunking, a real inverted index+vector index, real search.

The upstream Go backend remains the production engine; this one is documented as the
local engine. Nothing here is imported by the backend.

Modified for OwnRAG from the upstream Apache-2.0 project; see NOTICE for attribution.
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import sqlite3
import threading
import time
import uuid

ENGINE_VERSION = "0.1.0"
ROOT = pathlib.Path(__file__).resolve().parents[1]  # engine/


def _load_env(path: pathlib.Path) -> None:
    """Minimal .env loader so the engine needs no python-dotenv dependency."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env(ROOT / ".env")

DATA_DIR = pathlib.Path(os.environ.get("OWNRAG_DATA_DIR") or str(ROOT / "data")).expanduser()
FILES_DIR = DATA_DIR / "files"
DB_PATH = DATA_DIR / "ownrag.db"

HOST = os.environ.get("OWNRAG_HOST", "127.0.0.1")
PORT = int(os.environ.get("OWNRAG_PORT", "9380"))

# CORS: the console is served from its own dev/preview origin, so only those origins may call the
# API from a browser. Override with a comma-separated list when the console lives elsewhere. Auth
# is a Bearer header, never a cookie, so credentials are deliberately not allowed.
CORS_ORIGINS = [
    origin.strip()
    for origin in (os.environ.get("OWNRAG_CORS_ORIGINS") or "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]

# A bind anywhere but loopback makes the API reachable by other hosts. On loopback the owner signs
# in one-click with no password by design; off loopback a missing owner password must stop the
# process rather than expose the workspace (see `assert_public_bind_is_secured`).
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "0:0:0:0:0:0:0:1"}


def is_loopback_host(host: str) -> bool:
    return str(host or "").strip().lower() in LOOPBACK_HOSTS

# Bring your own models. Both are optional: without them the engine uses its built-in lexical
# vectors and an extractive answer builder, and says so in every answer it produces.
EMBEDDING_BASE_URL = os.environ.get("OWNRAG_EMBEDDING_BASE_URL", "").rstrip("/")
EMBEDDING_API_KEY = os.environ.get("OWNRAG_EMBEDDING_API_KEY", "")
EMBEDDING_MODEL = os.environ.get("OWNRAG_EMBEDDING_MODEL", "")
LLM_BASE_URL = os.environ.get("OWNRAG_LLM_BASE_URL", "").rstrip("/")
LLM_API_KEY = os.environ.get("OWNRAG_LLM_API_KEY", "")
LLM_MODEL = os.environ.get("OWNRAG_LLM_MODEL", "")

LOCAL_DIM = int(os.environ.get("OWNRAG_LOCAL_EMBED_DIM", "768"))


# --- what the operator configured in the console ------------------------------------------------
# The console writes providers, their API bases and their enabled models into this database. That
# is the operator's explicit choice, so it takes precedence over the deployment-level environment
# when both exist. A stored model only counts when its provider has an API base to call.


# What the console offers when adding a provider, and how THIS engine would reach it.
#
# - `engine: "openai"` — the vendor serves the OpenAI HTTP API this engine calls, so a provider
#   added here really answers questions. A base_url means the address is well known and can be
#   filled in for you; a blank one means it carries account-specific parts (Azure's resource name,
#   a self-hosted gateway) and has to be typed by whoever owns the deployment.
# - `engine: "go"` — the provider is served by a native driver in the preserved Go backend
#   (internal/entity/models/*.go), whose API shape this local engine does not speak. Listed so the
#   console shows the full set rather than pretending only four vendors exist, and labelled so
#   nobody adds one expecting answers from an endpoint that cannot be called.
PROVIDER_CATALOG: list[dict] = [
    {"name": "openai", "label": "OpenAI", "base_url": "https://api.openai.com/v1", "engine": "openai"},
    {"name": "deepseek", "label": "DeepSeek", "base_url": "https://api.deepseek.com/v1", "engine": "openai"},
    {"name": "openrouter", "label": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "engine": "openai"},
    {"name": "groq", "label": "Groq", "base_url": "https://api.groq.com/openai/v1", "engine": "openai"},
    {"name": "mistral", "label": "Mistral AI", "base_url": "https://api.mistral.ai/v1", "engine": "openai"},
    {"name": "xai", "label": "xAI", "base_url": "https://api.x.ai/v1", "engine": "openai"},
    {"name": "together", "label": "Together AI", "base_url": "https://api.together.xyz/v1", "engine": "openai"},
    {"name": "fireworks", "label": "Fireworks AI", "base_url": "https://api.fireworks.ai/inference/v1", "engine": "openai"},
    {"name": "moonshot", "label": "Moonshot (Kimi)", "base_url": "https://api.moonshot.cn/v1", "engine": "openai"},
    {"name": "zhipu", "label": "Zhipu GLM", "base_url": "https://open.bigmodel.cn/api/paas/v4", "engine": "openai"},
    {"name": "siliconflow", "label": "SiliconFlow", "base_url": "https://api.siliconflow.cn/v1", "engine": "openai"},
    {"name": "perplexity", "label": "Perplexity", "base_url": "https://api.perplexity.ai", "engine": "openai"},
    {"name": "nvidia", "label": "NVIDIA NIM", "base_url": "https://integrate.api.nvidia.com/v1", "engine": "openai"},
    {"name": "upstage", "label": "Upstage", "base_url": "https://api.upstage.ai/v1", "engine": "openai"},
    {"name": "voyage", "label": "Voyage AI", "base_url": "https://api.voyageai.com/v1", "engine": "openai",
     "note": "Embeddings and reranking — no chat models."},
    {"name": "jina", "label": "Jina AI", "base_url": "https://api.jina.ai/v1", "engine": "openai",
     "note": "Embeddings and reranking — no chat models."},
    {"name": "ollama", "label": "Ollama", "base_url": "http://127.0.0.1:11434/v1", "engine": "openai",
     "note": "Runs on this machine. No API key needed."},
    {"name": "vllm", "label": "vLLM", "base_url": "http://127.0.0.1:8000/v1", "engine": "openai",
     "note": "Self-hosted. Point the base at your own server."},
    {"name": "lmstudio", "label": "LM Studio", "base_url": "http://127.0.0.1:1234/v1", "engine": "openai",
     "note": "Runs on this machine. No API key needed."},
    {"name": "localai", "label": "LocalAI", "base_url": "http://127.0.0.1:8080/v1", "engine": "openai",
     "note": "Self-hosted. Point the base at your own server."},
    {"name": "xinference", "label": "Xinference", "base_url": "http://127.0.0.1:9997/v1", "engine": "openai",
     "note": "Self-hosted. Point the base at your own server."},
    {"name": "azure", "label": "Azure OpenAI", "base_url": "", "engine": "openai",
     "note": "Your deployment's endpoint carries the resource name, so it has to be typed."},
    {"name": "minimax", "label": "MiniMax", "base_url": "", "engine": "openai",
     "note": "OpenAI-compatible — paste the base URL from your account."},
    {"name": "baichuan", "label": "Baichuan", "base_url": "", "engine": "openai",
     "note": "OpenAI-compatible — paste the base URL from your account."},
    {"name": "stepfun", "label": "StepFun", "base_url": "", "engine": "openai",
     "note": "OpenAI-compatible — paste the base URL from your account."},
    {"name": "volcengine", "label": "Volcengine Ark", "base_url": "", "engine": "openai",
     "note": "OpenAI-compatible — paste the base URL from your account."},
    {"name": "custom", "label": "Any OpenAI-compatible endpoint", "base_url": "", "engine": "openai",
     "note": "A gateway, a proxy, or a vendor not listed here."},
    {"name": "anthropic", "label": "Anthropic", "base_url": "", "engine": "go",
     "note": "Speaks its own Messages API; the Go backend has the driver for it."},
    {"name": "google", "label": "Google Gemini", "base_url": "", "engine": "go",
     "note": "The Go backend has the driver; Gemini also offers an OpenAI-compatible base."},
    {"name": "bedrock", "label": "AWS Bedrock", "base_url": "", "engine": "go",
     "note": "Signed with AWS credentials — only the Go backend's driver calls it."},
    {"name": "aliyun", "label": "Alibaba Cloud Bailian", "base_url": "", "engine": "go"},
    {"name": "baidu", "label": "Baidu Qianfan", "base_url": "", "engine": "go"},
    {"name": "cohere", "label": "Cohere", "base_url": "", "engine": "go"},
    {"name": "replicate", "label": "Replicate", "base_url": "", "engine": "go"},
    {"name": "novita", "label": "Novita AI", "base_url": "", "engine": "go"},
    {"name": "ppio", "label": "PPIO", "base_url": "", "engine": "go"},
    {"name": "deepinfra", "label": "DeepInfra", "base_url": "", "engine": "go"},
    {"name": "302ai", "label": "302.AI", "base_url": "", "engine": "go"},
    {"name": "cometapi", "label": "CometAPI", "base_url": "", "engine": "go"},
    {"name": "apiroute", "label": "APIRoute", "base_url": "", "engine": "go"},
    {"name": "qiniu", "label": "Qiniu", "base_url": "", "engine": "go"},
    {"name": "tokenhub", "label": "TokenHub", "base_url": "", "engine": "go"},
    {"name": "modelscope", "label": "ModelScope", "base_url": "", "engine": "go"},
    {"name": "gitee", "label": "Gitee AI", "base_url": "", "engine": "go"},
    {"name": "astraflow", "label": "Astraflow", "base_url": "", "engine": "go"},
    {"name": "anonrouter", "label": "AnonRouter", "base_url": "", "engine": "go"},
    {"name": "avian", "label": "Avian", "base_url": "", "engine": "go"},
    {"name": "cheaperinference", "label": "CheaperInference", "base_url": "", "engine": "go"},
    {"name": "daoxe", "label": "Daoxe", "base_url": "", "engine": "go"},
    {"name": "futurmix", "label": "Futurmix", "base_url": "", "engine": "go"},
    {"name": "greenpt", "label": "GreenPT", "base_url": "", "engine": "go"},
    {"name": "mws", "label": "MWS", "base_url": "", "engine": "go"},
    {"name": "n1n", "label": "N1N", "base_url": "", "engine": "go"},
    {"name": "orcarouter", "label": "OrcaRouter", "base_url": "", "engine": "go"},
    {"name": "synthorai", "label": "Synthorai", "base_url": "", "engine": "go"},
    {"name": "tokenpony", "label": "TokenPony", "base_url": "", "engine": "go"},
    {"name": "ragcon", "label": "RAGCon", "base_url": "", "engine": "go"},
    {"name": "gpustack", "label": "GPUStack", "base_url": "", "engine": "openai",
     "note": "Self-hosted and OpenAI-compatible — point the base at your GPUStack server."},
    {"name": "monkeyocrv2", "label": "MonkeyOCR (vision)", "base_url": "", "engine": "go"},
    {"name": "fishaudio", "label": "Fish Audio (speech)", "base_url": "", "engine": "go"},
    {"name": "funasr", "label": "FunASR (speech)", "base_url": "", "engine": "go"},
    {"name": "paddleocr", "label": "PaddleOCR (vision)", "base_url": "", "engine": "go"},
]

# One source of truth: a provider's well-known address, used both by the console's picker and by
# the resolver when the operator leaves the API base blank.
KNOWN_BASE_URLS = {
    entry["name"]: entry["base_url"] for entry in PROVIDER_CATALOG if entry["base_url"]
}

# The provider the engine serves itself. Its models run in-process, so they have no address to call —
# which is not the same as being unconfigured.
BUILTIN_PROVIDER = "ownrag-local"


def test_provider_names() -> set[str]:
    """Names of providers a test harness registered (`origin = "test"`).

    Tolerates a database that predates the column (the migration runs at startup), in which case
    nothing is test-only yet.
    """
    try:
        return {str(row["name"]) for row in q("SELECT name FROM provider WHERE origin = 'test'")}
    except sqlite3.OperationalError:
        return set()


def active_model(kind: str, preferred: str = "", tenant: str = "") -> dict | None:
    """The enabled model this deployment should use for `kind`.

    `preferred` is the model an assistant pinned, in the API's `model@provider` form. It wins when it is
    enabled and usable, so choosing a model in the console's chat settings decides who answers. Otherwise
    the engine's own model answers: a registered provider is used only when an assistant pins one, because
    registration alone must not capture the chat slot.

    `tenant` is the workspace asking. An external provider belongs to the workspace that added it, so a
    chat in one workspace can never be answered — and billed — through another workspace's key.
    """
    rows = q(
        "SELECT pm.model AS model, pm.kind AS kind, p.name AS provider, p.tenant_id AS tenant_id,"
        " p.base_url AS base_url, p.api_key AS api_key"
        " FROM provider_model pm JOIN provider p ON p.id = pm.provider_id"
        " WHERE pm.kind = ? AND pm.enabled = 1"
        " ORDER BY pm.create_time DESC",
        (kind,),
    )
    usable: list[dict] = []
    for row in rows:
        entry = dict(row)
        entry["base_url"] = entry["base_url"] or KNOWN_BASE_URLS.get(str(entry["provider"]).lower(), "")
        # The engine's own provider serves its models in-process: having no address to call is not the
        # same as not being configured. Requiring one silently disqualified the local model and left the
        # only registered external provider as the answering model for every chat in every workspace.
        entry["in_process"] = str(entry["provider"]) == BUILTIN_PROVIDER
        if not entry["base_url"] and not entry["in_process"]:
            continue
        # An external provider serves the workspace that added it.
        if tenant and not entry["in_process"] and str(entry["tenant_id"] or "") != tenant:
            continue
        usable.append(entry)
    if not usable:
        return None
    if preferred:
        wanted, _, provider = preferred.partition("@")
        # The seeded assistant stores the mode string ("llm:<model>"); accept it as a model name too.
        wanted = wanted[4:] if wanted.startswith("llm:") else wanted
        for entry in usable:
            if entry["model"] in {preferred, wanted} and (not provider or entry["provider"] == provider):
                return entry
    # A model a test registered must never quietly become the deployment's answering model. For the
    # chat slot (what actually answers questions) providers flagged `origin = "test"` are skipped
    # for auto-selection and used only when a caller explicitly pins them. Embeddings keep their
    # normal order, because an assistant cannot pin an encoder and the ingest path must stay
    # exercisable end to end.
    pool = usable
    if kind == "chat":
        test_only = test_provider_names()
        if test_only:
            pool = [entry for entry in usable if str(entry["provider"]) not in test_only]
        # The engine's own model answers unless an assistant pins a model: it needs no key, no network and
        # cannot fail. Registering a provider must not silently move every chat onto it — the same hazard
        # the `origin = "test"` exclusion above exists for, and it just cost every workspace its answers.
        own = [entry for entry in pool if entry["in_process"]]
        if own:
            return own[0]
    return pool[0] if pool else None


def fallback_reason() -> str:
    """Why answers are not being generated, when the reason is a switched-off model.

    A provider with every model disabled looks exactly like "the provider is not connecting", so the
    extractive note says which provider it is instead of leaving the user to guess.
    """
    rows = q(
        "SELECT p.name AS provider, pm.enabled AS enabled FROM provider_model pm"
        " JOIN provider p ON p.id = pm.provider_id WHERE pm.kind = 'chat'"
    )
    if any(row["enabled"] for row in rows):
        return ""
    names = sorted({str(row["provider"]) for row in rows if str(row["provider"]) != "ownrag-local"})
    if not names:
        return ""
    return (
        f" A chat model is registered for {', '.join(names)} but every one of its models is switched"
        " off — turn one on under Models, or press Fetch models there."
    )


def discover_models(base_url: str, api_key: str = "", timeout: int = 20) -> list[str]:
    """The model ids an OpenAI-compatible endpoint advertises.

    Best effort on purpose: an endpoint that does not answer ``/models`` is not an error — it only
    means a name has to be entered by hand. Linking a provider is the user's whole intent, so the
    engine asks the provider what it serves instead of leaving the model list empty.
    """
    import requests  # local: core stays importable without the HTTP client

    if not base_url:
        return []
    try:
        response = requests.get(
            f"{base_url.rstrip('/')}/models",
            headers={"Authorization": f"Bearer {api_key}"} if api_key else {},
            timeout=timeout,
        )
        if response.status_code != 200:
            return []
        body = response.json()
    except Exception:
        return []
    entries = body.get("data") if isinstance(body, dict) else body
    if not isinstance(entries, list):
        return []
    ids: list[str] = []
    for entry in entries:
        model = (entry.get("id") or entry.get("name")) if isinstance(entry, dict) else entry
        if model and str(model) not in ids:
            ids.append(str(model))
    return ids


def resolve_llm(preferred: str = "", tenant: str = "") -> dict:
    """Where answers come from: the model this assistant pinned, else the engine's own model, else the
    environment, else the extractive builder. Returns the mode to attribute the answer to."""
    row = active_model("chat", preferred, tenant)
    # The engine's own chat model *is* the extractive builder: there is no endpoint to call, and naming it
    # as the author is what keeps the assistant's stored label honest.
    if row and not row.get("in_process"):
        return {
            "mode": f"llm:{row['model']}",
            "base_url": row["base_url"],
            "api_key": row["api_key"],
            "model": row["model"],
            "source": str(row["provider"]),
        }
    if LLM_BASE_URL and LLM_MODEL:
        return {
            "mode": f"llm:{LLM_MODEL}",
            "base_url": LLM_BASE_URL,
            "api_key": LLM_API_KEY,
            "model": LLM_MODEL,
            "source": "environment",
        }
    return {"mode": "extractive", "base_url": "", "api_key": "", "model": "", "source": ""}


def resolve_embedding() -> dict:
    """The embedding endpoint to use, or empty values for the built-in lexical vectors."""
    row = active_model("embedding")
    # The engine's own encoder is the lexical one, in-process. Returning its row would report a remote
    # "semantic" mode that does not exist, so the in-process case resolves to empty values — which is
    # exactly what `retrieval.vector_kind`/`embed_texts` test for to pick the local vectors.
    if row and not row.get("in_process"):
        return {
            "base_url": row["base_url"],
            "api_key": row["api_key"],
            "model": row["model"],
            "source": str(row["provider"]),
        }
    if EMBEDDING_BASE_URL and EMBEDDING_MODEL:
        return {
            "base_url": EMBEDDING_BASE_URL,
            "api_key": EMBEDDING_API_KEY,
            "model": EMBEDDING_MODEL,
            "source": "environment",
        }
    return {"base_url": "", "api_key": "", "model": "", "source": ""}
CHUNK_SIZE = int(os.environ.get("OWNRAG_CHUNK_SIZE", "512"))
CHUNK_OVERLAP = int(os.environ.get("OWNRAG_CHUNK_OVERLAP", "80"))

OWNER_EMAIL = os.environ.get("OWNRAG_OWNER_EMAIL", "owner@ownrag.local")
OWNER_PASSWORD = os.environ.get("OWNRAG_OWNER_PASSWORD", "")
TENANT_ID = "tenant_ownrag"
OWNER_ID = "user_owner"


def assert_public_bind_is_secured(host: str = HOST, password: str = OWNER_PASSWORD) -> None:
    """Refuse to serve on a non-loopback address without an owner password.

    Loopback is the owner's own machine: the console signs in one-click with no password by design.
    Any other bind is reachable from the network, so an empty password must abort startup rather
    than leave every knowledge base open to whoever can reach the port.
    """
    if is_loopback_host(host):
        return
    if not str(password or "").strip():
        raise RuntimeError(
            f"refusing to bind {host} without an owner password — set OWNRAG_OWNER_PASSWORD in "
            "engine/.env (or bind OWNRAG_HOST to 127.0.0.1 for local use)."
        )

SCHEMA = """
CREATE TABLE IF NOT EXISTS tenant (
  id TEXT PRIMARY KEY, name TEXT, create_time INTEGER
);
CREATE TABLE IF NOT EXISTS team_invite (
  id TEXT PRIMARY KEY, tenant_id TEXT, email TEXT, role TEXT DEFAULT 'member',
  token_hash TEXT UNIQUE, invited_by TEXT, create_time INTEGER, expires_at INTEGER,
  status TEXT DEFAULT 'pending', accepted_by TEXT, accepted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_invite_tenant ON team_invite (tenant_id);
CREATE TABLE IF NOT EXISTS team_invite (
  id TEXT PRIMARY KEY, tenant_id TEXT, email TEXT, role TEXT DEFAULT 'member',
  token_hash TEXT UNIQUE, invited_by TEXT, create_time INTEGER, expires_at INTEGER,
  status TEXT DEFAULT 'pending', accepted_by TEXT, accepted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_invite_tenant ON team_invite (tenant_id);
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY, email TEXT UNIQUE, password TEXT, nickname TEXT, avatar TEXT,
  tenant_id TEXT, is_admin INTEGER DEFAULT 1, language TEXT DEFAULT 'en', create_time INTEGER
);
CREATE TABLE IF NOT EXISTS api_token (
  id TEXT PRIMARY KEY, tenant_id TEXT, token TEXT UNIQUE, name TEXT,
  create_time INTEGER, last_used INTEGER, user_id TEXT, expires_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, at INTEGER, event TEXT, email TEXT, ip TEXT, detail TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at);
CREATE TABLE IF NOT EXISTS dataset (
  id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, description TEXT DEFAULT '', avatar TEXT,
  language TEXT DEFAULT 'en', embedding_model TEXT, chunk_method TEXT DEFAULT 'naive',
  parser_config TEXT DEFAULT '{}', similarity_threshold REAL DEFAULT 0.2,
  vector_similarity_weight REAL DEFAULT 0.3, top_k INTEGER DEFAULT 1024,
  rerank_model TEXT, permission TEXT DEFAULT 'me', created_by TEXT,
  create_time INTEGER, update_time INTEGER, status TEXT DEFAULT '1', tags TEXT DEFAULT '[]',
  document_count INTEGER DEFAULT 0, chunk_count INTEGER DEFAULT 0, token_count INTEGER DEFAULT 0,
  pagerank INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS document (
  id TEXT PRIMARY KEY, dataset_id TEXT, name TEXT, location TEXT, type TEXT, size INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0, token_count INTEGER DEFAULT 0, progress REAL DEFAULT 0,
  progress_msg TEXT DEFAULT '', run TEXT DEFAULT 'UNSTART', parser_id TEXT DEFAULT 'naive',
  parser_config TEXT DEFAULT '{}', source_type TEXT DEFAULT 'local', created_by TEXT,
  create_time INTEGER, update_time INTEGER, thumbnail TEXT, meta_fields TEXT DEFAULT '{}',
  page_count INTEGER DEFAULT 0, text_path TEXT, error TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS chunk (
  id TEXT PRIMARY KEY, dataset_id TEXT, document_id TEXT, idx INTEGER, content_with_weight TEXT,
  content_ltks TEXT, important_kwd TEXT DEFAULT '[]', question_kwd TEXT DEFAULT '[]',
  available_int INTEGER DEFAULT 1, positions TEXT DEFAULT '[]', token_count INTEGER DEFAULT 0,
  page INTEGER DEFAULT 1, vector BLOB, vec_kind TEXT, create_time INTEGER,
  source TEXT DEFAULT 'native', bbox TEXT DEFAULT '', quarantine TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS token_index (
  dataset_id TEXT, token TEXT, chunk_id TEXT, tf INTEGER
);
CREATE INDEX IF NOT EXISTS idx_token_index ON token_index (dataset_id, token);
CREATE INDEX IF NOT EXISTS idx_chunk_doc ON chunk (document_id);
CREATE INDEX IF NOT EXISTS idx_chunk_ds ON chunk (dataset_id);
CREATE TABLE IF NOT EXISTS chat (
  id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, description TEXT DEFAULT '',
  dataset_ids TEXT DEFAULT '[]', llm TEXT DEFAULT '{}', prompt TEXT DEFAULT '{}',
  similarity_threshold REAL DEFAULT 0.2, vector_similarity_weight REAL DEFAULT 0.3,
  top_k INTEGER DEFAULT 6, rerank_model TEXT, create_time INTEGER, update_time INTEGER
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY, chat_id TEXT, name TEXT, create_time INTEGER, update_time INTEGER
);
CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, reference TEXT DEFAULT '[]',
  feedback TEXT, create_time INTEGER
);
CREATE TABLE IF NOT EXISTS agent (
  id TEXT PRIMARY KEY, tenant_id TEXT, title TEXT, description TEXT DEFAULT '', dsl TEXT,
  tags TEXT DEFAULT '[]', status TEXT DEFAULT 'draft', run_count INTEGER DEFAULT 0,
  create_time INTEGER, update_time INTEGER
);
CREATE TABLE IF NOT EXISTS agent_version (
  id TEXT PRIMARY KEY, agent_id TEXT, title TEXT, dsl TEXT, create_time INTEGER
);
CREATE TABLE IF NOT EXISTS agent_log (
  id TEXT PRIMARY KEY, agent_id TEXT, status TEXT, elapsed REAL, message TEXT, create_time INTEGER
);
CREATE TABLE IF NOT EXISTS provider (
  id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT UNIQUE, label TEXT, kind TEXT DEFAULT 'chat',
  base_url TEXT DEFAULT '', api_key TEXT DEFAULT '', status TEXT DEFAULT 'configured',
  create_time INTEGER, update_time INTEGER, origin TEXT DEFAULT 'console'
);
CREATE TABLE IF NOT EXISTS provider_model (
  id TEXT PRIMARY KEY, provider_id TEXT, model TEXT, kind TEXT DEFAULT 'chat',
  enabled INTEGER DEFAULT 1, context_length INTEGER DEFAULT 8192, max_output INTEGER DEFAULT 2048,
  create_time INTEGER, UNIQUE (provider_id, model, kind)
);
CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, description TEXT DEFAULT '', config TEXT DEFAULT '{}',
  create_time INTEGER, update_time INTEGER
);
CREATE TABLE IF NOT EXISTS mcp_server (
  id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, url TEXT, transport TEXT DEFAULT 'sse',
  tools TEXT DEFAULT '[]', enabled INTEGER DEFAULT 1, create_time INTEGER
);
CREATE TABLE IF NOT EXISTS connector (
  id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, type TEXT, config TEXT DEFAULT '{}',
  status TEXT DEFAULT 'idle', last_sync INTEGER, create_time INTEGER,
  schedule TEXT DEFAULT '', documents_synced INTEGER DEFAULT 0, message TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS connector_log (
  id TEXT PRIMARY KEY, connector_id TEXT, status TEXT, message TEXT, create_time INTEGER
);
CREATE TABLE IF NOT EXISTS file (
  id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, size INTEGER, type TEXT, location TEXT,
  dataset_id TEXT, version INTEGER DEFAULT 1, create_time INTEGER, update_time INTEGER
);
CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY, name TEXT, type TEXT, status TEXT DEFAULT 'running', progress REAL DEFAULT 0,
  message TEXT DEFAULT '', create_time INTEGER, update_time INTEGER
);
CREATE TABLE IF NOT EXISTS ingestion_log (
  id TEXT PRIMARY KEY, dataset_id TEXT, document_id TEXT, document_name TEXT, status TEXT,
  message TEXT, elapsed REAL, create_time INTEGER, operation TEXT DEFAULT 'parse'
);
"""

_conn: "sqlite3.Connection | None" = None
# Ingestion runs in worker threads while the console polls progress, so every statement goes
# through one lock. SQLite serialises writes anyway; this keeps the shared connection honest.
_LOCK = threading.RLock()


# How long a write waits for another writer before giving up. A lock held for a moment is a pause,
# not an error; the default five seconds was short enough that a second connection doing a slow write
# could fail a request outright.
BUSY_TIMEOUT_SECONDS = 15.0


def connect() -> sqlite3.Connection:
    """One shared connection; FastAPI runs handlers on a threadpool, so allow cross-thread use."""
    global _conn
    if _conn is None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        FILES_DIR.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=BUSY_TIMEOUT_SECONDS)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA synchronous=NORMAL")
        _conn.execute(f"PRAGMA busy_timeout={int(BUSY_TIMEOUT_SECONDS * 1000)}")
        _conn.commit()
    return _conn


def q(sql: str, args: tuple = ()) -> list[sqlite3.Row]:
    with _LOCK:
        return connect().execute(sql, args).fetchall()


def one(sql: str, args: tuple = ()) -> sqlite3.Row | None:
    rows = q(sql, args)
    return rows[0] if rows else None


def _write(run) -> None:
    """Run one write on the shared connection and leave that connection clean whatever happens.

    A failed write can leave the implicit transaction open; without the rollback the next request
    inherits a broken transaction, so a single locked write used to take the engine down until it was
    restarted — every later request, sign-in included, answered 500.
    """
    with _LOCK:
        conn = connect()
        try:
            run(conn)
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def x(sql: str, args: tuple = ()) -> None:
    _write(lambda conn: conn.execute(sql, args))


def xmany(sql: str, rows: list[tuple]) -> None:
    _write(lambda conn: conn.executemany(sql, rows))


def jloads(raw: str | None, fallback):
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return fallback


def jdumps(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def model_mode(tenant: str = "") -> dict:
    """What is actually wired up, reported to the console instead of quietly pretending.

    Resolved per call, so flipping a switch in the console is reflected on the next read rather
    than the next restart."""
    embedding = resolve_embedding()
    llm = resolve_llm("", tenant)
    return {
        "embeddings": f"semantic:{embedding['model']}" if embedding["model"] else "lexical-built-in",
        "generation": llm["mode"] if llm["mode"] != "extractive" else "extractive-built-in",
        "rerank": "lexical-built-in",
    }


TOKEN_RE = re.compile(r"[a-z0-9\u0600-\u06FF]+")
_AR_DIACRITICS = re.compile(r"[\u0617-\u061A\u064B-\u0652\u0670\u0640]")
_AR_NORMALISE = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي", "ؤ": "و", "ئ": "ي"})


def normalise(text: str) -> str:
    return text.lower().translate(_AR_NORMALISE)


def tokenize(text: str) -> list[str]:
    """Latin + Arabic aware. Arabic diacritics and alef/teh-marbuta variants are folded so
    'الأجور' and 'الاجور' match, which matters for the Arabic corpora this engine is used on."""
    return TOKEN_RE.findall(_AR_DIACRITICS.sub("", normalise(text)))


# Columns added after the first release. `init_db` applies whatever is missing, so an existing
# database is upgraded in place instead of crashing the first query that touches a new column.
MIGRATIONS: list[tuple[str, str, str]] = [
    # Assistants arrived without an owner, so a blank `created_by` belongs to nobody and only
    # managers see it. That keeps existing rows working without a data migration.
    ("chat", "created_by", "TEXT DEFAULT ''"),
    ("dataset", "document_count", "INTEGER DEFAULT 0"),
    # Roles arrived with workspace invitations. An old row keeps working: `team.role_of` derives a
    # role from `is_admin` while this column is empty, so the column needs no data migration.
    ("user", "role", "TEXT DEFAULT 'member'"),
    ("dataset", "chunk_count", "INTEGER DEFAULT 0"),
    ("dataset", "token_count", "INTEGER DEFAULT 0"),
    ("dataset", "pagerank", "INTEGER DEFAULT 0"),
    ("provider", "update_time", "INTEGER"),
    ("provider", "origin", "TEXT DEFAULT 'console'"),
    ("document", "page_count", "INTEGER DEFAULT 0"),
    ("document", "error", "TEXT DEFAULT ''"),
    ("chunk", "page", "INTEGER DEFAULT 1"),
    ("chunk", "vec_kind", "TEXT"),
    ("chunk", "source", "TEXT DEFAULT 'native'"),
    ("chunk", "bbox", "TEXT DEFAULT ''"),
    ("chunk", "quarantine", "TEXT DEFAULT ''"),
    ("connector", "schedule", "TEXT DEFAULT ''"),
    ("connector", "documents_synced", "INTEGER DEFAULT 0"),
    ("connector", "message", "TEXT DEFAULT ''"),
    # Accounts and sessions. `user.password` now holds a scrypt hash; a legacy plaintext row is
    # upgraded on the next successful sign-in (see ownrag_engine/auth.py).
    ("user", "last_login", "INTEGER DEFAULT 0"),
    ("user", "is_admin", "INTEGER DEFAULT 0"),
    ("api_token", "user_id", "TEXT"),
    ("api_token", "expires_at", "INTEGER DEFAULT 0"),
]


def _apply_migrations() -> None:
    conn = connect()
    for table, column, ddl in MIGRATIONS:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if not existing:
            continue  # the table itself is absent; executescript above owns creation
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
    conn.commit()


def init_db() -> None:
    # Lazy import: auth.py imports this module, so a top-level import here would be circular.
    from . import auth as _auth

    def _hash(value: str) -> str:
        return _auth.hash_password(value) if value else ""

    conn = connect()
    conn.executescript(SCHEMA)
    conn.commit()
    _apply_migrations()
    if not one("SELECT id FROM tenant WHERE id = ?", (TENANT_ID,)):
        x("INSERT INTO tenant (id, name, create_time) VALUES (?,?,?)", (TENANT_ID, "OwnRAG", now_ms()))
    if not one("SELECT id FROM user WHERE id = ?", (OWNER_ID,)):
        x(
            "INSERT INTO user (id, email, password, nickname, tenant_id, is_admin, role, create_time)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (OWNER_ID, OWNER_EMAIL, _hash(OWNER_PASSWORD), OWNER_EMAIL.split("@")[0], TENANT_ID, 1, "owner", now_ms()),
        )
    else:
        # Keep the owner row in step with engine/.env: setting (or clearing) OWNRAG_OWNER_PASSWORD
        # after the first run must take effect, otherwise a password could be configured while the
        # stored row stayed empty and sign-in would still be passwordless.
        owner = one("SELECT * FROM user WHERE id = ?", (OWNER_ID,))
        if owner is not None:
            if owner["email"] != OWNER_EMAIL:
                x("UPDATE user SET email = ? WHERE id = ?", (OWNER_EMAIL, OWNER_ID))
            # The configured owner is the workspace owner, whatever the row said before roles existed.
            if (owner["role"] if "role" in owner.keys() else None) != "owner":
                x("UPDATE user SET role = 'owner', is_admin = 1 WHERE id = ?", (OWNER_ID,))
            # The configured owner is the workspace owner, whatever the row said before roles existed.
            if (owner["role"] if "role" in owner.keys() else None) != "owner":
                x("UPDATE user SET role = 'owner', is_admin = 1 WHERE id = ?", (OWNER_ID,))
            # Keep the owner row in step with .env, comparing hashes rather than the configured
            # password: a legacy plaintext row is re-hashed here so no credential stays readable.
            stored = owner["password"] or ""
            if OWNER_PASSWORD and not stored.startswith("scrypt$"):
                x("UPDATE user SET password = ? WHERE id = ?", (_hash(OWNER_PASSWORD), OWNER_ID))
            elif OWNER_PASSWORD and not _auth.verify_password(stored, OWNER_PASSWORD)[0]:
                x("UPDATE user SET password = ? WHERE id = ?", (_hash(OWNER_PASSWORD), OWNER_ID))
    if not q("SELECT id FROM api_token LIMIT 1"):
        x(
            "INSERT INTO api_token (id, tenant_id, token, name, create_time, last_used) VALUES (?,?,?,?,?,?)",
            (
                new_id("tok"),
                TENANT_ID,
                "ownrag-" + uuid.uuid4().hex + uuid.uuid4().hex[:8],
                "Default workspace key",
                now_ms(),
                0,
            ),
        )

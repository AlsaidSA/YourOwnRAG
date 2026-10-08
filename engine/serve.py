"""
OwnRAG engine — entrypoint.

    python serve.py            # http://127.0.0.1:9380

Point the console's dev proxy (already wired in web/vite.config.ts) at this port and it runs as
the live backend: parse → chunk → index → retrieve → answer, all on this machine, no containers.
"""

from __future__ import annotations

import json
import sys

import uvicorn

from ownrag_engine.core import DB_PATH, HOST, PORT, assert_public_bind_is_secured, init_db, model_mode


def main() -> int:
    # Refuse to expose the engine off loopback without an owner password, before binding the port.
    try:
        assert_public_bind_is_secured()
    except RuntimeError as exc:
        print("=" * 78)
        print("  OwnRAG engine — refusing to start")
        print("=" * 78)
        print(f"  {exc}")
        print("=" * 78, flush=True)
        return 2
    # Create/upgrade the schema before reporting the resolved mode, so a first run against a fresh
    # data directory works instead of querying tables that do not exist yet.
    init_db()
    mode = model_mode()
    print("=" * 78)
    print("  OwnRAG engine — local")
    print("=" * 78)
    print(f"  listening   http://{HOST}:{PORT}")
    print(f"  data dir    {DB_PATH.parent}")
    print(f"  embeddings  {mode['embeddings']}")
    print(f"  generation  {mode['generation']}")
    if mode["embeddings"].startswith("lexical") or mode["generation"].startswith("extractive"):
        print("-" * 78)
        print("  Running without a model. Retrieval is real (BM25 + vector search over your own")
        print("  documents); answers are extractive, assembled from the retrieved passages.")
        print("  To generate answers instead, add a provider on the console's Models screen and")
        print("  enable a chat model there — it takes effect on the next question, no restart.")
        print("  engine/.env (OWNRAG_LLM_* / OWNRAG_EMBEDDING_*, see .env.example) still works as a")
        print("  deployment-level default when no provider is configured in the console.")
    print("=" * 78, flush=True)
    uvicorn.run("ownrag_engine.api:app", host=HOST, port=PORT, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())

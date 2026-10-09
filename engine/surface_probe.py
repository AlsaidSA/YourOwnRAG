"""What does a brand-new account see that the owner sees?

The invariant to test: an account that has created nothing must see an empty engine. Catalogs (the list
of connector *types*, agent templates) are not owned by anyone and are expected to be readable.
"""
from __future__ import annotations

import json
import pathlib
import sqlite3
import uuid

import requests

BASE = "http://127.0.0.1:9380/api/v1"
DB = pathlib.Path(__file__).resolve().parent / "data" / "ownrag.db"
OWNER = "owner@ownrag.local"

SURFACES = [
    ("data sources", "/connectors", "catalog"),
    ("source types (catalog)", "/connectors/sources", "catalog"),
    ("sync logs", "/connectors/sync_logs", "owned"),
    ("files", "/files", "owned"),
    ("MCP servers", "/mcp/servers", "owned"),
    ("agents", "/agents", "owned"),
    ("agent templates (catalog)", "/agents/templates", "catalog"),
    ("memory stores", "/memories", "owned"),
    # The engine's default model serves every workspace on purpose; a workspace's own configured models
    # are what the isolation suite checks.
    ("models", "/providers", "catalog"),
    ("API keys", "/system/tokens", "owned"),
    ("knowledge bases", "/datasets", "owned"),
    ("assistants", "/chats", "owned"),
    ("documents", "/documents", "owned"),
]


def call(method: str, path: str, token: str = "", payload=None):
    try:
        r = requests.request(method, BASE + path, json=payload, timeout=30,
                             headers={"Authorization": "Bearer " + token} if token else {})
    except Exception as exc:  # noqa: BLE001
        return 0, {"code": -1, "message": str(exc)[:60], "data": None}
    try:
        return r.status_code, r.json()
    except Exception:  # noqa: BLE001
        return r.status_code, {"code": -1, "message": r.text[:60], "data": None}


def shape(response) -> str:
    data = response.get("data")
    if data is None:
        return "nothing (code " + str(response.get("code")) + ")"
    if isinstance(data, dict):
        if "total" in data:
            return str(data.get("total")) + " row(s)"
        return "object: " + ", ".join(sorted(data.keys())[:5])
    if isinstance(data, list):
        return str(len(data)) + " row(s): " + json.dumps(data[:2], default=str)[:150]
    return str(data)[:80]


def main() -> int:
    owner = call("POST", "/auth/login", payload={"email": OWNER, "password": ""})[1]
    owner_token = (owner.get("data") or {}).get("access_token") or ""
    if not owner_token:
        print("cannot sign in as the owner")
        return 1

    email = "surface-" + uuid.uuid4().hex[:8] + "@example.test"
    signup = call("POST", "/users", payload={"email": email, "password": "Surface-Pass!22"})[1]
    member_token = (signup.get("data") or {}).get("access_token") or ""
    member_id = (signup.get("data") or {}).get("id") or ""
    if not member_token:
        print("cannot sign up:", signup)
        return 1
    print("fresh account:", email)
    print()

    leaks = 0
    print("  " + "surface".ljust(26) + "owner".ljust(22) + "new account")
    print("  " + "-" * 74)
    for label, path, kind in SURFACES:
        os_, o = call("GET", path, owner_token)
        ms, m = call("GET", path, member_token)
        o_text, m_text = shape(o), shape(m)
        empty = m.get("code") not in (0, None) or m.get("data") in (None, [], {}) 
        flag = "" if (empty or kind == "catalog") else "   <-- LEAK"
        if flag:
            leaks += 1
        print("  " + label.ljust(26) + o_text.ljust(22) + m_text + flag)

    print()
    print(str(leaks) + " surface(s) leak workspace data to a new account")

    with sqlite3.connect(DB) as conn:
        conn.execute("DELETE FROM api_token WHERE user_id = ?", (member_id,))
        conn.execute("DELETE FROM user WHERE id = ?", (member_id,))
        conn.commit()
    print("(fixture account removed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

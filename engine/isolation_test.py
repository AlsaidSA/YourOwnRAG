# Copyright 2026 OwnRAG contributors — Apache-2.0.
"""Prove one account cannot see another account's workspace.

Reported: signing in with a new account showed the owner's data sources and knowledge bases. These
checks drive the real HTTP surface with two real accounts — the owner and a fresh member — and assert
what each may reach.

A fixture that cannot fail proves nothing, so every refusal is paired with a control: the same call
succeeds for an account that is entitled to it, and the owner's own retrieval and listings are
re-checked after the change so that closing the leak did not simply break the product.

Database access here is deliberately brief. An earlier version held one connection open for the whole
run, and when it asked the engine to delete the member the engine's write found the file locked and
returned 500 — which left the engine answering 500 to every later request until it was restarted. The
suites must not be able to damage the thing under test.
"""
from __future__ import annotations

import pathlib
import sqlite3
import sys
import uuid

import requests

BASE = "http://127.0.0.1:9380/api/v1"
DB = pathlib.Path(__file__).resolve().parent / "data" / "ownrag.db"

PASS = 0
FAIL = 0
PROBLEMS: list[str] = []


def check(label: str, condition: bool, detail: object = "") -> None:
    global PASS, FAIL
    if condition:
        PASS += 1
        print("  [PASS] " + label)
    else:
        FAIL += 1
        PROBLEMS.append(label)
        print("  [FAIL] " + label + (" (" + str(detail) + ")" if detail else ""))


def call(method: str, path: str, payload=None, token: str = "") -> tuple[int, dict]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    response = requests.request(method, BASE + path, json=payload, headers=headers, timeout=120)
    try:
        return response.status_code, response.json()
    except ValueError:
        return response.status_code, {}


def call_text(method: str, path: str, payload=None, token: str = "") -> tuple[int, str]:
    """Same as `call`, but keeps the raw body — a streamed route returns SSE, not JSON."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    response = requests.request(method, BASE + path, json=payload, headers=headers, timeout=120)
    return response.status_code, response.text


def db_read(sql: str, args: tuple = ()) -> list:
    """One short, read-only look at the file, then let go of it."""
    conn = sqlite3.connect(str(DB), timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(row) for row in conn.execute(sql, args).fetchall()]
    finally:
        conn.close()


def db_write(sql: str, args: tuple = ()) -> None:
    """One short write, then let go of it. Never hold a connection across an engine request."""
    conn = sqlite3.connect(str(DB), timeout=30)
    try:
        conn.execute(sql, args)
        conn.commit()
    finally:
        conn.close()


def items(response: dict) -> list:
    data = (response or {}).get("data")
    return data if isinstance(data, list) else []


def ids(response: dict) -> set:
    return {str(row.get("id")) for row in items(response) if isinstance(row, dict)}


def main() -> int:
    print("=" * 68)
    print("  workspace isolation")
    print("=" * 68)

    status, response = call("POST", "/auth/login", {"email": "owner@ownrag.local", "password": ""})
    owner = (response.get("data") or {}).get("access_token") or ""
    check("the owner can sign in", status == 200 and bool(owner), str(status) + " " + str(response.get("message"))[:40])
    if not owner:
        return 1

    owner_kbs = ids(call("GET", "/datasets", token=owner)[1])
    check("the owner has knowledge bases to protect", len(owner_kbs) > 0, len(owner_kbs))
    owner_chats = ids(call("GET", "/chats", token=owner)[1])
    check("the owner has assistants to protect", len(owner_chats) > 0, len(owner_chats))
    owner_kb = sorted(owner_kbs)[0]
    owner_chat = sorted(owner_chats)[0]

    # ---- a real second account -------------------------------------------------
    email = "isolation-" + uuid.uuid4().hex[:8] + "@example.test"
    status, response = call("POST", "/users", {"email": email, "password": "Is0lation-Pass!"})
    member = (response.get("data") or {}).get("access_token") or ""
    member_id = (response.get("data") or {}).get("id") or ""
    check("a new account can register", status == 200 and bool(member) and bool(member_id), status)
    if not member:
        return 1
    print("  [info] member = " + email)

    # ---- what the member sees --------------------------------------------------
    print("\n[1] listings")
    seen = ids(call("GET", "/datasets", token=member)[1])
    check("the member sees none of the owner's knowledge bases", not (seen & owner_kbs), sorted(seen & owner_kbs))
    check("the owner still sees their own knowledge bases", owner_kbs <= ids(call("GET", "/datasets", token=owner)[1]))
    chat_seen = ids(call("GET", "/chats", token=member)[1])
    check("the member sees none of the owner's assistants", not (chat_seen & owner_chats), sorted(chat_seen & owner_chats))

    docs = items(call("GET", "/documents", token=member)[1])
    foreign = [d for d in docs if str(d.get("dataset_id")) in owner_kbs]
    check("the member sees none of the owner's documents", not foreign, len(foreign))

    # ---- direct access by id ---------------------------------------------------
    print("\n[2] direct access by id")
    for label, method, path, payload in [
        ("reading a knowledge base", "GET", "/datasets/" + owner_kb, None),
        ("listing its documents", "GET", "/datasets/" + owner_kb + "/documents", None),
        ("reading its chunks", "GET", "/datasets/" + owner_kb + "/documents/doc_x/chunks", None),
        ("deleting it", "DELETE", "/datasets/" + owner_kb, None),
        ("deleting its documents", "DELETE", "/datasets/" + owner_kb + "/documents", {"ids": ["doc_x"]}),
        ("reading an assistant", "GET", "/chats/" + owner_chat, None),
        ("reading an assistant's sessions", "GET", "/chats/" + owner_chat + "/sessions", None),
    ]:
        status, response = call(method, path, payload, member)
        check("the member is refused when " + label, status == 403, str(status) + " " + str(response.get("message"))[:40])

    # The completion route names its assistant in the body, so the handler refuses it rather than the
    # path guard — and this engine carries a refusal on HTTP 200 with a non-zero code (the same
    # envelope quirk `users/me` has). What matters is that no content comes back, and that the very
    # same call still answers its owner.
    status, body = call_text("POST", "/chat/completions", {"chat_id": owner_chat, "question": "what is attention", "stream": False}, member)
    check("the completion route refuses the member the owner's assistant", "another account" in body, str(status) + " " + body[:60])
    check("and returns none of the owner's content", "doc_" not in body and "Labor Law" not in body, body[:80])
    status, body = call_text("POST", "/chat/completions", {"chat_id": owner_chat, "question": "what is attention", "stream": False}, owner)
    check("the owner's assistant still answers (control)", status == 200 and "another account" not in body, status)

    check("the owner's knowledge base survived the member's delete",
          owner_kb in ids(call("GET", "/datasets", token=owner)[1]))
    check("the owner can still read it", call("GET", "/datasets/" + owner_kb, token=owner)[0] == 200)
    check("the owner can still open their assistant", call("GET", "/chats/" + owner_chat, token=owner)[0] == 200)

    # ---- retrieval -------------------------------------------------------------
    print("\n[3] retrieval")
    question = {"question": "what is attention", "top_k": 5}
    status, response = call("POST", "/datasets/search", dict(question, dataset_ids=[owner_kb]), member)
    chunks = ((response.get("data") or {}).get("chunks") or [])
    check("naming the owner's knowledge base returns nothing", status == 200 and not chunks, len(chunks))
    status, response = call("POST", "/datasets/search", dict(question), member)
    chunks = ((response.get("data") or {}).get("chunks") or [])
    check("an unfiltered search returns nothing for the member", status == 200 and not chunks, len(chunks))
    # The control: the call the member was refused, made by an account entitled to it. An empty scope
    # has always meant "nothing" — `retrieval.search` returns early — so the owner's control names the
    # knowledge bases explicitly, which is also what the console sends.
    status, response = call("POST", "/datasets/search", dict(question, dataset_ids=sorted(owner_kbs)), owner)
    owner_chunks = ((response.get("data") or {}).get("chunks") or [])
    check("the owner's search still works (control)", status == 200 and len(owner_chunks) > 0, len(owner_chunks))
    status, response = call("POST", "/datasets/search", dict(question, dataset_ids=sorted(owner_kbs)), member)
    chunks = ((response.get("data") or {}).get("chunks") or [])
    check("naming every knowledge base still returns nothing for the member", not chunks, len(chunks))

    # ---- configuration surfaces belong to the workspace that owns them --------
    print("\n[4] configuration surfaces are per workspace")
    # Each of these is for the workspace you own. A new account owns its own, so it is entitled to its
    # own configuration; what must not happen is reaching the owner's.
    for label, path in [("provider configuration", "/providers"), ("the API-key list", "/system/tokens"), ("memories", "/memories")]:
        status, response = call("GET", path, token=member)
        check("the member reaches its own " + label, status == 200 and response.get("code") == 0, str(status))

        def own(response):
            # The engine's default model is shared on purpose: it is what every workspace starts with.
            return {str(r.get("id")) for r in items(response) if str(r.get("name")) != "ownrag-local"}

        overlap = own(response) & own(call("GET", path, token=owner)[1])
        check("and none of the owner's " + label, not overlap, sorted(overlap)[:2])
    check("the owner can read provider configuration (control)", call("GET", "/providers", token=owner)[0] == 200)

    # ---- the member can still work --------------------------------------------
    print("\n[5] the member's own workspace")
    name = "isolation kb " + uuid.uuid4().hex[:6]
    status, response = call("POST", "/datasets", {"name": name}, member)
    own_kb = (items(response)[0].get("id") if items(response) else "")
    check("the member can create a knowledge base", status == 200 and bool(own_kb), status)
    rows = db_read("SELECT created_by FROM dataset WHERE id = ?", (own_kb,)) if own_kb else []
    check("it is attributed to the member, not the owner", bool(rows) and rows[0]["created_by"] == email, rows[0] if rows else None)
    check("the member can read their own knowledge base", call("GET", "/datasets/" + own_kb, token=member)[0] == 200)
    check("the member sees it in their listing", own_kb in ids(call("GET", "/datasets", token=member)[1]))
    # A dataset the member created lives in the member's own workspace, so the owner is outside it.
    check("the owner does not see another workspace's knowledge base",
          own_kb not in ids(call("GET", "/datasets", token=owner)[1]), own_kb)
    status, response = call("POST", "/chats", {"name": "isolation chat"}, member)
    own_chat = ((response.get("data") or {}).get("id") or "")
    check("the member can create an assistant", status == 200 and bool(own_chat), status)
    check("the member can read their own assistant", not own_chat or call("GET", "/chats/" + own_chat, token=member)[0] == 200)

    # ---- an API key still works ------------------------------------------------
    print("\n[6] an API key acts for the workspace")
    status, response = call("POST", "/system/tokens", {"name": "isolation key"}, owner)
    key = (response.get("data") or {}).get("token") or ""
    check("the owner can issue an API key", status == 200 and bool(key), status)
    if key:
        status, response = call("GET", "/datasets", token=key)
        check("the key reaches the workspace", status == 200 and bool(ids(response) & owner_kbs), status)
        status, response = call("POST", "/datasets/search", dict(question, dataset_ids=[owner_kb]), key)
        chunks = ((response.get("data") or {}).get("chunks") or [])
        check("the key can retrieve (control for the leak fix)", status == 200 and len(chunks) > 0, len(chunks))

    # ---- the agent route names its knowledge bases in its DSL ------------------
    print("\n[7] the agent route")
    agent_rows = items(call("GET", "/agents", token=owner)[1])
    agent_id = str(agent_rows[0].get("id")) if agent_rows else ""
    if agent_id:
        status, body = call_text("POST", "/agents/chat/completions", {"agent_id": agent_id, "question": "what is attention", "stream": False}, member)
        check("the agent route does not answer a member from the owner's corpus",
              status == 403 or ("doc_" not in body and "Labor Law" not in body), str(status) + " " + body[:60])
        status, body = call_text("POST", "/agents/chat/completions", {"agent_id": agent_id, "question": "what is attention", "stream": False}, owner)
        check("the agent route still answers the owner (control)", status == 200, status)
    else:
        print("  [info] no agent to probe")

    # ---- whose workspace is it --------------------------------------------------
    print("\n[9] a new account is not in the owner's workspace")
    other_email = "isolation-" + uuid.uuid4().hex[:8] + "@example.test"
    status, response = call("POST", "/users", {"email": other_email, "password": "Is0lation-Pass!"})
    other = (response.get("data") or {}).get("access_token") or ""
    other_id = (response.get("data") or {}).get("id") or ""
    check("a second account can register", status == 200 and bool(other) and bool(other_id), status)
    other_ws = ""
    if other:
        other_ws = str((((call("GET", "/tenants", token=other)[1].get("data") or [{}])[0]) or {}).get("tenant_id") or "")
    check("it gets a workspace of its own", bool(other_ws) and other_ws != "tenant_ownrag", other_ws)
    roster = {str(m.get("user_id")) for m in items(call("GET", "/tenants/tenant_ownrag/users", token=owner)[1])}
    check("the owner's team list does not show it", other_id not in roster, len(roster))
    status, response = call("GET", "/tenants/tenant_ownrag/users", token=other)
    check("it cannot read the owner's team list", status != 200 or response.get("code") != 0,
          str(status) + " " + str(response.get("code")))
    if other_ws:
        own_roster = [str(m.get("user_id")) for m in items(call("GET", "/tenants/" + other_ws + "/users", token=other)[1])]
        check("its own workspace lists only itself", own_roster == [other_id], own_roster)
    status, response = call("GET", "/tenants/tenant_ownrag/users", token=owner)
    check("the owner still reads their own team list (control)", status == 200 and response.get("code") == 0, status)

    # ---- the account owns the workspace it created -------------------------------
    print("\n[10] a new account owns its workspace")
    fixtures = []
    ident = (call("GET", "/users/me", token=member)[1].get("data") or {})
    check("the new account is the owner of its workspace", ident.get("role") == "owner", str(ident.get("role")))
    own_ws = ((call("GET", "/tenants", token=member)[1].get("data") or [{}])[0]) or {}
    check("its workspace calls it the owner", own_ws.get("role") == "owner", str(own_ws.get("role")))
    check("its workspace says it may manage", own_ws.get("can_manage") is True)

    # Models: every workspace seeds its own local model, so an owner has something to configure.
    owner_models = items(call("GET", "/providers", token=owner)[1])
    member_models = items(call("GET", "/providers", token=member)[1])
    check("the owner has models (control)", len(owner_models) > 0, len(owner_models))
    check("it sees a model to configure (the engine default)", len(member_models) > 0, len(member_models))
    # The owner's *own* configured model is the one that must stay private.
    created = call("POST", "/providers", {"name": "isolation-model", "base_url": "https://example.test/v1"}, owner)
    # This route answers `true` rather than the object, so the id is not read here; the sweep below finds
    # the fixture by name.
    if created[0] == 200 and created[1].get("code") == 0:
        fixtures.append(("provider", ""))
    check("the owner has a model of their own (control)",
          any(str(m.get("name")) == "isolation-model" for m in items(call("GET", "/providers", token=owner)[1])))
    check("the new account does not see the owner's own model",
          not [m for m in items(call("GET", "/providers", token=member)[1])
               if str(m.get("name")) == "isolation-model"])

    # Memory stores, and the API keys, follow the same rule.
    created = call("POST", "/memories", {"name": "isolation-memory"}, owner)
    if (created[1].get("data") or {}).get("id"):
        fixtures.append(("memory", str(created[1]["data"]["id"])))
    check("the owner has a memory store to protect (control)",
          len(items(call("GET", "/memories", token=owner)[1])) > 0)
    check("the new account sees none of the owner's memory stores",
          not items(call("GET", "/memories", token=member)[1]))
    owner_keys = {str(k.get("id")) for k in items(call("GET", "/system/tokens", token=owner)[1])}
    member_keys = {str(k.get("id")) for k in items(call("GET", "/system/tokens", token=member)[1])}
    check("the owner has API keys (control)", len(owner_keys) > 0, len(owner_keys))
    check("the new account's keys are its own, not the owner's", not (member_keys & owner_keys))

    # ---- the surfaces that are not knowledge bases ------------------------------
    print("\n[11] tools, sources and files")
    created = call("POST", "/connectors", {"name": "isolation-source", "source_type": "web",
                                           "settings": {"urls": "https://example.test/robots.txt"}}, owner)
    if (created[1].get("data") or {}).get("id"):
        fixtures.append(("connector", str(created[1]["data"]["id"])))
    created = call("POST", "/mcp/servers", {"name": "isolation-tools", "url": "https://example.test/sse",
                                            "transport": "sse"}, owner)
    if (created[1].get("data") or {}).get("id"):
        fixtures.append(("mcp_server", str(created[1]["data"]["id"])))
    created = call("POST", "/agents", {"title": "isolation-agent"}, owner)
    if (created[1].get("data") or {}).get("id"):
        fixtures.append(("agent", str(created[1]["data"]["id"])))
    # Files have no creator column and the owner has none, so without this the file checks pass
    # vacuously. Registering one row is all the real upload flow does at this endpoint.
    created = call("POST", "/files", {"name": "isolation-file.txt", "size": 11, "type": "txt",
                                      "location": "isolation/file.txt"}, owner)
    if (created[1].get("data") or {}).get("id"):
        fixtures.append(("file", str(created[1]["data"]["id"])))
    check("the owner has fixtures to protect on every surface", len(fixtures) == 6, len(fixtures))

    for label, path in (
        ("data sources", "/connectors"),
        ("sync logs", "/connectors/sync_logs"),
        ("tool servers", "/mcp/servers"),
        ("agents", "/agents"),
        ("files", "/files"),
    ):
        owner_rows = items(call("GET", path, token=owner)[1])
        member_rows = items(call("GET", path, token=member)[1])
        check("the owner has " + label + " of their own to see (control)", len(owner_rows) > 0, len(owner_rows))
        check("the member sees none of the owner's " + label, not member_rows, len(member_rows))

    for table, row_id in fixtures:
        if table == "file":
            continue  # a file is only listed and uploaded; there is no by-id route to probe
        if table in ("file", "provider"):
            continue  # listed, not read by id
        path = {
            "connector": "/connectors/",
            "mcp_server": "/mcp/servers/",
            "agent": "/agents/",
            "memory": "/memories/",
        }[table]
        status, response = call("GET", path + row_id, token=member)
        check("the member cannot read the owner's " + table + " by id",
              status != 200 or response.get("code") != 0, str(status) + " " + str(response.get("code")))
        status, response = call("GET", path + row_id, token=owner)
        check("the owner still reads their own " + table + " (control)",
              status == 200 and response.get("code") == 0, status)

    # ---- cleanup ---------------------------------------------------------------
    print("\n[8] cleanup")
    if own_chat:
        db_write("DELETE FROM chat WHERE id = ?", (own_chat,))
    if own_kb:
        for sql in (
            "DELETE FROM chunk WHERE dataset_id = ?",
            "DELETE FROM token_index WHERE dataset_id = ?",
            "DELETE FROM document WHERE dataset_id = ?",
            "DELETE FROM ingestion_log WHERE dataset_id = ?",
            "DELETE FROM dataset WHERE id = ?",
        ):
            db_write(sql, (own_kb,))
    for token_row in db_read("SELECT id FROM api_token WHERE name = 'isolation key'"):
        call("DELETE", "/system/tokens", {"id": token_row["id"]}, owner)
    db_write("DELETE FROM api_token WHERE name = 'isolation key'")
    # ---- removing a provider ---------------------------------------------------
    print("\n[12] removing a provider")
    # The engine refuses its own in-process model: it needs no key, and removing it would leave the
    # workspace with nothing to answer with.
    response = call("DELETE", "/providers/ownrag-local", None, owner)[1]
    check("the engine's own model cannot be removed", response.get("code") != 0, str(response.get("code")))
    check(
        "and it is still listed",
        any(str(p.get("name")) == "ownrag-local" for p in items(call("GET", "/providers", token=owner)[1])),
    )

    # A provider belongs to the workspace that added it. Another workspace can neither read its instances
    # nor write to it — and it must not be able to remove it.
    check(
        "another workspace sees none of its instances",
        not items(call("GET", "/providers/isolation-model/instances", token=member)[1]),
    )
    response = call("POST", "/providers/isolation-model/instances/default/models", {"model_name": "isolation-x"}, member)[1]
    check("another workspace cannot add a model to it", response.get("code") != 0, str(response.get("code")))
    response = call("DELETE", "/providers/isolation-model", None, member)[1]
    check("another workspace cannot remove it", response.get("code") != 0, str(response.get("code")))
    check(
        "and it survived the attempt",
        any(str(p.get("name")) == "isolation-model" for p in items(call("GET", "/providers", token=owner)[1])),
    )

    # The owner made it a real fixture first, so the removal has models to take with it.
    added = call("POST", "/providers/isolation-model/instances/default/models", {"model_name": "isolation-x"}, owner)[1]
    check("the owner can add a model to its own provider", added.get("code") == 0, str(added.get("code")))
    removed = (call("DELETE", "/providers/isolation-model", None, owner)[1].get("data") or {})
    check("the owner removes its own provider", removed.get("provider") == "isolation-model", str(removed))
    check("its models are removed with it", int(removed.get("models_removed") or 0) > 0, str(removed.get("models_removed")))
    check(
        "and it is gone from the listing",
        not [p for p in items(call("GET", "/providers", token=owner)[1]) if str(p.get("name")) == "isolation-model"],
    )
    check(
        "no model row is left pointing at a provider that is gone",
        not db_read("SELECT id FROM provider_model WHERE provider_id NOT IN (SELECT id FROM provider)"),
    )

    # ---- the model a chat answers with -----------------------------------------
    print("\n[13] choosing the model a chat answers with")
    from ownrag_engine import core  # the resolution rule itself, not a copy of it

    # The console's picker reads this list. It held a single label — whatever was already resolved — so a
    # provider could be registered, keyed and switched on and still be unpickable, which is what "I cannot
    # use my model with the chat tab" looks like from the outside.
    models = lambda who: ((call("GET", "/users/me/models", token=who)[1].get("data") or {}).get("chat") or [])
    before = models(owner)
    check("the engine's own model is offered first", bool(before) and not before[0].startswith("llm:"), str(before))

    call("POST", "/providers", {"name": "isolation-pin", "label": "Isolation Pin"}, owner)
    # The address and the key arrive through the instance route — the console's own two-step flow. A
    # provider with no address is correctly unusable, so a fixture that skipped this would prove nothing.
    call("POST", "/providers/isolation-pin/instances", {"api_base": "https://example.test/v1", "api_key": "x"}, owner)
    call("POST", "/providers/isolation-pin/instances/default/models", {"model_name": "isolation-pin-model"}, owner)
    check("a workspace is offered its own provider's models", "llm:isolation-pin-model" in models(owner), str(models(owner)))
    check("another workspace is not", not any(m.startswith("llm:") for m in models(member)), str(models(member)))

    # The rule the picker leans on: a pin is honoured only inside the workspace that owns the provider, so a
    # chat in one workspace is never answered — or billed — through another workspace's key.
    tenant = lambda who: (db_read("SELECT tenant_id FROM user WHERE email = ?", (who,)) or [{"tenant_id": ""}])[0]["tenant_id"]
    owner_tenant, member_tenant = tenant("owner@ownrag.local"), tenant(email)
    check("the two accounts are in different workspaces", bool(owner_tenant) and owner_tenant != member_tenant, owner_tenant + " / " + member_tenant)
    resolved = core.active_model("chat", "llm:isolation-pin-model", member_tenant)
    check("a pin cannot reach another workspace's provider", not resolved or str(resolved.get("provider")) != "isolation-pin", str(resolved))
    resolved = core.active_model("chat", "llm:isolation-pin-model", owner_tenant)
    check("the owner's own pin resolves to it", bool(resolved) and str(resolved.get("provider")) == "isolation-pin", str(resolved))

    call("DELETE", "/providers/isolation-pin", None, owner)
    check("the fixture is removed again", not db_read("SELECT id FROM provider WHERE name = 'isolation-pin'"))


    for table, _row_id in fixtures:
        column = "title" if table == "agent" else "name"
        db_write("DELETE FROM " + table + " WHERE " + column + " LIKE 'isolation-%'")
    if other_id:
        db_write("DELETE FROM api_token WHERE user_id = ?", (other_id,))
        db_write("DELETE FROM user WHERE id = ?", (other_id,))
    if member_id:
        call("DELETE", "/tenants/tenant_ownrag/users/" + member_id, token=owner)
        db_write("DELETE FROM api_token WHERE user_id = ?", (member_id,))
        db_write("DELETE FROM user WHERE id = ?", (member_id,))
    leftovers = db_read("SELECT COUNT(*) AS n FROM user WHERE email LIKE 'isolation-%@example.test'")
    check("no test account left behind", bool(leftovers) and leftovers[0]["n"] == 0, leftovers[0] if leftovers else None)
    check("the owner's knowledge bases are untouched", owner_kbs <= ids(call("GET", "/datasets", token=owner)[1]))

    print("\n" + "=" * 68)
    print("  " + str(PASS) + " passed, " + str(FAIL) + " failed")
    print("=" * 68)
    if PROBLEMS:
        for label in PROBLEMS:
            print("  failed: " + label)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())

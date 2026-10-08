"""
Auth regression suite — accounts, credentials and sessions, against a live engine.

Unit tier in spirit (no model, no retrieval): it drives the real HTTP surface, so it also proves the
wiring rather than the helpers. Needs the engine on 127.0.0.1:9380.

    cd engine && PYTHONUTF8=1 ./.venv/Scripts/python.exe auth_test.py
"""
from __future__ import annotations

import sqlite3
import sys
import time
import uuid

import requests

BASE = "http://127.0.0.1:9380/api/v1"
PASS = 0
FAIL = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label}{' - ' + detail if detail else ''}")


def post(path: str, body: dict, token: str | None = None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return requests.post(f"{BASE}{path}", json=body, headers=headers, timeout=60).json()


def get(path: str, token: str | None = None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return requests.get(f"{BASE}{path}", headers=headers, timeout=60).json()


def fresh_email() -> str:
    return f"user-{uuid.uuid4().hex[:10]}@example.test"


def db():
    conn = sqlite3.connect("data/ownrag.db")
    conn.row_factory = sqlite3.Row
    return conn


def main() -> int:
    print("=" * 66)
    print("  accounts, credentials and sessions")
    print("=" * 66)

    config = get("/system/config")
    check("signup is offered by the running engine", config["data"]["registerEnabled"] is True, str(config["data"]))

    print("1. sign-up validates before it creates anything")
    web = post("/users", {"email": "not-an-email", "password": "a-long-enough-one"})
    check("a malformed email is refused", web["code"] != 0, str(web)[:90])
    web = post("/users", {"email": fresh_email(), "password": "short"})
    check("a short password is refused", web["code"] != 0, str(web)[:90])

    print("2. sign-up creates a signed-in account")
    email = fresh_email()
    web = post("/users", {"email": email, "password": "a-proper-passphrase-42", "nickname": "Ada"})
    check("the account is created", web["code"] == 0, str(web)[:120])
    token = (web.get("data") or {}).get("access_token") or ""
    check("sign-up returns a session token", bool(token))
    check("repeat sign-up on the same email is refused", post("/users", {"email": email, "password": "another-good-one"})["code"] != 0)

    print("3. the credential is stored as a hash, never as text")
    row = db().execute("SELECT * FROM user WHERE email = ?", (email,)).fetchone()
    check("password column holds a scrypt hash", str(row["password"]).startswith("scrypt$"), str(row["password"])[:24])
    check("the plaintext password is nowhere in the row", "a-proper-passphrase-42" not in (row["password"] or ""))
    check("the account is not an administrator", int(row["is_admin"]) == 0)

    print("4. the session identifies its own user")
    me = get("/users/me", token)["data"]
    check("users/me returns the signed-up account", me["email"] == email, str(me))
    check("users/me does not report the owner", me["nickname"] == "Ada", str(me))
    check("a request without a token is refused", requests.get(f"{BASE}/users/me", timeout=30).status_code == 401)

    print("5. sign-in with the right credential")
    login = post("/auth/login", {"email": email, "password": "a-proper-passphrase-42"})
    check("correct password signs in", login["code"] == 0, str(login)[:90])
    check("sign-in returns a token", bool((login.get("data") or {}).get("access_token")))

    print("6. wrong passwords are refused, and lock the account")
    for _ in range(5):
        bad = post("/auth/login", {"email": email, "password": "definitely-wrong"})
        check("wrong password refused", bad["code"] != 0, str(bad)[:80])
    locked = post("/auth/login", {"email": email, "password": "a-proper-passphrase-42"})
    check("the account is locked after repeated failures", "Too many attempts" in (locked.get("message") or ""), str(locked)[:110])
    check("the lock also blocks the correct password", locked["code"] != 0)

    print("7. an unknown address is not distinguishable from a bad password")
    unknown = post("/auth/login", {"email": fresh_email(), "password": "whatever-it-is"})
    check("unknown email and wrong password share one message", unknown.get("message") == "Incorrect email or password", str(unknown.get("message")))

    print("8. sessions carry an owner and an expiry")
    tok = db().execute("SELECT * FROM api_token WHERE token = ?", (token,)).fetchone()
    check("the token row records its user", (tok["user_id"] or "") == row["id"], str(dict(tok) if tok else None)[:90])
    check("the token row has an expiry in the future", int(tok["expires_at"] or 0) > int(time.time() * 1000))
    check("no token is stored against no user", db().execute("SELECT COUNT(*) AS n FROM api_token WHERE user_id IS NULL").fetchone()["n"] == 0)

    print("9. sign-out revokes exactly that session, and keep it")
    requests.post(f"{BASE}/auth/logout", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    check("the revoked token stops working", requests.get(f"{BASE}/users/me", headers={"Authorization": f"Bearer {token}"}, timeout=30).status_code == 401)
    check("the row is gone", db().execute("SELECT COUNT(*) AS n FROM api_token WHERE token = ?", (token,)).fetchone()["n"] == 0)

    print("10. auth events are audited")
    events = {r["event"] for r in db().execute("SELECT DISTINCT event FROM audit_log").fetchall()}
    for wanted in ("signup", "login_ok", "login_failed", "login_locked", "login_unknown_email"):
        check(f"audited: {wanted}", wanted in events, str(sorted(events)))

    print()
    print("=" * 66)
    print(f"  {PASS} passed, {FAIL} failed")
    print("=" * 66)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())

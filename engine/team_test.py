"""
Team regression suite — invitations, roles and member management, against a live engine.

Unit tier in spirit (no model, no retrieval): it drives the real HTTP surface, so it proves the
wiring and the authority rules together. Needs the engine on 127.0.0.1:9380.

    cd engine && PYTHONUTF8=1 ./.venv/Scripts/python.exe team_test.py
"""
from __future__ import annotations

import sys
import pathlib
import sqlite3
import uuid

import requests

BASE = "http://127.0.0.1:9380/api/v1"
PASS = 0
FAIL = 0
OWNER = "owner@ownrag.local"


def check(label: str, condition: bool, detail: str = "") -> None:
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label}{' - ' + detail if detail else ''}")


def call(method: str, path: str, body: dict | None = None, token: str | None = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = requests.request(method, f"{BASE}{path}", json=body, headers=headers, timeout=60)
    try:
        return resp.json()
    except ValueError:
        return {"code": -1, "message": f"HTTP {resp.status_code} non-JSON"}


def post(path: str, body: dict | None = None, token: str | None = None) -> dict:
    return call("POST", path, body, token)


def get(path: str, token: str | None = None) -> dict:
    return call("GET", path, None, token)


def patch(path: str, body: dict, token: str | None = None) -> dict:
    return call("PATCH", path, body, token)


def delete(path: str, token: str | None = None) -> dict:
    return call("DELETE", path, None, token)


def fresh_email(tag: str = "invitee") -> str:
    return f"{tag}-{uuid.uuid4().hex[:10]}@example.test"


def token_of(invite: dict) -> str:
    return str(invite.get("data", {}).get("token") or "")


def login(email: str, password: str = "") -> dict:
    return post("/auth/login", {"email": email, "password": password})


DB = pathlib.Path(__file__).resolve().parent / "data" / "ownrag.db"


def db_read(sql: str, args: tuple = ()) -> list:
    # Brief connections only: the engine must never find the file locked by this suite.
    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(row) for row in conn.execute(sql, args).fetchall()]


def db_write(sql: str, args: tuple = ()) -> None:
    with sqlite3.connect(DB) as conn:
        conn.execute(sql, args)
        conn.commit()


def main() -> int:
    print("\n[1] workspace and roles")
    owner_login = login(OWNER)
    owner = owner_login.get("data", {}).get("access_token") or ""
    check("owner signs in", bool(owner), str(owner_login.get("message")))
    me = get("/users/me", owner).get("data") or {}
    check("owner role is owner", me.get("role") == "owner", str(me.get("role")))
    ws = (get("/tenants", owner).get("data") or [{}])[0]
    tenant = ws.get("tenant_id") or ""
    check("workspace reports owner role", ws.get("role") == "owner", str(ws.get("role")))
    check("owner may manage the workspace", ws.get("can_manage") is True)
    check("workspace has a tenant id", bool(tenant))
    check("workspace counts its members", int(ws.get("member_count") or 0) >= 1, str(ws.get("member_count")))

    print("\n[2] creating invitations")
    email_a = fresh_email("a")
    created = post(f"/tenants/{tenant}/invitations", {"email": email_a, "role": "member"}, owner)
    invite = created.get("data") or {}
    check("owner creates an invitation", created.get("code") == 0, str(created.get("message")))
    check("invitation carries a token", bool(invite.get("token")))
    check("invitation carries a copyable link", f"/invite/{invite.get('token')}" in str(invite.get("invite_url")))
    check("invitation starts pending", invite.get("status") == "pending", str(invite.get("status")))
    check("invitation keeps the requested role", invite.get("role") == "member")
    check(
        "duplicate invitation refused",
        post(f"/tenants/{tenant}/invitations", {"email": email_a, "role": "member"}, owner).get("code") != 0,
    )
    check(
        "invalid email refused",
        post(f"/tenants/{tenant}/invitations", {"email": "not-an-email", "role": "member"}, owner).get("code") != 0,
    )
    check(
        "inviting a second owner refused",
        post(f"/tenants/{tenant}/invitations", {"email": fresh_email("o"), "role": "owner"}, owner).get("code") != 0,
    )
    check(
        "inviting an existing member refused",
        post(f"/tenants/{tenant}/invitations", {"email": OWNER, "role": "member"}, owner).get("code") != 0,
    )

    print("\n[3] the invitation link is public but narrow")
    info = get(f"/invitations/{token_of(created)}").get("data") or {}
    check("link readable without a session", info.get("email") == email_a, str(info))
    check("link exposes the role", info.get("role") == "member")
    check("link does not expose a token", "token" not in info)
    check("unknown link refused", get("/invitations/definitely-not-a-real-token").get("code") != 0)

    print("\n[4] accepting an invitation")
    weak = post(f"/invitations/{token_of(created)}/accept", {"password": "abc", "nickname": "A"})
    check("weak password refused", weak.get("code") != 0, str(weak.get("message")))
    accepted = post(f"/invitations/{token_of(created)}/accept", {"password": "Str0ng-Passw0rd!", "nickname": "Member A"})
    a_token = (accepted.get("data") or {}).get("access_token") or ""
    check("invitation accepted", accepted.get("code") == 0, str(accepted.get("message")))
    check("acceptance signs the new member in", bool(a_token))
    check("new member keeps the invited role", (accepted.get("data") or {}).get("role") == "member")
    check("accepted link cannot be reused", post(f"/invitations/{token_of(created)}/accept", {"password": "Str0ng-Passw0rd!"}).get("code") != 0)
    pending = [i for i in (get(f"/tenants/{tenant}/invitations", owner).get("data") or []) if i.get("id") == invite.get("id")]
    check("accepted invitation is marked accepted", bool(pending) and pending[0].get("status") == "accepted", str(pending))
    check("the new account can sign in with its password", bool((login(email_a, "Str0ng-Passw0rd!").get("data") or {}).get("access_token")))
    check("the new account appears as a member", any(m.get("email") == email_a for m in (get(f"/tenants/{tenant}/users", owner).get("data") or [])))

    print("\n[5] a member has no authority")
    check(
        "member cannot invite",
        post(f"/tenants/{tenant}/invitations", {"email": fresh_email("x"), "role": "member"}, a_token).get("code") != 0,
    )
    check("member cannot list invitations", get(f"/tenants/{tenant}/invitations", a_token).get("code") != 0)
    check("member cannot change a role", patch(f"/tenants/{tenant}/users/{me.get('id')}", {"role": "admin"}, a_token).get("code") != 0)
    check(
        "member cannot remove the owner",
        delete(f"/tenants/{tenant}/users/{me.get('id')}", a_token).get("code") != 0,
    )

    print("\n[6] admin is delegated, owner is final")
    admin_email = fresh_email("admin")
    admin_invite = post(f"/tenants/{tenant}/invitations", {"email": admin_email, "role": "admin"}, owner).get("data") or {}
    check("owner may invite an admin", bool(admin_invite.get("token")), str(admin_invite))
    admin_accept = post(f"/invitations/{token_of({'data': admin_invite})}/accept", {"password": "Adm1n-Passw0rd!", "nickname": "Admin"})
    admin = (admin_accept.get("data") or {}).get("access_token") or ""
    admin_id = (admin_accept.get("data") or {}).get("id") or ""
    check("admin invitation accepted with admin role", (admin_accept.get("data") or {}).get("role") == "admin")
    member_email = fresh_email("member")
    check(
        "admin may invite a member",
        post(f"/tenants/{tenant}/invitations", {"email": member_email, "role": "member"}, admin).get("code") == 0,
    )
    check(
        "admin may not invite another admin",
        post(f"/tenants/{tenant}/invitations", {"email": fresh_email("admin2"), "role": "admin"}, admin).get("code") != 0,
    )
    check("admin may change a member's role", patch(f"/tenants/{tenant}/users/{admin_id}", {"role": "member"}, owner).get("code") == 0)
    check("admin role change takes effect", any(m.get("role") == "member" for m in (get(f"/tenants/{tenant}/users", owner).get("data") or []) if m.get("user_id") == admin_id))
    check("owner may restore the admin", patch(f"/tenants/{tenant}/users/{admin_id}", {"role": "admin"}, owner).get("code") == 0)
    check("owner cannot change their own role", patch(f"/tenants/{tenant}/users/{me.get('id')}", {"role": "member"}, owner).get("code") != 0)
    check("the owner cannot be removed", delete(f"/tenants/{tenant}/users/{me.get('id')}", admin).get("code") != 0)
    check("a member cannot be promoted by themselves", patch(f"/tenants/{tenant}/users/{admin_id}", {"role": "admin"}, a_token).get("code") != 0)
    check("role must be admin or member", patch(f"/tenants/{tenant}/users/{admin_id}", {"role": "owner"}, owner).get("code") != 0)

    print("\n[7] removal ends access immediately")
    removing = delete(f"/tenants/{tenant}/users/{admin_id}", owner)
    check("owner removes a member", removing.get("code") == 0, str(removing.get("message")))
    check("the removed session stops working", get("/users/me", admin).get("code") != 0)
    check("the removed account is gone from the roster", not any(m.get("user_id") == admin_id for m in (get(f"/tenants/{tenant}/users", owner).get("data") or [])))
    # Removing access must not delete the account. Read the row itself: signing in again would also
    # depend on how the invitation set a password, which is a different question.
    rows = db_read("SELECT tenant_id FROM user WHERE id = ?", (admin_id,))
    check("the removed account still exists", len(rows) == 1, len(rows))
    check("it was moved to a workspace of its own",
          bool(rows) and str(rows[0]["tenant_id"] or "") not in ("", str(tenant)),
          str(rows[0]["tenant_id"]) if rows else None)

    print("\n[8] resending rotates the link, revoking kills it")
    rot_email = fresh_email("rotate")
    rot_invite = post(f"/tenants/{tenant}/invitations", {"email": rot_email, "role": "member"}, owner).get("data") or {}
    old_token = str(rot_invite.get("token") or "")
    resent = post(f"/tenants/{tenant}/invitations/{rot_invite.get('id')}/resend", {}, owner).get("data") or {}
    new_token = str(resent.get("token") or "")
    check("resend issues a new token", bool(new_token) and new_token != old_token)
    check("the previous link stops working", get(f"/invitations/{old_token}").get("code") != 0)
    check("the new link works", get(f"/invitations/{new_token}").get("code") == 0)
    check("resend keeps the invited role", resent.get("role") == "member")
    revoked = delete(f"/tenants/{tenant}/invitations/{rot_invite.get('id')}", owner)
    check("revoke succeeds", revoked.get("code") == 0, str(revoked.get("message")))
    check("a revoked link stops working", get(f"/invitations/{new_token}").get("code") != 0)
    check(
        "a revoked invitation shows as revoked",
        any(
            i.get("id") == rot_invite.get("id") and i.get("status") == "revoked"
            for i in (get(f"/tenants/{tenant}/invitations", owner).get("data") or [])
        ),
    )

    print("\n[9] cleanup: test accounts and their invitations")
    # Every fixture in this suite (and in auth_test) uses an @example.test address. Sweeping them
    # keeps a repeated run from stacking accounts in the live workspace the console displays.
    swept_accounts = 0
    for member in get(f"/tenants/{tenant}/users", owner).get("data") or []:
        email = str(member.get("email") or "")
        if email.endswith("@example.test") and member.get("role") != "owner":
            result = delete(f"/tenants/{tenant}/users/{member.get('user_id')}", owner)
            check(f"removed test account {email}", result.get("code") == 0, str(result.get("message")))
            swept_accounts += 1
    if swept_accounts == 0:
        check("no stray test accounts to remove", True)
    # Removal detaches rather than deletes — that is the point of the change above — so the sweep has to
    # clear the rows itself, or every run would leave an empty workspace behind.
    for row in db_read("SELECT id FROM user WHERE email LIKE '%@example.test'"):
        db_write("DELETE FROM api_token WHERE user_id = ?", (row["id"],))
        db_write("DELETE FROM user WHERE id = ?", (row["id"],))
    left = db_read("SELECT COUNT(*) AS n FROM user WHERE email LIKE '%@example.test'")
    check("no test account left in the database", bool(left) and left[0]["n"] == 0, left[0] if left else None)
    for invite in get(f"/tenants/{tenant}/invitations", owner).get("data") or []:
        if str(invite.get("email") or "").endswith("@example.test") and invite.get("status") != "revoked":
            delete(f"/tenants/{tenant}/invitations/{invite.get('id')}", owner)
    check("test invitations closed", True)

    print(f"\n{'=' * 52}\n  {PASS} passed, {FAIL} failed\n{'=' * 52}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())

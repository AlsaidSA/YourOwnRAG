# Copyright 2026 OwnRAG contributors — Apache-2.0.
"""
OwnRAG engine — workspace team: members, invitations and roles.

Kept out of `api.py` so the HTTP surface stays thin and these rules can be exercised without a
server or a model:

- a workspace has one **owner** (the account the engine is configured with), plus any number of
  **admins** and **members**. Roles live on `user.role`; `is_admin` is written alongside for the
  routes that predate roles, and a row with no role falls back to deriving one from `is_admin`, so
  an existing database keeps working without a data migration;
- an invitation is an **opaque token stored only as a SHA-256 hash**. The plaintext is returned
  exactly once — when the invitation is created — and resending rotates it. A leaked database
  therefore cannot be used to join a workspace. SHA-256 rather than scrypt is deliberate: the token
  is high-entropy random, not a human password, so there is nothing to brute-force;
- invitations expire (`OWNRAG_INVITE_TTL_DAYS`, default 7) and can be revoked;
- **authority is enforced here, not in the console**: only the owner may create or remove an admin,
  the owner's own role is immutable, and nobody may change their own role or remove themselves.

Every mutation records an `audit_log` row through `auth.audit`.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import time
from typing import Any
from typing import Any

from . import auth
from .core import new_id, now_ms, one, q, x

ROLES = ("owner", "admin", "member")
# Who may act on whom. `member` cannot manage anything.
RANK = {"owner": 3, "admin": 2, "member": 1}
# A role a manager is allowed to hand out through an invitation or a role change.
GRANTABLE = ("admin", "member")
STATUSES = ("pending", "accepted", "revoked", "expired")


def ttl_ms() -> int:
    """Invitation lifetime. Configurable because a deployment may want shorter-lived links."""
    try:
        days = int(os.environ.get("OWNRAG_INVITE_TTL_DAYS", "7") or 7)
    except ValueError:
        days = 7
    return max(1, days) * 86_400_000


def hash_token(token: str) -> str:
    """Storage form of an invitation token. Never store the token itself."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def role_of(row) -> str:
    """Stored role, or one derived from `is_admin` for a row written before roles existed."""
    role = (row["role"] if "role" in row.keys() else None) or ""
    if role in ROLES:
        return role
    return "owner" if row["is_admin"] else "member"


def can_manage(row) -> bool:
    """May this account invite people and manage members?"""
    return RANK.get(role_of(row), 0) >= RANK["admin"]


def is_owner(row) -> bool:
    return role_of(row) == "owner"


# --------------------------------------------------------------------------- members


def members(tenant_id: str) -> list[dict]:
    """Active accounts in the workspace, owner first then admins then members."""
    rows = q(
        "SELECT * FROM user WHERE COALESCE(NULLIF(tenant_id, ''), ?) = ?"
        " ORDER BY create_time",
        (tenant_id, tenant_id),
    )
    out = [
        {
            "user_id": r["id"],
            "email": r["email"],
            "nickname": r["nickname"],
            "role": role_of(r),
            "avatar": r["avatar"],
            "status": "active",
            "is_admin": bool(r["is_admin"]),
            "create_time": r["create_time"],
        }
        for r in rows
    ]
    out.sort(key=lambda m: (-RANK.get(m["role"], 0), m["create_time"] or 0))
    return out


def member_count(tenant_id: str) -> int:
    row = one(
        "SELECT COUNT(*) AS n FROM user WHERE COALESCE(NULLIF(tenant_id, ''), ?) = ?",
        (tenant_id, tenant_id),
    )
    return int(row["n"]) if row else 0


# --------------------------------------------------------------------------- invitations


def status_of(row) -> str:
    """The status to report: a pending invitation past its expiry is expired, not pending."""
    status = row["status"] or "pending"
    if status == "pending" and (row["expires_at"] or 0) < now_ms():
        return "expired"
    return status


def _shape(row, base: str | None = None, token: str | None = None) -> dict:
    data = {
        "id": row["id"],
        "tenant_id": row["tenant_id"],
        "email": row["email"],
        "role": row["role"],
        "status": status_of(row),
        "create_time": row["create_time"],
        "expires_at": row["expires_at"],
        "invited_by": row["invited_by"],
        "accepted_at": row["accepted_at"] if "accepted_at" in row.keys() else None,
    }
    # The link is only knowable at the moment the token exists. A resend returns it again; after
    # that the plaintext is gone by design and the console shows "resend" instead of a link.
    if base and token:
        data["token"] = token
        data["invite_url"] = f"{base.rstrip('/')}/invite/{token}"
    return data


def invites(tenant_id: str, limit: int = 200) -> list[dict]:
    rows = q(
        "SELECT * FROM team_invite WHERE tenant_id = ? ORDER BY create_time DESC LIMIT ?",
        (tenant_id, limit),
    )
    return [_shape(r) for r in rows]


def invite_for_token(token: str):
    """The invitation behind a presented token, or None when it is unknown, used, or expired."""
    if not token:
        return None
    row = one("SELECT * FROM team_invite WHERE token_hash = ?", (hash_token(token),))
    if row is None:
        return None
    return row if status_of(row) == "pending" else None


def describe_invite(row) -> dict:
    """What a stranger holding an invitation link is allowed to see: the workspace, role and expiry."""
    return {
        "tenant_id": row["tenant_id"],
        "email": row["email"],
        "role": row["role"],
        "expires_at": row["expires_at"],
        "status": status_of(row),
    }


def create_invite(actor, tenant_id: str, email: str, role: str, base: str | None = None) -> tuple[dict | None, str | None]:
    """Invite an address to the workspace. Returns (invitation, error)."""
    if not can_manage(actor):
        return None, "You do not have permission to invite people"
    email = (email or "").strip().lower()
    problem = auth.email_problem(email)
    if problem:
        return None, problem
    if role not in GRANTABLE:
        return None, "Choose a role of admin or member"
    if not is_owner(actor) and role == "admin":
        return None, "Only the workspace owner can invite an admin"

    existing = one("SELECT id FROM user WHERE lower(email) = ?", (email,))
    if existing:
        return None, "That email already belongs to a member of this workspace"

    # An invitation that is still live must not be duplicated — resend it instead, so the address
    # never ends up holding two links with different expiries.
    live = one(
        "SELECT * FROM team_invite WHERE tenant_id = ? AND lower(email) = ? AND status = 'pending'",
        (tenant_id, email),
    )
    if live is not None and status_of(live) == "pending":
        return None, "That address already has a pending invitation"

    token = secrets.token_urlsafe(24)
    invite_id = new_id("inv")
    x(
        "INSERT INTO team_invite (id, tenant_id, email, role, token_hash, invited_by, create_time,"
        " expires_at, status) VALUES (?,?,?,?,?,?,?,?,?)",
        (invite_id, tenant_id, email, role, hash_token(token), actor["id"], now_ms(), now_ms() + ttl_ms(), "pending"),
    )
    auth.audit("invite_created", actor["email"], "", f"{email} as {role}")
    row = one("SELECT * FROM team_invite WHERE id = ?", (invite_id,))
    return _shape(row, base, token), None


def resend_invite(actor, tenant_id: str, invite_id: str, base: str | None = None) -> tuple[dict | None, str | None]:
    """Rotate an invitation's token and extend its life. The old link stops working."""
    if not can_manage(actor):
        return None, "You do not have permission to manage invitations"
    row = one("SELECT * FROM team_invite WHERE id = ? AND tenant_id = ?", (invite_id, tenant_id))
    if row is None:
        return None, "Invitation not found"
    if row["status"] == "accepted":
        return None, "That invitation has already been accepted"
    token = secrets.token_urlsafe(24)
    x(
        "UPDATE team_invite SET token_hash = ?, expires_at = ?, status = 'pending' WHERE id = ?",
        (hash_token(token), now_ms() + ttl_ms(), invite_id),
    )
    auth.audit("invite_resent", actor["email"], "", row["email"])
    return _shape(one("SELECT * FROM team_invite WHERE id = ?", (invite_id,)), base, token), None


def revoke_invite(actor, tenant_id: str, invite_id: str) -> tuple[bool, str | None]:
    if not can_manage(actor):
        return False, "You do not have permission to manage invitations"
    row = one("SELECT * FROM team_invite WHERE id = ? AND tenant_id = ?", (invite_id, tenant_id))
    if row is None:
        return False, "Invitation not found"
    if row["status"] == "accepted":
        return False, "That invitation has already been accepted"
    x("UPDATE team_invite SET status = 'revoked' WHERE id = ?", (invite_id,))
    auth.audit("invite_revoked", actor["email"], "", row["email"])
    return True, None


def accept_invite(token: str, password: str, nickname: str = "") -> tuple[Any | None, str | None]:
    """Turn an invitation into an account. Returns (user row, error)."""
    row = invite_for_token(token)
    if row is None:
        return None, "This invitation link is not valid any more"
    email = row["email"]
    if one("SELECT id FROM user WHERE lower(email) = ?", (email,)):
        # Refuse rather than attach a role to an account someone else may control: the invitee
        # signs in with the account they already have, and the owner grants access deliberately.
        return None, "That email already has an account. Sign in instead."
    problem = auth.password_problem(password, email)
    if problem:
        return None, problem

    user_id = new_id("user")
    role = row["role"] if row["role"] in ROLES else "member"
    x(
        "INSERT INTO user (id, email, password, nickname, tenant_id, is_admin, role, create_time)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (
            user_id,
            email,
            auth.hash_password(password),
            (nickname or "").strip()[:64] or email.split("@")[0],
            row["tenant_id"],
            1 if role == "admin" else 0,
            role,
            now_ms(),
        ),
    )
    x(
        "UPDATE team_invite SET status = 'accepted', accepted_by = ?, accepted_at = ? WHERE id = ?",
        (user_id, now_ms(), row["id"]),
    )
    auth.audit("invite_accepted", email, "", f"role {role} in {row['tenant_id']}")
    return one("SELECT * FROM user WHERE id = ?", (user_id,)), None


# --------------------------------------------------------------------------- role changes


def change_role(actor, tenant_id: str, user_id: str, role: str) -> tuple[dict | None, str | None]:
    if not can_manage(actor):
        return None, "You do not have permission to change roles"
    if role not in GRANTABLE:
        return None, "Choose a role of admin or member"
    target = one("SELECT * FROM user WHERE id = ?", (user_id,))
    if target is None:
        return None, "Member not found"
    if target["id"] == actor["id"]:
        return None, "You cannot change your own role"
    if is_owner(target):
        return None, "The workspace owner's role cannot be changed"
    if not is_owner(actor):
        # An admin may not create or demote another admin — that would let one admin escalate
        # sideways past the owner's authority.
        if role == "admin" or role_of(target) == "admin":
            return None, "Only the workspace owner can manage admins"

    x("UPDATE user SET role = ?, is_admin = ? WHERE id = ?", (role, 1 if role == "admin" else 0, user_id))
    auth.audit("role_changed", actor["email"], "", f"{target['email']} -> {role}")
    return {"user_id": user_id, "email": target["email"], "role": role}, None


def remove_member(actor, tenant_id: str, user_id: str) -> tuple[bool, str | None]:
    if not can_manage(actor):
        return False, "You do not have permission to remove members"
    target = one("SELECT * FROM user WHERE id = ?", (user_id,))
    if target is None:
        return False, "Member not found"
    if target["id"] == actor["id"]:
        return False, "You cannot remove yourself"
    if is_owner(target):
        return False, "The workspace owner cannot be removed"
    if role_of(target) == "admin" and not is_owner(actor):
        return False, "Only the workspace owner can remove an admin"

    # Sessions die with the membership, otherwise a removed member keeps the access they were
    # removed for until their token happens to expire.
    x("DELETE FROM api_token WHERE user_id = ?", (user_id,))
    # Removing access is not deleting the account. The person keeps their account — and the knowledge
    # bases they created — in a workspace of their own; what they lose is this one.
    x(
        "UPDATE user SET tenant_id = ?, role = 'member', is_admin = 0 WHERE id = ?",
        (new_id("tenant"), user_id),
    )
    auth.audit("member_removed", actor["email"], "", f"{target['email']} -> workspace of their own")
    return True, None

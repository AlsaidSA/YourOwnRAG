# Copyright 2026 OwnRAG contributors — Apache-2.0.
"""Who may see what.

A workspace is not a shared folder. The owner and admins manage workspace content, so they see
everything in it; a member sees the knowledge bases and chats they created, plus anything
explicitly marked for the team. None of this is a console concern: the console hides what this
refuses, and this refuses it anyway.
"""
from __future__ import annotations

from typing import Any

MANAGER_ROLES = {"owner", "admin"}
TEAM_PERMISSION = "team"


def _field(row: Any, name: str) -> Any:
    """Read a column from a sqlite3.Row, a dict, or None without exploding."""
    if row is None:
        return None
    try:
        return row[name]
    except (KeyError, IndexError, TypeError):
        pass
    getter = getattr(row, "get", None)
    if callable(getter):
        return getter(name)
    return getattr(row, name, None)


def role_of(user: Any) -> str:
    """The user's role, derived when the row predates roles."""
    role = _field(user, "role")
    if role:
        return str(role)
    if user is None:
        return ""
    from . import team

    return team.role_of(user)


def is_manager(user: Any) -> bool:
    """True for the roles that manage workspace content: owner and admin."""
    return role_of(user) in MANAGER_ROLES


def identity(user: Any) -> set[str]:
    """The strings a `created_by` column may hold for this user: id and email."""
    out: set[str] = set()
    for key in ("id", "email"):
        value = _field(user, key)
        if value:
            out.add(str(value))
    return out


def sees_row(user: Any, row: Any) -> bool:
    """The one visibility rule: workspace first, then role.

    A workspace is not a shared folder. A row belongs to a workspace, and only that workspace's accounts
    may reach it at all; inside it, a manager sees the workspace and a member sees what it created (or
    what is explicitly marked for the team). Every listing and every by-id read goes through here, so a
    new surface cannot be added without a decision about who may see it.
    """
    if row is None:
        return False
    tenant = str(_field(row, "tenant_id") or "")
    if tenant and tenant != tenant_of(user):
        return False
    if is_manager(user):
        return True
    if not str(_field(row, "created_by") or ""):
        # The table cannot say who made this row — connectors, agents, files and tool servers do not
        # record it — so the row is workspace infrastructure: shared inside the workspace the tenant
        # check above just confirmed, and invisible outside it.
        return True
    if str(_field(row, "permission") or "me") == TEAM_PERMISSION:
        return True
    return str(_field(row, "created_by") or "") in identity(user)


def in_workspace(user: Any, rows: Any) -> list:
    """The rows of `rows` this user may reach — the filter every listing applies."""
    return [r for r in rows if sees_row(user, r)]


def may_reach(user: Any, table: str, row_id: str) -> bool:
    """Whether the id names a row of `table` in this user's workspace (used by the path guard)."""
    if not row_id:
        return True
    from .core import one

    return sees_row(user, one("SELECT * FROM " + table + " WHERE id = ?", (row_id,)))


def can_see_dataset(user: Any, row: Any) -> bool:
    """Kept as a name: a dataset follows the same rule as every other row."""
    return sees_row(user, row)


def can_see_chat(user: Any, row: Any) -> bool:
    """Kept as a name: an assistant follows the same rule as every other row."""
    return sees_row(user, row)


def tenant_of(user: Any) -> str:
    """The workspace this account belongs to.

    Accounts written before workspaces existed have no tenant of their own; startup places them in the
    owner's workspace, so the constant is only a last resort here.
    """
    from .core import TENANT_ID

    return str(_field(user, "tenant_id") or "") or TENANT_ID


def visible_dataset_ids(user: Any) -> set[str]:
    """Dataset ids this user may reach: their workspace's, narrowed to their own for a member.

    This used to answer `None` for a manager, meaning "every dataset on the engine" — which is how the
    owner's Knowledge page came to list a knowledge base belonging to another workspace.
    """
    from .core import q

    return {r["id"] for r in q("SELECT * FROM dataset") if sees_row(user, r)}


def reachable_dataset_ids(user: Any, wanted: Any) -> list[str]:
    """The subset of `wanted` this user may reach."""
    if wanted is None:
        return []
    if isinstance(wanted, str):
        wanted = [wanted]
    allowed = visible_dataset_ids(user)
    return [str(d) for d in wanted if str(d) in allowed]


def may_reach_dataset(user: Any, dataset_id: str) -> bool:
    """Whether the id names a dataset this user may reach (used by the path guard)."""
    if not dataset_id:
        return True
    return dataset_id in visible_dataset_ids(user)


def may_reach_chat(user: Any, chat_id: str) -> bool:
    """Whether the id names a chat this user may reach (used by the path guard).

    This used to answer True for any manager without looking at the row, which was safe while exactly one
    account was a manager. Now that every workspace has one, it would have let an owner of one workspace
    read another's assistant by id. The row decides.
    """
    if not chat_id:
        return True
    from .core import one

    return can_see_chat(user, one("SELECT * FROM chat WHERE id = ?", (chat_id,)))

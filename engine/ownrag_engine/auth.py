# Copyright 2026 OwnRAG contributors — Apache-2.0.
"""
OwnRAG engine — accounts, credentials and sessions.

Everything a real user account needs, kept out of `api.py` so the HTTP surface stays thin and this
module can be exercised without a server or a model:

- passwords are stored only as **scrypt hashes** (`hashlib.scrypt`, standard library), never in
  plaintext; a legacy plaintext row is still verifiable so an existing database keeps working, and
  the caller is told to re-hash it on the next successful sign-in;
- comparison is constant-time (`hmac.compare_digest`), so a wrong password cannot be found one
  character at a time;
- repeated failures lock an account for a cooling-off period (in-process state — a multi-worker
  deployment needs shared state; see `docs/SECURITY.md`);
- sessions are opaque random tokens with an expiry and an owning user id, so a token can be
  revoked individually and cannot outlive its configured TTL.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import threading
import time

from .core import TENANT_ID, new_id, now_ms, one, q, x

# scrypt parameters. n=2**14 with r=8/p=1 is the interactive-login profile: ~16 MB and a few
# milliseconds per hash, which is expensive for a guessing attacker and invisible to a user.
_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1
_HASH_PREFIX = "scrypt"

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 256

# A session is long enough to be useful and short enough to matter. Override with
# OWNRAG_TOKEN_TTL_DAYS; 0 disables expiry entirely (single-operator local use only).
TOKEN_TTL_MS = int(os.environ.get("OWNRAG_TOKEN_TTL_DAYS", "30") or 0) * 24 * 60 * 60 * 1000

# Lockout: this many failures inside the window locks the account for LOCK_MS.
MAX_FAILURES = int(os.environ.get("OWNRAG_MAX_LOGIN_FAILURES", "5") or 5)
FAILURE_WINDOW_MS = 15 * 60 * 1000
LOCK_MS = 15 * 60 * 1000

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]+$")

_failures: dict[str, list[int]] = {}
_failures_lock = threading.Lock()


# --------------------------------------------------------------------------- passwords


def hash_password(password: str) -> str:
    """Return a self-describing scrypt hash: `scrypt$n$r$p$salt$hash` (both parts base64)."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32
    )
    return "$".join(
        [
            _HASH_PREFIX,
            str(_SCRYPT_N),
            str(_SCRYPT_R),
            str(_SCRYPT_P),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(digest).decode("ascii"),
        ]
    )


def verify_password(stored: str, password: str) -> tuple[bool, bool]:
    """
    Check `password` against a stored value.

    Returns `(ok, needs_rehash)`. A stored value without the `scrypt$` prefix is a legacy
    plaintext row (or an empty owner password): it is compared in constant time, and `needs_rehash`
    is True so the caller can upgrade it instead of leaving it readable in the database.
    """
    stored = stored or ""
    if stored.startswith(_HASH_PREFIX + "$"):
        try:
            _, n, r, p, salt_b64, hash_b64 = stored.split("$")
            digest = hashlib.scrypt(
                password.encode("utf-8"),
                salt=base64.b64decode(salt_b64),
                n=int(n),
                r=int(r),
                p=int(p),
                dklen=len(base64.b64decode(hash_b64)),
            )
        except (ValueError, TypeError):
            return False, False
        return hmac.compare_digest(digest, base64.b64decode(hash_b64)), False
    # Legacy plaintext. Constant-time so the comparison itself leaks nothing.
    ok = hmac.compare_digest(stored.encode("utf-8"), password.encode("utf-8"))
    return ok, ok


def password_problem(password: str, email: str = "") -> str | None:
    """Return a human-readable reason a password is unacceptable, or None when it is fine."""
    if not password:
        return "Password is required"
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
    if len(password) > MAX_PASSWORD_LENGTH:
        return f"Password must be at most {MAX_PASSWORD_LENGTH} characters"
    if password.lower() in {"password", "12345678", "qwertyui", "ownrag123", "changeme"}:
        return "That password is too common — pick something else"
    local = (email.split("@")[0] or "").lower()
    if local and local == password.lower():
        return "Password must not be your email name"
    return None


def email_problem(email: str) -> str | None:
    if not email:
        return "Email is required"
    if len(email) > 254 or not _EMAIL_RE.match(email):
        return "Enter a valid email address"
    return None


# --------------------------------------------------------------------------- lockout


def _key(email: str, ip: str = "") -> str:
    return f"{email.strip().lower()}|{ip}"


def is_locked(email: str, ip: str = "") -> int:
    """Seconds a sign-in attempt must wait, or 0 when the account may try now."""
    now = now_ms()
    with _failures_lock:
        stamps = [t for t in _failures.get(_key(email, ip), []) if now - t < FAILURE_WINDOW_MS]
        if stamps:
            _failures[_key(email, ip)] = stamps
        else:
            _failures.pop(_key(email, ip), None)
        if len(stamps) < MAX_FAILURES:
            return 0
        return max(1, int((stamps[-1] + LOCK_MS - now) / 1000))


def note_failure(email: str, ip: str = "") -> None:
    with _failures_lock:
        _failures.setdefault(_key(email, ip), []).append(now_ms())


def clear_failures(email: str, ip: str = "") -> None:
    with _failures_lock:
        _failures.pop(_key(email, ip), None)


# --------------------------------------------------------------------------- sessions


def issue_token(user_row, name: str = "session") -> str:
    """Mint an opaque session token bound to a user, with an expiry."""
    token = new_id("tok") + new_id("").replace("_", "")
    x(
        "INSERT INTO api_token (id, tenant_id, token, name, create_time, last_used, user_id, expires_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (
            new_id("tok"),
            user_row["tenant_id"] or TENANT_ID,
            token,
            name,
            now_ms(),
            now_ms(),
            user_row["id"],
            now_ms() + TOKEN_TTL_MS if TOKEN_TTL_MS else 0,
        ),
    )
    return token


def token_row(token: str):
    """The token row when it exists and has not expired, else None. Expired rows are removed."""
    if not token:
        return None
    row = one("SELECT * FROM api_token WHERE token = ?", (token,))
    if row is None:
        return None
    expires_at = row["expires_at"] if "expires_at" in row.keys() else 0
    if expires_at and int(expires_at) < now_ms():
        x("DELETE FROM api_token WHERE id = ?", (row["id"],))
        return None
    return row


def user_for_token(token: str):
    """Resolve the account a session belongs to. Legacy tokens fall back to the owner row."""
    row = token_row(token)
    if row is None:
        return None
    user_id = row["user_id"] if "user_id" in row.keys() else None
    if user_id:
        return one("SELECT * FROM user WHERE id = ?", (user_id,))
    return None


def touch_token(token: str) -> None:
    """Record last use. Cheap, and it is the only session telemetry this engine keeps."""
    try:
        x("UPDATE api_token SET last_used = ? WHERE token = ?", (now_ms(), token))
    except Exception:  # pragma: no cover - telemetry must never break a request
        pass


def prune_tokens() -> int:
    """Delete expired sessions. Called at startup so the table cannot grow without bound."""
    if not TOKEN_TTL_MS:
        return 0
    conn = q("SELECT id, expires_at FROM api_token WHERE expires_at > 0 AND expires_at < ?", (now_ms(),))
    for row in conn:
        x("DELETE FROM api_token WHERE id = ?", (row["id"],))
    return len(conn)


def revoke_token(token: str) -> None:
    x("DELETE FROM api_token WHERE token = ?", (token,))


# --------------------------------------------------------------------------- audit


def audit(event: str, email: str = "", ip: str = "", detail: str = "") -> None:
    """
    Append an auth event. Sign-in success, failure, lockout, signup and revocation are the events
    worth keeping: with them, "who got in and when" is answerable after the fact.
    """
    try:
        x(
            "INSERT INTO audit_log (id, at, event, email, ip, detail) VALUES (?,?,?,?,?,?)",
            (new_id("aud"), now_ms(), event, email[:254], ip[:64], detail[:400]),
        )
    except Exception:  # pragma: no cover - auditing must never break a request
        pass


def client_ip(request) -> str:
    """Best-effort client address. Only meaningful behind a proxy that sets these headers."""
    for header in ("x-forwarded-for", "x-real-ip"):
        value = request.headers.get(header)
        if value:
            return value.split(",")[0].strip()
    return request.client.host if request.client else ""

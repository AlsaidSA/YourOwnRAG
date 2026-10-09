# Copyright 2026 OwnRAG contributors — Apache-2.0.
"""Prove a held database lock cannot take the engine down.

The defect this guards: with another connection holding SQLite's write lock, the engine's login handler
died on its own `UPDATE user SET last_login` with `sqlite3.OperationalError: database is locked`, and
the shared connection was left in a broken transaction — every later request, sign-in included,
answered 500 until the process was restarted. Eleven of them were logged.

What must hold, and has failed at least once:

  1. a lock held briefly is waited for, so the request still succeeds;
  2. a lock held longer than the timeout never fails *instantly* — it gives up honestly, after waiting;
  3. the very next request succeeds. No restart, ever. That is the property the defect broke.

This takes about half a minute on purpose: it holds the lock for 5 s and then 20 s.
"""
from __future__ import annotations

import json
import pathlib
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request

DB = pathlib.Path(__file__).resolve().parent / "data" / "ownrag.db"
BASE = "http://127.0.0.1:9380/api/v1"
SHORT_LOCK_S = 5.0
LONG_LOCK_S = 20.0

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


def login() -> tuple[int, float]:
    """Sign in, and report how long the engine took to answer."""
    body = json.dumps({"email": "owner@ownrag.local", "password": ""}).encode()
    request = urllib.request.Request(
        BASE + "/auth/login", method="POST", data=body, headers={"Content-Type": "application/json"}
    )
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return response.status, time.time() - started
    except urllib.error.HTTPError as error:
        return error.code, time.time() - started


def hold_write_lock(seconds: float, done: dict) -> None:
    """Take SQLite's write lock in this thread's own connection, then let go."""
    conn = sqlite3.connect(str(DB), timeout=60)
    try:
        conn.execute("BEGIN IMMEDIATE")
        done["held"] = True
        time.sleep(seconds)
        conn.commit()
    finally:
        conn.close()


def under_lock(seconds: float) -> tuple[int, float]:
    """Run one sign-in while a separate connection holds the write lock for `seconds`."""
    done: dict = {}
    thread = threading.Thread(target=hold_write_lock, args=(seconds, done), daemon=True)
    thread.start()
    while not done.get("held"):
        time.sleep(0.05)
    status, elapsed = login()
    thread.join()
    return status, elapsed


def main() -> int:
    print("=" * 68)
    print("  a held lock must not brick the engine")
    print("=" * 68)

    try:
        status, _ = login()
    except Exception as error:  # a dead engine is a failure, not a crash
        check("the engine answers with no lock held", False, error)
        return 1
    check("the engine answers with no lock held", status == 200, status)

    print("\n[1] a short lock is waited for, not treated as fatal")
    status, elapsed = under_lock(SHORT_LOCK_S)
    check("the sign-in succeeds while the lock is held", status == 200, status)
    check("and it waited for the lock rather than racing past it", elapsed >= (SHORT_LOCK_S / 2), round(elapsed, 1))

    print("\n[2] a lock longer than the timeout gives up honestly")
    status, elapsed = under_lock(LONG_LOCK_S)
    check("the sign-in did not fail instantly", elapsed >= 10.0, round(elapsed, 1))
    print("  [info] the sign-in returned " + str(status) + " after " + str(round(elapsed, 1)) + "s")

    print("\n[3] the engine recovers without a restart")
    status, elapsed = login()
    check("the very next sign-in succeeds", status == 200, status)
    check("and nothing is still held against it", elapsed < 10.0, round(elapsed, 1))

    print("\n[4] the engine is still healthy")
    try:
        health = urllib.request.urlopen("http://127.0.0.1:9380/health", timeout=30)
        check("the health endpoint answers", health.status == 200, health.status)
    except Exception as error:
        check("the health endpoint answers", False, error)

    print("\n" + "=" * 68)
    print("  " + str(PASS) + " passed, " + str(FAIL) + " failed")
    print("=" * 68)
    for label in PROBLEMS:
        print("  failed: " + label)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())

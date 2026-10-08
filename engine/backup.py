# Copyright 2026 OwnRAG contributors — Apache-2.0.
"""
Backup and restore for the local engine.

Two things have to be copied *together* to be restorable: the SQLite database (chunks, index,
accounts, provider keys) and the document store (`data/files`). A consistent database copy is taken
through SQLite's own backup API rather than a file copy, so it is safe to run while the engine is
writing.

    cd engine && ./.venv/Scripts/python.exe backup.py                # one snapshot
    cd engine && ./.venv/Scripts/python.exe backup.py --keep 14      # snapshot, then prune
    cd engine && ./.venv/Scripts/python.exe backup.py --list         # what exists

Restore: stop the engine, copy `ownrag.db` and `files/` out of a snapshot into `engine/data/`, start.
There is no incremental format and no tooling to learn — a snapshot is a directory.
"""
from __future__ import annotations

import argparse
import datetime as dt
import pathlib
import shutil
import sqlite3
import sys

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE / "data"
DB = DATA / "ownrag.db"
FILES = DATA / "files"
BACKUPS = HERE / "backups"


def snapshot() -> pathlib.Path:
    """Take one consistent snapshot and return its directory."""
    if not DB.exists():
        raise SystemExit(f"no database at {DB} — nothing to back up")
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    target = BACKUPS / stamp
    (target / "files").mkdir(parents=True, exist_ok=True)

    # SQLite's backup API: consistent even while the engine holds the database open.
    source = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    dest = sqlite3.connect(target / "ownrag.db")
    with dest:
        source.backup(dest)
    source.close()
    dest.close()

    if FILES.exists():
        shutil.copytree(FILES, target / "files", dirs_exist_ok=True)

    # Verify the copy rather than trusting the call: open it and count what matters.
    check = sqlite3.connect(target / "ownrag.db")
    counts = {
        table: check.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in ("dataset", "document", "chunk", "user", "api_token")
    }
    check.close()
    size = sum(f.stat().st_size for f in target.rglob("*") if f.is_file())
    print(f"  snapshot {target}")
    print(f"    {counts}")
    print(f"    {len(list((target / 'files').rglob('*')))} file entries, {size / 1e6:.1f} MB")
    return target


def prune(keep: int) -> None:
    snapshots = sorted((d for d in BACKUPS.glob("*") if d.is_dir()), key=lambda d: d.name)
    for old in snapshots[:-keep] if keep else []:
        shutil.rmtree(old)
        print(f"  pruned {old.name}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Snapshot the engine's database and documents.")
    parser.add_argument("--keep", type=int, default=0, help="after snapshotting, keep only the newest N")
    parser.add_argument("--list", action="store_true", help="list existing snapshots and exit")
    args = parser.parse_args()

    if args.list:
        for d in sorted(BACKUPS.glob("*")) if BACKUPS.exists() else []:
            size = sum(f.stat().st_size for f in d.rglob("*") if f.is_file()) if d.is_dir() else 0
            print(f"  {d.name}  {size / 1e6:.1f} MB")
        return 0

    snapshot()
    if args.keep:
        prune(args.keep)
    return 0


if __name__ == "__main__":
    sys.exit(main())

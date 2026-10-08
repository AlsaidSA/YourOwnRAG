"""
Connector sync check.

Source types are checked against what they claim: `web` is pulled from a local HTTP server, and the
token-based sources are driven against a stub Google/Graph API in-process, so the code path that
would read a real Drive or Gmail is exercised without a Google account. Sources that need something
this engine does not have must say so rather than report an empty success.

    cd engine && .venv/Scripts/python.exe connectors_test.py
"""

from __future__ import annotations

import base64
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests

ENGINE = "http://127.0.0.1:9380/api/v1"
STUB = "http://127.0.0.1:9398"
PAGE_PHRASE = "connector sync reached this page"
DRIVE_PHRASE = "drive contract clause 7 termination notice"
MAIL_PHRASE = "renewal window closes on the twenty first"
results: list[tuple[bool, str, str]] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    results.append((bool(ok), label, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{' — ' + detail if detail else ''}", flush=True)


class Stub(BaseHTTPRequestHandler):
    """One server standing in for a web page, a Drive API and a Gmail API."""

    def _send(self, body: bytes, content_type: str = "application/json", status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler's naming
        path = self.path.split("?", 1)[0]  # query strings carry the export mime type and the API key
        if path.startswith("/page.html"):
            html = f"<html><body><h1>Handbook</h1><p>{PAGE_PHRASE}.</p></body></html>"
            return self._send(html.encode("utf-8"), "text/html")
        if path.startswith("/drive/v3/files/") and path.endswith("/export"):
            return self._send(DRIVE_PHRASE.encode("utf-8"), "text/plain")
        if path.startswith("/drive/v3/files/"):
            return self._send(b"%PDF-1.4 stub", "application/pdf")
        if path.startswith("/drive/v3/files"):
            return self._send(
                json.dumps(
                    {
                        "files": [
                            {"id": "file-1", "name": "contract.pdf", "mimeType": "application/pdf"},
                            {
                                "id": "file-2",
                                "name": "signed notes",
                                "mimeType": "application/vnd.google-apps.document",
                            },
                        ]
                    }
                ).encode("utf-8")
            )
        if path.startswith("/gmail/v1/users/me/messages/"):
            encoded = base64.urlsafe_b64encode(MAIL_PHRASE.encode("utf-8")).decode("ascii")
            return self._send(
                json.dumps(
                    {
                        "payload": {
                            "mimeType": "multipart/alternative",
                            "headers": [{"name": "Subject", "value": "Renewal notice"}],
                            "parts": [{"mimeType": "text/plain", "body": {"data": encoded}}],
                        }
                    }
                ).encode("utf-8")
            )
        if path.startswith("/gmail/v1/users/me/messages"):
            return self._send(json.dumps({"messages": [{"id": "msg-1"}]}).encode("utf-8"))
        if path.startswith("/v1.0/me/drive/root/children"):
            return self._send(
                json.dumps(
                    {
                        "value": [
                            {"id": "sp-1", "name": "sharepoint-notes.txt", "file": {"mimeType": "text/plain"}},
                            {"id": "sp-folder", "name": "folder", "folder": {"childCount": 0}},
                        ]
                    }
                ).encode("utf-8")
            )
        if path.startswith("/v1.0/me/drive/items/sp-1/content"):
            return self._send(b"sharepoint body about quarterly budgets", "text/plain")
        return self._send(json.dumps({"error": "not found"}).encode("utf-8"), status=404)

    def log_message(self, format, *args):  # noqa: A002 - matches BaseHTTPRequestHandler
        return


def login() -> str:
    response = requests.post(
        f"{ENGINE}/auth/login",
        json={"email": "owner@ownrag.local", "password": ""},
        timeout=30,
    ).json()
    return str((response.get("data") or {}).get("access_token") or "")


def headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def first_id(payload: dict) -> str:
    data = payload.get("data")
    if isinstance(data, list):
        data = data[0] if data else {}
    return str((data or {}).get("id") or "")


def new_kb(token: str, name: str) -> str:
    created = requests.post(
        f"{ENGINE}/datasets",
        headers=headers(token),
        json={"name": name, "chunk_method": "naive"},
        timeout=30,
    ).json()
    return first_id({"data": created.get("data")})


def sync(token: str, connector_id: str) -> dict:
    return requests.post(f"{ENGINE}/connectors/{connector_id}/rebuild", headers=headers(token), timeout=180).json()


def documents(token: str, kb_id: str) -> list[dict]:
    response = requests.get(f"{ENGINE}/datasets/{kb_id}/documents", headers=headers(token), timeout=30).json()
    return response.get("data") or []


def search(token: str, kb_id: str, question: str) -> str:
    response = requests.post(
        f"{ENGINE}/datasets/search",
        headers=headers(token),
        json={"question": question, "dataset_ids": [kb_id], "top_k": 8, "keyword": True},
        timeout=60,
    ).json()
    chunks = (response.get("data") or {}).get("chunks") or []
    return " ".join(str(c.get("content_with_weight") or "") for c in chunks)


def wait_for_done(token: str, kb_id: str, deadline: float = 90) -> list[dict]:
    end = time.time() + deadline
    rows: list[dict] = []
    while time.time() < end:
        rows = documents(token, kb_id)
        if rows and all(r.get("run") in {"DONE", "FAIL"} for r in rows):
            return rows
        time.sleep(0.5)
    return rows


def main() -> int:
    print("=" * 78)
    print("  OwnRAG engine — data source (connector) check")
    print("=" * 78)

    stub = HTTPServer(("127.0.0.1", 9398), Stub)
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    token = login()
    if not token:
        print("  could not sign in — is the engine running on 9380?")
        return 1

    kb_id = ""
    created_kbs: list[str] = []
    try:
        print("\n1. web crawl: a real page into a real knowledge base")
        kb_id = new_kb(token, f"Connector check {int(time.time()) % 100000}")
        created_kbs.append(kb_id)
        check("knowledge base created", bool(kb_id))
        web = requests.post(
            f"{ENGINE}/connectors",
            headers=headers(token),
            json={
                "name": "Handbook site",
                "source_type": "web",
                "dataset_ids": [kb_id],
                "schedule": "0 2 * * *",
                "settings": {"urls": [f"{STUB}/page.html"]},
            },
            timeout=30,
        ).json()
        web_id = first_id(web)
        check("web connector created", bool(web_id), str(web.get("message") or ""))

        probed = requests.post(f"{ENGINE}/connectors/{web_id}/test", headers=headers(token), timeout=60).json()
        check("test connection reaches the page", probed.get("code") == 0, str((probed.get("data") or {}).get("message") or probed.get("message")))

        summary = sync(token, web_id)
        check("sync reports the documents it wrote", summary.get("code") == 0, str((summary.get("data") or {}).get("message") or summary.get("message")))
        rows = wait_for_done(token, kb_id)
        check("the page became a document in the knowledge base", len(rows) == 1, f"{len(rows)} documents: {[r.get('name') for r in rows]}")
        check("the document ingested without error", all(r.get("run") == "DONE" for r in rows), str([(r.get("run"), r.get("progress_msg")) for r in rows]))
        if rows:
            page_chunks = (
                requests.get(
                    f"{ENGINE}/datasets/{kb_id}/documents/{rows[0]['id']}/chunks",
                    headers=headers(token),
                    timeout=30,
                ).json().get("data")
                or []
            )
            stored = " ".join(str(c.get("content_with_weight") or "") for c in page_chunks)
            check("the stored chunk text is the page's", PAGE_PHRASE in stored, stored[:70])
        else:
            check("the stored chunk text is the page's", False, "no document to read")
        found = search(token, kb_id, "connector sync page")
        check("the crawled page is searchable", PAGE_PHRASE in found, found[:80])
        detail = requests.get(f"{ENGINE}/connectors/{web_id}", headers=headers(token), timeout=30).json().get("data") or {}
        check("the connector reports what it synced", int(detail.get("documents_synced") or 0) >= 1, f"documents_synced={detail.get('documents_synced')} status={detail.get('status')}")
        logs = requests.get(f"{ENGINE}/connectors/{web_id}/logs", headers=headers(token), timeout=30).json().get("data") or []
        check("the sync is in the connector log", any("Synced" in str(row.get("message")) for row in logs), str(logs[:1]))

        print("\n2. token sources: Drive and Gmail, driven against a stub API")
        drive_kb = new_kb(token, f"Drive check {int(time.time()) % 100000}")
        created_kbs.append(drive_kb)
        drive = requests.post(
            f"{ENGINE}/connectors",
            headers=headers(token),
            json={
                "name": "Drive folder",
                "source_type": "google-drive",
                "dataset_ids": [drive_kb],
                "settings": {"token": "stub-token", "api_base": STUB, "query": "trashed = false"},
            },
            timeout=30,
        ).json()
        drive_id = first_id(drive)
        drive_summary = sync(token, drive_id)
        check("a Drive sync runs with a token", drive_summary.get("code") == 0, str((drive_summary.get("data") or {}).get("message") or drive_summary.get("message")))
        drive_rows = wait_for_done(token, drive_kb)
        names = sorted(str(r.get("name")) for r in drive_rows)
        check("a downloadable Drive file was pulled", "contract.pdf" in names, str(names))
        check("a Google-native doc was exported to text", any(name.endswith(".txt") for name in names), str(names))
        drive_text = search(token, drive_kb, "termination notice clause")
        check("exported Drive content is searchable", DRIVE_PHRASE in drive_text, drive_text[:80])

        gmail_kb = new_kb(token, f"Gmail check {int(time.time()) % 100000}")
        created_kbs.append(gmail_kb)
        gmail = requests.post(
            f"{ENGINE}/connectors",
            headers=headers(token),
            json={
                "name": "Renewals inbox",
                "source_type": "gmail",
                "dataset_ids": [gmail_kb],
                "settings": {"token": "stub-token", "api_base": STUB, "query": "subject:renewal"},
            },
            timeout=30,
        ).json()
        gmail_id = first_id(gmail)
        gmail_summary = sync(token, gmail_id)
        check("a Gmail sync runs with a token", gmail_summary.get("code") == 0, str((gmail_summary.get("data") or {}).get("message") or gmail_summary.get("message")))
        mail_rows = wait_for_done(token, gmail_kb)
        check("the message became a document", len(mail_rows) >= 1, str([r.get("name") for r in mail_rows]))
        mail_text = search(token, gmail_kb, "renewal window")
        check("the message body is searchable", MAIL_PHRASE in mail_text, mail_text[:80])

        print("\n3. sources that need credentials say so")
        for source, expected in (("google-drive", "token"), ("slack", "Slack bot token"), ("s3", "access key")):
            made = requests.post(
                f"{ENGINE}/connectors",
                headers=headers(token),
                json={"name": f"Empty {source}", "source_type": source, "dataset_ids": [kb_id]},
                timeout=30,
            ).json()
            attempt = sync(token, first_id(made))
            message = str(attempt.get("message") or "")
            check(f"{source} without credentials fails with a reason", attempt.get("code") != 0 and expected.lower() in message.lower(), message[:90])

        print("\n4. a connector with no knowledge base is refused, not silently empty")
        orphan = requests.post(
            f"{ENGINE}/connectors",
            headers=headers(token),
            json={"name": "No target", "source_type": "web", "settings": {"urls": [f"{STUB}/page.html"]}},
            timeout=30,
        ).json()
        orphan_result = sync(token, first_id(orphan))
        check(
            "syncing without a target knowledge base is refused",
            orphan_result.get("code") != 0 and "knowledge base" in str(orphan_result.get("message") or "").lower(),
            str(orphan_result.get("message"))[:90],
        )
    finally:
        for kb in created_kbs:
            requests.delete(f"{ENGINE}/datasets/{kb}", headers=headers(token), timeout=30)
        for made in q_all_connectors(token):
            if str(made.get("name", "")).startswith(("Handbook", "Drive folder", "Renewals", "Empty", "No target")):
                requests.delete(f"{ENGINE}/connectors/{made.get('id')}", headers=headers(token), timeout=30)
        stub.shutdown()

    failed = [label for ok, label, _ in results if not ok]
    print("\n" + "=" * 78)
    print(f"  {len(results) - len(failed)} passed · {len(failed)} failed")
    for label in failed:
        print(f"    - {label}")
    print("=" * 78)
    return 1 if failed else 0


def q_all_connectors(token: str) -> list[dict]:
    response = requests.get(f"{ENGINE}/connectors", headers=headers(token), timeout=30).json()
    return response.get("data") or []


if __name__ == "__main__":
    raise SystemExit(main())

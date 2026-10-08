"""
OwnRAG console ↔ engine integration check.

Everything here goes through the console's own dev proxy on :5173 — the same origin, paths and
envelope the browser uses — so a pass means the UI's requests are being served, not just the
engine's raw port. Run with both halves up:

    cd engine && .venv/Scripts/python.exe check_console_path.py
"""

from __future__ import annotations

import json
import time

import requests

CONSOLE = "http://localhost:5173"
results: list[tuple[bool, str, str]] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    results.append((ok, label, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{' — ' + detail if detail else ''}")


def env(response: requests.Response) -> dict:
    try:
        return response.json()
    except ValueError:
        return {"code": -1, "message": response.text[:160]}


def main() -> int:
    print("=" * 78)
    print("  Console → engine integration (through the vite proxy on :5173)")
    print("=" * 78)

    print("\n1. the console serves")
    page = requests.get(f"{CONSOLE}/", timeout=15)
    check(page.status_code == 200, "GET / returns the app shell", f"HTTP {page.status_code}")
    check("<title>OwnRAG</title>" in page.text, "the document is branded OwnRAG")

    print("\n2. the connectivity probe the login page makes")
    probe = env(requests.get(f"{CONSOLE}/api/v1/system/version", timeout=15))
    payload = probe.get("data") or {}
    check(probe.get("code") == 0, "probe succeeds (console will show Live, not Demo)", str(probe.get("code")))
    check(
        "owner" not in payload and "storage" not in payload,
        "the unauthenticated probe withholds the owner email and storage path",
        f"keys={sorted(payload)}",
    )

    print("\n3. sign-in through the proxy")
    email = "owner@ownrag.local"
    login = env(requests.post(f"{CONSOLE}/api/v1/auth/login", json={"email": email, "password": ""}, timeout=20))
    token = (login.get("data") or {}).get("access_token")
    check(bool(token), "POST /auth/login issues a token through the console origin")
    if not token:
        print("  cannot continue without a token:", json.dumps(login)[:300])
        return 1
    headers = {"Authorization": f"Bearer {token}"}

    print("\n4. every screen's first request answers")
    screens = [
        ("Overview", "/api/v1/datasets"),
        ("Overview stats", "/api/v1/system/version"),
        ("Knowledge list", "/api/v1/datasets/tags/aggregation"),
        ("Chat", "/api/v1/chats"),
        ("Agents", "/api/v1/agents"),
        ("Models", "/api/v1/providers"),
        ("Models (per-model rows)", "/api/v1/models"),
        ("Data sources", "/api/v1/connectors"),
        ("MCP", "/api/v1/mcp/servers"),
        ("Memory", "/api/v1/memories"),
        ("Settings → team", "/api/v1/tenants"),
        ("Settings → users", "/api/v1/users/me"),
        ("Developers → tokens", "/api/v1/system/tokens"),
        ("Pipelines", "/api/v1/pipelines"),
    ]
    for label, path in screens:
        payload = env(requests.get(f"{CONSOLE}{path}", headers=headers, timeout=20))
        check(payload.get("code") == 0, f"{label}: GET {path}", str(payload.get("code")))

    print("\n5. create a knowledge base through the proxy")
    kb = env(requests.post(f"{CONSOLE}/api/v1/datasets", headers=headers, json={"name": "Console integration corpus", "chunk_method": "laws"}, timeout=20))
    kb_id = ((kb.get("data") or [{}])[0] or {}).get("id")
    check(bool(kb_id), "POST /datasets", str(kb.get("message"))[:160] if not kb_id else kb_id)
    if not kb_id:
        return 1

    print("\n6. upload a real file the way the UI does")
    document = (
        "Article 12. Annual leave is twenty-one days paid.\n"
        "Article 13. The leave rises to thirty days after five continuous years of service.\n"
        "Article 14. The employer sets the date after notifying the employee thirty days in advance.\n"
    )
    upload = env(
        requests.post(
            f"{CONSOLE}/api/v1/datasets/{kb_id}/documents",
            headers=headers,
            files={"file": ("labour-regulations.txt", document, "text/plain")},
            timeout=60,
        )
    )
    doc_id = ((upload.get("data") or [{}])[0] or {}).get("id")
    check(bool(doc_id), "multipart upload accepted through the proxy", str(upload.get("message"))[:120] if not doc_id else doc_id)

    print("\n7. ingest, with progress the UI polls")
    env(requests.post(f"{CONSOLE}/api/v1/documents/ingest", headers=headers, json={"document_ids": [doc_id]}, timeout=20))
    seen: set[float] = set()
    doc: dict = {}
    deadline = time.time() + 90
    while time.time() < deadline:
        doc = env(requests.get(f"{CONSOLE}/api/v1/datasets/{kb_id}/documents/{doc_id}", headers=headers, timeout=20)).get("data") or {}
        seen.add(round(float(doc.get("progress") or 0), 2))
        if doc.get("run") in {"DONE", "FAIL"}:
            break
        time.sleep(0.4)
    check(doc.get("run") == "DONE", f"document parsed — {doc.get('chunk_count')} chunks", str(doc.get("progress_msg"))[:80])

    print("\n8. retrieval the retrieval screen would show")
    search = env(
        requests.post(
            f"{CONSOLE}/api/v1/datasets/search",
            headers=headers,
            json={"dataset_ids": [kb_id], "question": "How many days of annual leave, and when does it rise?", "top_k": 5, "similarity_threshold": 0.2, "vector_similarity_weight": 0.3},
            timeout=30,
        )
    ).get("data") or {}
    top = (search.get("chunks") or [{}])[0]
    check(bool(search.get("chunks")), f"{search.get('total')} hits in {search.get('elapsed_ms')} ms")
    check("twenty-one" in str(top.get("content_with_weight")) or "thirty days" in str(top.get("content_with_weight")), "the retrieved chunk answers the question")
    check(top.get("similarity") is not None and top.get("vector_similarity") is not None and top.get("term_similarity") is not None, "all three scores present for the score meters", f"fused {top.get('similarity')} / vector {top.get('vector_similarity')} / term {top.get('term_similarity')}")

    print("\n9. chunk list the document viewer shows")
    chunks = env(requests.get(f"{CONSOLE}/api/v1/datasets/{kb_id}/documents/{doc_id}/chunks", headers=headers, timeout=20))
    check(chunks.get("code") == 0 and (chunks.get("total") or 0) > 0, "chunks readable", f"{chunks.get('total')} chunks")
    first = (chunks.get("data") or [{}])[0]
    check(bool(first.get("document_keyword")), "chunk carries the document name for the viewer breadcrumb", str(first.get("document_keyword")))

    print("\n10. chat streaming through the proxy")
    chat = env(requests.post(f"{CONSOLE}/api/v1/chats", headers=headers, json={"name": "Console assistant", "dataset_ids": [kb_id]}, timeout=20)).get("data") or {}
    stream = requests.post(
        f"{CONSOLE}/api/v1/chat/completions",
        headers=headers,
        json={"chat_id": chat.get("id"), "question": "When does annual leave rise to thirty days?", "stream": True},
        stream=True,
        timeout=120,
    )
    frames, answer, citations = 0, "", 0
    for raw in stream.iter_lines(decode_unicode=True):
        if not raw or not raw.startswith("data:"):
            continue
        payload = raw[5:].strip()
        if payload == "[DONE]":
            break
        try:
            inner = json.loads(payload).get("data") or {}
        except ValueError:
            continue
        frames += 1
        if inner.get("reference"):
            citations = len(inner["reference"])
        if isinstance(inner.get("answer"), str):
            answer += inner["answer"]
    check(frames > 1, "SSE streamed frame by frame", f"{frames} frames")
    check(citations > 0, "citations attached to the turn", f"{citations} references")
    check("thirty" in answer.lower() or "five" in answer.lower(), "the answer is grounded in the uploaded file", answer[:120].replace("\n", " "))

    print("\n11. ingestion summary + log the detail screen shows")
    summary = env(requests.get(f"{CONSOLE}/api/v1/datasets/{kb_id}/ingestions/summary", headers=headers, timeout=20)).get("data") or {}
    check(summary.get("done") == 1, "summary counts the run", json.dumps({k: summary.get(k) for k in ("total", "done", "chunks", "tokens")}))
    logs = env(requests.get(f"{CONSOLE}/api/v1/datasets/{kb_id}/ingestions", headers=headers, timeout=20)).get("data") or []
    check(bool(logs), "ingestion log has rows", f"{len(logs)} rows · {logs[0].get('message') if logs else ''}")

    print("\n12. delete flows back through the proxy")
    removed = env(requests.post(f"{CONSOLE}/api/v1/datasets/{kb_id}/documents", headers=headers, json={}, timeout=20))
    check(removed.get("code") == 0, "empty upload body does not error", str(removed.get("code")))
    check(env(requests.delete(f"{CONSOLE}/api/v1/datasets/{kb_id}", headers=headers, timeout=20)).get("code") == 0, "knowledge base deleted")

    failed = [label for ok, label, _ in results if not ok]
    print("\n" + "=" * 78)
    print(f"  {len(results) - len(failed)} passed · {len(failed)} failed")
    for label in failed:
        print(f"    - {label}")
    print("=" * 78)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

"""
OwnRAG engine — end-to-end smoke test.

Drives the real pipeline against a running engine and asserts on the observable outcome:

    login -> create KB -> upload a real PDF and a real Markdown file -> ingest -> poll ->
    read chunks -> hybrid retrieval -> streamed cited answer -> registry surfaces

Run it with the engine up:

    cd engine && .venv/Scripts/python.exe smoke_test.py

It writes its fixtures into engine/samples/ (a genuine multi-page PDF and a Markdown file) so the
test exercises PyMuPDF and the text reader rather than a synthetic stub.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys
import time

import requests

BASE = "http://127.0.0.1:9380"
SAMPLES = pathlib.Path(__file__).resolve().parent / "samples"

MARKDOWN = """# OwnRAG operations handbook

## Retention

Raw uploads are kept for 90 days. Parsed chunks and their vectors are kept for the life of the
knowledge base, because deleting a chunk invalidates its citation in every stored conversation.
The audit log is shipped to cold storage after 180 days.

## Rate limits

The retrieval endpoint accepts 40 requests per second per workspace. Exceeding that returns HTTP
429 with a Retry-After header measured in milliseconds. Ingestion is throttled separately at 8
documents per minute to protect the parse queue.

## Escalation

A failed parse is retried twice with exponential backoff, then parked in the FAILED queue. An
operator must re-upload the document to move it out of that state.

## نظام إجازة الموظف

يستحق الموظف إجازة سنوية مدتها واحد وعشرون يوما مدفوعة الأجر. تزداد الإجازة إلى ثلاثين يوما
إذا أمضى الموظف خمس سنوات متصلة في الخدمة. يحدد صاحب العمل موعد الإجازة بعد إشعار الموظف
بمدة لا تقل عن ثلاثين يوما.
"""

PLAIN = """OwnRAG support notes

Ticket SLA: first response within 4 business hours for production workspaces, 1 business day for
evaluation workspaces. A production incident that blocks ingestion entirely is treated as severity
one and escalates to the on-call engineer within 15 minutes.

Billing is metered per thousand tokens of retrieved context, not per uploaded page, so re-parsing
a document does not double-charge a workspace.
"""

PASS: list[str] = []
FAIL: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    (PASS if condition else FAIL).append(name)
    print(f"  [{'PASS' if condition else 'FAIL'}] {name}{' — ' + detail if detail else ''}")


def envelope(response: requests.Response) -> dict:
    try:
        return response.json()
    except ValueError:
        return {"code": -1, "message": response.text[:200], "data": None}


def make_samples() -> tuple[pathlib.Path, pathlib.Path, pathlib.Path]:
    SAMPLES.mkdir(parents=True, exist_ok=True)
    md = SAMPLES / "ownrag-operations-handbook.md"
    md.write_text(MARKDOWN, encoding="utf-8")
    notes = SAMPLES / "support-notes.txt"
    notes.write_text(PLAIN, encoding="utf-8")

    pdf_path = SAMPLES / "parsing-pipeline.pdf"
    try:
        import pymupdf

        doc = pymupdf.open()
        pages = [
            "OwnRAG parsing pipeline\n\nA PDF is opened page by page so every citation can carry a "
            "page number. Text is extracted per page and handed to the chunker unchanged.",
            "Chunking\n\nThe naive method groups paragraphs up to 512 tokens. The laws method splits "
            "on article boundaries instead, which keeps a legal instrument's articles intact.",
            "Indexing\n\nEach chunk is tokenised, embedded, and written to both the inverted index "
            "and the vector index. A chunk is searchable the moment its document reports DONE.",
        ]
        # Repeated so ingestion spans more than one poll: a fixture that parses in a few
        # milliseconds cannot demonstrate that progress is observable while parsing.
        for repeat in range(12):
            for body in pages:
                page = doc.new_page()
                page.insert_text((56, 72), body, fontsize=11, lineheight=1.4)
        doc.save(str(pdf_path))
        doc.close()
    except Exception as exc:  # noqa: BLE001
        print(f"  (could not build the PDF fixture: {exc})")
    return pdf_path, md, notes


def main() -> int:
    print("=" * 78)
    print("  OwnRAG engine — end-to-end pipeline test")
    print("=" * 78)

    # ---- engine up ----
    print("\n1. engine reachable")
    version = None
    for _ in range(40):
        try:
            response = requests.get(f"{BASE}/api/v1/system/version", timeout=3)
            if response.status_code == 200:
                version = envelope(response)
                break
        except requests.RequestException:
            pass
        time.sleep(0.5)
    if version is None:
        print("  [FAIL] engine is not answering on", BASE)
        return 1
    data = version.get("data") or {}
    check("GET /system/version returns the envelope", version.get("code") == 0)
    check("engine reports its mode", bool((data.get("mode") or {}).get("embeddings")), json.dumps(data.get("mode")))

    # ---- auth ----
    print("\n2. authentication")
    login = envelope(requests.post(f"{BASE}/api/v1/auth/login", json={"email": data.get("owner") or "owner@ownrag.local", "password": ""}, timeout=10))
    token = (login.get("data") or {}).get("access_token")
    check("POST /auth/login issues a token", bool(token))
    headers = {"Authorization": f"Bearer {token}"}
    unauth = requests.get(f"{BASE}/api/v1/datasets", timeout=10)
    check("protected routes reject a missing token", unauth.status_code == 401, f"HTTP {unauth.status_code}")

    # ---- knowledge base ----
    print("\n3. knowledge base")
    kb = envelope(
        requests.post(
            f"{BASE}/api/v1/datasets",
            headers=headers,
            json={"name": "Engine test corpus", "description": "Created by smoke_test.py", "chunk_method": "naive"},
            timeout=15,
        )
    )
    kb_id = ((kb.get("data") or [{}])[0] or {}).get("id")
    check("POST /datasets creates a knowledge base", bool(kb_id), str(kb.get("message"))[:200] if not kb_id else "")
    if not kb_id:
        print("\n  cannot continue without a knowledge base — the response was:")
        print("  " + json.dumps(kb)[:600])
        return 1

    # ---- upload real files ----
    print("\n4. upload real files")
    pdf_path, md_path, notes_path = make_samples()
    created_ids: list[str] = []
    for path in (pdf_path, md_path, notes_path):
        if not path.exists():
            continue
        with path.open("rb") as handle:
            up = envelope(
                requests.post(
                    f"{BASE}/api/v1/datasets/{kb_id}/documents",
                    headers=headers,
                    files={"file": (path.name, handle, "application/octet-stream")},
                    timeout=60,
                )
            )
        rows = up.get("data") or []
        created_ids.extend(r["id"] for r in rows)
        check(f"upload {path.name}", bool(rows), f"{len(rows)} document(s) registered")
    check("three real documents registered", len(created_ids) == 3, f"{len(created_ids)} registered")

    # ---- ingest ----
    print("\n5. ingestion pipeline (parse -> chunk -> index)")
    start = envelope(requests.post(f"{BASE}/api/v1/documents/ingest", headers=headers, json={"document_ids": created_ids}, timeout=15))
    check("POST /documents/ingest accepted the batch", start.get("code") == 0, str(start.get("message")))

    deadline = time.time() + 120
    docs: list[dict] = []
    progress_seen: set[float] = set()
    while time.time() < deadline:
        listing = envelope(requests.get(f"{BASE}/api/v1/datasets/{kb_id}/documents", headers=headers, timeout=15))
        docs = listing.get("data") or []
        for doc in docs:
            progress_seen.add(round(float(doc.get("progress") or 0), 2))
        if docs and all(d.get("run") in {"DONE", "FAIL"} for d in docs):
            break
        time.sleep(0.25)

    states = {d["name"]: (d["run"], d["chunk_count"], d.get("progress_msg")) for d in docs}
    for name, (run, chunks, message) in states.items():
        print(f"    {name}: {run} · {chunks} chunks · {message}")
    check("every document finished", all(run == "DONE" for run, _, _ in states.values()))
    check("chunks were produced", sum(c for _, c, _ in states.values()) > 0, f"{sum(c for _, c, _ in states.values())} chunks total")
    check("progress was observable while parsing", len(progress_seen) > 1, f"{len(progress_seen)} distinct progress values")

    summary = envelope(requests.get(f"{BASE}/api/v1/datasets/{kb_id}/ingestions/summary", headers=headers, timeout=15)).get("data") or {}
    check("ingestion summary reports the run", summary.get("done") == len(docs), json.dumps({k: summary.get(k) for k in ("total", "done", "chunks", "tokens")}))
    logs = envelope(requests.get(f"{BASE}/api/v1/datasets/{kb_id}/ingestions", headers=headers, timeout=15)).get("data") or []
    check("ingestion log has an entry per document", len(logs) >= len(docs), f"{len(logs)} log rows")

    # ---- chunks ----
    print("\n6. chunks are readable")
    first = created_ids[0]
    chunk_page = envelope(requests.get(f"{BASE}/api/v1/datasets/{kb_id}/documents/{first}/chunks", headers=headers, timeout=30))
    chunks = chunk_page.get("data") or []
    check("GET .../chunks returns chunks", bool(chunks), f"{chunk_page.get('total')} total")
    if chunks:
        body = chunks[0].get("content_with_weight") or ""
        check("chunk carries its text", len(body) > 40, f"{len(body)} chars · e.g. {body[:60]!r}")
        check("chunk carries its document name", bool(chunks[0].get("document_keyword")), str(chunks[0].get("document_keyword")))
        check("chunk carries a page number", (chunks[0].get("page") or 0) >= 1, f"page {chunks[0].get('page')}")

    # ---- retrieval ----
    print("\n7. hybrid retrieval (English)")
    question = "How long are raw uploads kept and what is the retrieval rate limit?"
    result = envelope(
        requests.post(
            f"{BASE}/api/v1/datasets/search",
            headers=headers,
            json={"dataset_ids": [kb_id], "question": question, "top_k": 6, "similarity_threshold": 0.05, "vector_similarity_weight": 0.3},
            timeout=30,
        )
    ).get("data") or {}
    hits = result.get("chunks") or []
    check("search returns chunks", bool(hits), f"{result.get('total')} hits in {result.get('elapsed_ms')} ms")
    if hits:
        top = hits[0]
        print(f"    top: {top['doc_name']} p.{top['page']} · fused {top['similarity']:.3f} "
              f"(vector {top['vector_similarity']:.3f} / term {top['term_similarity']:.3f})")
        check("both score components are present", top.get("vector_similarity") is not None and top.get("term_similarity") is not None)
        check("retrieved text actually answers the question", "90 days" in top["content_with_weight"])
        check("document aggregates returned", bool(result.get("doc_aggs")), str(len(result.get("doc_aggs") or [])))

    print("\n8. retrieval across the Arabic chunk")
    arabic = envelope(
        requests.post(
            f"{BASE}/api/v1/datasets/search",
            headers=headers,
            json={"dataset_ids": [kb_id], "question": "كم مدة الإجازة السنوية للموظف؟", "top_k": 6, "similarity_threshold": 0.05},
            timeout=30,
        )
    ).get("data") or {}
    arabic_hits = arabic.get("chunks") or []
    joined = " ".join(h["content_with_weight"] for h in arabic_hits[:3])
    check("Arabic query retrieves Arabic content", "إجازة سنوية" in joined or "ثلاثين" in joined, f"{len(arabic_hits)} hits")
    check("Arabic retrieval is not top-hit noise", bool(arabic_hits) and "واحد وعشرون" in joined, "expected phrase found in top 3")

    # ---- chat ----
    print("\n9. streamed, cited answer")
    chat = envelope(requests.post(f"{BASE}/api/v1/chats", headers=headers, json={"name": "Smoke assistant", "dataset_ids": [kb_id]}, timeout=15)).get("data") or {}
    chat_id = chat.get("id")
    check("assistant created", bool(chat_id))

    stream = requests.post(
        f"{BASE}/api/v1/chat/completions",
        headers=headers,
        json={"chat_id": chat_id, "question": "What happens to a failed parse?", "stream": True},
        stream=True,
        timeout=120,
    )
    check("SSE endpoint answered", stream.status_code == 200, f"HTTP {stream.status_code}")
    answer_parts: list[str] = []
    citations: list[dict] = []
    for raw in stream.iter_lines(decode_unicode=True):
        if not raw or not raw.startswith("data:"):
            continue
        payload = raw[5:].strip()
        if payload == "[DONE]":
            break
        try:
            frame = json.loads(payload)
        except ValueError:
            continue
        inner = frame.get("data") or {}
        if inner.get("reference"):
            citations = inner["reference"]
        if isinstance(inner.get("answer"), str) and inner["answer"]:
            answer_parts.append(inner["answer"])
    answer = "".join(answer_parts)
    check("answer streamed in pieces", len(answer_parts) > 1, f"{len(answer_parts)} frames, {len(answer)} chars")
    check("answer cites the retrieved passages", "[citation:" in answer, re.findall(r"\[citation:\d+\]", answer)[:4].__str__())
    check("citations are structured references", bool(citations) and bool(citations[0].get("doc_name")), f"{len(citations)} references")
    check("answer is grounded in the corpus", "retried twice" in answer or "FAILED queue" in answer, answer[:140].replace("\n", " "))

    session = envelope(requests.get(f"{BASE}/api/v1/chats/{chat_id}/sessions", headers=headers, timeout=15)).get("data") or []
    check("the conversation was persisted", bool(session), f"{len(session)} session(s)")
    if session:
        detail = envelope(requests.get(f"{BASE}/api/v1/chats/{chat_id}/sessions/{session[0]['id']}", headers=headers, timeout=15)).get("data") or {}
        messages = detail.get("messages") or []
        roles = [m["role"] for m in messages]
        check("session stores both turns", "user" in roles and "assistant" in roles, str(roles))
        check("stored assistant turn keeps its references", bool(messages[-1].get("reference")))

    # ---- registry surfaces ----
    print("\n10. registry surfaces the console reads")
    for label, path, key in [
        ("providers", "/api/v1/providers", None),
        ("models", "/api/v1/models", None),
        ("users/me/models", "/api/v1/users/me/models", None),
        ("models/default", "/api/v1/models/default", None),
        ("tenants", "/api/v1/tenants", None),
        ("agents", "/api/v1/agents", None),
        ("agent templates", "/api/v1/agents/templates", None),
        ("pipelines", "/api/v1/pipelines", None),
        ("system/tokens", "/api/v1/system/tokens", None),
        ("connectors", "/api/v1/connectors", None),
        ("mcp servers", "/api/v1/mcp/servers", None),
        ("memories", "/api/v1/memories", None),
        ("files", "/api/v1/files", None),
        ("dataset graph", f"/api/v1/datasets/{kb_id}/graph", None),
        ("embedding check", f"/api/v1/datasets/{kb_id}/embedding/check", None),
        ("navigation", f"/api/v1/datasets/{kb_id}/navigation", None),
    ]:
        got = envelope(requests.get(f"{BASE}{path}", headers=headers, timeout=20))
        check(f"{label} responds", got.get("code") == 0, f"code {got.get('code')}")

    embedding_check = envelope(requests.get(f"{BASE}/api/v1/datasets/{kb_id}/embedding/check", headers=headers, timeout=15)).get("data") or {}
    check("embedding check reports consistency", embedding_check.get("consistent") is True, str(embedding_check.get("current")))

    graph = envelope(requests.get(f"{BASE}/api/v1/datasets/{kb_id}/graph", headers=headers, timeout=20)).get("data") or {}
    check("dataset graph is computed from the chunks", len(graph.get("nodes") or []) > 0, f"{len(graph.get('nodes') or [])} nodes, {len(graph.get('edges') or [])} edges")

    # ---- agent ----
    print("\n11. agent graph run")
    agents = envelope(requests.get(f"{BASE}/api/v1/agents", headers=headers, timeout=15)).get("data") or []
    check("agents seeded", bool(agents))
    if agents:
        agent_id = agents[0]["id"]
        agent_stream = requests.post(
            f"{BASE}/api/v1/agents/chat/completions",
            headers=headers,
            json={"agent_id": agent_id, "question": "What is metered in billing?", "stream": True},
            stream=True,
            timeout=120,
        )
        agent_answer = ""
        agent_refs = 0
        for raw in agent_stream.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue
            payload = raw[5:].strip()
            if payload == "[DONE]":
                break
            try:
                inner = (json.loads(payload).get("data") or {})
            except ValueError:
                continue
            if isinstance(inner.get("answer"), str):
                agent_answer += inner["answer"]
            if inner.get("reference"):
                agent_refs += len(inner["reference"])
        # Grounded means the answer is drawn from the agent's own documents and cites them. It used to
        # require the word "token", which only appeared when a *failed* rerank had narrowed the context to
        # the floor of three and the extractive builder happened to pick the sentence containing it — a pass
        # that depended on the vendor's error response rather than on the agent working.
        check(
            "agent produced a grounded answer",
            bool(agent_answer.strip()) and agent_refs > 0 and "[citation:" in agent_answer.lower(),
            f"{agent_refs} reference(s); " + agent_answer[:90].replace("\n", " "),
        )
        logs = envelope(requests.get(f"{BASE}/api/v1/agents/{agent_id}/logs", headers=headers, timeout=15)).get("data") or []
        check("agent run was logged", bool(logs), f"{len(logs)} log entries")
        versions = envelope(requests.get(f"{BASE}/api/v1/agents/{agent_id}/versions", headers=headers, timeout=15))
        check("agent versions endpoint responds", versions.get("code") == 0)

    # ---- cleanup ----
    requests.delete(f"{BASE}/api/v1/datasets/{kb_id}", headers=headers, timeout=15)

    print("\n" + "=" * 78)
    print(f"  {len(PASS)} passed · {len(FAIL)} failed")
    if FAIL:
        print("  failures:")
        for name in FAIL:
            print(f"    - {name}")
    print("=" * 78)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())

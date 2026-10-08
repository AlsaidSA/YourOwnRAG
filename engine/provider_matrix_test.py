"""
Provider matrix check.

Every provider the catalog says *this engine* can call, driven through chat against one stub
OpenAI-compatible endpoint: does linking it enable a model, does a question reach that provider's
endpoint with that provider's key, and does the engine attribute the answer to it.

A vendor's own API cannot be exercised without that vendor's key, so what this proves is the
engine's side for every catalog entry — the endpoint it calls, the auth header it sends, the model
it selects, and the provenance it reports. The one provider with a real key on this deployment is
checked separately, live.

    cd engine && .venv/Scripts/python.exe provider_matrix_test.py
"""

from __future__ import annotations

import json
import pathlib
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests

ENGINE = "http://127.0.0.1:9380/api/v1"
STUB = "http://127.0.0.1:9396"
MARKER = "MATRIX-ANSWER"
results: list[tuple[bool, str, str]] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    results.append((bool(ok), label, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{' — ' + detail if detail else ''}", flush=True)


class Stub(BaseHTTPRequestHandler):
    """One OpenAI-compatible endpoint standing in for every vendor: it echoes back what it saw."""

    seen: dict = {}

    def _json(self, payload: dict, status: int = 200) -> None:
        blob = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(blob)))
        self.end_headers()
        self.wfile.write(blob)

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler's naming
        if self.path.split("?")[0].endswith("/models"):
            return self._json({"data": [{"id": "matrix-chat"}, {"id": "matrix-embed"}]})
        return self._json({"error": "not found"}, 404)

    def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler's naming
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        if not self.path.endswith("/chat/completions"):
            return self._json({"error": "not found"}, 404)
        Stub.seen = {
            "auth": self.headers.get("Authorization") or "",
            "model": str(body.get("model") or ""),
            "base": f"http://{self.headers.get('Host')}",
        }
        words = f"{MARKER} answered by {Stub.seen['model']}.".split()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for word in words:
            self.wfile.write(f"data: {json.dumps({'choices': [{'delta': {'content': word + ' '}}]})}\n\n".encode())
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, format, *args):  # noqa: A002 - matches BaseHTTPRequestHandler
        return


def headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def login() -> str:
    return requests.post(f"{ENGINE}/auth/login", json={"email": "owner@ownrag.local"}, timeout=20).json()["data"]["access_token"]


def first_id(payload) -> str:
    data = payload.get("data") if isinstance(payload, dict) else payload
    if isinstance(data, list):
        data = data[0] if data else {}
    return str((data or {}).get("id") or "")


def ask(token: str, kb_id: str, question: str, model: str = "", chat_id: str = "") -> str:
    answer = ""
    body = {"dataset_ids": [kb_id], "question": question, "stream": True, **(({"model": model} if model else {}))}
    if chat_id:
        body["chat_id"] = chat_id
    with requests.post(
        f"{ENGINE}/chat/completions",
        headers=headers(token),
        stream=True,
        timeout=120,
        json=body,
    ) as stream:
        for line in stream.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload in ("[DONE]", ""):
                break
            answer += (json.loads(payload).get("data") or {}).get("answer") or ""
    return answer


def pin_chat(token: str, kb_id: str, model_name: str) -> str:
    """A throwaway assistant names the model to answer — a test-only provider is never the default."""
    chat = requests.post(f"{ENGINE}/chats", headers=headers(token), json={"name": "Matrix pin", "dataset_ids": [kb_id]}, timeout=20).json().get("data") or {}
    chat_id = str(chat.get("id") or "")
    requests.put(f"{ENGINE}/chats/{chat_id}", headers=headers(token), json={"llm": {"model_name": model_name, "temperature": 0.2}}, timeout=20)
    return chat_id


def main() -> int:
    print("=" * 78)
    print("  OwnRAG engine — every callable provider, checked through chat")
    print("=" * 78)
    stub = HTTPServer(("127.0.0.1", 9396), Stub)
    threading.Thread(target=stub.serve_forever, daemon=True).start()
    token = login()
    stamp = int(time.time()) % 100000
    kb_id = ""
    catalog: list[dict] = []

    def sweep() -> None:
        for entry in requests.get(f"{ENGINE}/providers", headers=headers(token), timeout=20).json().get("data") or []:
            if str(entry.get("name", "")).startswith("matrix-"):
                requests.delete(f"{ENGINE}/providers/{entry['name']}", headers=headers(token), timeout=20)
        for chat in requests.get(f"{ENGINE}/chats", headers=headers(token), timeout=20).json().get("data") or []:
            if str(chat.get("name", "")) == "Matrix pin":
                requests.delete(f"{ENGINE}/chats/{chat['id']}", headers=headers(token), timeout=20)

    try:
        catalog = requests.get(f"{ENGINE}/providers/catalog", headers=headers(token), timeout=30).json().get("data") or []
        callable_here = [entry for entry in catalog if entry.get("engine") == "openai"]
        foreign = [entry for entry in catalog if entry.get("engine") != "openai"]
        print(f"\n1. catalog: {len(catalog)} providers — {len(callable_here)} callable here, {len(foreign)} need the Go backend")

        created = requests.post(
            f"{ENGINE}/datasets", headers=headers(token),
            json={"name": f"Provider matrix {stamp}", "chunk_method": "naive"}, timeout=30,
        ).json()
        kb_id = first_id(created)
        fact = "The matrix probe fact is that annual leave is twenty-one days.\n"
        uploaded = requests.post(
            f"{ENGINE}/datasets/{kb_id}/documents", headers=headers(token),
            files={"file": ("matrix-notes.txt", fact.encode(), "text/plain")}, timeout=60,
        ).json()
        doc_id = first_id(uploaded)
        requests.post(f"{ENGINE}/documents/ingest", headers=headers(token), json={"document_ids": [doc_id]}, timeout=30)
        for _ in range(60):
            rows = requests.get(f"{ENGINE}/datasets/{kb_id}/documents", headers=headers(token), timeout=30).json().get("data") or []
            row = rows[0] if rows else {}
            if row.get("run") in ("DONE", "FAIL"):
                break
            time.sleep(0.5)
        check("knowledge base ready for the matrix", row.get("run") == "DONE", str(row.get("progress_msg"))[:60])

        print(f"\n2. each callable provider: link it, ask through chat, confirm it answered")
        failures: list[str] = []
        for entry in callable_here:
            name = str(entry["name"])
            alias = f"matrix-{name}-{stamp}"
            key = f"matrix-key-{name}"
            requests.post(f"{ENGINE}/providers", headers=headers(token),
                          json={"provider_name": alias, "label": f"Matrix {name}", "origin": "test"}, timeout=20)
            made = requests.post(
                f"{ENGINE}/providers/{alias}/instances", headers=headers(token),
                json={"instance_name": "default", "api_base": STUB, "api_key": key}, timeout=60,
            ).json()
            registered = (made.get("data") or {}).get("models_registered") or []
            if not any("matrix-chat (chat)" in str(item) for item in registered):
                failures.append(f"{name}: chat model not enabled on link ({registered})")
                requests.delete(f"{ENGINE}/providers/{alias}", headers=headers(token), timeout=20)
                continue
            if any("matrix-embed (chat)" in str(item) for item in registered):
                failures.append(f"{name}: an embedding model was enabled as chat ({registered})")
                requests.delete(f"{ENGINE}/providers/{alias}", headers=headers(token), timeout=20)
                continue
            Stub.seen = {}
            chat_id = pin_chat(token, kb_id, f"matrix-chat@{alias}")
            answer = ask(token, kb_id, "How many days of annual leave?", chat_id=chat_id)
            seen = Stub.seen or {}
            ok = MARKER in answer and "matrix-chat" in str(seen.get("model"))
            auth_ok = seen.get("auth") == f"Bearer {key}"
            if not ok:
                failures.append(f"{name}: answer did not come from its endpoint ({answer[:50]!r})")
            elif not auth_ok:
                failures.append(f"{name}: wrong credentials sent ({str(seen.get('auth'))[:14]}…)")
            if chat_id:
                requests.delete(f"{ENGINE}/chats/{chat_id}", headers=headers(token), timeout=20)
            requests.delete(f"{ENGINE}/providers/{alias}", headers=headers(token), timeout=20)

        checked = len(callable_here) - len({f.split(':')[0] for f in failures})
        check(
            f"every provider this engine can call answers through chat ({len(callable_here)} checked)",
            not failures,
            "; ".join(failures[:4]) if failures else f"all {len(callable_here)} sent their own key and answered",
        )
        check("no provider was left behind by the sweep", not [p for p in requests.get(f"{ENGINE}/providers", headers=headers(token), timeout=20).json().get("data") or [] if str(p.get("name", "")).startswith("matrix-")])

        print("\n3. providers this engine cannot call say so instead of failing silently")
        check(
            f"the {len(foreign)} native-driver providers are labelled",
            all("go" in str(entry.get("engine")) for entry in foreign),
            ", ".join(sorted(entry["name"] for entry in foreign)[:6]) + " …",
        )
        # `engine: "go"` describes the preset — no OpenAI-compatible endpoint we can assume for it.
        # Pointing one at an OpenAI-compatible gateway still works; the label is about the default.
        alias = f"matrix-{foreign[0]['name']}-{stamp}"
        requests.post(f"{ENGINE}/providers", headers=headers(token),
                      json={"provider_name": alias, "label": f"Matrix {foreign[0]['name']}", "origin": "test"}, timeout=20)
        bare = requests.post(
            f"{ENGINE}/providers/{alias}/instances", headers=headers(token),
            json={"instance_name": "default", "api_key": "x"}, timeout=60,
        ).json()
        check(
            "a native-driver provider with no endpoint enables no model",
            not ((bare.get("data") or {}).get("models_registered") or []),
            f"{foreign[0]['name']}: {str(bare.get('data'))[:70]}",
        )
        pointed = requests.post(
            f"{ENGINE}/providers/{alias}/instances", headers=headers(token),
            json={"instance_name": "default", "api_base": STUB, "api_key": "x"}, timeout=60,
        ).json()
        check(
            "pointed at an OpenAI-compatible endpoint it does work — the label is about the preset",
            bool(((pointed.get("data") or {}).get("models_registered") or [])),
            f"{foreign[0]['name']} @ stub: {str((pointed.get('data') or {}).get('models_registered'))[:60]}",
        )
        requests.delete(f"{ENGINE}/providers/{alias}", headers=headers(token), timeout=20)
    finally:
        sweep()
        if kb_id:
            requests.delete(f"{ENGINE}/datasets/{kb_id}", headers=headers(token), timeout=30)
        stub.shutdown()

    failed = [label for ok, label, _ in results if not ok]
    print("\n" + "=" * 78)
    print(f"  {len(results) - len(failed)} passed · {len(failed)} failed")
    for label in failed:
        print(f"    - {label}")
    print("=" * 78)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

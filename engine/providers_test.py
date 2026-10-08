"""
Bring-your-own-model check.

A provider configured through the console's own API must become the model that answers, and
disabling it must fall back honestly to the extractive builder. A stub OpenAI-compatible endpoint
runs in-process, so this needs no API key and no outside network.

    cd engine && .venv/Scripts/python.exe providers_test.py
"""

from __future__ import annotations

import json
import pathlib
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests

ENGINE = "http://127.0.0.1:9380/api/v1"
STUB = "http://127.0.0.1:9399"
MARKER = "STUB-GENERATED"
# Unique per run: provider names are permanent keys, so a rerun must not collide with a leftover.
PROVIDER = f"stub-provider-{int(time.time()) % 1000000}"
INSTANCE = "production"
CHAT_MODEL = "stub-chat"
EMBED_MODEL = "stub-embed"
DIM = 16

results: list[tuple[bool, str, str]] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    results.append((bool(ok), label, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{' — ' + detail if detail else ''}", flush=True)


# --------------------------------------------------------------------------- stub endpoint
class StubHandler(BaseHTTPRequestHandler):
    """The smallest thing that speaks the OpenAI wire format: streaming chat + embeddings."""

    def log_message(self, format, *args):  # noqa: A002 - matches BaseHTTPRequestHandler's signature
        return

    def _json(self, payload: dict) -> None:
        blob = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(blob)))
        self.end_headers()
        self.wfile.write(blob)

    def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler's naming
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")

        if self.path.endswith("/chat/completions"):
            seen_key = self.headers.get("Authorization") or ""
            words = f"{MARKER} the leave is twenty-one days and rises to thirty after five years.".split()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(b": stub\n\n")
            for word in words:
                frame = {"choices": [{"delta": {"content": word + " "}}]}
                self.wfile.write(f"data: {json.dumps(frame)}\n\n".encode())
                self.wfile.flush()
                time.sleep(0.01)
            self.wfile.write(f"data: {json.dumps({'auth_seen': seen_key[:20], 'model': body.get('model')})}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            return

        if self.path.endswith("/embeddings"):
            inputs = body.get("input") or []
            if isinstance(inputs, str):
                inputs = [inputs]
            data = []
            for index, text in enumerate(inputs):
                seed = sum(ord(c) for c in str(text)) % 97
                data.append({"embedding": [((seed + 7 * i) % 13) / 13 for i in range(DIM)], "index": index})
            self._json({"data": data, "model": body.get("model")})
            return

        self._json({"error": "unsupported"})

    def do_GET(self):  # noqa: N802
        self._json({"data": [{"id": CHAT_MODEL}]})


def start_stub() -> HTTPServer:
    server = HTTPServer(("127.0.0.1", 9399), StubHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# --------------------------------------------------------------------------- helpers
def load_token() -> str:
    return requests.post(f"{ENGINE}/auth/login", json={"email": "owner@ownrag.local"}, timeout=20).json()["data"]["access_token"]


def headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def first_id(payload: dict) -> str:
    """The preserved API answers collection endpoints with a list — take the first entry's id."""
    data = payload.get("data")
    if isinstance(data, list):
        data = data[0] if data else {}
    return (data or {}).get("id") or ""


def version(token: str) -> str:
    return json.dumps(requests.get(f"{ENGINE}/system/version", headers=headers(token), timeout=20).json())


def ask(token: str, kb_id: str, question: str, chat_id: str = "") -> str:
    """Post to the streaming chat endpoint the console's Chat screen uses, and collect the text."""
    answer = ""
    body: dict = {"question": question, "dataset_ids": [kb_id], "stream": True, "top_k": 6}
    if chat_id:
        body["chat_id"] = chat_id
    with requests.post(
        f"{ENGINE}/chat/completions",
        headers={**headers(token), "Content-Type": "application/json"},
        json=body,
        stream=True,
        timeout=120,
    ) as response:
        response.raise_for_status()
        for raw in response.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue
            payload = raw[5:].strip()
            if payload == "[DONE]":
                break
            try:
                frame = json.loads(payload)
            except json.JSONDecodeError:
                continue
            piece = (frame.get("data") or {}).get("answer")
            if piece:
                answer += piece
    return answer


def main() -> int:
    print("=" * 78)
    print("  OwnRAG engine — bring-your-own-model check")
    print("=" * 78)
    stub = start_stub()
    token = load_token()
    kb_id = ""
    chat_id = ""
    try:
        print("\n1. baseline: what answers when this engine has no provider of its own")
        before = version(token)
        if "llm:" in before:
            print(f"  (this deployment already answers with its own provider — {before}; baseline not applicable)")
        else:
            check("with no provider configured answers are extractive", "extractive-built-in" in before, before)

        print("\n2. add a provider the way the console does")
        # `origin: test` marks a throwaway provider. The engine never auto-selects such a provider
        # to answer questions — it answers only when an assistant explicitly pins one of its models.
        created = requests.post(
            f"{ENGINE}/providers",
            headers=headers(token),
            json={"provider_name": PROVIDER, "label": "Stub provider", "origin": "test"},
            timeout=20,
        ).json()
        check("provider created", created.get("code") == 0, str(created.get("message")))
        instance = requests.post(
            f"{ENGINE}/providers/{PROVIDER}/instances",
            headers=headers(token),
            json={"api_base": STUB, "api_key": "stub-key-not-a-secret", "instance_name": INSTANCE},
            timeout=20,
        ).json()
        check("instance created with its API base", instance.get("code") == 0)
        auto = (instance.get("data") or {}).get("models_registered") or []
        check(
            "linking the provider enables the models it advertises",
            any(CHAT_MODEL in entry for entry in auto),
            str(auto),
        )
        added = requests.post(
            f"{ENGINE}/providers/{PROVIDER}/instances/{INSTANCE}/models",
            headers=headers(token),
            json={"models": [{"name": CHAT_MODEL, "model_type": "chat"}]},
            timeout=20,
        ).json()
        check("chat model added and enabled", added.get("code") == 0)
        providers = requests.get(f"{ENGINE}/providers", headers=headers(token), timeout=20).json()["data"]
        mine = next((p for p in providers if p["name"] == PROVIDER), {})
        check("the provider reports its base URL back", mine.get("base_url") == STUB, str(mine.get("base_url")))
        models_now = requests.get(
            f"{ENGINE}/providers/{PROVIDER}/instances/{INSTANCE}/models",
            headers=headers(token),
            timeout=20,
        ).json().get("data") or []
        check(
            "the provider's chat model is registered and enabled",
            any(m.get("name") == CHAT_MODEL and m.get("enabled") for m in models_now),
            str(models_now),
        )
        discovered = requests.post(
            f"{ENGINE}/providers/{PROVIDER}/instances/{INSTANCE}/models/discover",
            headers=headers(token),
            json={"kinds": ["chat"]},
            timeout=30,
        ).json()
        found = discovered.get("data") or {}
        check(
            "fetching models again lists them without duplicating",
            discovered.get("code") == 0 and CHAT_MODEL in (found.get("available") or []) and not found.get("registered"),
            str(found),
        )

        print("\n3. the provider answers a real question")
        created_kb = requests.post(
            f"{ENGINE}/datasets",
            headers=headers(token),
            json={"name": f"Provider check {int(time.time()) % 100000}", "chunk_method": "naive"},
            timeout=30,
        ).json()["data"]
        # POST /datasets answers with the list of created knowledge bases, as upstream does.
        kb_id = first_id({"data": created_kb})
        check("knowledge base created for the check", bool(kb_id))
        sample = pathlib.Path(__file__).resolve().parent / "samples" / "provider-check.txt"
        sample.parent.mkdir(parents=True, exist_ok=True)
        sample.write_text(
            "Article 30. Annual leave is twenty-one days of paid leave per year.\n"
            "Article 31. The leave rises to thirty days after five continuous years of service.\n",
            encoding="utf-8",
        )
        with sample.open("rb") as handle:
            uploaded = requests.post(
                f"{ENGINE}/datasets/{kb_id}/documents",
                headers=headers(token),
                files={"file": (sample.name, handle, "text/plain")},
                timeout=60,
            ).json()
        doc_id = first_id(uploaded)
        check("document uploaded", bool(doc_id))
        requests.post(f"{ENGINE}/documents/ingest", headers=headers(token), json={"kb_id": kb_id, "document_ids": [doc_id]}, timeout=60)
        state = {}
        for _ in range(30):
            docs = requests.get(f"{ENGINE}/datasets/{kb_id}/documents", headers=headers(token), timeout=20).json().get("data") or []
            state = next((d for d in docs if d["id"] == doc_id), {})
            if str(state.get("run")).upper() in ("3", "DONE"):
                break
            time.sleep(1)
        check("document ingested", str(state.get("run")).upper() in ("3", "DONE"), str(state.get("progress_msg"))[:60])

        print("\n3. the provider the assistant selects answers a real question")
        # Pin a chat to the stub model the way the chat settings dialog does. A test-only provider is
        # never auto-selected (that is the point of `origin: test`), so the question must name it.
        chat = requests.post(f"{ENGINE}/chats", headers=headers(token), json={"name": "Provider check"}, timeout=20).json().get("data") or {}
        chat_id = str(chat.get("id") or "")
        requests.put(
            f"{ENGINE}/chats/{chat_id}",
            headers=headers(token),
            json={"llm": {"model_name": f"{CHAT_MODEL}@{PROVIDER}", "temperature": 0.3}},
            timeout=20,
        )
        answer = ask(token, kb_id, "How many days of annual leave, and when does it rise?", chat_id=chat_id)
        check("the answer came from the provider the assistant pins", MARKER in answer, answer[:90])
        check("it is not the extractive fallback", "Extractive answer assembled" not in answer)

        print("\n3b. a test-only provider does not become the default answering model")
        # A second provider, newer than the stub, pointing at nothing at all. It is registered as a
        # test throwaway, so it must not win the unpinned default slot.
        requests.post(f"{ENGINE}/providers", headers=headers(token), json={"provider_name": "nowhere", "label": "Nowhere", "origin": "test"}, timeout=20)
        requests.post(
            f"{ENGINE}/providers/nowhere/instances",
            headers=headers(token),
            json={"instance_name": INSTANCE, "api_base": "http://127.0.0.1:9", "api_key": "placeholder"},
            timeout=20,
        )
        requests.post(
            f"{ENGINE}/providers/nowhere/instances/{INSTANCE}/models",
            headers=headers(token),
            json={"models": [{"name": "other-chat", "model_type": "chat"}]},
            timeout=20,
        )
        unpinned = ask(token, kb_id, "How many days of annual leave?")
        check("with no choice made, a test-only provider is not used", "STUB-GENERATED" not in unpinned, unpinned[:50])

        pinned = ask(token, kb_id, "How many days of annual leave?", chat_id=chat_id)
        check("the assistant's chosen model answers its chat", "STUB-GENERATED" in pinned, pinned[:60])
        requests.delete(f"{ENGINE}/providers/nowhere", headers=headers(token), timeout=20)

        print("\n4. disabling the model falls back honestly")
        requests.put(
            f"{ENGINE}/providers/{PROVIDER}/instances/{INSTANCE}/models/{CHAT_MODEL}",
            headers=headers(token),
            json={"status": "inactive"},
            timeout=20,
        )
        models_now = requests.get(
            f"{ENGINE}/providers/{PROVIDER}/instances/{INSTANCE}/models",
            headers=headers(token),
            timeout=20,
        ).json().get("data") or []
        check(
            "the engine stops offering the model",
            any(m.get("name") == CHAT_MODEL and not m.get("enabled") for m in models_now),
            str(models_now),
        )
        fallback = ask(token, kb_id, "How many days of annual leave, and when does it rise?")
        check("the stub is no longer called", MARKER not in fallback)
        if "extractive-built-in" in version(token):
            check("answers revert to extractive", "Extractive answer assembled" in fallback, fallback[:70])
        else:
            check(
                "answers move to whatever model is still enabled",
                MARKER not in fallback and bool(fallback.strip()),
                f"another provider is configured here — mode={version(token)}",
            )

        print("\n5. a broken endpoint degrades instead of failing the turn")
        requests.put(
            f"{ENGINE}/providers/{PROVIDER}/instances/{INSTANCE}/models/{CHAT_MODEL}",
            headers=headers(token),
            json={"status": "active"},
            timeout=20,
        )
        requests.post(
            f"{ENGINE}/providers/{PROVIDER}/instances",
            headers=headers(token),
            json={"api_base": "http://127.0.0.1:9", "api_key": "x"},
            timeout=20,
        )
        broken = ask(token, kb_id, "How many days of annual leave, and when does it rise?", chat_id=chat_id)
        check("an unreachable provider still answers from the passages", "Extractive answer assembled" in broken or "retrieved passages" in broken, broken[:80])

        print("\n6. an embedding provider drives ingestion")
        requests.post(
            f"{ENGINE}/providers/{PROVIDER}/instances",
            headers=headers(token),
            json={"api_base": STUB, "api_key": "stub-key-not-a-secret"},
            timeout=20,
        )
        requests.post(
            f"{ENGINE}/providers/{PROVIDER}/instances/{INSTANCE}/models",
            headers=headers(token),
            json={"models": [{"name": EMBED_MODEL, "model_type": "embedding"}]},
            timeout=20,
        )
        check("the engine advertises the embedding model", EMBED_MODEL in version(token))
        with sample.open("rb") as handle:
            second = requests.post(
                f"{ENGINE}/datasets/{kb_id}/documents",
                headers=headers(token),
                files={"file": (sample.name, handle, "text/plain")},
                timeout=60,
            ).json()
        second_id = first_id(second)
        requests.post(f"{ENGINE}/documents/ingest", headers=headers(token), json={"kb_id": kb_id, "document_ids": [second_id]}, timeout=60)
        encoded = ""
        for _ in range(30):
            check_payload = requests.get(f"{ENGINE}/datasets/{kb_id}/embedding/check", headers=headers(token), timeout=20).json().get("data") or {}
            encoded = json.dumps(check_payload)
            if EMBED_MODEL in encoded:
                break
            time.sleep(1)
        check("chunks record the new encoder", EMBED_MODEL in encoded, encoded[:90])
        hits = requests.post(
            f"{ENGINE}/datasets/search",
            headers=headers(token),
            json={"dataset_ids": [kb_id], "question": "How many days of annual leave?", "top_k": 5},
            timeout=30,
        ).json().get("data") or {}
        check(
            "retrieval still returns the passage under the new encoder",
            any("twenty-one" in str(c.get("content_with_weight")) for c in (hits.get("chunks") or [])),
            f"{hits.get('total')} hits",
        )

        print("\n7. a known provider works with the API base left blank")
        requests.post(
            f"{ENGINE}/providers",
            headers=headers(token),
            json={"provider_name": "openai", "label": "OpenAI", "origin": "test"},
            timeout=20,
        )
        requests.post(
            f"{ENGINE}/providers/openai/instances",
            headers=headers(token),
            json={"instance_name": INSTANCE, "api_key": "not-a-real-key"},
            timeout=20,
        )
        requests.post(
            f"{ENGINE}/providers/openai/instances/{INSTANCE}/models",
            headers=headers(token),
            json={"models": [{"name": "gpt-4o-mini", "model_type": "chat"}]},
            timeout=20,
        )
        # Registration only — the test never calls a real vendor, and the throwaway provider is a
        # test-only one so it cannot become the deployment's answering model in the meantime.
        openai_models = requests.get(
            f"{ENGINE}/providers/openai/instances/{INSTANCE}/models",
            headers=headers(token),
            timeout=20,
        ).json().get("data") or []
        check(
            "a known provider accepts its model with no typed base URL",
            any(m.get("name") == "gpt-4o-mini" and m.get("enabled") for m in openai_models),
            str(openai_models),
        )
        requests.delete(f"{ENGINE}/providers/openai", headers=headers(token), timeout=20)
        check("removing it restores the local models", "llm:gpt-4o-mini" not in version(token))

        print("\n8. the catalog the console's picker renders")
        catalog_route = requests.get(f"{ENGINE}/providers/catalog", headers=headers(token), timeout=20).json()
        catalog = catalog_route.get("data") or []
        names = {str(entry.get("name")) for entry in catalog}
        check("the catalog offers a real set", len(catalog) > 20, f"{len(catalog)} entries")
        check("well-known vendors are offered", {"openai", "deepseek", "ollama", "vllm"} <= names)
        check(
            "every entry says how the engine would reach it",
            all(entry.get("engine") in {"openai", "go"} for entry in catalog),
            f"{sum(1 for e in catalog if e.get('engine') == 'go')} need the Go backend",
        )
        check(
            "drivers the local engine cannot call are labelled as such",
            any(entry["name"] == "anthropic" and entry["engine"] == "go" for entry in catalog),
        )
        catalog_base = next((entry["base_url"] for entry in catalog if entry["name"] == "deepseek"), "")
        check("the catalog's address is the one the resolver would call", catalog_base == "https://api.deepseek.com/v1", catalog_base)
        # A throwaway provider name on purpose: a real vendor's name may be the one the user linked,
        # and this check deletes what it creates.
        picker = f"picker-check-{int(time.time()) % 100000}"
        requests.post(f"{ENGINE}/providers", headers=headers(token), json={"provider_name": picker, "label": "Picker check", "origin": "test"}, timeout=20)
        requests.post(
            f"{ENGINE}/providers/{picker}/instances",
            headers=headers(token),
            json={"instance_name": INSTANCE, "api_base": STUB, "api_key": "stub-key-not-a-secret"},
            timeout=20,
        )
        requests.post(
            f"{ENGINE}/providers/{picker}/instances/{INSTANCE}/models",
            headers=headers(token),
            json={"models": [{"name": "deepseek-chat", "model_type": "chat"}]},
            timeout=20,
        )
        # The picked provider answers once the assistant names it (a test-only provider is never the
        # default). The stub returns its marker regardless of the model name it is called with.
        requests.put(
            f"{ENGINE}/chats/{chat_id}",
            headers=headers(token),
            json={"llm": {"model_name": f"deepseek-chat@{picker}", "temperature": 0.3}},
            timeout=20,
        )
        picked = ask(token, kb_id, "How many days of annual leave?", chat_id=chat_id)
        check("a picked provider answers when the assistant selects it", MARKER in picked, picked[:60])
        requests.delete(f"{ENGINE}/providers/{picker}", headers=headers(token), timeout=20)
    finally:
        if kb_id:
            requests.delete(f"{ENGINE}/datasets/{kb_id}", headers=headers(token), timeout=30)
        if chat_id:
            requests.delete(f"{ENGINE}/chats/{chat_id}", headers=headers(token), timeout=20)
        removed = requests.delete(f"{ENGINE}/providers/{PROVIDER}", headers=headers(token), timeout=20).json()
        check("the provider can be removed again", removed.get("code") == 0, str(removed.get("message")))
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

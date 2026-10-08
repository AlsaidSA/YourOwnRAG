"""
OwnRAG console — live UI test.

Drives the real interface in a real browser against the running local engine: sign-in, the Live
indicator, knowledge-base creation, a real file upload, ingestion, the chunk viewer, retrieval and
a streamed cited answer. Screenshots land in engine/screenshots/ as evidence.

    cd engine && .venv/Scripts/python.exe ui_test.py
"""

from __future__ import annotations

import pathlib
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from playwright.sync_api import Page, sync_playwright

CONSOLE = "http://localhost:5173"
SHOTS = pathlib.Path(__file__).resolve().parent / "screenshots"
CORPUS = (
    "Article 30. Annual leave is twenty-one days of paid leave per year.\n"
    "Article 31. The leave increases to thirty days once the employee completes five continuous "
    "years of service with the same employer.\n"
    "Article 32. The employer determines the date of the leave after notifying the employee at "
    "least thirty days in advance.\n"
    "Article 33. Leave pay is calculated on the basic wage at the time the leave begins.\n"
)

results: list[tuple[bool, str, str]] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    results.append((bool(ok), label, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{' — ' + detail if detail else ''}", flush=True)


import requests


class UiFixture(BaseHTTPRequestHandler):
    """A page for the browser-created connector to crawl, so the sync has something real to read."""

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler's naming
        html = (
            "<html><body><h1>Handbook</h1>"
            "<p>ui connector check reached this page through the dialog.</p></body></html>"
        )
        payload = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):  # noqa: A002 - matches BaseHTTPRequestHandler
        return


def login_api() -> str:
    """A token for direct API assertions — the UI's own proxy, same origin the browser uses."""
    response = requests.post(
        "http://localhost:5173/api/v1/auth/login", json={"email": "owner@ownrag.local"}, timeout=20
    )
    return response.json()["data"]["access_token"]


def api_get(path: str, token: str, **params) -> dict:
    response = requests.get(
        f"http://localhost:5173{path}",
        headers={"Authorization": f"Bearer {token}"},
        params=params or None,
        timeout=30,
    )
    return response.json()


def body(page: Page) -> str:
    return page.inner_text("body")


def click_text(page: Page, pattern: str) -> bool:
    """Click the first visible button/link whose text matches."""
    for selector in ("button", "a"):
        element = page.query_selector_all(selector)
        for candidate in element:
            try:
                if candidate.is_visible() and re.search(pattern, candidate.inner_text() or "", re.I):
                    candidate.click()
                    return True
            except Exception:  # noqa: BLE001 - detached nodes during re-render are expected
                continue
    return False


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=False)
    print(f"    · screenshot engine/screenshots/{name}.png", flush=True)


def dump_buttons(page: Page, label: str) -> None:
    """Print the visible buttons — makes a selector failure diagnosable in one run."""
    labels = []
    for button in page.query_selector_all("button"):
        try:
            if button.is_visible():
                text = (button.inner_text() or "").strip().replace("\n", " ")
                if text:
                    labels.append(text[:32])
        except Exception:  # noqa: BLE001
            continue
    print(f"    · {label} buttons: {labels}", flush=True)


def fill_first(page: Page, selectors: tuple[str, ...], value: str) -> bool:
    for selector in selectors:
        for field in page.query_selector_all(selector):
            try:
                if field.is_visible() and not field.get_attribute("disabled"):
                    field.fill(value)
                    return True
            except Exception:  # noqa: BLE001
                continue
    return False


def dump_inputs(page: Page, label: str) -> None:
    fields = page.eval_on_selector_all(
        "input, textarea, select",
        "els => els.filter(e => e.offsetParent).map(e => e.tagName + (e.placeholder ? ':' + e.placeholder : '') + (e.type ? '/' + e.type : ''))",
    )
    print(f"    · {label} fields: {fields}", flush=True)


def main() -> int:
    token = login_api()
    print("=" * 78)
    print("  OwnRAG console — live UI test")
    print("=" * 78)
    with sync_playwright() as play:
        browser = play.chromium.launch()
        context = browser.new_context(viewport={"width": 1512, "height": 950})
        page = context.new_page()
        errors: list[str] = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        # ---------------------------------------------------------------- sign in
        print("\n1. sign-in screen")
        page.goto(f"{CONSOLE}/login", wait_until="networkidle")
        time.sleep(2.5)
        email_value = page.eval_on_selector_all(
            "input", "els => { const e = els.find(i => i.type==='email' || /email/i.test(i.name||i.placeholder||'')); return e ? e.value : ''; }"
        )
        check("console title is OwnRAG", page.title() == "OwnRAG", page.title())
        check("engine account prefilled", email_value == "owner@ownrag.local", email_value or "(empty)")
        check("no 'no API server' notice — the engine is live", "No API server is answering" not in body(page))
        shot(page, "01-login")

        check("sign-in button clicked", click_text(page, r"sign in|log in|continue"))
        try:
            page.wait_for_url(lambda url: url.rstrip("/") == CONSOLE, timeout=25000)
        except Exception:  # noqa: BLE001 - report what the form said instead of just timing out
            node = page.query_selector("p.text-danger")
            print(f"    · sign-in did not navigate. Visible error: {node.inner_text() if node else '(none)'}", flush=True)
        time.sleep(3)
        page.wait_for_load_state("networkidle")
        landing = body(page)
        check("landed inside the console", page.url.rstrip("/") == CONSOLE, page.url)
        check("top bar reports Live, not Demo", "Live" in landing and "Demo data" not in landing)
        check("overview renders", "Overview" in landing or "Knowledge" in landing)
        shot(page, "02-overview-live")

        # ---------------------------------------------------------------- knowledge base
        print("\n2. knowledge base via the UI")
        page.goto(f"{CONSOLE}/knowledge", wait_until="networkidle")
        time.sleep(3)
        shot(page, "03-knowledge-list")
        check("create button present", click_text(page, r"^new knowledge base"))
        time.sleep(2)
        dump_buttons(page, "create dialog")
        name = f"UI test corpus {int(time.time()) % 100000}"
        # The dialog's name field is identifiable by its placeholder; the list's own search box
        # is a text input too, so a bare `input[type=text]` would fill the wrong one.
        typed = fill_first(page, ('input[placeholder*="e.g."]', 'input[placeholder*="Contracts"]'), name)
        check("name entered in the create dialog", typed, name)
        shot(page, "04-create-dialog")
        if typed:
            click_text(page, r"create knowledge base")
            time.sleep(4)
        page.goto(f"{CONSOLE}/knowledge", wait_until="networkidle")
        time.sleep(3)
        listing = body(page)
        check("the new knowledge base is listed", name in listing, name)
        shot(page, "05-knowledge-list-created")

        # ---------------------------------------------------------------- upload + ingest
        print("\n3. upload a real file and ingest")
        link = page.query_selector(f"text={name}")
        if link:
            link.click()
            time.sleep(3.5)
        check("opened the knowledge base", "/knowledge/" in page.url, page.url)
        kb_id = page.url.rstrip("/").split("/")[-1]
        dump_buttons(page, "knowledge detail")
        shot(page, "06-knowledge-detail-empty")

        sample = SHOTS.parent / "samples" / "ui-upload.txt"
        sample.parent.mkdir(parents=True, exist_ok=True)
        sample.write_text(CORPUS, encoding="utf-8")

        # The upload dialog reads from a hidden file input (react-dropzone).
        check("upload button present", click_text(page, r"upload|add document|add file"))
        time.sleep(1.5)
        dump_buttons(page, "upload dialog")
        file_input = page.query_selector("input[type=file]")
        check("upload dialog exposes a file input", bool(file_input))
        if file_input:
            file_input.set_input_files(str(sample))
            time.sleep(2)
            shot(page, "07-upload-dialog")
            # Only the dialog's own submit carries the staged files; the toolbar's "Upload"
            # button merely opens it, so match the label exactly.
            submitted = False
            for button in page.query_selector_all("button"):
                text = (button.inner_text() or "").strip()
                if button.is_visible() and re.search(r"^(upload|add)\s*\d*\s*files?$", text, re.I):
                    button.click()
                    submitted = True
                    break
            check("upload dialog submitted with the file", submitted)
            time.sleep(5)
        # The engine is the source of truth: wait for it to report the document before asking
        # the page to render it, so a slow write cannot look like a broken upload.
        uploaded = False
        for _ in range(25):
            docs = api_get(f"/api/v1/datasets/{kb_id}/documents", token).get("data") or []
            if any(d["name"] == "ui-upload.txt" for d in docs):
                uploaded = True
                break
            time.sleep(1)
        check("the engine received the uploaded document", uploaded)
        page.reload(wait_until="networkidle")
        time.sleep(4)
        detail = body(page)
        check("uploaded file appears in the document list", "ui-upload" in detail, "ui-upload.txt")
        shot(page, "08-document-uploaded")

        # ---- ingest, then verify the outcome against the engine itself ----
        # "Ingest pending" is disabled until the table knows about the document, so wait for the
        # enabled state rather than clicking a button that does nothing.
        for _ in range(15):
            target = next(
                (
                    button
                    for button in page.query_selector_all("button")
                    if button.is_visible() and re.search(r"ingest pending", button.inner_text() or "", re.I)
                ),
                None,
            )
            if target is not None and not target.is_disabled():
                print("    · clicking 'Ingest pending'", flush=True)
                target.click()
                break
            page.reload(wait_until="networkidle")
            time.sleep(2.5)
        time.sleep(3)
        doc_state: dict = {}
        deadline = time.time() + 90
        done_states = ("3", "DONE", "SUCCESS")
        while time.time() < deadline:
            try:
                docs = api_get(f"/api/v1/datasets/{kb_id}/documents", token).get("data") or []
                doc_state = next((d for d in docs if d["name"] == "ui-upload.txt"), {})
                if str(doc_state.get("run")).upper() in done_states + ("4", "FAIL", "FAILED"):
                    break
            except Exception:  # noqa: BLE001 - keep polling while the engine works
                pass
            time.sleep(2)
        # The preserved status enum is numeric upstream (3 = DONE); the local engine reports the
        # same states by name, so accept both rather than pinning the transport spelling.
        check(
            "the engine ingested the file the UI uploaded",
            str(doc_state.get("run")).upper() in done_states,
            f"run={doc_state.get('run')} msg={str(doc_state.get('progress_msg'))[:70]!r}",
        )
        chunks = api_get(
            f"/api/v1/datasets/{kb_id}/documents/{doc_state.get('id')}/chunks", token, page_size=20
        )
        bodies = " ".join(c.get("content_with_weight", "") for c in (chunks.get("data") or []))
        check("chunks were produced from the uploaded bytes", (chunks.get("total") or 0) > 0, f"total={chunks.get('total')}")
        check("the chunk text is the file's real content", "twenty-one" in bodies.lower())
        page.reload(wait_until="networkidle")
        time.sleep(3)
        detail = body(page)
        check("the console reports a non-zero chunk count", bool(re.search(r"[1-9]\d*\s*chunks", detail, re.I)))
        shot(page, "09-document-done")

        # ---- open the document viewer (its own route) ----
        page.goto(f"{CONSOLE}/knowledge/{kb_id}/documents/{doc_state.get('id')}", wait_until="networkidle")
        time.sleep(4)
        viewer = body(page)
        check(
            "the document viewer shows the parsed text",
            "Article 30" in viewer or "twenty-one" in viewer.lower(),
            page.url,
        )
        check("the viewer lists chunks", bool(re.search(r"chunk", viewer, re.I)))
        shot(page, "10-document-viewer")

        # ---------------------------------------------------------------- retrieval
        print("\n4. retrieval screen")
        page.goto(f"{CONSOLE}/retrieval", wait_until="networkidle")
        time.sleep(3)
        dump_buttons(page, "retrieval")
        typed = fill_first(
            page,
            ("textarea", 'input[type="text"]', "input:not([type])"),
            "How many days of annual leave and when does it rise?",
        )
        check("query entered", typed)
        # Match "retrieve/retrieval" only: the old pattern also matched the sidebar's
        # "Search ⌘K" button, which opens the command palette and runs nothing.
        clicked = click_text(page, r"retriev")
        time.sleep(6)
        retrieval = body(page)
        # The passage text can only appear if retrieval actually returned the indexed chunk.
        check(
            "the retrieved passage is shown",
            "twenty-one" in retrieval.lower() or "Article 30" in retrieval,
            f"submitted={clicked}",
        )
        check("scores are shown", bool(re.search(r"vector|term|fused|similarity|score", retrieval, re.I)))
        shot(page, "11-retrieval-live")

        # ---------------------------------------------------------------- chat
        print("\n5. chat with a grounded answer")
        page.goto(f"{CONSOLE}/chat", wait_until="networkidle")
        time.sleep(3.5)
        shot(page, "12-chat-live")
        composer = page.query_selector("textarea")
        check("composer present", bool(composer))
        if composer:
            composer.fill("When does annual leave rise to thirty days?")
            time.sleep(0.4)
            composer.press("Enter")
            time.sleep(9)
            convo = body(page)
            check("an answer streamed in", "thirty" in convo.lower() or "five" in convo.lower())
            # `[citation:N]` is rendered as a chip whose aria-label names the source, so the
            # literal marker is never in the text — count the chips instead.
            chips = page.query_selector_all('[aria-label^="Inspect source"]')
            check("the answer carries inline citation chips", len(chips) > 0, f"{len(chips)} chips")
            shot(page, "13-chat-answer")

        # ---------------------------------------------------------------- provider picker
        print("\n6. adding a provider picks from the engine's catalog")
        page.goto(f"{CONSOLE}/models", wait_until="networkidle")
        time.sleep(1.8)
        if click_text(page, r"Add provider"):
            time.sleep(1.4)
            dialog = body(page)
            rows = page.query_selector_all("button[aria-selected]")
            check("the picker lists providers instead of a blank name field", len(rows) > 20, f"{len(rows)} rows")
            check(
                "the list separates what this engine can call",
                "answered by this engine" in dialog.lower()
                and "native driver in the preserved go backend" in dialog.lower(),
            )
            check("well-known vendors are shown", all(name in dialog for name in ("OpenAI", "DeepSeek", "Ollama", "vLLM")))
            shot(page, "15-provider-picker")

            search = page.query_selector('input[aria-label="Search providers"]')
            if search:
                search.fill("ollama")
                time.sleep(0.7)
                check("searching narrows the list", len(page.query_selector_all("button[aria-selected]")) == 1,
                      f"{len(page.query_selector_all('button[aria-selected]'))} rows for 'ollama'")
                search.fill("deepseek")
                time.sleep(0.7)
            else:
                check("the picker has a search box", False, "no search input")

            target = next(
                (row for row in page.query_selector_all("button[aria-selected]") if "deepseek.com" in (row.inner_text() or "")),
                None,
            )
            if target:
                target.click()
                time.sleep(0.9)
                fields = page.eval_on_selector_all("input", "els => els.map(e => e.value)")
                check(
                    "picking a provider fills in its endpoint",
                    any("api.deepseek.com" in str(value) for value in fields),
                    str([v for v in fields if v]),
                )
                check("picking a provider fills in its id", "deepseek" in fields)
                shot(page, "16-provider-picked")
            else:
                check("a catalog row for DeepSeek is present", False, "no row matched")

            page.keyboard.press("Escape")
            time.sleep(0.8)
        else:
            check("the Add provider button is reachable", False, "not found")
            dump_buttons(page, "models")

        # ---------------------------------------------------------------- data sources
        print("\n7. the data source dialog asks for what the engine can actually read")
        fixture = HTTPServer(("127.0.0.1", 9397), UiFixture)
        threading.Thread(target=fixture.serve_forever, daemon=True).start()
        try:
            page.goto(f"{CONSOLE}/data-sources", wait_until="networkidle")
            time.sleep(1.8)
            for stale in api_get("/api/v1/connectors", token).get("data") or []:
                if stale.get("name") == "UI source check":  # a previous run may have left one behind
                    requests.delete(
                        f"{CONSOLE}/api/v1/connectors/{stale['id']}",
                        headers={"Authorization": f"Bearer {token}"},
                        timeout=30,
                    )
            if click_text(page, r"(Add source|Add a data source|Add connector|New source)"):
                time.sleep(1.4)
                text = body(page)
                check("the dialog opens on a source this engine can read", "Web crawl" in text, text.replace("\n", " ")[:70])
                url_field = page.query_selector("textarea")
                check("it shows the field that source needs", url_field is not None, "URLs to read")
                shot(page, "17-data-source-web")

                for tile in page.query_selector_all("button"):
                    if re.search(r"amazon s3", (tile.inner_text() or "").strip(), re.I):
                        tile.click()
                        break
                time.sleep(0.9)
                text = body(page)
                # Amazon S3 is a source this engine CAN read (the fetcher signs with SigV4 and reads
                # public buckets anonymously), so the dialog shows its fields and there is no refusal.
                # The "cannot read" note is reserved for a source whose `pull` flag is false in the
                # engine catalog — assert the dialog and the catalog agree instead of assuming S3 is
                # unsupported.
                catalog = api_get("/api/v1/connectors/sources", token).get("data") or []
                s3_pull = next((bool(s.get("pull")) for s in catalog if s.get("source_type") == "s3"), None)
                unreadable = [s for s in catalog if not s.get("pull")]
                check(
                    "the source dialog matches what the engine can read",
                    s3_pull is True
                    and "Access key id" in text
                    and "cannot read" not in text
                    and len(unreadable) >= 1
                    and all(str(s.get("needs") or "").strip() for s in unreadable),
                    f"s3 readable={s3_pull}, fields shown; {len(unreadable)} unreadable sources each state a need",
                )
                shot(page, "18-data-source-unsupported")

                # Back to a source this engine can read, then create it for real through the dialog.
                for tile in page.query_selector_all("button"):
                    if re.fullmatch(r"web crawl", (tile.inner_text() or "").strip(), re.I):
                        tile.click()
                        break
                time.sleep(0.7)
                name_field = page.query_selector('input[placeholder="Engineering wiki"]')
                if name_field:
                    name_field.fill("UI source check")
                field = page.query_selector("textarea")
                if field is not None:
                    field.fill("http://127.0.0.1:9397/handbook.html")
                for box in page.query_selector_all('[aria-label^="Include"]'):
                    box.click()
                    break
                time.sleep(0.4)
                click_text(page, r"^(Add source|Create|Add connector|Save)")
                time.sleep(2.4)
                made = api_get("/api/v1/connectors", token).get("data") or []
                created = next((c for c in made if c.get("name") == "UI source check"), None)
                check("the connector the browser collected reaches the engine", created is not None, f"{len(made)} connectors")
                if created:
                    synced = requests.post(
                        f"{CONSOLE}/api/v1/connectors/{created['id']}/rebuild",
                        headers={"Authorization": f"Bearer {token}"},
                        timeout=120,
                    ).json()
                    payload = synced.get("data") or {}
                    check(
                        "syncing it pulls the address that was typed in the browser",
                        synced.get("code") == 0 and int(payload.get("documents_synced") or 0) >= 1,
                        str(payload.get("message") or synced.get("message")),
                    )
                    requests.delete(
                        f"{CONSOLE}/api/v1/connectors/{created['id']}",
                        headers={"Authorization": f"Bearer {token}"},
                        timeout=30,
                    )
            else:
                check("the Add source button is reachable", False, "not found")
                dump_buttons(page, "data-sources")
        finally:
            fixture.shutdown()

        # ---------------------------------------------------------------- sweep
        print("\n8. every route renders against the live engine")
        for route in ("/", "/knowledge", "/retrieval", "/chat", "/agents", "/models", "/data-sources", "/memory", "/mcp", "/settings", "/developers"):
            page.goto(f"{CONSOLE}{route}", wait_until="networkidle")
            time.sleep(1.6)
            text = body(page)
            check(f"{route} renders", len(text) > 200 and "Something went wrong" not in text, f"{len(text)} chars")
        shot(page, "14-final")

        check("no uncaught console errors", not errors, "; ".join(errors[:2]))
        browser.close()

    failed = [label for ok, label, _ in results if not ok]
    print("\n" + "=" * 78)
    print(f"  {len(results) - len(failed)} passed · {len(failed)} failed")
    for label in failed:
        print(f"    - {label}")
    print("=" * 78)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

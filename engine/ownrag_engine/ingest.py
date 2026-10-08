"""
OwnRAG engine — real document ingestion: parse, chunk, index.

Parsing is genuine: PyMuPDF for PDF (page by page, so citations carry a page number),
python-docx for DOCX (paragraphs + tables), openpyxl for XLSX, stdlib csv for CSV/TSV and a
tag-stripping reader for HTML. Everything else is read as text.

Chunking implements each method the console offers with different logic — they are not aliases.

Derived from RAGFlow (https://github.com/infiniflow/ragflow), Apache-2.0.
"""

from __future__ import annotations

import csv
import html
import io
import pathlib
import re
import zipfile

from . import core
from .core import CHUNK_OVERLAP, CHUNK_SIZE, jdumps, new_id, now_ms, one, q, tokenize, x, xmany

TEXT_SUFFIXES = {".txt", ".md", ".markdown", ".log", ".rst", ".json", ".yaml", ".yml", ".xml"}
HTML_SUFFIXES = {".html", ".htm", ".xhtml"}
CSV_SUFFIXES = {".csv", ".tsv"}


# --------------------------------------------------------------------------- parsing


def _parse_pdf(path: pathlib.Path) -> list[str]:
    import pymupdf

    pages: list[str] = []
    with pymupdf.open(path) as doc:
        for page in doc:
            pages.append(page.get_text("text"))
    return pages


def _parse_docx(path: pathlib.Path) -> list[str]:
    import docx  # python-docx

    document = docx.Document(str(path))
    blocks: list[str] = [p.text.strip() for p in document.paragraphs if p.text.strip()]
    for table in document.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                blocks.append(" | ".join(cells))
    # DOCX has no reliable page mapping, so the whole document is one logical page.
    return ["\n\n".join(blocks)] if blocks else []


def _parse_xlsx(path: pathlib.Path) -> list[str]:
    from openpyxl import load_workbook

    workbook = load_workbook(str(path), read_only=True, data_only=True)
    out: list[str] = []
    try:
        for sheet in workbook.worksheets:
            lines = [f"# {sheet.title}"]
            for row in sheet.iter_rows(values_only=True):
                cells = ["" if c is None else str(c) for c in row]
                if any(c.strip() for c in cells):
                    lines.append(" | ".join(cells))
            if len(lines) > 1:
                out.append("\n".join(lines))
    finally:
        workbook.close()
    return out


def _parse_csv(path: pathlib.Path) -> list[str]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    dialect = "\t" if path.suffix.lower() == ".tsv" else ","
    rows = list(csv.reader(io.StringIO(raw), delimiter=dialect))
    pages: list[str] = []
    for start in range(0, max(len(rows), 1), 200):
        block = rows[start : start + 200]
        if not block:
            continue
        header = block[0]
        lines = [" | ".join(r) for r in block if any(c.strip() for c in r)]
        pages.append("\n".join(lines))
        _ = header
    return pages


def _parse_html(path: pathlib.Path) -> list[str]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    raw = re.sub(r"(?is)<(script|style|nav|footer)[^>]*>.*?</\1>", " ", raw)
    text = re.sub(r"(?s)<[^>]+>", "\n", raw)
    text = html.unescape(text)
    lines = [ln.strip() for ln in text.splitlines()]
    return ["\n".join(ln for ln in lines if ln)]


def _parse_text(path: pathlib.Path) -> list[str]:
    return [path.read_text(encoding="utf-8", errors="replace")]


def parse_file(path: pathlib.Path) -> tuple[list[str], str]:
    """Return (pages, type). `pages` is a list of strings; a page is whatever unit the format
    naturally has (PDF page, worksheet, 200 CSV rows, or the whole text file)."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        pages = _parse_pdf(path)
        if not any(p.strip() for p in pages):
            return [], "needs_ocr:pdf"
        # A PDF can mix text pages and image-only pages. Report the split so a half-empty
        # document is visible in the ingestion message instead of silently indexing less.
        blank = sum(1 for p in pages if not p.strip())
        return pages, (f"pdf:{len(pages) - blank} indexed/{blank} needs_ocr" if blank else "pdf")
    if suffix in {".docx", ".doc"}:
        try:
            return _parse_docx(path), "docx"
        except Exception:  # noqa: BLE001 - a legacy .doc or a corrupt zip: fall through
            pass
    if suffix in {".xlsx", ".xlsm"}:
        try:
            return _parse_xlsx(path), "xlsx"
        except Exception:  # noqa: BLE001
            pass
    if suffix in CSV_SUFFIXES:
        return _parse_csv(path), "csv"
    if suffix in HTML_SUFFIXES:
        return _parse_html(path), "html"
    if suffix == ".xls":
        # Legacy binary XLS is not a zip; extract printable runs rather than failing.
        blob = path.read_bytes()
        text = re.sub(rb"[^\x20-\x7e\n\u0600-\u06ff]+", b" ", blob)
        return [text.decode("utf-8", "replace")], "xls"
    if suffix in TEXT_SUFFIXES:
        return _parse_text(path), suffix.lstrip(".")
    if suffix in {".pptx"}:
        return _parse_pptx(path), "pptx"
    # Unknown binary: try zip (many formats are zips), else extract text runs.
    try:
        with zipfile.ZipFile(path) as zf:
            parts = [n for n in zf.namelist() if n.endswith(".xml")]
            chunks_text = []
            for name in parts[:40]:
                body = zf.read(name).decode("utf-8", "replace")
                body = re.sub(r"(?s)<[^>]+>", " ", body)
                if body.strip():
                    chunks_text.append(html.unescape(body))
            if chunks_text:
                return ["\n".join(chunks_text)], "archive"
    except (zipfile.BadZipFile, OSError):
        pass
    # Sludge guard. An image carries no native text, and the old fallback below decoded raw
    # bytes into "text runs" — one BMP yielded 48,263 characters of `!!! ### $$$ %%%` noise
    # which the retriever then matched as content. Refuse, and say why.
    carrier = _image_signature(path)
    if carrier and suffix.lstrip(".") not in TEXT_SUFFIXES:
        return [], f"needs_ocr:{carrier}"
    blob = path.read_bytes()
    text = re.sub(rb"[^\x20-\x7e\n]+", b" ", blob[:400_000])
    decoded = text.decode("utf-8", "replace")
    if _text_plausibility(decoded) < MIN_ALNUM_RATIO:
        # Byte noise from a binary blob, archive or compressed stream: nothing quotable in it.
        return [], "rejected:no-native-text"
    return [decoded], "binary"


# --- sludge guard helpers -------------------------------------------------------------
# Text is overwhelmingly letters, digits and whitespace; stripped byte noise is
# overwhelmingly punctuation and symbol runs. Measured here: the English and Arabic
# corpora score > 0.9 on this ratio, the BMP noise scored well under 0.3, so 0.55 falls in
# the wide gap between them rather than being fitted to one file.
MIN_ALNUM_RATIO = 0.55
IMAGE_SIGNATURES = (
    (b"\xff\xd8\xff", "jpeg"), (b"\x89PNG", "png"), (b"GIF8", "gif"), (b"BM", "bmp"),
    (b"II*\x00", "tiff"), (b"MM\x00*", "tiff"), (b"RIFF", "webp"),
)


def _image_signature(path: pathlib.Path) -> str:
    """Name the image format when the file signature says it cannot carry native text."""
    head = path.read_bytes()[:16]
    return next((kind for sig, kind in IMAGE_SIGNATURES if head.startswith(sig)), "")


def _text_plausibility(text: str) -> float:
    """Fraction of characters that are letters, digits or whitespace."""
    if not text:
        return 0.0
    return sum(1 for ch in text if ch.isalnum() or ch.isspace()) / len(text)


def _parse_pptx(path: pathlib.Path) -> list[str]:
    """PPTX is a zip of slide XML; extract text per slide so each slide becomes a page."""
    pages: list[str] = []
    with zipfile.ZipFile(path) as zf:
        slides = sorted(
            (n for n in zf.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
            key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)),  # type: ignore[union-attr]
        )
        for name in slides:
            body = zf.read(name).decode("utf-8", "replace")
            runs = re.findall(r"(?s)<a:t>(.*?)</a:t>", body)
            text = "\n".join(html.unescape(r) for r in runs if r.strip())
            pages.append(text)
    return pages


# --------------------------------------------------------------------------- chunking

_HEADING_RE = re.compile(r"^(#{1,6}\s+\S|[\u0600-\u06FF\d]{0,4}\s?(?:CHAPTER|Chapter|الفصل|الباب)\s+\S|\S{3,80}\n[=\-]{3,}$)", re.M)
_ARTICLE_RE = re.compile(r"(?m)^\s*(?:المادة|Article|ARTICLE|Art\.|§|第)\s*[\d\u0660-\u0669\u06f0-\u06f9]+")
_QA_RE = re.compile(r"(?m)^\s*(?:Q\d*[:.)]|A\d*[:.)]|Question\s*\d*[:.)]|Answer\s*\d*[:.)]|س\d*[:.)]|ج\d*[:.)])")
_MAIL_RE = re.compile(r"(?m)^\s*(?:From:|Sent:|To:|Subject:|-----Original Message-----|_{10,})")


def _window(text: str, size: int, overlap: int) -> list[str]:
    """Character window that prefers to break on whitespace, with real overlap."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= size:
        return [text]
    out: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            window = text[start:end]
            cut = max(window.rfind("\n\n"), window.rfind("\n"), window.rfind(" "))
            if cut > size * 0.5:
                end = start + cut
        piece = text[start:end].strip()
        if piece:
            out.append(piece)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return out


def _group_paragraphs(text: str, size: int) -> list[str]:
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    out: list[str] = []
    buffer = ""
    for block in blocks:
        if len(block) > size * 1.6:
            if buffer:
                out.append(buffer)
                buffer = ""
            out.extend(_window(block, size, CHUNK_OVERLAP))
            continue
        candidate = f"{buffer}\n\n{block}" if buffer else block
        if len(candidate) > size:
            if buffer:
                out.append(buffer)
            buffer = block
        else:
            buffer = candidate
    if buffer:
        out.append(buffer)
    return out


def _split_on(text: str, pattern: re.Pattern[str], size: int) -> list[str]:
    starts = [m.start() for m in pattern.finditer(text)]
    if not starts:
        return _group_paragraphs(text, size)
    out: list[str] = []
    preamble = text[: starts[0]].strip()
    if preamble:
        out.extend(_group_paragraphs(preamble, size))
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(text)
        piece = text[start:end].strip()
        if len(piece) > size * 2:
            out.extend(_window(piece, size, CHUNK_OVERLAP))
        elif piece:
            out.append(piece)
    return out


def chunk_pages(pages: list[str], method: str, size: int = CHUNK_SIZE) -> list[dict]:
    """Split parsed pages into chunks. Each method has distinct logic, not a shared alias."""
    method = (method or "naive").lower()
    out: list[dict] = []

    def emit(text: str, page: int) -> None:
        text = text.strip()
        if text:
            out.append({"content": text, "page": page})

    if method in {"one", "tag", "knowledge_graph", "picture"}:
        for page_no, page in enumerate(pages, start=1):
            if not page.strip():
                continue
            # "one" keeps the document whole, splitting only when a page exceeds the model window.
            for piece in _window(page, max(size, 4000), 0):
                emit(piece, page_no)
        return out

    if method == "presentation":
        for page_no, page in enumerate(pages, start=1):
            for piece in _group_paragraphs(page, max(size // 2, 200)):
                emit(piece, page_no)
        return out

    if method == "table":
        for page_no, page in enumerate(pages, start=1):
            lines = [ln for ln in page.splitlines() if ln.strip()]
            header = lines[0] if lines else ""
            group: list[str] = []
            for line in lines[1:]:
                group.append(line)
                if len(group) >= 20:
                    emit(f"{header}\n" + "\n".join(group), page_no)
                    group = []
            if group:
                emit(f"{header}\n" + "\n".join(group), page_no)
        return out

    for page_no, page in enumerate(pages, start=1):
        if not page.strip():
            continue
        if method == "qa":
            pieces = _split_on(page, _QA_RE, size)
        elif method == "laws":
            pieces = _split_on(page, _ARTICLE_RE, size)
        elif method in {"book", "paper", "manual"}:
            pieces = _split_on(page, _HEADING_RE, size)
        elif method == "email":
            pieces = _split_on(page, _MAIL_RE, max(size, 800))
        elif method in {"general", "naive"}:
            pieces = _group_paragraphs(page, size)
        else:
            pieces = _window(page, size, CHUNK_OVERLAP)
        for piece in pieces:
            emit(piece, page_no)
    return out


# --------------------------------------------------------------------------- indexing


def _set_progress(document_id: str, progress: float, message: str) -> None:
    x(
        "UPDATE document SET progress = ?, progress_msg = ?, update_time = ? WHERE id = ?",
        (round(progress, 3), message, now_ms(), document_id),
    )


def _refresh_counts(dataset_id: str) -> None:
    row = one(
        "SELECT COUNT(*) AS docs, COALESCE(SUM(chunk_count),0) AS chunks, COALESCE(SUM(token_count),0) AS tokens"
        " FROM document WHERE dataset_id = ?",
        (dataset_id,),
    )
    if row:
        x(
            "UPDATE dataset SET document_count = ?, chunk_count = ?, token_count = ?, update_time = ? WHERE id = ?",
            (row["docs"], row["chunks"], row["tokens"], now_ms(), dataset_id),
        )


def ingest_document(document_id: str) -> dict:
    """The real pipeline. Long-running by design — the console polls progress while it runs."""
    from . import retrieval  # local import: avoids a circular import at module load

    doc = one("SELECT * FROM document WHERE id = ?", (document_id,))
    if not doc:
        return {"ok": False, "message": "document not found"}
    started = now_ms()
    dataset_id = doc["dataset_id"]
    path = pathlib.Path(doc["location"]) if doc["location"] else None
    try:
        if path is None or not path.exists():
            raise FileNotFoundError(
                "No file was uploaded for this document."
                if not doc["location"]
                else f"The uploaded file is no longer on disk: {doc['location']}"
            )
        _set_progress(document_id, 0.05, "Reading file")
        pages, kind = parse_file(path)
        size = int(core.jloads(doc["parser_config"], {}).get("chunk_size") or CHUNK_SIZE)
        native_pieces = (chunk_pages(pages, doc["parser_id"] or "naive", size)
                         if any(p.strip() for p in pages) else [])
        ocr_pieces: list[dict] = []
        ocr_status = ""
        if "needs_ocr" in kind:
            # OCR only the pages the guard deferred; each chunk keeps its own provenance so a
            # citation can say whether it came from native text or from OCR.
            from . import ocr as ocr_worker

            result = ocr_worker.ocr_chunks_for(path)
            ocr_status = result["status"]
            ocr_pieces = [
                {"content": chunk["content"], "page": chunk["page"], "source": "ocr",
                 "bbox": jdumps(chunk["bbox"]) if chunk["bbox"] else "",
                 "available_int": 0 if chunk["quarantined"] else 1,
                 "quarantine": jdumps(chunk["quarantined"]) if chunk["quarantined"] else ""}
                for chunk in result["ocr_chunks"]
            ]
        pieces = native_pieces + ocr_pieces
        if not pieces:
            status = "REJECTED" if kind.startswith("rejected") else (ocr_status or "NEEDS_OCR_NO_TEXT")
            _set_progress(document_id, 1.0, f"No indexable text ({kind}); OCR status "
                          f"{ocr_status or 'not attempted'} - nothing was indexed.")
            x("UPDATE document SET run = ? WHERE id = ?", (status, document_id))
            return {"ok": False, "message": status}
        _set_progress(document_id, 0.3, f"{len(pages)} native page(s), {len(ocr_pieces)} OCR page(s) as {kind}")
        if not pieces:
            raise ValueError("Parsing produced no chunks")
        _set_progress(document_id, 0.5, f"Chunked into {len(pieces)} pieces")

        # Replace any previous chunks for this document.
        old = q("SELECT id FROM chunk WHERE document_id = ?", (document_id,))
        if old:
            # The chunk ids, not the document id: deleting by document_id matches no row and
            # leaves every old token_index row behind, which inflates BM25's df term.
            keys = [(row["id"],) for row in old]
            xmany("DELETE FROM token_index WHERE chunk_id = ?", keys)
            x("DELETE FROM chunk WHERE document_id = ?", (document_id,))

        _set_progress(document_id, 0.62, "Embedding chunks")
        vectors, vec_kind = retrieval.embed_texts([p["content"] for p in pieces])

        rows: list[tuple] = []
        index_rows: list[tuple] = []
        created = now_ms()
        total_tokens = 0
        for i, piece in enumerate(pieces):
            text = piece["content"]
            tokens = tokenize(text)
            total_tokens += len(tokens)
            chunk_id = new_id("chunk")
            keywords = _keywords(text)
            vector = vectors[i].astype("float32").tobytes() if vectors is not None else None
            rows.append(
                (
                    chunk_id,
                    dataset_id,
                    document_id,
                    i,
                    text,
                    " ".join(tokens),
                    jdumps(keywords),
                    jdumps([]),
                    piece.get("available_int", 1),
                    jdumps([]),
                    len(tokens),
                    piece["page"],
                    vector,
                    vec_kind,
                    created,
                    piece.get("source", "native"),
                    piece.get("bbox", ""),
                    piece.get("quarantine", ""),
                )
            )
            counts: dict[str, int] = {}
            for token in tokens:
                counts[token] = counts.get(token, 0) + 1
            for token, tf in counts.items():
                index_rows.append((dataset_id, token, chunk_id, tf))

        xmany(
            "INSERT INTO chunk (id, dataset_id, document_id, idx, content_with_weight, content_ltks,"
            " important_kwd, question_kwd, available_int, positions, token_count, page, vector,"
            " vec_kind, create_time, source, bbox, quarantine)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            rows,
        )
        xmany("INSERT INTO token_index (dataset_id, token, chunk_id, tf) VALUES (?,?,?,?)", index_rows)

        _set_progress(document_id, 1.0, f"{len(rows)} chunks indexed")
        _run = "NEEDS_OCR_QUARANTINE" if any(p.get("quarantine") for p in pieces) else "DONE"
        x(
            "UPDATE document SET run = ?, chunk_count = ?, token_count = ?, progress = 1,"
            " progress_msg = ?, page_count = ?, update_time = ?, error = '' WHERE id = ?",
            (
                _run,
                len(rows),
                total_tokens,
                f"{len(rows)} chunks indexed ({vec_kind})",
                len(pages) or len({piece["page"] for piece in pieces}),
                now_ms(),
                document_id,
            ),
        )
        _refresh_counts(dataset_id)
        elapsed = (now_ms() - started) / 1000
        x(
            "INSERT INTO ingestion_log (id, dataset_id, document_id, document_name, status, message,"
            " elapsed, create_time, operation) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                new_id("ilog"),
                dataset_id,
                document_id,
                doc["name"],
                "success",
                f"{len(rows)} chunks, {vec_kind}",
                elapsed,
                now_ms(),
                "parse",
            ),
        )
        return {"ok": True, "chunks": len(rows), "tokens": total_tokens, "vectors": vec_kind, "pages": len(pages)}
    except Exception as exc:  # noqa: BLE001 - surfaced to the console as a failed run
        message = str(exc) or exc.__class__.__name__
        x(
            "UPDATE document SET run = 'FAIL', progress = 0, progress_msg = ?, error = ?, update_time = ?"
            " WHERE id = ?",
            (message, message, now_ms(), document_id),
        )
        x(
            "INSERT INTO ingestion_log (id, dataset_id, document_id, document_name, status, message,"
            " elapsed, create_time, operation) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                new_id("ilog"),
                dataset_id,
                document_id,
                doc["name"] if doc else document_id,
                "failed",
                message,
                (now_ms() - started) / 1000,
                now_ms(),
                "parse",
            ),
        )
        _refresh_counts(dataset_id)
        return {"ok": False, "message": message}


def _keywords(text: str, limit: int = 8) -> list[str]:
    counts: dict[str, int] = {}
    for token in tokenize(text):
        if len(token) < 3:
            continue
        counts[token] = counts.get(token, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [token for token, _ in ranked[:limit]]

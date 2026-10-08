"""Sludge guard — locks the ingestion classification down so the 48 KB-of-noise case cannot return.

Run: cd engine && .venv/Scripts/python.exe ingest_guard_test.py
Unit tier: no server, no LLM, no network. Everything is decided in-process by parse_file().
"""

from __future__ import annotations

import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from ownrag_engine.ingest import MIN_ALNUM_RATIO, _text_plausibility, parse_file  # noqa: E402

PASS = FAIL = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS, FAIL
    PASS, FAIL = PASS + bool(condition), FAIL + (not condition)
    print(f"  [{'PASS' if condition else 'FAIL'}] {name}{f' — {detail}' if detail else ''}")


def write(root: pathlib.Path, name: str, data: bytes) -> pathlib.Path:
    path = root / name
    path.write_bytes(data)
    return path


def mixed_pdf(root: pathlib.Path) -> pathlib.Path:
    """One real text page, one page that is only an image — the case that must not go silently half-empty."""
    import pymupdf

    doc = pymupdf.open()
    text_page = doc.new_page()
    text_page.insert_text((72, 100), "Graph retrieval report: the nightly build finished at 03:14 UTC.", fontsize=11)
    image_page = doc.new_page()
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 120, 120))
    pix.set_rect(pix.irect, (40, 90, 160))
    image_page.insert_image(pymupdf.Rect(60, 60, 300, 300), pixmap=pix)
    path = root / "mixed.pdf"
    doc.save(path)
    doc.close()
    return path


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)

        print("1. images carry no native text -> needs_ocr, nothing parsed")
        bmp = write(root, "scan.bmp", b"BM" + bytes(range(256)) * 40)
        jpg = write(root, "scan.jpg", b"\xff\xd8\xff\xe0" + b"JFIF\x00" + bytes(range(256)) * 30)
        png = write(root, "scan.png", b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 30)
        for label, path in (("bmp", bmp), ("jpeg", jpg), ("png", png)):
            pages, kind = parse_file(path)
            check(f"{label} -> needs_ocr", kind.startswith("needs_ocr") and not pages, f"kind={kind} pages={len(pages)}")

        print("2. the 48,263-character case -> rejected, not indexed")
        noise = root / "blob.bin"
        noise.write_bytes(b"".join(bytes([33, 32, 35, 32, 36, 32, 37, 32]) for _ in range(6000)))
        pages, kind = parse_file(noise)
        check("byte noise -> rejected", kind.startswith("rejected") and not pages, f"kind={kind} pages={len(pages)}")

        print("3. honest text is untouched")
        honest = "The nightly build finished at 03:14 UTC. Support is provided for ninety days after activation.\n"
        md = write(root, "report.md", honest.encode("utf-8"))
        pages, kind = parse_file(md)
        check("markdown intact", pages == [honest] and kind == "md", f"kind={kind} chars={len(pages[0])}")
        check("markdown passes the ratio", _text_plausibility(honest) > 0.9, f"{_text_plausibility(honest):.3f}")

        arabic = "يمنح النظام كل موظف إجازة سنوية مدفوعة مقدارها ٢١ يومًا، وتزيد إلى 30 يومًا بعد خمس سنوات.\n"
        pages, kind = parse_file(write(root, "leave.txt", arabic.encode("utf-8")))
        check("arabic intact (digits and letters both count)", pages == [arabic], f"kind={kind} ratio={_text_plausibility(arabic):.3f}")

        print("4. mixed PDF is page-level, and says so")
        pdf = mixed_pdf(root)
        pages, kind = parse_file(pdf)
        blank = sum(1 for p in pages if not p.strip())
        check("text page stays native", any("nightly build" in p for p in pages), f"pages={len(pages)}")
        check("image page becomes needs_ocr", blank == 1 and "needs_ocr" in kind, f"kind={kind}")

        print("5. an all-image PDF is deferred whole")
        empty = pathlib.Path(tempfile.mkdtemp()) / "scan.pdf"
        import pymupdf

        d = pymupdf.open(); p = d.new_page()
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 80, 80)); pix.set_rect(pix.irect, (10, 20, 30))
        p.insert_image(pymupdf.Rect(50, 50, 250, 250), pixmap=pix); d.save(empty); d.close()
        pages, kind = parse_file(empty)
        check("all-image pdf -> needs_ocr:pdf", kind == "needs_ocr:pdf" and not pages, f"kind={kind}")

        print("6. the threshold sits in the measured gap")
        check("empty text scores 0", _text_plausibility("") == 0.0)
        check("threshold below honest text, above noise",
              0.3 < MIN_ALNUM_RATIO < _text_plausibility(honest), f"{MIN_ALNUM_RATIO} vs {_text_plausibility(honest):.3f}")

    print("\n" + "=" * 66)
    print(f"  {PASS} passed · {FAIL} failed")
    print("=" * 66)
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()

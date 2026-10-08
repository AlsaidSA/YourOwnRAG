"""Arabic step 1 — does Arabic survive ingestion, does BM25 find it, and what does its morphology break?

No engine changes: this creates its own knowledge base and uploads documents through the same API the
console uses, so the frozen English configuration is untouched.

Three synthetic documents carry deliberate adversarial features (Arabic-Indic digits beside Latin
ones, full tashkeel, and all four alef forms) so the normalisation matrix has a known right answer.
Five real Arabic Wikipedia extracts sit alongside them so relevance is also tested on text nobody
wrote for the test.

    cd engine && .venv/Scripts/python.exe arabic_smoke.py
"""

from __future__ import annotations

import io
import json
import pathlib
import time

import requests

ENGINE = "http://127.0.0.1:9380/api/v1"
WIKI = "https://ar.wikipedia.org/w/api.php"
UA = {"User-Agent": "OwnRAG-arabic-smoke/1.0 (local evaluation)"}

# Authored so each normalisation question has one unambiguous answer.
SYNTHETIC: dict[str, str] = {
    "arabic-leave.txt": (
        "سياسة الإجازات السنوية\n\n"
        "يمنح النظام كل موظف إجازة سنوية مدفوعة مقدارها ٢١ يومًا. وتزيد الإجازة إلى 30 يومًا "
        "بعد إكمال خمس سنوات متصلة من الخدمة. تُقدَّم طلبات الإجازة قبل أسبوعين من تاريخ البدء، "
        "ويوافق عليها المدير المباشر. لا تُرحَّل الإجازات غير المستخدمة إلى السنة التالية إلا بموافقة "
        "الإدارة العامة للموارد البشرية. الإجازة المرضية منفصلة تمامًا عن الإجازة السنوية."
    ),
    "arabic-city.txt": (
        "مدينة الرياض\n\n"
        "الرياض هي عاصمة المملكة العربية السعودية وأكبر مدنها. يبلغ عدد سكان مدينة الرياض نحو "
        "7.6 مليون نسمة، وتبلغ مساحتها حوالي 1973 كيلومترًا مربعًا. تقع المدينة على هضبة نجد "
        "في وسط شبه الجزيرة العربية، وترتفع نحو 600 متر عن سطح البحر. تشتهر الرياض بمعالم "
        "عمرانية حديثة مثل مركز الملك عبد الله المالي وبرج المملكة."
    ),
    "arabic-admin.txt": (
        "التنظيم الإداري\n\n"
        "الْإِدَارَةُ الْعَامَّةُ لِلْمَشْرُوعِ تَتَابِعُ الْأَعْمَالَ الْيَوْمِيَّةَ وَتَرْفَعُ تَقَارِيرَهَا "
        "شَهْرِيًّا. تتولى الإدارة العامة تنسيق الأعمال بين الأقسام، وتشرف على الموازنة والالتزام "
        "باللوائح. أنشأت الأمانة العامة لجنة دائمة لمراجعة الأداء، ودرست آثار التوسع على الخدمات. "
        "اكتشاف المشكلات مبكرًا مسؤولية مشتركة بين جميع الأقسام."
    ),
}

WIKI_TITLES = ["الرياض", "اللغة العربية", "الذكاء الاصطناعي", "البحر الأحمر", "جامعة الملك سعود"]

# (label, question, expected document, expected span in the chunk text)
PROBES: list[tuple[str, str, str, str]] = [
    ("direct / Arabic-Indic digits", "كم عدد أيام الإجازة السنوية؟", "arabic-leave.txt", "٢١"),
    ("direct / Latin digits", "كم يومًا تزيد الإجازة بعد خمس سنوات؟", "arabic-leave.txt", "30"),
    ("query uses Arabic-Indic digits", "الإجازة السنوية ٢١ يومًا", "arabic-leave.txt", "٢١"),
    ("alef: bare ا in query, إ in corpus", "اجازة سنوية مدفوعة", "arabic-leave.txt", "إجازة"),
    ("alef: أ in query, ا in corpus", "أكبر مدن المملكة", "arabic-city.txt", "أكبر"),
    ("alef: آ in corpus", "آثار التوسع على الخدمات", "arabic-admin.txt", "آثار"),
    ("tashkeel in query, none in corpus", "الإدارة العامة للمشروع", "arabic-admin.txt", "الإدارة العامة"),
    ("tashkeel in corpus, none in query", "ما دور الإدارة العامة؟", "arabic-admin.txt", "الإدارة العامة"),
    ("definite article (clitic ال)", "الإجازات غير المستخدمة", "arabic-leave.txt", "الإجازات"),
    ("clitic و prefix", "وتبلغ مساحتها كم؟", "arabic-city.txt", "مساحتها"),
    ("numbers: population", "كم عدد سكان مدينة الرياض؟", "arabic-city.txt", "7.6"),
    ("real Wikipedia text", "ما هي عاصمة المملكة العربية السعودية؟", "الرياض", "الرياض"),
    ("negative / out of corpus", "ما هي عاصمة أستراليا؟", "", ""),
]

H: dict[str, str] = {}


def call(method: str, path: str, body=None, timeout: int = 300):
    return requests.request(method, f"{ENGINE}{path}", json=body, headers={**H, "Content-Type": "application/json"}, timeout=timeout).json()


def norm(text: str) -> str:
    return " ".join(str(text or "").split())


def wiki_extracts(titles: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        params = {
            "action": "query", "prop": "extracts", "explaintext": 1, "format": "json",
            "redirects": 1, "titles": "|".join(titles),
        }
        data = requests.get(WIKI, params=params, headers=UA, timeout=60).json()
        for page in (data.get("query") or {}).get("pages", {}).values():
            text = norm(page.get("extract"))
            if text and len(text) > 400:
                out[page.get("title", "?")] = text[:12000]
    except Exception as exc:  # noqa: BLE001
        print(f"  wikipedia fetch failed ({exc}) — continuing with synthetic documents only")
    return out


def main() -> None:
    H["Authorization"] = "Bearer " + call("POST", "/auth/login", {"email": "owner@ownrag.local"})["data"]["access_token"]

    files: dict[str, bytes] = {name: text.encode("utf-8") for name, text in SYNTHETIC.items()}
    real = wiki_extracts(WIKI_TITLES)
    for title, text in real.items():
        files[f"wiki-{title}.txt"] = text.encode("utf-8")
    print(f"sources: {len(SYNTHETIC)} synthetic + {len(real)} real Arabic Wikipedia articles")

    kb = call("POST", "/datasets", {"name": "Arabic smoke"})["data"][0]["id"]
    ids = []
    for name, blob in files.items():
        rows = requests.post(
            f"{ENGINE}/datasets/{kb}/documents", headers=H, timeout=300,
            files={"file": (name, io.BytesIO(blob), "text/plain")}, data={"parser_id": "naive"},
        ).json().get("data") or []
        ids.append(rows[0]["id"] if rows and isinstance(rows[0], dict) else "")
    call("POST", "/documents/ingest", {"document_ids": [i for i in ids if i]})

    for _ in range(60):
        time.sleep(3)
        s = call("GET", f"/datasets/{kb}/ingestions/summary")["data"]
        if s["done"] >= len(files) and not s["running"]:
            break
    s = call("GET", f"/datasets/{kb}/ingestions/summary")["data"]
    print(f"kb {kb}  ingested {s['done']}/{s['total']}  chunks={s['chunks']}  tokens={s['tokens']}")

    # Does Arabic survive the pipeline, or arrive mangled/empty?
    docs = call("GET", f"/datasets/{kb}/documents?page_size=30")["data"]
    print("\nSTORAGE CHECK (text as indexed):")
    for d in docs[:3]:
        page = call("GET", f"/datasets/{kb}/documents/{d['id']}/chunks?page=1&page_size=1").get("data") or []
        rows = page if isinstance(page, list) else (page.get("chunks") or [])
        head = norm((rows[0].get("content") if rows else ""))[:80]
        print(f"  {d['name']:<26} chunks={d['chunk_count']:<4} {head!r}")

    print("\nRETRIEVAL MATRIX (top-1 document, and whether the expected span is in the top chunk):")
    name_of = {d["id"]: d["name"] for d in docs}
    survived = 0
    for label, question, expected_doc, span in PROBES:
        res = call("POST", "/datasets/search", {
            "question": question, "dataset_ids": [kb], "top_k": 10, "page_size": 10,
            "similarity_threshold": 0.0, "vector_similarity_weight": 0.3, "keyword": True,
        })
        chunks = (res.get("data") or {}).get("chunks") or []
        if not chunks:
            print(f"  [no results] {label}")
            continue
        top = chunks[0]
        top_doc = top.get("document_keyword") or name_of.get(str(top.get("document_id") or ""), "?")
        rank = next((i for i, c in enumerate(chunks, 1)
                     if (c.get("document_keyword") == expected_doc)), 0) if expected_doc else 0
        span_hit = bool(span) and any(span in norm(c.get("content") or "") for c in chunks[:3])
        if not expected_doc:
            ok = "ok (nothing relevant expected)"
        else:
            ok = "PASS" if (rank and span_hit) else ("partial" if rank else "MISS")
            survived += int(ok == "PASS")
        print(f"  {ok:<26} {label}")
        print(f"       q={question[:52]!r}")
        print(f"       top={top_doc} sim={top.get('similarity')} expected_rank={rank or '-'} span_in_top3={span_hit}")

    scored = [p for p in PROBES if p[2]]
    print(f"\nnormalisation/relevance: {survived}/{len(scored)} probes fully passed")


if __name__ == "__main__":
    main()

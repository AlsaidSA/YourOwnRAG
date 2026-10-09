"""
OwnRAG engine — retrieval: vector index, inverted index, hybrid fusion, rerank.

Two real indexes back every query:
  * a hashed vector index (or a remote embedding model when one is configured), stored as
    float32 blobs and scored with a numpy dot product;
  * a BM25 inverted index (`token_index`) built during ingestion.

Scores are combined the way the upstream contract describes — `vector_similarity_weight`
splits the weight between the vector and the term score — and the result carries the
per-component numbers the console's score meters display.

Modified from an upstream Apache-2.0 project; see NOTICE for origin and attribution.
"""

from __future__ import annotations

import json
import math
import zlib

import numpy as np

from . import core
from .core import (
    LOCAL_DIM,
    jdumps,
    one,
    q,
    resolve_embedding,
    tokenize,
)

K1 = 1.5
B = 0.75


# --------------------------------------------------------------------------- vectors


def _bucket(token: str) -> int:
    # zlib.crc32, not hash(): builtin str hashing is salted per process, so stored vectors
    # would stop matching freshly-encoded queries after a restart.
    return zlib.crc32(token.encode("utf-8")) % LOCAL_DIM


def _local_vector(text: str) -> np.ndarray:
    """Sublinear TF over word tokens plus character 3-grams, L2-normalised.

    The 3-grams give partial robustness to Arabic morphology (clitics, plural forms) that a pure
    bag of words misses. This is a lexical vector, not a semantic embedding — the engine labels
    it as such everywhere it reports its mode.
    """
    vector = np.zeros(LOCAL_DIM, dtype="float32")
    tokens = tokenize(text)
    counts: dict[str, int] = {}
    for token in tokens:
        counts[token] = counts.get(token, 0) + 1
    for token, tf in counts.items():
        vector[_bucket(token)] += 1.0 + math.log(tf)
        if len(token) >= 4:
            for i in range(len(token) - 2):
                gram = token[i : i + 3]
                vector[_bucket("#" + gram)] += 0.5
    norm = float(np.linalg.norm(vector))
    if norm > 0:
        vector /= norm
    return vector


def _remote_embed(texts: list[str], cfg: dict) -> np.ndarray:
    """OpenAI-compatible /embeddings, at the endpoint the console or the environment configured."""
    import requests

    vectors: list[list[float]] = []
    for start in range(0, len(texts), 32):
        batch = texts[start : start + 32]
        response = requests.post(
            f"{cfg['base_url']}/embeddings",
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {cfg['api_key']}"} if cfg["api_key"] else {}),
            },
            json={"model": cfg["model"], "input": batch},
            timeout=120,
        )
        response.raise_for_status()
        payload = response.json()
        vectors.extend(item["embedding"] for item in payload["data"])
    matrix = np.asarray(vectors, dtype="float32")
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms


def vector_kind() -> str:
    """The encoder's identity, stored beside every vector so a model swap cannot silently mix
    incompatible spaces — `_load_index` skips vectors written by a different one."""
    cfg = resolve_embedding()
    if cfg["model"] and cfg["base_url"]:
        return f"semantic/{cfg['model']}"
    return f"lexical/{LOCAL_DIM}"


def embed_texts(texts: list[str]) -> tuple[np.ndarray | None, str]:
    if not texts:
        return None, vector_kind()
    cfg = resolve_embedding()
    if cfg["model"] and cfg["base_url"]:
        return _remote_embed(texts, cfg), vector_kind()
    return np.vstack([_local_vector(t) for t in texts]), vector_kind()


def _load_index(dataset_ids: list[str]) -> tuple[list[str], np.ndarray | None]:
    """Load the stored vectors for these datasets, skipping any written by a different encoder."""
    if not dataset_ids:
        return [], None
    marks = ",".join("?" for _ in dataset_ids)
    kind = vector_kind()
    rows = q(
        f"SELECT id, vector FROM chunk WHERE dataset_id IN ({marks}) AND vector IS NOT NULL AND vec_kind = ?",
        (*dataset_ids, kind),
    )
    ids: list[str] = []
    blobs: list[np.ndarray] = []
    for row in rows:
        arr = np.frombuffer(row["vector"], dtype="float32")
        if arr.size:
            ids.append(row["id"])
            blobs.append(arr)
    if not blobs or len({b.size for b in blobs}) != 1:
        return ids, None
    return ids, np.vstack(blobs)


# --------------------------------------------------------------------------- lexical


def bm25(dataset_ids: list[str], question: str, limit: int) -> dict[str, float]:
    tokens = [t for t in tokenize(question) if len(t) > 1]
    if not tokens or not dataset_ids:
        return {}
    marks = ",".join("?" for _ in dataset_ids)
    marks_t = ",".join("?" for _ in tokens)
    stats = one(
        f"SELECT COUNT(*) AS n, COALESCE(AVG(token_count),1) AS avg FROM chunk WHERE dataset_id IN ({marks})",
        tuple(dataset_ids),
    )
    if not stats:
        return {}
    total = float(stats["n"] or 0)
    avg_len = float(stats["avg"] or 1)
    if total <= 0:
        return {}
    df_rows = q(
        f"SELECT token, COUNT(DISTINCT chunk_id) AS df FROM token_index"
        f" WHERE dataset_id IN ({marks}) AND token IN ({marks_t}) GROUP BY token",
        (*dataset_ids, *tokens),
    )
    idf = {r["token"]: math.log(1 + (total - r["df"] + 0.5) / (r["df"] + 0.5)) for r in df_rows}
    if not idf:
        return {}
    hits = q(
        f"SELECT chunk_id, token, tf FROM token_index WHERE dataset_id IN ({marks}) AND token IN ({marks_t})",
        (*dataset_ids, *tokens),
    )
    lengths = {
        r["id"]: r["token_count"]
        for r in q(f"SELECT id, token_count FROM chunk WHERE dataset_id IN ({marks})", tuple(dataset_ids))
    }
    scores: dict[str, float] = {}
    for hit in hits:
        token = hit["token"]
        tf = float(hit["tf"])
        length = float(lengths.get(hit["chunk_id"], avg_len) or avg_len)
        denom = tf + K1 * (1 - B + B * length / avg_len)
        scores[hit["chunk_id"]] = scores.get(hit["chunk_id"], 0.0) + idf[token] * (tf * (K1 + 1)) / denom
    if not scores:
        return {}
    ranked = dict(sorted(scores.items(), key=lambda kv: -kv[1])[: limit * 8])
    return ranked


def rerank(question: str, rows: list[dict]) -> None:
    """Lexical rerank: query-term recall, proximity and a short-passage prior, in place.

    A configured cross-encoder rerank model would slot in here; without one this is an honest
    lexical rerank and the console labels the column `lexical`.
    """
    query_tokens = {t for t in tokenize(question) if len(t) > 1}
    if not query_tokens:
        for row in rows:
            row["rerank_score"] = row["similarity"]
        return
    for row in rows:
        tokens = tokenize(row["content_with_weight"])
        if not tokens:
            row["rerank_score"] = 0.0
            continue
        token_set = set(tokens)
        recall = len(query_tokens & token_set) / len(query_tokens)
        density = len(query_tokens & token_set) / (len(tokens) ** 0.5)
        # Proximity: are the query terms near each other, or scattered across the passage?
        positions = [i for i, t in enumerate(tokens) if t in query_tokens]
        span = (positions[-1] - positions[0] + 1) if len(positions) > 1 else len(tokens)
        proximity = 1.0 - min(span / max(len(tokens), 1), 1.0)
        row["rerank_score"] = round(0.6 * recall + 0.3 * min(density, 1.0) + 0.1 * proximity, 6)
    rows.sort(key=lambda r: -(r["rerank_score"] or 0))


# --------------------------------------------------------------------------- search


def _norm(values: dict[str, float]) -> dict[str, float]:
    if not values:
        return {}
    top = max(values.values())
    bottom = min(values.values())
    if top <= bottom:
        return {k: 1.0 for k in values}
    return {k: (v - bottom) / (top - bottom) for k, v in values.items()}


def llm_rerank(question: str, chunks: list[dict], llm: dict, keep: int) -> list[dict]:
    """Keep the passages that answer the question; drop the ones that merely share vocabulary.

    Retrieving wide recovers evidence (diagnostics: the gold chunk for 4 of 10 questions sits at
    rank 8-19) but also hands the model unrelated passages from the same corpus, and it cites what it
    is shown. Anything the model does not rank is appended in retrieval order rather than dropped, so
    a bad ranking can reorder the context but never silently discard the evidence.
    """
    import re

    import requests

    if len(chunks) <= keep:
        return chunks
    base = str(llm.get("base_url") or "").rstrip("/")
    key = str(llm.get("api_key") or "")
    model = str(llm.get("model_name") or llm.get("model") or "")
    if not (base and key and model):
        return chunks[:keep]
    listing = "\n\n".join(
        f"[{i}] {str(c.get('content') or c.get('content_with_weight') or '')[:400]}" for i, c in enumerate(chunks)
    )
    try:
        response = requests.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "temperature": 0,
                "stream": False,
                "messages": [
                    {
                        "role": "system",
                        "content": "You rank retrieved passages by how directly they answer the question. "
                        "Reply with passage numbers only, most useful first, comma separated. No prose.",
                    },
                    {
                        "role": "user",
                        "content": f"Question: {question}\n\nPassages:\n{listing}\n\n"
                        f"List the {keep} passage numbers that best answer the question.",
                    },
                ],
            },
            timeout=90,
        )
        content = str((((response.json().get("choices") or [{}])[0].get("message")) or {}).get("content") or "")
    except Exception:  # noqa: BLE001 - reranking is an optimisation, never a failure path
        return chunks[:keep]
    order = [int(n) for n in re.findall(r"\d+", content)]
    ranked = [chunks[i] for i in order if 0 <= i < len(chunks)]
    if not ranked:
        # The call came back but ranked nothing — a rejected key answers with a plain error body, which
        # parses fine and yields an empty list. Then no judgement was made, so the retrieval order stands:
        # padding to the floor here would silently *narrow* the context a failed rerank was given, which is
        # backwards. This is also why the agent smoke check used to pass: the narrowed three passages
        # happened to contain the word it looked for.
        return chunks[:keep]
    # Trust the ranking. Padding back up to `keep` with passages the model did not choose is exactly
    # how distractors re-enter the context: it ranks the relevant ones, then the empty slots are
    # refilled with what it passed over. Pad only to `floor`, so the context is never starved but
    # unranked passages are never promoted.
    floor = min(keep, 3)
    if len(ranked) < floor:
        for chunk in chunks:
            if chunk not in ranked:
                ranked.append(chunk)
            if len(ranked) >= floor:
                break
    return ranked[:keep]

def search(payload: dict) -> dict:
    """The shared implementation behind /datasets/search, the chat retrieval step and the agent
    retrieval node: hybrid BM25 + vector search, weighted fusion, threshold, optional rerank."""
    dataset_ids = [str(d) for d in (payload.get("dataset_ids") or payload.get("kb_ids") or []) if d]
    question = str(payload.get("question") or payload.get("query") or "").strip()
    if not dataset_ids or not question:
        return {"total": 0, "chunks": [], "doc_aggs": [], "keywords": [], "elapsed_ms": 0}

    top_k = int(payload.get("top_k") or 1024)
    page_size = int(payload.get("page_size") or min(top_k, 30))
    page = max(int(payload.get("page") or 1), 1)
    weight = float(payload.get("vector_similarity_weight") or 0.3)
    weight = min(max(weight, 0.0), 1.0)
    threshold = float(payload.get("similarity_threshold") or 0.0)
    doc_ids = [str(d) for d in (payload.get("doc_ids") or []) if d]
    want_rerank = bool(payload.get("rerank_id"))
    use_keyword = payload.get("keyword", True) is not False
    # A disabled keyword arm must not keep its share of the score. With only the vector arm left
    # it carries the full weight; otherwise every score is capped at `weight` and any threshold
    # above that value discards the entire corpus — which is what "Use keyword search: off"
    # (the console's default) used to do.
    vector_weight = weight if use_keyword else 1.0
    term_weight = (1.0 - weight) if use_keyword else 0.0

    import time

    started = time.perf_counter()

    term_scores = bm25(dataset_ids, question, top_k) if use_keyword else {}
    ids, matrix = _load_index(dataset_ids)
    vector_scores: dict[str, float] = {}
    if matrix is not None and ids:
        query_vector, _ = embed_texts([question])
        if query_vector is not None and query_vector.shape[1] == matrix.shape[1]:
            sims = matrix @ query_vector[0]
            mask = np.argsort(-sims)[: top_k * 4]
            vector_scores = {ids[i]: float(sims[i]) for i in mask}

    term_scores = _norm(term_scores)
    candidates = set(term_scores) | set(vector_scores)
    if not candidates:
        return {"total": 0, "chunks": [], "doc_aggs": [], "keywords": [], "elapsed_ms": 0}

    marks = ",".join("?" for _ in candidates)
    rows: list[dict] = []
    for row in q(
        "SELECT c.*, d.name AS doc_name FROM chunk c LEFT JOIN document d ON d.id = c.document_id"
        f" WHERE c.id IN ({marks}) AND c.available_int = 1",
        tuple(candidates),
    ):
        if doc_ids and row["document_id"] not in doc_ids:
            continue
        term = term_scores.get(row["id"], 0.0)
        vector = max(vector_scores.get(row["id"], 0.0), 0.0)
        score = vector_weight * vector + term_weight * term
        rows.append(
            {
                "id": row["id"],
                "chunk_id": row["id"],
                "content_with_weight": row["content_with_weight"],
                "content": row["content_with_weight"],
                "document_id": row["document_id"],
                "doc_id": row["document_id"],
                "doc_name": row["doc_name"] or "Document",
                "document_keyword": row["doc_name"] or "Document",
                "docnm_kwd": row["doc_name"] or "Document",
                "dataset_id": row["dataset_id"],
                "page": row["page"],
                "important_kwd": core.jloads(row["important_kwd"], []),
                "question_kwd": core.jloads(row["question_kwd"], []),
                "available_int": row["available_int"],
                "positions": core.jloads(row["positions"], []),
                "token_count": row["token_count"],
                "term_similarity": round(term, 6),
                "vector_similarity": round(vector, 6),
                "similarity": round(score, 6),
            }
        )

    rows = [r for r in rows if r["similarity"] >= threshold]
    if want_rerank:
        rerank(question, rows)
    else:
        rows.sort(key=lambda r: -r["similarity"])

    for i, row in enumerate(rows):
        row["index"] = i + 1

    total = len(rows)
    window = rows[(page - 1) * page_size : (page - 1) * page_size + page_size]
    aggregates: dict[str, dict] = {}
    for row in rows:
        key = row["document_id"]
        bucket = aggregates.setdefault(
            key, {"doc_id": key, "doc_name": row["doc_name"], "count": 0, "dataset_id": row["dataset_id"]}
        )
        bucket["count"] += 1

    keywords = [t for t in dict.fromkeys(tokenize(question)) if t in " ".join(term_scores)][:12]
    return {
        "total": total,
        "chunks": window,
        "doc_aggs": list(aggregates.values()),
        "keywords": keywords,
        "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
    }

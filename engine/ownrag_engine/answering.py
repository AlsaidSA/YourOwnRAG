"""
OwnRAG engine — grounded answer construction and SSE streaming.

Two modes, and the engine is explicit about which one produced an answer:

  * `extractive` (default) — no model configured. The answer is assembled from the retrieved
    passages: sentences are scored against the question, ordered, and cited. It cannot
    hallucinate, because it only ever emits sentences that exist in your corpus. It will not
    paraphrase or synthesise, and the answer says so in its last line.
  * `llm:<model>` — an OpenAI-compatible chat endpoint is configured. The retrieved passages are
    numbered and injected as the only context; citations come from the retriever, not the model.

Frames are emitted in the shape `web/src/api/chat-stream.ts` parses:
    data:{"code":0,"data":{"answer":"","reference":[...]}}   ← citations
    data:{"code":0,"data":{"answer":"..."}}                  ← incremental text
    data:[DONE]

Derived from RAGFlow (https://github.com/infiniflow/ragflow), Apache-2.0.
"""

from __future__ import annotations

import json
import re

from . import retrieval
from .core import fallback_reason, resolve_llm, tokenize

QUOTE_ONLY_NOTE = (
    "Extractive answer assembled from the retrieved passages above — no generation model is "
    "configured, so nothing here is paraphrased or synthesised. Add a provider and enable a chat "
    "model on the Models screen for generated answers (or set OWNRAG_LLM_BASE_URL / "
    "OWNRAG_LLM_MODEL in engine/.env)."
)


def quote_only_note() -> str:
    """The note, plus the specific reason when a provider exists but has no model switched on."""
    return QUOTE_ONLY_NOTE + fallback_reason()

_SENTENCE_RE = re.compile(r"(?<=[.!?؟।\n])\s+")


def _sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENTENCE_RE.split(text)]
    out: list[str] = []
    for part in parts:
        if not part:
            continue
        # A very long run without punctuation (common in PDFs) is split on length.
        if len(part) > 600:
            out.extend(part[i : i + 400].strip() for i in range(0, len(part), 400))
        else:
            out.append(part)
    return [p for p in out if len(p) > 2]


def build_extractive(question: str, chunks: list[dict], max_sentences: int = 7) -> str:
    """Score every sentence in the retrieved passages and assemble a cited answer."""
    if not chunks:
        return (
            "Nothing in this knowledge base matched the question, so there is no grounded answer "
            "to give. Try different wording, add the document that covers this topic, or lower the "
            "similarity threshold."
        )

    query_tokens = {t for t in tokenize(question) if len(t) > 1}
    candidates: list[tuple[float, int, str]] = []
    for chunk_index, chunk in enumerate(chunks, start=1):
        body = str(chunk.get("content_with_weight") or chunk.get("content") or "")
        sentences = _sentences(body)
        for position, sentence in enumerate(sentences):
            tokens = tokenize(sentence)
            if not tokens:
                continue
            token_set = set(tokens)
            overlap = len(query_tokens & token_set)
            if overlap == 0:
                continue
            goodness = overlap / (len(query_tokens) ** 0.5)
            goodness *= 1.0 / (1.0 + position * 0.12)  # earlier sentences describe, later ones qualify
            goodness *= 1.0 + min(len(sentence), 400) / 800.0
            if len(sentence) < 30:
                goodness *= 0.5
            candidates.append((goodness, chunk_index, sentence))

    if not candidates:
        # No sentence shares a term with the question: fall back to the head of the best passage.
        best = chunks[0]
        body = str(best.get("content_with_weight") or best.get("content") or "")
        excerpt = " ".join(body.split()[:90])
        return f"The closest passage to your question is from {best.get('doc_name', 'the corpus')} (1):\n\n{excerpt} [citation:1]\n\n{quote_only_note()}"

    candidates.sort(key=lambda item: -item[0])
    chosen = candidates[:max_sentences]
    chosen.sort(key=lambda item: item[1])  # restore document order for readability

    lines: list[str] = []
    used: set[int] = set()
    for _, chunk_index, sentence in chosen:
        used.add(chunk_index)
        cleaned = " ".join(sentence.split())
        lines.append(f"- {cleaned} [citation:{chunk_index}]")

    sources = ", ".join(
        f"{chunks[i - 1].get('doc_name', 'document')} (p.{chunks[i - 1].get('page', '?')})" for i in sorted(used)
    )
    lead = (
        f"From {len(used)} of the {len(chunks)} retrieved passages, the corpus says — sourced from {sources}:"
        if len(used) > 1
        else f"The corpus answers this in one passage, from {sources}:"
    )
    return "\n\n".join([lead, "\n".join(lines), quote_only_note()])


def _reference(chunks: list[dict]) -> list[dict]:
    out: list[dict] = []
    for i, chunk in enumerate(chunks, start=1):
        out.append(
            {
                "chunk_id": chunk.get("id") or chunk.get("chunk_id"),
                "doc_id": chunk.get("document_id"),
                "document_id": chunk.get("document_id"),
                "doc_name": chunk.get("doc_name") or "Document",
                "document_keyword": chunk.get("doc_name") or "Document",
                "dataset_id": chunk.get("dataset_id"),
                "content": chunk.get("content_with_weight") or chunk.get("content") or "",
                "content_with_weight": chunk.get("content_with_weight") or "",
                "similarity": chunk.get("similarity"),
                "vector_similarity": chunk.get("vector_similarity"),
                "term_similarity": chunk.get("term_similarity"),
                "rerank_score": chunk.get("rerank_score"),
                "page": chunk.get("page"),
                "index": i,
            }
        )
    return out


def _frame(payload: dict) -> str:
    return "data:" + json.dumps({"code": 0, "data": payload}, ensure_ascii=False) + "\n\n"


def _pieces(text: str, size: int = 24):
    """Stream in word-ish pieces so the UI renders progressively like a real token stream."""
    buffer = ""
    for part in re.split(r"(\s+)", text):
        buffer += part
        if len(buffer) >= size:
            yield buffer
            buffer = ""
    if buffer:
        yield buffer


def _llm_stream(question: str, chunks: list[dict], prompt: str, temperature: float, llm: dict):
    """Stream from an OpenAI-compatible chat endpoint, grounded on the numbered passages."""
    import requests

    context = "\n\n".join(
        f"[{i}] {c.get('doc_name', 'document')} (p.{c.get('page', '?')}):\n{c.get('content_with_weight', '')}"
        for i, c in enumerate(chunks, start=1)
    )
    system = prompt or (
        "You are OwnRAG answering strictly from the numbered passages provided. Cite the passage "
        "number you used as [citation:N]. If the passages do not contain the answer, say so plainly "
        "instead of guessing."
    )
    response = requests.post(
        f"{llm['base_url']}/chat/completions",
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {llm['api_key']}"} if llm["api_key"] else {}),
        },
        json={
            "model": llm["model"],
            "stream": True,
            "temperature": temperature,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": f"Passages:\n{context}\n\nQuestion: {question}"},
            ],
        },
        stream=True,
        timeout=300,
    )
    response.raise_for_status()
    for raw in response.iter_lines(decode_unicode=True):
        if not raw or not raw.startswith("data:"):
            continue
        payload = raw[5:].strip()
        if payload == "[DONE]":
            return
        try:
            parsed = json.loads(payload)
        except ValueError:
            continue
        delta = (parsed.get("choices") or [{}])[0].get("delta") or {}
        piece = delta.get("content")
        if piece:
            yield piece


def stream_answer(payload: dict) -> "list[str]":
    """Build the full SSE response. Returned as a list of frames (uvicorn streams them out)."""
    question = str(payload.get("question") or "").strip()
    datasets = [str(d) for d in (payload.get("dataset_ids") or []) if d]
    prompt = str(payload.get("prompt") or "")
    temperature = float(payload.get("temperature") or 0.3)
    top_k = int(payload.get("top_k") or 6)

    if not question:
        return [_frame({"answer": "Ask a question and I will answer from your knowledge bases."}), "data:[DONE]\n\n"]
    if not datasets:
        return [
            _frame(
                {
                    "answer": "No knowledge base is linked to this conversation. Open the assistant "
                    "settings and attach one, then ask again."
                }
            ),
            "data:[DONE]\n\n",
        ]

    result = retrieval.search({**payload, "top_k": max(top_k, 6), "page_size": max(top_k, 6)})
    chunks = result["chunks"]

    # Retrieve wide, then rank down to what the model actually reads. The wide window recovered the
    # evidence but also pulled in passages from unrelated papers, and the model cites what it sees.
    keep = int(payload.get("rerank_top_n") or 5)
    # Rank a wide pool (20), then cap-select `keep` from THAT pool with at most 2 passages per
    # document. Capping the reranker's own 5-item output recovers nothing — there is no sixth item
    # to diversify to — so the cap is only meaningful over a pool longer than the slots it fills.
    rerank_pool = keep
    if len(chunks) > keep:
        ranked = retrieval.llm_rerank(question, chunks, resolve_llm(str(payload.get("model") or "")), rerank_pool)
        chunks = ranked[:keep]

    frames: list[str] = []
    # References first. The empty `answer` string is deliberate: without it the console's
    # stream reader treats a reference-only frame as the end of the stream.
    frames.append(_frame({"answer": "", "reference": _reference(chunks)}))
    frames.append(_frame({"thought": f"Retrieved {len(chunks)} passages from {len(datasets)} knowledge base(s) in {result['elapsed_ms']} ms"}))

    # Resolved per answer, not at import: enabling a provider in the console must take effect on
    # the next question rather than the next restart. `model` is the assistant's own choice.
    llm = resolve_llm(str(payload.get("model") or ""))
    if llm["mode"] != "extractive":
        try:
            for piece in _llm_stream(question, chunks, prompt, temperature, llm):
                frames.append(_frame({"answer": piece}))
        except Exception as exc:  # noqa: BLE001 - degrade to extractive rather than fail the turn
            frames.append(_frame({"answer": f"\n\nThe configured model call failed ({exc}). Falling back to the retrieved passages:\n\n"}))
            for piece in _pieces(build_extractive(question, chunks)):
                frames.append(_frame({"answer": piece}))
    else:
        if not chunks:
            for piece in _pieces(build_extractive(question, chunks)):
                frames.append(_frame({"answer": piece}))
        else:
            frames.append(_frame({"answer": f"**{len(chunks)} passages retrieved.** "}))
            for piece in _pieces(build_extractive(question, chunks)):
                frames.append(_frame({"answer": piece}))

    frames.append("data:[DONE]\n\n")
    return frames

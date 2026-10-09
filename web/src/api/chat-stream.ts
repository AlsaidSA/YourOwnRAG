/*
 * Copyright 2026 OwnRAG contributors
 * Modified from an upstream Apache-2.0 project; see NOTICE for origin and attribution.
 * Copyright 2026 The InfiniFlow Authors. Licensed under the Apache License, Version 2.0.
 *
 * Streaming chat transport.
 *
 * The backend streams server-sent events from `/api/v1/chat/completions` and
 * `/api/v1/agents/chat/completions`. Two payload shapes appear in the wild:
 *   data:{"code":0,"data":{"answer":"...","reference":[...]}}   — chat assistant
 *   data:{"answer":"...","reference":{...}}                     — agent / search bot
 * This module normalises both into a single async iterator, and simulates the same
 * cadence against the demo corpus so the streaming UI is exercised without a backend.
 */
import { endpoints } from '@/api/endpoints';
import { isDemoMode } from '@/api/client';
import { demoAgents, demoChunks, demoMessages, demoScore } from '@/api/demo/db';
import type { Citation } from '@/api/types';
import { getAuthToken } from '@/store/auth';

export interface StreamDelta {
  kind: 'delta' | 'reference' | 'done' | 'thought';
  text?: string;
  citations?: Citation[];
  elapsedMs?: number;
}

interface StreamOptions {
  url?: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}

function normalizeCitation(raw: unknown): Citation | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const content = typeof c.content === 'string' ? c.content : typeof c.content_with_weight === 'string' ? c.content_with_weight : '';
  return {
    chunk_id: String(c.chunk_id ?? c.id ?? ''),
    doc_id: String(c.doc_id ?? c.document_id ?? ''),
    doc_name: String(c.doc_name ?? c.document_keyword ?? c.docnm_kwd ?? 'Document'),
    content,
    similarity: typeof c.similarity === 'number' ? c.similarity : undefined,
    vector_similarity: typeof c.vector_similarity === 'number' ? c.vector_similarity : undefined,
    term_similarity: typeof c.term_similarity === 'number' ? c.term_similarity : undefined,
    index: typeof c.index === 'number' ? c.index : undefined,
  };
}

function extractCitations(raw: unknown): Citation[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(normalizeCitation).filter((c): c is Citation => Boolean(c));
}

/** Split a seeded answer into token-ish pieces so demo streaming looks like the real thing. */
function* chunkText(text: string, size = 4) {
  const parts = text.split(/(\s+)/);
  let buffer = '';
  for (const part of parts) {
    buffer += part;
    if (buffer.length >= size) {
      yield buffer;
      buffer = '';
    }
  }
  if (buffer) yield buffer;
}

async function* demoStream({ body, signal }: StreamOptions): AsyncGenerator<StreamDelta> {
  await new Promise((resolve) => setTimeout(resolve, 260));
  const platform = String(body.platform ?? 'chat');
  const question = String(body.question ?? '');
  const chatId = String(body.chat_id ?? '');

  // Reuse the seeded conversation when the question matches a stored turn, otherwise answer
  // from the closest seeded chunk. Either way the citations are real rows from the corpus.
  const seeded = Object.values(demoMessages)
    .flat()
    .find((m) => m.role === 'assistant' && m.reference?.length);
  const answer =
    seeded?.content ??
    'Based on the indexed corpus, the retrieved passages answer the question directly. Connect the API server for live generation.';
  const references = seeded?.reference ?? [];

  yield { kind: 'thought', text: platform === 'agent' ? 'Planning · retrieving from 2 knowledge bases' : 'Retrieving passages' };
  await new Promise((resolve) => setTimeout(resolve, 220));

  if (references.length) {
    yield { kind: 'reference', citations: references };
  } else {
    yield {
      kind: 'reference',
      citations: demoChunks.slice(0, 3).map((c, i) => ({
        chunk_id: c.id,
        doc_id: c.document_id,
        doc_name: c.document_keyword ?? 'Document',
        content: c.content_with_weight,
        similarity: demoScore(i).similarity,
        index: i + 1,
      })),
    };
  }

  if (signal?.aborted) return;
  for (const piece of chunkText(answer)) {
    if (signal?.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, 14));
    yield { kind: 'delta', text: piece };
  }
  yield { kind: 'done', elapsedMs: 1_240 + question.length * 4, text: String(chatId || demoAgents[0]?.id || '') };
}

export async function* streamChat(options: StreamOptions): AsyncGenerator<StreamDelta> {
  if (isDemoMode()) {
    yield* demoStream(options);
    return;
  }

  const token = getAuthToken();
  const response = await fetch(options.url ?? endpoints.completion, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(options.body),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(
      response.status === 401
        ? 'Your session expired — sign in again to keep chatting.'
        : `The API refused the request (HTTP ${response.status}).`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        if (payload === '[DONE]') yield { kind: 'done' };
        continue;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (typeof parsed.code === 'number' && parsed.code !== 0) {
        throw new Error(
          typeof parsed.message === 'string' ? parsed.message : 'The model call failed.',
        );
      }
      const inner = (parsed.data ?? parsed) as Record<string, unknown>;
      if (inner.reference) {
        const citations = extractCitations(inner.reference);
        if (citations.length) yield { kind: 'reference', citations };
      }
      if (typeof inner.answer === 'string' && inner.answer.length) {
        yield { kind: 'delta', text: inner.answer };
      }
      if (Array.isArray(inner.reference) && inner.reference.length && typeof inner.answer !== 'string') {
        yield { kind: 'done' };
      }
    }
  }
  yield { kind: 'done' };
}

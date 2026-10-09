/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 *
 * Demo transport. Resolves the same REST paths the Go backend serves, from the seeded corpus
 * in ./db.ts. Response envelopes are byte-compatible with the backend
 * (`{ code, data, message, total }` with HTTP 200 for both success and failure), so the
 * console's query layer cannot tell the two apart — except for the explicit demo banner.
 *
 * Writes mutate the in-memory seed only; nothing is persisted. Switching to a live backend
 * requires no page-level changes.
 */

import {
  demoAgents,
  demoAgentTemplates,
  demoAssistants,
  demoChunks,
  demoConnectors,
  demoDocuments,
  demoKnowledgeBases,
  demoMcpServers,
  demoMemory,
  demoMessages,
  demoProviders,
  demoSessions,
  demoScore,
  demoSystem,
  demoTokens,
} from '@/api/demo/db';

export interface DemoEnvelope {
  code: number;
  data: unknown;
  message?: unknown;
  total?: number;
}

const ok = (data: unknown, total?: number): DemoEnvelope => ({
  code: 0,
  data,
  message: 'Success',
  ...(total === undefined ? {} : { total }),
});
const fail = (message: string, code = 102): DemoEnvelope => ({ code, data: null, message });

function paginate<T>(items: T[], body: Record<string, unknown> | undefined) {
  const page = Number(body?.page ?? 1);
  const size = Number(body?.page_size ?? 30);
  const start = (page - 1) * size;
  return { items: items.slice(start, start + size), total: items.length, page, size };
}

function parseJsonBody(body: unknown): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return body as Record<string, unknown>;
}

const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

// ---- workspace team -------------------------------------------------------------------------
// Mutable, and shared by every request: the demo has no server, so these arrays are its memory and
// the console must see an invitation or a removal reflected as soon as it refreshes.
interface DemoMember {
  user_id: string;
  email: string;
  nickname: string;
  role: string;
  status: string;
  create_time: number;
}

interface DemoInvite {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
  status: string;
  create_time: number;
  expires_at: number;
  invited_by?: string;
  token?: string;
  invite_url?: string;
}

const demoMembers: DemoMember[] = [
  { user_id: 'u_01', email: 'dnn@ownrag.local', nickname: 'dnn', role: 'owner', status: 'active', create_time: Date.now() - 86_400_000 * 120 },
  { user_id: 'u_02', email: 'a.alharbi@ownrag.local', nickname: 'a.alharbi', role: 'admin', status: 'active', create_time: Date.now() - 86_400_000 * 61 },
  { user_id: 'u_03', email: 's.otaibi@ownrag.local', nickname: 's.otaibi', role: 'member', status: 'active', create_time: Date.now() - 86_400_000 * 40 },
];

const demoInvitations: DemoInvite[] = [
  {
    id: 'inv_01',
    tenant_id: 'tenant_ownrag',
    email: 'audit@ownrag.local',
    role: 'member',
    status: 'pending',
    create_time: Date.now() - 86_400_000 * 3,
    expires_at: Date.now() + 86_400_000 * 4,
    invited_by: 'u_01',
  },
];

/** Retrieval: rank seeded chunks for the query, deterministically. */
function runRetrieval(body: Record<string, unknown>) {
  const datasetIds = (body.dataset_ids as string[] | undefined) ?? [];
  const docIds = (body.doc_ids as string[] | undefined) ?? [];
  const threshold = Number(body.similarity_threshold ?? 0.2);
  const topK = Number(body.top_k ?? 1024);
  const rerankEnabled = Boolean(body.rerank_id);
  const question = String(body.question ?? '');

  const applyIds = (chunks: typeof demoChunks) =>
    chunks.filter((c) => {
      const kbOk = datasetIds.length === 0 || datasetIds.includes(c.dataset_id ?? '');
      const docOk = docIds.length === 0 || docIds.includes(c.document_id);
      return kbOk && docOk;
    });

  const tokens = question
    .toLowerCase()
    .split(/[\s،,.;:!?()\[\]]+/)
    .filter((t) => t.length > 2);

  const ranked = applyIds(demoChunks)
    .map((chunk, index) => {
      const haystack = `${chunk.content_with_weight} ${(chunk.important_kwd ?? []).join(' ')}`.toLowerCase();
      const hits = tokens.filter((t) => haystack.includes(t)).length;
      // Blend a lexical hit-rate signal with a fixed rank decay so the ordering is stable
      // and legible in a screenshot: better lexical match first, then seed order.
      const lexicalBoost = tokens.length ? hits / tokens.length : 0;
      const decay = Math.max(0, 0.28 - index * 0.012);
      const scores = demoScore(index, Math.min(0.97, 0.62 + lexicalBoost * 0.31 + decay));
      return { chunk, index, scores, hits };
    })
    .filter((r) => r.scores.similarity >= threshold)
    .sort((a, b) => (rerankEnabled ? b.scores.rerank_score - a.scores.rerank_score : b.scores.similarity - a.scores.similarity))
    .slice(0, Math.min(topK, 30));

  const chunks = ranked.map((r) => ({
    ...r.chunk,
    ...r.scores,
    rerank_score: rerankEnabled ? r.scores.rerank_score : undefined,
  }));

  const docAggs = Object.values(
    chunks.reduce<Record<string, { doc_id: string; doc_name: string; count: number }>>((acc, c) => {
      const key = c.document_id;
      acc[key] = acc[key] ?? { doc_id: key, doc_name: c.document_keyword ?? key, count: 0 };
      acc[key].count += 1;
      return acc;
    }, {}),
  );

  const keywords = Array.from(
    new Set(
      tokens
        .filter((t) => t.length > 3)
        .concat(
          chunks
            .flatMap((c) => c.important_kwd ?? [])
            .slice(0, 6),
        ),
    ),
  ).slice(0, 12);

  return {
    total: chunks.length,
    chunks,
    doc_aggs: docAggs,
    keywords,
    elapsed_ms: rerankEnabled ? 118 : 64,
  };
}

/**
 * Resolve a request against the demo corpus.
 * Returns null when the path is not modelled, so the caller can surface a real 404.
 */
export function resolveDemo(
  method: string,
  pathname: string,
  body: unknown,
): DemoEnvelope | null {
  const m = method.toUpperCase();
  const withoutHost = pathname.replace(/^https?:\/\/[^/]+/, '');
  // GET list endpoints carry their filters in the query string; merge them with any body so
  // demo pagination and filtering behave exactly like the live path.
  const [path, queryString] = withoutHost.split('?');
  const query: Record<string, unknown> = {};
  if (queryString) {
    new URLSearchParams(queryString).forEach((value, key) => {
      query[key] = value;
    });
  }
  const b = { ...query, ...parseJsonBody(body) };

  // ---- session ----
  if (m === 'POST' && path === '/api/v1/auth/login') {
    return ok({ access_token: 'demo.token.ownrag', token: 'demo.token.ownrag' });
  }
  if (m === 'GET' && path === '/api/v1/users/me') {
    return ok({
      email: 'dnn@ownrag.local',
      nickname: 'dnn',
      language: 'en',
      is_admin: true,
      tenant_id: 'tenant_ownrag',
    });
  }
  if (m === 'GET' && path === '/api/v1/users/me/models') {
    return ok({
      chat: demoProviders
        .flatMap((p) => p.instances.flatMap((i) => i.models))
        .filter((mm) => (Array.isArray(mm.model_type) ? mm.model_type : [mm.model_type]).includes('chat'))
        .map((mm) => mm.name),
      embedding: ['BAAI/bge-m3@BAAI', 'BAAI/bge-large-en-v1.5@BAAI', 'text-embedding-3-large@openai'],
      rerank: ['BAAI/bge-reranker-v2-m3@BAAI', 'rerank-2@voyage'],
    });
  }
  if (m === 'GET' && path === '/api/v1/system/version') return ok(demoSystem);
  if (m === 'GET' && path === '/api/v1/tenants') {
    return ok([
      {
        tenant_id: 'tenant_ownrag',
        name: "dnn's workspace",
        role: 'owner',
        member_count: demoMembers.length,
        can_manage: true,
      },
    ]);
  }

  // ---- knowledge bases ----
  if (path === '/api/v1/datasets' && m === 'GET') {
    const keyword = String(b.keyword ?? '').toLowerCase();
    const filtered = keyword
      ? demoKnowledgeBases.filter(
          (kb) => kb.name.toLowerCase().includes(keyword) || kb.description?.toLowerCase().includes(keyword),
        )
      : demoKnowledgeBases;
    const { items, total } = paginate(filtered, b);
    return ok(items, total);
  }
  if (path === '/api/v1/datasets' && m === 'POST') {
    const kb = {
      id: id('kb'),
      name: String(b.name ?? 'Untitled knowledge base'),
      description: String(b.description ?? ''),
      language: String(b.language ?? 'en'),
      embedding_model: String(b.embedding_model ?? 'BAAI/bge-m3@BAAI'),
      chunk_method: (b.chunk_method as never) ?? 'naive',
      document_count: 0,
      chunk_count: 0,
      token_count: 0,
      similarity_threshold: 0.2,
      vector_similarity_weight: 0.3,
      top_k: 1024,
      rerank_model: null,
      permission: 'me' as const,
      create_time: Date.now(),
      update_time: Date.now(),
      tags: [],
    };
    demoKnowledgeBases.unshift(kb);
    return ok([kb]);
  }
  if (path === '/api/v1/datasets/tags/aggregation' && m === 'GET') {
    const counts: Record<string, number> = {};
    demoKnowledgeBases.forEach((kb) => (kb.tags ?? []).forEach((t) => (counts[t] = (counts[t] ?? 0) + 1)));
    return ok(counts);
  }
  const kbMatch = path.match(/^\/api\/v1\/datasets\/([^/]+)$/);
  if (kbMatch) {
    const kb = demoKnowledgeBases.find((k) => k.id === kbMatch[1]);
    if (m === 'GET') return kb ? ok(kb) : fail('Knowledge base not found', 102);
    if (m === 'PUT' || m === 'PATCH') {
      if (!kb) return fail('Knowledge base not found', 102);
      Object.assign(kb, b, { update_time: Date.now() });
      return ok(true);
    }
    if (m === 'DELETE') {
      const index = demoKnowledgeBases.findIndex((k) => k.id === kbMatch[1]);
      if (index >= 0) demoKnowledgeBases.splice(index, 1);
      return ok(true);
    }
  }
  const kbSummaryMatch = path.match(/^\/api\/v1\/datasets\/([^/]+)\/ingestions\/summary$/);
  if (kbSummaryMatch && m === 'GET') {
    const docs = demoDocuments.filter((d) => d.kb_id === kbSummaryMatch[1]);
    return ok({
      total: docs.length,
      done: docs.filter((d) => d.run === 'DONE').length,
      running: docs.filter((d) => d.run === 'RUNNING').length,
      failed: docs.filter((d) => d.run === 'FAIL').length,
      unstart: docs.filter((d) => d.run === 'UNSTART').length,
      chunks: docs.reduce((sum, d) => sum + d.chunk_count, 0),
      tokens: docs.reduce((sum, d) => sum + (d.token_count ?? 0), 0),
    });
  }
  const kbIngestionMatch = path.match(/^\/api\/v1\/datasets\/([^/]+)\/ingestions$/);
  if (kbIngestionMatch && m === 'GET') {
    const logs = demoDocuments
      .filter((d) => d.kb_id === kbIngestionMatch[1])
      .map((d, i) => ({
        log_id: `log_${d.id}`,
        document_id: d.id,
        document_name: d.name,
        status: d.run,
        progress: d.progress,
        message: d.progress_msg ?? (d.run === 'DONE' ? 'Indexing completed' : ''),
        create_time: d.update_time ?? Date.now() - i * 600_000,
        elapsed: d.run === 'DONE' ? 42 + i * 3 : undefined,
      }));
    return ok(logs);
  }
  const kbMetaMatch = path.match(/^\/api\/v1\/datasets\/([^/]+)\/metadata\/(config|summary)$/);
  if (kbMetaMatch && m === 'GET') {
    if (kbMetaMatch[2] === 'config') {
      return ok({
        fields: [
          { key: 'jurisdiction', type: 'string' },
          { key: 'instrument', type: 'string' },
          { key: 'year', type: 'number' },
          { key: 'quarter', type: 'string' },
          { key: 'audited', type: 'boolean' },
        ],
      });
    }
    return ok([
      { key: 'jurisdiction', values: { SA: 42 } },
      { key: 'instrument', values: { 'Royal Decree M/51': 1, 'Implementing Regulation': 1 } },
      { key: 'quarter', values: { Q1: 1, Q2: 1 } },
      { key: 'audited', values: { true: 2 } },
    ]);
  }
  const kbGraphMatch = path.match(/^\/api\/v1\/datasets\/([^/]+)\/graph$/);
  if (kbGraphMatch && m === 'GET') {
    return ok({
      nodes: [
        { id: 'labor-law', label: 'Labor Law', type: 'instrument', degree: 7 },
        { id: 'article-73', label: 'Article 73 — working hours', type: 'article', degree: 4 },
        { id: 'article-107', label: 'Article 107 — overtime', type: 'article', degree: 5 },
        { id: 'ramadan', label: 'Ramadan reduction', type: 'concept', degree: 2 },
        { id: 'wage', label: 'Basic wage', type: 'concept', degree: 3 },
      ],
      edges: [
        { source: 'labor-law', target: 'article-73' },
        { source: 'labor-law', target: 'article-107' },
        { source: 'article-73', target: 'ramadan' },
        { source: 'article-107', target: 'wage' },
      ],
    });
  }
  if (path === '/api/v1/pipelines?type=builtin' || path === '/api/v1/pipelines') {
    return ok([
      { id: 'pipe_builtin_naive', name: 'General', type: 'builtin', chunk_method: 'naive' },
      { id: 'pipe_builtin_laws', name: 'Laws', type: 'builtin', chunk_method: 'laws' },
      { id: 'pipe_builtin_table', name: 'Table', type: 'builtin', chunk_method: 'table' },
      { id: 'pipe_builtin_qa', name: 'Q&A', type: 'builtin', chunk_method: 'qa' },
    ]);
  }

  // ---- documents ----
  const docsMatch = path.match(/^\/api\/v1\/datasets\/([^/]+)\/documents$/);
  if (docsMatch) {
    const kbId = docsMatch[1];
    if (m === 'GET') {
      // The live handler reads `keywords` (plural); accept the singular spelling too so the
      // console can send one request shape to both transports.
      const keyword = String(b.keywords ?? b.keyword ?? '').toLowerCase();
      const status = String(b.run ?? '').toUpperCase();
      let docs = demoDocuments.filter((d) => d.kb_id === kbId);
      if (keyword) docs = docs.filter((d) => d.name.toLowerCase().includes(keyword));
      if (status && status !== 'ALL') docs = docs.filter((d) => d.run === status);
      const { items, total } = paginate(docs, b);
      return ok(items, total);
    }
    if (m === 'POST') {
      const names = (b.names as string[] | undefined) ?? ['uploaded-document.pdf'];
      const created = names.map((name) => ({
        id: id('doc'),
        kb_id: kbId,
        name,
        type: name.split('.').pop() ?? 'pdf',
        size: 118_402,
        chunk_count: 0,
        token_count: 0,
        progress: 0,
        run: 'UNSTART' as const,
        parser_id: 'naive' as const,
        create_time: Date.now(),
        update_time: Date.now(),
      }));
      demoDocuments.unshift(...created);
      const kb = demoKnowledgeBases.find((k) => k.id === kbId);
      if (kb) kb.document_count += created.length;
      return ok(created);
    }
    if (m === 'DELETE') {
      const ids = (b.ids as string[] | undefined) ?? [];
      ids.forEach((docId) => {
        const index = demoDocuments.findIndex((d) => d.id === docId);
        if (index >= 0) demoDocuments.splice(index, 1);
      });
      return ok(true);
    }
  }
  const docMatch = path.match(/^\/api\/v1\/datasets\/([^/]+)\/documents\/([^/]+)$/);
  if (docMatch && m === 'GET') {
    const doc = demoDocuments.find((d) => d.id === docMatch[2]);
    return doc ? ok(doc) : fail('Document not found', 102);
  }
  if (docMatch && (m === 'PUT' || m === 'PATCH')) {
    const doc = demoDocuments.find((d) => d.id === docMatch[2]);
    if (!doc) return fail('Document not found', 102);
    if (typeof b.name === 'string') doc.name = b.name;
    if (typeof b.run === 'string') doc.run = b.run as never;
    if (b.parser_id) doc.parser_id = b.parser_id as never;
    if (b.chunk_method) doc.parser_id = b.chunk_method as never;
    if (b.parser_config) doc.parser_config = b.parser_config as never;
    Object.assign(doc, b.meta_fields ? { meta_fields: b.meta_fields } : {});
    doc.update_time = Date.now();
    return ok(true);
  }
  const chunksMatch = path.match(/^\/api\/v1\/datasets\/([^/]+)\/documents\/([^/]+)\/chunks$/);
  if (chunksMatch && m === 'GET') {
    const docId = chunksMatch[2];
    let chunks = demoChunks.filter((c) => c.document_id === docId);
    if (chunks.length === 0) {
      // Every document has chunks once parsed; synthesise a plausible outline for the seed.
      const doc = demoDocuments.find((d) => d.id === docId);
      const count = doc?.chunk_count ?? 0;
      const preview = Math.min(count, 8);
      chunks = Array.from({ length: preview }, (_, i) => ({
        id: `chk_${docId}_${i + 1}`,
        content_with_weight:
          doc?.run === 'DONE'
            ? `Chunk ${i + 1} of ${doc.name}. Parsed with the ${doc.parser_id} method, 512-token window with delimiter awareness. This segment carries the surrounding heading context so the embedding keeps the section topic.`
            : '',
        document_id: docId,
        document_keyword: doc?.name,
        dataset_id: chunksMatch[1],
        important_kwd: [],
        question_kwd: [],
        available_int: 1,
        index: i + 1,
      }));
    }
    const { items, total } = paginate(chunks, b);
    return ok(items, total);
  }
  if (path === '/api/v1/documents/ingest' && m === 'POST') {
    const ids = (b.document_ids as string[] | undefined) ?? (b.ids as string[] | undefined) ?? [];
    ids.forEach((docId) => {
      const doc = demoDocuments.find((d) => d.id === docId);
      if (doc) {
        doc.run = 'RUNNING';
        doc.progress = 0.05;
        doc.progress_msg = 'Queued — waiting for a parser slot';
      }
    });
    return ok(true);
  }
  if (path === '/api/v1/thumbnails' && m === 'GET') return ok([]);

  // ---- retrieval ----
  if (path === '/api/v1/datasets/search' && m === 'POST') return ok(runRetrieval(b));

  // ---- chat ----
  if (path === '/api/v1/chats' && m === 'GET') {
    const { items, total } = paginate(demoAssistants, b);
    return ok(items, total);
  }
  if (path === '/api/v1/chats' && m === 'POST') {
    const assistant = {
      id: id('chat'),
      name: String(b.name ?? 'New assistant'),
      description: String(b.description ?? ''),
      dataset_ids: (b.dataset_ids as string[]) ?? [],
      llm: { model_name: 'gpt-5@openai', temperature: 0.2, top_p: 0.8, max_tokens: 2048 },
      prompt: { similarity_threshold: 0.2, keywords_similarity_weight: 0.7, top_n: 6, top_k: 1024, show_quote: true },
      create_time: Date.now(),
      update_time: Date.now(),
    };
    demoAssistants.unshift(assistant);
    return ok(assistant);
  }
  const chatMatch = path.match(/^\/api\/v1\/chats\/([^/]+)$/);
  if (chatMatch) {
    const assistant = demoAssistants.find((c) => c.id === chatMatch[1]);
    if (m === 'GET') return assistant ? ok(assistant) : fail('Assistant not found');
    if (m === 'PUT' || m === 'PATCH') {
      if (!assistant) return fail('Assistant not found');
      if (b.prompt) assistant.prompt = { ...assistant.prompt, ...(b.prompt as object) };
      if (b.llm) assistant.llm = { ...assistant.llm, ...(b.llm as object) };
      Object.assign(assistant, { ...b, prompt: assistant.prompt, llm: assistant.llm });
      assistant.update_time = Date.now();
      return ok(true);
    }
    if (m === 'DELETE') {
      const index = demoAssistants.findIndex((c) => c.id === chatMatch[1]);
      if (index >= 0) demoAssistants.splice(index, 1);
      return ok(true);
    }
  }
  const sessionListMatch = path.match(/^\/api\/v1\/chats\/([^/]+)\/sessions$/);
  if (sessionListMatch && m === 'GET') {
    const sessions = demoSessions.filter((s) => s.chat_id === sessionListMatch[1]);
    return ok(sessions, sessions.length);
  }
  if (sessionListMatch && m === 'POST') {
    const session = {
      id: id('sess'),
      chat_id: sessionListMatch[1],
      name: String(b.name ?? 'New session'),
      create_time: Date.now(),
      update_time: Date.now(),
    };
    demoSessions.push(session);
    return ok(session);
  }
  const sessionMatch = path.match(/^\/api\/v1\/chats\/([^/]+)\/sessions\/([^/]+)$/);
  if (sessionMatch) {
    const session = demoSessions.find((s) => s.id === sessionMatch[2]);
    if (m === 'GET') {
      return ok({
        ...(session ?? {}),
        messages: demoMessages[sessionMatch[2]] ?? [],
      });
    }
    if (m === 'DELETE') {
      const index = demoSessions.findIndex((s) => s.id === sessionMatch[2]);
      if (index >= 0) demoSessions.splice(index, 1);
      return ok(true);
    }
  }

  // ---- agents ----
  if (path === '/api/v1/agents' && m === 'GET') return ok(demoAgents, demoAgents.length);
  if (path === '/api/v1/agents/templates' && m === 'GET') return ok(demoAgentTemplates);
  if (path === '/api/v1/agents/tags' && m === 'GET') return ok(['legal', 'support', 'finance', 'research', 'arabic', 'production']);
  if (path === '/api/v1/agents' && m === 'POST') {
    const agent = {
      id: id('agent'),
      title: String(b.title ?? 'Untitled agent'),
      description: String(b.description ?? ''),
      dsl: (b.dsl as never) ?? { graph: { nodes: [], edges: [] } },
      permission: 'me' as const,
      create_time: Date.now(),
      update_time: Date.now(),
      tags: [],
      status: 'draft' as const,
      run_count: 0,
    };
    demoAgents.unshift(agent);
    return ok(agent);
  }
  const agentMatch = path.match(/^\/api\/v1\/agents\/([^/]+)$/);
  if (agentMatch) {
    const agent = demoAgents.find((a) => a.id === agentMatch[1]);
    if (m === 'GET') return agent ? ok(agent) : fail('Agent not found');
    if (m === 'PUT' || m === 'PATCH') {
      if (!agent) return fail('Agent not found');
      if (b.dsl) agent.dsl = b.dsl as never;
      if (typeof b.title === 'string') agent.title = b.title;
      if (typeof b.description === 'string') agent.description = b.description;
      if (b.status) agent.status = b.status as never;
      agent.update_time = Date.now();
      return ok(true);
    }
    if (m === 'DELETE') {
      const index = demoAgents.findIndex((a) => a.id === agentMatch[1]);
      if (index >= 0) demoAgents.splice(index, 1);
      return ok(true);
    }
  }
  if (/^\/api\/v1\/agents\/[^/]+\/sessions$/.test(path) && m === 'GET') return ok([]);
  if (/^\/api\/v1\/agents\/[^/]+\/versions$/.test(path) && m === 'GET') {
    return ok([
      { id: 'v14', title: 'v14 — current', create_time: Date.now() - 3_600_000 },
      { id: 'v13', title: 'v13 — rerank bumped', create_time: Date.now() - 86_400_000 },
      { id: 'v12', title: 'v12 — added confidence gate', create_time: Date.now() - 172_800_000 },
    ]);
  }
  if (path === '/api/v1/agents/chat/completions') return ok({ answer: 'demo', reference: [] });
  if (/^\/api\/v1\/tasks\/[^/]+\/cancel$/.test(path) && m === 'POST') return ok(true);

  // ---- models ----
  if (path === '/api/v1/providers/catalog' && m === 'GET') {
    // Demo mode never reaches the engine, so the picker is fed from the modelled corpus. Entries the
    // real catalog marks as Go-backend-only stay that way here rather than being relabelled.
    const nativeOnly = new Set(['anthropic', 'bedrock', 'google']);
    const configured = demoProviders.map((p) => ({
      name: p.name,
      label: p.label,
      base_url: p.instances[0]?.api_base ?? '',
      engine: nativeOnly.has(p.name) ? ('go' as const) : ('openai' as const),
      configured: p.status === 'added',
    }));
    const known = configured.map((p) => p.name);
    const extras = [
      ['deepseek', 'DeepSeek'],
      ['openrouter', 'OpenRouter'],
      ['groq', 'Groq'],
      ['mistral', 'Mistral AI'],
      ['ollama', 'Ollama'],
      ['vllm', 'vLLM'],
      ['lmstudio', 'LM Studio'],
      ['voyage', 'Voyage AI'],
      ['cohere', 'Cohere'],
      ['replicate', 'Replicate'],
    ]
      .filter(([name]) => !known.includes(name))
      .map(([name, label]) => ({
        name,
        label,
        base_url: '',
        engine: (nativeOnly.has(name) ? 'go' : 'openai') as 'go' | 'openai',
      }));
    return ok([...configured, ...extras]);
  }
  if (path === '/api/v1/providers' && m === 'GET') {
    const available = String(b.available ?? '') === 'true';
    return ok(available ? demoProviders : demoProviders.filter((p) => p.status === 'added'));
  }
  if (path === '/api/v1/providers' && m === 'POST') {
    const provider = {
      name: String(b.provider_name ?? b.name ?? 'custom'),
      label: String(b.label ?? 'Custom provider'),
      kind: 'llm',
      status: 'added' as const,
      instances: [],
    };
    demoProviders.push(provider);
    return ok(true);
  }
  if (path === '/api/v1/models' && m === 'GET') {
    return ok(
      demoProviders.flatMap((p) =>
        p.instances.flatMap((i) =>
          i.models.map((mm) => ({ ...mm, provider: p.name, instance: i.instance_name })),
        ),
      ),
    );
  }
  const providerInstancesMatch = path.match(/^\/api\/v1\/providers\/([^/]+)\/instances$/);
  if (providerInstancesMatch) {
    const provider = demoProviders.find((p) => p.name === providerInstancesMatch[1]);
    if (m === 'GET') return ok(provider?.instances ?? []);
    if (m === 'POST') {
      const instance = {
        id: id('inst'),
        provider: providerInstancesMatch[1],
        instance_name: String(b.instance_name ?? 'default'),
        api_base: b.api_base ? String(b.api_base) : undefined,
        status: 'connected' as const,
        has_api_key: Boolean(b.api_key),
        models: [],
      };
      if (provider) {
        provider.instances.push(instance);
        provider.status = 'added';
      }
      return ok(true);
    }
  }
  const instanceMatch = path.match(/^\/api\/v1\/providers\/([^/]+)\/instances\/([^/]+)$/);
  if (instanceMatch && m === 'GET') {
    const provider = demoProviders.find((p) => p.name === instanceMatch[1]);
    const instance = provider?.instances.find((i) => i.id === instanceMatch[2] || i.instance_name === instanceMatch[2]);
    return instance ? ok(instance) : fail('Instance not found');
  }
  const providerModelsMatch = path.match(/^\/api\/v1\/providers\/([^/]+)\/models$/);
  if (providerModelsMatch && m === 'GET') {
    const provider = demoProviders.find((p) => p.name === providerModelsMatch[1]);
    return ok(provider?.instances.flatMap((i) => i.models) ?? []);
  }
  if (/^\/api\/v1\/providers\/[^/]+\/connection$/.test(path) && m === 'GET') {
    return ok({ status: 'ok', elapsed_ms: 182 });
  }
  const instanceModelsMatch = path.match(/^\/api\/v1\/providers\/([^/]+)\/instances\/([^/]+)\/models$/);
  if (instanceModelsMatch) {
    const provider = demoProviders.find((p) => p.name === instanceModelsMatch[1]);
    const instance = provider?.instances.find((i) => i.id === instanceModelsMatch[2] || i.instance_name === instanceModelsMatch[2]);
    if (m === 'GET') return ok(instance?.models ?? []);
    if (m === 'POST') {
      const added = Array.isArray(b.models)
        ? b.models
        : [{ id: String(b.model_name ?? 'new-model'), name: String(b.model_name ?? 'new-model'), model_type: 'chat', status: 'active' }];
      if (instance) instance.models.push(...(added as never[]));
      return ok(true);
    }
  }
  if (/^\/api\/v1\/providers\/[^/]+\/instances\/[^/]+\/balance$/.test(path) && m === 'GET') {
    return ok({ balance: 412.88, currency: 'USD' });
  }
  if (path === '/api/v1/models/default' && m === 'GET') {
    return ok({ chat: 'gpt-5@openai', embedding: 'BAAI/bge-m3@BAAI', rerank: 'BAAI/bge-reranker-v2-m3@BAAI' });
  }
  if (path === '/api/v1/plugin/tools' && m === 'GET') {
    return ok([
      { name: 'web_search', label: 'Web search', description: 'Search the public web and return ranked snippets.' },
      { name: 'code_executor', label: 'Code executor', description: 'Run Python or JavaScript in the sandbox.' },
      { name: 'wikipedia', label: 'Wikipedia', description: 'Look up entities on Wikipedia.' },
      { name: 'arxiv', label: 'arXiv', description: 'Search and fetch arXiv papers.' },
      { name: 'sql_executor', label: 'SQL executor', description: 'Run read-only SQL against a registered database.' },
    ]);
  }

  // ---- connectors ----
  if (path === '/api/v1/connectors/sources' && m === 'GET') {
    return ok([
      { source_type: 'web', pull: true, needs: '', fields: [{ key: 'urls', label: 'URLs to read', hint: 'One address per line.', kind: 'lines' }] },
      {
        source_type: 'google-drive',
        pull: true,
        needs: '',
        fields: [
          { key: 'token', label: 'Google access token', hint: 'Scope drive.readonly.', kind: 'secret' },
          { key: 'query', label: 'Drive query', hint: 'Optional, e.g. name contains "contract"', kind: 'text' },
        ],
      },
      {
        source_type: 'gmail',
        pull: true,
        needs: '',
        fields: [
          { key: 'token', label: 'Google access token', hint: 'Scope gmail.readonly.', kind: 'secret' },
          { key: 'query', label: 'Gmail query', hint: 'Optional, e.g. subject:renewal', kind: 'text' },
        ],
      },
      {
        source_type: 'sharepoint',
        pull: true,
        needs: '',
        fields: [{ key: 'token', label: 'Microsoft Graph token', hint: 'Scope Files.Read.All.', kind: 'secret' }],
      },
      { source_type: 's3', pull: true, needs: 'A bucket name. Keys are optional — a public bucket reads anonymously.', fields: [{ key: 'bucket', label: 'Bucket', kind: 'text', required: true }, { key: 'region', label: 'Region', kind: 'text' }, { key: 'prefix', label: 'Prefix', kind: 'text' }, { key: 'access_key', label: 'Access key id', kind: 'secret' }, { key: 'secret_key', label: 'Secret access key', kind: 'secret' }, { key: 'endpoint', label: 'Endpoint', kind: 'text' }, { key: 'max_keys', label: 'Objects to read', kind: 'text' }] },
      { source_type: 'slack', pull: true, needs: 'A bot token with channels:history, invited to the channels you want read.', fields: [{ key: 'token', label: 'Bot token', kind: 'secret', required: true }, { key: 'channels', label: 'Channels', kind: 'text' }, { key: 'messages_per_channel', label: 'Messages per channel', kind: 'text' }, { key: 'api_base', label: 'API base', kind: 'text' }] },
      { source_type: 'box', pull: true, needs: 'A Box developer token or app access token.', fields: [{ key: 'token', label: 'Box access token', kind: 'secret', required: true }, { key: 'folder_id', label: 'Folder id', kind: 'text' }, { key: 'api_base', label: 'API base', kind: 'text' }] },
    ]);
  }
  if (path === '/api/v1/connectors' && m === 'GET') return ok(demoConnectors);
  if (path === '/api/v1/connectors' && m === 'POST') {
    const connector = {
      id: id('conn'),
      name: String(b.name ?? 'New connector'),
      source_type: (b.source_type as never) ?? 's3',
      status: 'connected' as const,
      dataset_ids: (b.dataset_ids as string[]) ?? [],
      documents_synced: 0,
      last_sync_at: Date.now(),
    };
    demoConnectors.unshift(connector);
    return ok(connector);
  }
  if (/^\/api\/v1\/providers\/[^/]+\/instances\/[^/]+\/models\/discover$/.test(path)) {
    return ok({
      available: ['demo-chat', 'demo-embed'],
      registered: ['demo-chat (chat)'],
      kinds: ['chat'],
    });
  }
  const connectorMatch = path.match(/^\/api\/v1\/connectors\/([^/]+)$/);
  if (connectorMatch) {
    const connector = demoConnectors.find((c) => c.id === connectorMatch[1]);
    if (m === 'GET') return connector ? ok(connector) : fail('Connector not found');
    if (m === 'PUT' || m === 'PATCH') {
      if (connector) Object.assign(connector, b);
      return ok(true);
    }
    if (m === 'DELETE') {
      const index = demoConnectors.findIndex((c) => c.id === connectorMatch[1]);
      if (index >= 0) demoConnectors.splice(index, 1);
      return ok(true);
    }
  }
  if (/^\/api\/v1\/connectors\/[^/]+\/(logs|test|rebuild)$/.test(path)) {
    if (path.endsWith('/test')) return ok({ ok: true, message: 'web answered — 3 object(s) visible.' });
    if (path.endsWith('/rebuild')) {
      const target = demoConnectors.find((c) => c.id === path.split('/')[4]);
      if (target) {
        target.documents_synced = (target.documents_synced ?? 0) + 12;
        target.status = 'connected';
        target.last_sync_at = Date.now();
      }
      return ok({ ok: true, documents_synced: 12, message: 'Synced 12 document(s) from 12 object(s) into 1 knowledge base(s).' });
    }
    return ok([{ time: Date.now() - 3_600_000, message: 'Pulled 12 changed objects', level: 'info' }]);
  }

  // ---- mcp / memory / files / tokens ----
  if (path === '/api/v1/mcp/servers' && m === 'GET') return ok(demoMcpServers);
  if (path === '/api/v1/mcp/servers' && m === 'POST') {
    const server = {
      id: id('mcp'),
      name: String(b.name ?? 'new-server'),
      url: String(b.url ?? ''),
      transport: (b.transport as never) ?? 'sse',
      enabled: b.enabled === undefined ? true : Boolean(b.enabled),
      status: 'ok' as const,
      last_check_at: Date.now(),
      tools: [],
    };
    demoMcpServers.push(server);
    return ok(server);
  }
  const mcpMatch = path.match(/^\/api\/v1\/mcp\/servers\/([^/]+)$/);
  if (mcpMatch) {
    const server = demoMcpServers.find((s) => s.id === mcpMatch[1]);
    if (m === 'GET') return server ? ok(server) : fail('MCP server not found');
    if (m === 'PUT' || m === 'PATCH') {
      if (!server) return fail('MCP server not found');
      Object.assign(server, b, { last_check_at: Date.now() });
      return ok(true);
    }
    if (m === 'DELETE') {
      const index = demoMcpServers.findIndex((s) => s.id === mcpMatch[1]);
      if (index >= 0) demoMcpServers.splice(index, 1);
      return ok(true);
    }
  }
  if (path === '/api/v1/memories' && m === 'GET') return ok(demoMemory);
  if (path === '/api/v1/memories' && m === 'POST') {
    const record = {
      id: id('mem'),
      name: String(b.name ?? 'New memory'),
      description: String(b.description ?? ''),
      memory_type: (b.memory_type as never) ?? 'semantic',
      message_count: 0,
      storage_type: String(b.storage_type ?? 'vector'),
      create_time: Date.now(),
    };
    demoMemory.unshift(record);
    return ok(record);
  }
  const memoryMatch = path.match(/^\/api\/v1\/memories\/([^/]+)$/);
  if (memoryMatch) {
    const record = demoMemory.find((r) => r.id === memoryMatch[1]);
    if (m === 'GET') return record ? ok(record) : fail('Memory not found');
    if (m === 'PUT' || m === 'PATCH') {
      if (!record) return fail('Memory not found');
      Object.assign(record, b);
      return ok(true);
    }
    if (m === 'DELETE') {
      const index = demoMemory.findIndex((r) => r.id === memoryMatch[1]);
      if (index >= 0) demoMemory.splice(index, 1);
      return ok(true);
    }
  }
  // A single member: the role, or the removal. The engine refuses these for the owner and for
  // anyone without authority; the demo mirrors the same answers so the UI path is exercised.
  const tenantMemberMatch = path.match(/^\/api\/v1\/tenants\/([^/]+)\/users\/([^/]+)$/);
  if (tenantMemberMatch) {
    const member = demoMembers.find((entry) => entry.user_id === tenantMemberMatch[2]);
    if (m === 'PATCH' || m === 'PUT') {
      if (!member) return fail('Member not found');
      if (member.role === 'owner') return fail("The workspace owner's role cannot be changed");
      const role = String(b.role ?? 'member');
      if (role !== 'admin' && role !== 'member') return fail('Choose a role of admin or member');
      member.role = role;
      return ok({ user_id: member.user_id, email: member.email, role });
    }
    if (m === 'DELETE') {
      if (!member) return fail('Member not found');
      if (member.role === 'owner') return fail('The workspace owner cannot be removed');
      demoMembers.splice(demoMembers.indexOf(member), 1);
      return ok(true);
    }
  }

  const tenantUsersMatch = path.match(/^\/api\/v1\/tenants\/([^/]+)\/users$/);
  if (tenantUsersMatch && m === 'GET') return ok(demoMembers);

  const inviteResendMatch = path.match(/^\/api\/v1\/tenants\/([^/]+)\/invitations\/([^/]+)\/resend$/);
  if (inviteResendMatch && m === 'POST') {
    const invite = demoInvitations.find((entry) => entry.id === inviteResendMatch[2]);
    if (!invite) return fail('Invitation not found');
    if (invite.status === 'accepted') return fail('That invitation has already been accepted');
    const token = `demo-${id('token')}`;
    invite.token = token;
    invite.invite_url = `http://localhost:5173/invite/${token}`;
    invite.expires_at = Date.now() + 86_400_000 * 7;
    invite.status = 'pending';
    return ok(invite);
  }

  const inviteMatch = path.match(/^\/api\/v1\/tenants\/([^/]+)\/invitations\/([^/]+)$/);
  if (inviteMatch && m === 'DELETE') {
    const invite = demoInvitations.find((entry) => entry.id === inviteMatch[2]);
    if (!invite) return fail('Invitation not found');
    invite.status = 'revoked';
    return ok(true);
  }

  const invitationsMatch = path.match(/^\/api\/v1\/tenants\/([^/]+)\/invitations$/);
  if (invitationsMatch) {
    if (m === 'GET') return ok(demoInvitations);
    if (m === 'POST') {
      const email = String(b.email ?? '').trim().toLowerCase();
      if (!email.includes('@') || email.length < 5) return fail('Enter a valid email address');
      if (demoMembers.some((entry) => entry.email.toLowerCase() === email)) {
        return fail('That email already belongs to a member of this workspace');
      }
      if (demoInvitations.some((entry) => entry.email.toLowerCase() === email && entry.status === 'pending')) {
        return fail('That address already has a pending invitation');
      }
      const token = `demo-${id('token')}`;
      const invite: DemoInvite = {
        id: id('inv'),
        tenant_id: invitationsMatch[1],
        email,
        role: String(b.role ?? 'member'),
        status: 'pending',
        create_time: Date.now(),
        expires_at: Date.now() + 86_400_000 * 7,
        invited_by: 'u_01',
        token,
        invite_url: `http://localhost:5173/invite/${token}`,
      };
      demoInvitations.unshift(invite);
      return ok(invite);
    }
  }

  // The public invitation link: no session, the token is the credential — exactly as the engine
  // serves it, so the accept page can be exercised end to end in demo mode.
  const acceptInviteMatch = path.match(/^\/api\/v1\/invitations\/([^/]+)\/accept$/);
  if (acceptInviteMatch && m === 'POST') {
    const invite = demoInvitations.find((entry) => entry.token === acceptInviteMatch[1]);
    if (!invite || invite.status !== 'pending') return fail('This invitation link is not valid any more');
    if (String(b.password ?? '').length < 8) return fail('Use at least 8 characters for the password');
    invite.status = 'accepted';
    return ok({
      email: invite.email,
      role: invite.role,
      tenant_id: invite.tenant_id,
      access_token: 'demo-session-token',
    });
  }

  const inviteInfoMatch = path.match(/^\/api\/v1\/invitations\/([^/]+)$/);
  if (inviteInfoMatch && m === 'GET') {
    const invite = demoInvitations.find((entry) => entry.token === inviteInfoMatch[1]);
    if (!invite || invite.status !== 'pending') return fail('This invitation link is not valid any more');
    return ok({
      tenant_id: invite.tenant_id,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expires_at,
      status: invite.status,
    });
  }
  // Per-model enable/disable on a provider instance.
  const instanceModelMatch = path.match(
    /^\/api\/v1\/providers\/([^/]+)\/instances\/([^/]+)\/models\/([^/]+)$/,
  );
  if (instanceModelMatch) {
    const provider = demoProviders.find((p) => p.name === instanceModelMatch[1]);
    const instance = provider?.instances.find(
      (i) => i.id === instanceModelMatch[2] || i.instance_name === instanceModelMatch[2],
    );
    const model = instance?.models.find((mm) => mm.id === instanceModelMatch[3] || mm.name === instanceModelMatch[3]);
    if (m === 'PUT' || m === 'PATCH') {
      if (model) Object.assign(model, b);
      else if (instance) {
        instance.models.push({
          id: instanceModelMatch[3],
          name: instanceModelMatch[3],
          model_type: (b.model_type as never) ?? 'chat',
          status: (b.status as never) ?? 'active',
        });
      }
      return ok(true);
    }
    if (m === 'DELETE') {
      if (instance && model) instance.models = instance.models.filter((mm) => mm !== model);
      return ok(true);
    }
  }
  // Message feedback (thumb up / down) on a session turn.
  const feedbackMatch = path.match(/^\/api\/v1\/chats\/([^/]+)\/sessions\/([^/]+)\/messages\/([^/]+)$/);
  if (feedbackMatch) {
    const messages = demoMessages[feedbackMatch[2]] ?? [];
    const message = messages.find((msg) => msg.id === feedbackMatch[3]);
    if (message && (m === 'PUT' || m === 'PATCH')) {
      message.feedback = b.thumbup === false ? 'down' : b.thumbup === true ? 'up' : null;
    }
    if (m === 'DELETE' && messages.length) {
      const index = messages.findIndex((msg) => msg.id === feedbackMatch[3]);
      if (index >= 0) messages.splice(index, 1);
    }
    return ok(true);
  }
  if (path === '/api/v1/files' && m === 'GET') return ok([]);
  if (path === '/api/v1/system/tokens' && m === 'GET') return ok(demoTokens);
  if (path === '/api/v1/system/tokens' && m === 'POST') {
    const token = {
      id: `tok_${Math.random().toString(16).slice(2, 10)}`,
      token: `ownrag-${Math.random().toString(16).slice(2).padEnd(32, '0')}`,
      name: String(b.name ?? 'new-token'),
      create_date: new Date().toISOString().slice(0, 10),
      create_time: Date.now(),
    };
    demoTokens.unshift(token);
    return ok(token);
  }
  if (path === '/api/v1/system/tokens' && m === 'DELETE') {
    const index = demoTokens.findIndex((t) => t.token === b.token);
    if (index >= 0) demoTokens.splice(index, 1);
    return ok(true);
  }
  if (path === '/api/v1/system/config' && m === 'GET') {
    return ok({ registerEnabled: true, oauthEnabled: false, maxFileSize: 128 * 1024 * 1024 });
  }
  if (path === '/api/v1/searchbots/retrieval_test' && m === 'POST') return ok(runRetrieval(b));
  if (path === '/api/v1/searchbots/ask' && m === 'POST') return ok({ answer: '', reference: [] });

  return null;
}

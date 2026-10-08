/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 *
 * Deterministic demo corpus.
 *
 * OwnRAG is a client of the preserved RAGFlow backend. When that backend is not reachable
 * (no docker stack, no cluster), the console falls back to this in-memory corpus so every
 * surface stays explorable. The UI labels this state explicitly — demo data is never
 * presented as live data. Nothing here is randomised at runtime: the same seed produces the
 * same screens, which keeps screenshots and reviews reproducible.
 */

import type {
  ActivityEvent,
  Agent,
  AgentTemplate,
  ApiToken,
  ChatAssistant,
  ChatMessage,
  ChatSession,
  Chunk,
  Connector,
  DashboardMetric,
  KbDocument,
  KnowledgeBase,
  McpServer,
  MemoryRecord,
  ModelProvider,
  SystemInfo,
} from '@/api/types';

const NOW = Date.UTC(2026, 9, 4, 9, 30, 0); // 2026-10-04T09:30:00Z — fixed clock for the seed.
const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 60 * minutes(1);
const days = (n: number) => n * 24 * hours(1);
const ago = (ms: number) => NOW - ms;

export const DEMO_NOW = NOW;

/* ------------------------------------------------------------------ knowledge bases */

export const demoKnowledgeBases: KnowledgeBase[] = [
  {
    id: 'kb_saudi_labor_law',
    name: 'Saudi Labor Law Corpus',
    description:
      'Consolidated Labor Law (M/51), implementing regulations, and ministerial decisions. Arabic source documents with bilingual chunk overlays.',
    language: 'ar',
    embedding_model: 'BAAI/bge-m3@BAAI',
    chunk_method: 'laws',
    document_count: 42,
    chunk_count: 18_412,
    token_count: 4_918_233,
    similarity_threshold: 0.2,
    vector_similarity_weight: 0.3,
    top_k: 1024,
    rerank_model: 'BAAI/bge-reranker-v2-m3@BAAI',
    permission: 'me',
    created_by: 'dnn',
    create_time: ago(days(38)),
    update_time: ago(hours(2)),
    status: '1',
    tags: ['arabic', 'statutory', 'production'],
  },
  {
    id: 'kb_product_docs',
    name: 'Platform Documentation',
    description:
      'Product handbook, API references, and release notes. Ingestion pipeline runs nightly from the documentation repository.',
    language: 'en',
    embedding_model: 'BAAI/bge-large-en-v1.5@BAAI',
    chunk_method: 'naive',
    document_count: 318,
    chunk_count: 41_205,
    token_count: 12_005_774,
    similarity_threshold: 0.25,
    vector_similarity_weight: 0.4,
    top_k: 512,
    rerank_model: null,
    permission: 'team',
    created_by: 'dnn',
    create_time: ago(days(96)),
    update_time: ago(minutes(52)),
    status: '1',
    tags: ['docs', 'english', 'nightly'],
  },
  {
    id: 'kb_finance_filings',
    name: 'Quarterly Filings',
    description:
      'Tadawul quarterly disclosures and audited statements. Table-aware chunking with figure extraction.',
    language: 'en',
    embedding_model: 'text-embedding-3-large@openai',
    chunk_method: 'table',
    document_count: 87,
    chunk_count: 9_640,
    token_count: 22_881_004,
    similarity_threshold: 0.18,
    vector_similarity_weight: 0.35,
    top_k: 768,
    rerank_model: 'rerank-2@voyage',
    permission: 'team',
    created_by: 'a.alharbi',
    create_time: ago(days(61)),
    update_time: ago(hours(19)),
    status: '1',
    tags: ['finance', 'tables'],
  },
  {
    id: 'kb_support_tickets',
    name: 'Support Knowledge',
    description:
      'Resolved tickets and internal runbooks, deduplicated weekly. Powers the support agent in production.',
    language: 'en',
    embedding_model: 'BAAI/bge-m3@BAAI',
    chunk_method: 'qa',
    document_count: 1_204,
    chunk_count: 6_118,
    token_count: 3_402_991,
    similarity_threshold: 0.3,
    vector_similarity_weight: 0.5,
    top_k: 256,
    rerank_model: 'BAAI/bge-reranker-v2-m3@BAAI',
    permission: 'team',
    created_by: 's.otaibi',
    create_time: ago(days(140)),
    update_time: ago(minutes(8)),
    status: '1',
    tags: ['support', 'qa-pairs'],
  },
  {
    id: 'kb_research_papers',
    name: 'Retrieval Research',
    description:
      'arXiv papers on dense retrieval, reranking, and chunking strategies. Used for evaluation baselines.',
    language: 'en',
    embedding_model: 'jina-embeddings-v3@jina',
    chunk_method: 'paper',
    document_count: 236,
    chunk_count: 52_880,
    token_count: 31_440_112,
    similarity_threshold: 0.22,
    vector_similarity_weight: 0.3,
    top_k: 1024,
    rerank_model: null,
    permission: 'me',
    created_by: 'dnn',
    create_time: ago(days(210)),
    update_time: ago(days(4)),
    status: '1',
    tags: ['research', 'arxiv'],
  },
  {
    id: 'kb_contracts_draft',
    name: 'Vendor Contracts (draft)',
    description: 'Ingestion in progress. Parsing is queued behind the nightly job window.',
    language: 'en',
    embedding_model: 'BAAI/bge-large-en-v1.5@BAAI',
    chunk_method: 'naive',
    document_count: 12,
    chunk_count: 0,
    token_count: 0,
    similarity_threshold: 0.2,
    vector_similarity_weight: 0.3,
    top_k: 1024,
    rerank_model: null,
    permission: 'me',
    created_by: 'dnn',
    create_time: ago(hours(6)),
    update_time: ago(minutes(3)),
    status: '1',
    tags: ['draft'],
  },
];

/* ------------------------------------------------------------------ documents */

const docSeeds: Array<
  Partial<KbDocument> & { name: string; kb_id: string; type: string; size: number }
> = [
  { kb_id: 'kb_saudi_labor_law', name: 'نظام العمل - المرسوم الملكي م-51.pdf', type: 'pdf', size: 2_418_112, parser_id: 'laws', run: 'DONE', chunk_count: 1_842, token_count: 402_118, meta_fields: { jurisdiction: 'SA', instrument: 'Royal Decree M/51', year: 2005 } },
  { kb_id: 'kb_saudi_labor_law', name: 'اللائحة التنفيذية لنظام العمل.pdf', type: 'pdf', size: 1_204_882, parser_id: 'laws', run: 'DONE', chunk_count: 1_106, token_count: 260_441, meta_fields: { jurisdiction: 'SA', instrument: 'Implementing Regulation', year: 2007 } },
  { kb_id: 'kb_saudi_labor_law', name: 'قرارات وزارية - الأجور وساعات العمل.pdf', type: 'pdf', size: 842_004, parser_id: 'laws', run: 'DONE', chunk_count: 688, token_count: 148_992 },
  { kb_id: 'kb_saudi_labor_law', name: 'نظام العمل - الترجمة الرسمية.docx', type: 'docx', size: 918_774, parser_id: 'laws', run: 'DONE', chunk_count: 1_204, token_count: 288_004 },
  { kb_id: 'kb_saudi_labor_law', name: 'لوائح العمل الداخلية - نماذج.docx', type: 'docx', size: 204_118, parser_id: 'naive', run: 'DONE', chunk_count: 148, token_count: 31_882 },
  { kb_id: 'kb_saudi_labor_law', name: 'قرارات هيئات تسوية الخلافات العمالية.pdf', type: 'pdf', size: 3_118_402, parser_id: 'laws', run: 'RUNNING', chunk_count: 0, token_count: 0, progress: 0.62, progress_msg: 'Parsing page 214 / 341 — extracting article boundaries' },
  { kb_id: 'kb_saudi_labor_law', name: 'أسئلة شائعة - وزارة الموارد البشرية.csv', type: 'csv', size: 88_412, parser_id: 'qa', run: 'FAIL', chunk_count: 0, token_count: 0, progress_msg: 'Row 1_204: unterminated quoted field — check the delimiter setting' },
  { kb_id: 'kb_product_docs', name: 'OwnRAG API Reference v0.1.md', type: 'md', size: 118_402, parser_id: 'naive', run: 'DONE', chunk_count: 412, token_count: 88_114 },
  { kb_id: 'kb_product_docs', name: 'Ingestion Pipeline Design.md', type: 'md', size: 62_118, parser_id: 'naive', run: 'DONE', chunk_count: 208, token_count: 44_882 },
  { kb_id: 'kb_product_docs', name: 'Release Notes 2026-Q3.pdf', type: 'pdf', size: 318_004, parser_id: 'naive', run: 'DONE', chunk_count: 96, token_count: 21_004 },
  { kb_id: 'kb_product_docs', name: 'Deployment Runbook.pdf', type: 'pdf', size: 1_882_118, parser_id: 'naive', run: 'DONE', chunk_count: 704, token_count: 166_882 },
  { kb_id: 'kb_product_docs', name: 'Architecture Overview.pptx', type: 'pptx', size: 4_118_402, parser_id: 'presentation', run: 'DONE', chunk_count: 188, token_count: 40_118 },
  { kb_id: 'kb_product_docs', name: 'Deployment Runbook v2.pdf', type: 'pdf', size: 1_902_114, parser_id: 'naive', run: 'UNSTART', chunk_count: 0, token_count: 0 },
  { kb_id: 'kb_finance_filings', name: 'FY2026 Q2 Consolidated Statements.pdf', type: 'pdf', size: 2_882_004, parser_id: 'table', run: 'DONE', chunk_count: 418, token_count: 882_004, meta_fields: { quarter: 'Q2', year: 2026, audited: true } },
  { kb_id: 'kb_finance_filings', name: 'FY2026 Q1 Consolidated Statements.xlsx', type: 'xlsx', size: 882_118, parser_id: 'table', run: 'DONE', chunk_count: 288, token_count: 402_114, meta_fields: { quarter: 'Q1', year: 2026, audited: true } },
  { kb_id: 'kb_finance_filings', name: 'Auditor Report 2025.pdf', type: 'pdf', size: 618_004, parser_id: 'naive', run: 'DONE', chunk_count: 112, token_count: 28_882 },
  { kb_id: 'kb_finance_filings', name: 'Board Minutes 2026-08.pdf', type: 'pdf', size: 402_118, parser_id: 'naive', run: 'RUNNING', chunk_count: 0, token_count: 0, progress: 0.28, progress_msg: 'OCR pass — 41 / 148 pages' },
  { kb_id: 'kb_support_tickets', name: 'tickets-export-2026-09.csv', type: 'csv', size: 8_118_402, parser_id: 'qa', run: 'DONE', chunk_count: 2_118, token_count: 1_204_118 },
  { kb_id: 'kb_support_tickets', name: 'runbook-ingestion-failures.md', type: 'md', size: 44_118, parser_id: 'naive', run: 'DONE', chunk_count: 84, token_count: 18_004 },
  { kb_id: 'kb_support_tickets', name: 'runbook-model-rollback.md', type: 'md', size: 38_882, parser_id: 'naive', run: 'DONE', chunk_count: 72, token_count: 15_882 },
  { kb_id: 'kb_research_papers', name: '2405.11882 Dense Retrieval Distillation.pdf', type: 'pdf', size: 1_118_402, parser_id: 'paper', run: 'DONE', chunk_count: 188, token_count: 42_118 },
  { kb_id: 'kb_research_papers', name: '2402.03412 Late Interaction Reranking.pdf', type: 'pdf', size: 984_118, parser_id: 'paper', run: 'DONE', chunk_count: 164, token_count: 38_882 },
  { kb_id: 'kb_research_papers', name: '2310.09918 Chunking Strategies Survey.pdf', type: 'pdf', size: 1_402_118, parser_id: 'paper', run: 'DONE', chunk_count: 216, token_count: 51_004 },
  { kb_id: 'kb_contracts_draft', name: 'MSA-Acme-2026.pdf', type: 'pdf', size: 418_118, parser_id: 'naive', run: 'UNSTART', chunk_count: 0, token_count: 0 },
  { kb_id: 'kb_contracts_draft', name: 'NDA-Globex-2026.docx', type: 'docx', size: 118_402, parser_id: 'naive', run: 'UNSTART', chunk_count: 0, token_count: 0 },
];

export const demoDocuments: KbDocument[] = docSeeds.map((seed, index) => ({
  id: `doc_${String(index + 1).padStart(3, '0')}`,
  kb_id: seed.kb_id,
  name: seed.name,
  location: seed.location,
  type: seed.type,
  size: seed.size,
  chunk_count: seed.chunk_count ?? 0,
  token_count: seed.token_count ?? 0,
  progress: seed.progress ?? (seed.run === 'DONE' ? 1 : 0),
  progress_msg: seed.progress_msg,
  run: seed.run ?? 'UNSTART',
  parser_id: seed.parser_id ?? 'naive',
  parser_config: { chunk_token_num: 512, delimiter: '\n!?;。；！？', html4excel: false, raptor: { use_raptor: false }, layout_recognize: 'DeepDOC' },
  source_type: 'local',
  created_by: seed.kb_id === 'kb_finance_filings' ? 'a.alharbi' : seed.kb_id === 'kb_support_tickets' ? 's.otaibi' : 'dnn',
  create_time: ago(days(30) - index * hours(7)),
  update_time: ago(hours((index * 3) % 96) + minutes(1)),
  meta_fields: seed.meta_fields,
  thumbnail: null,
}));

/* ------------------------------------------------------------------ chunks */

const chunkSeeds: Array<{ doc: string; kb: string; text: string; page: number; tags?: string[] }> = [
  {
    kb: 'kb_saudi_labor_law',
    doc: 'doc_001',
    page: 42,
    text: 'المادة الثالثة والسبعون: لا يجوز تشغيل العامل فعلياً أكثر من ثماني ساعات في اليوم الواحد، أو أكثر من ثمان وأربعين ساعة في الأسبوع، وذلك في جميع أشهر السنة عدا شهر رمضان المبارك.',
    tags: ['working-hours', 'article-73'],
  },
  {
    kb: 'kb_saudi_labor_law',
    doc: 'doc_001',
    page: 43,
    text: 'تخفض ساعات العمل الفعلية في شهر رمضان المبارك بحيث لا تزيد على ست ساعات في اليوم، أو ست وثلاثين ساعة في الأسبوع.',
    tags: ['working-hours', 'ramadan'],
  },
  {
    kb: 'kb_saudi_labor_law',
    doc: 'doc_002',
    page: 118,
    text: 'تُحسب ساعات العمل الإضافية بواقع أجر الساعة مضافاً إليه خمسون في المئة من أجره الأساسي، وتُعطى هذه الزيادة عن كل ساعة عمل إضافية.',
    tags: ['overtime', 'compensation'],
  },
  {
    kb: 'kb_product_docs',
    doc: 'doc_008',
    page: 3,
    text: 'Create a knowledge base with POST /api/v1/datasets. The request body requires `name` and accepts `embedding_model`, `chunk_method`, and `parser_config`. Ingestion is asynchronous: poll the document list until `run` reports DONE.',
    tags: ['api', 'datasets'],
  },
  {
    kb: 'kb_product_docs',
    doc: 'doc_009',
    page: 7,
    text: 'The ingestion pipeline is a directed graph of stages: fetch, parse, chunk, embed, index. Each stage writes a checkpoint so a failed run resumes from the last completed stage instead of re-parsing the whole document.',
    tags: ['pipeline', 'architecture'],
  },
  {
    kb: 'kb_finance_filings',
    doc: 'doc_014',
    page: 12,
    text: 'Revenue for the quarter increased 14.2% to SAR 8.42bn (Q2 2025: SAR 7.37bn), driven by a 21% expansion in the cloud segment and favourable FX movements in the services line.',
    tags: ['revenue', 'tables'],
  },
  {
    kb: 'kb_research_papers',
    doc: 'doc_021',
    page: 4,
    text: 'We show that distilling a cross-encoder reranker into the bi-encoder reduces recall@10 by 1.8 points on BEIR while halving the query latency and removing the second-stage compute entirely.',
    tags: ['reranking', 'latency'],
  },
  {
    kb: 'kb_research_papers',
    doc: 'doc_023',
    page: 9,
    text: 'Recursive semantic chunking outperforms fixed-length windows on documents with strong section structure, but degrades when headings are missing, where a simple 512-token window remains competitive.',
    tags: ['chunking', 'evaluation'],
  },
  {
    kb: 'kb_support_tickets',
    doc: 'doc_018',
    page: 1,
    text: 'Q: Ingestion stuck at RUNNING for over an hour. A: Check the task executor logs for a parser OOM. Documents over 300MB should be chunked with the naive parser before OCR is enabled.',
    tags: ['troubleshooting'],
  },
  {
    kb: 'kb_support_tickets',
    doc: 'doc_019',
    page: 2,
    text: 'Q: Retrieval returns empty results after a model swap. A: Embeddings written with the previous model are dimensionally incompatible. Re-index the knowledge base after any embedding-model change.',
    tags: ['troubleshooting', 'embeddings'],
  },
];

export const demoChunks: Chunk[] = chunkSeeds.map((seed, index) => ({
  id: `chk_${String(index + 1).padStart(4, '0')}`,
  content_with_weight: seed.text,
  document_id: seed.doc,
  document_keyword: demoDocuments.find((d) => d.id === seed.doc)?.name ?? 'document',
  dataset_id: seed.kb,
  important_kwd: seed.tags ?? [],
  question_kwd: [],
  available_int: 1,
  positions: [[seed.page, 120, 640, 480, 700]],
  index: index + 1,
}));

/* ------------------------------------------------------------------ retrieval scores
 * Deterministic pseudo-scores: a rankable, reproducible decay curve rather than Math.random,
 * so ordering and the score rail always agree between renders.
 */
export function demoScore(rank: number, base = 0.92) {
  const vector = +(base - rank * 0.041).toFixed(3);
  const term = +(0.34 + (rank % 3) * 0.07).toFixed(3);
  const fused = +(0.7 * vector + 0.3 * term).toFixed(3);
  const rerank = +(0.96 - rank * 0.038).toFixed(3);
  return { vector_similarity: Math.max(0.05, vector), term_similarity: term, similarity: Math.max(0.05, fused), rerank_score: Math.max(0.05, rerank) };
}

/* ------------------------------------------------------------------ chat */

export const demoAssistants: ChatAssistant[] = [
  {
    id: 'chat_labor',
    name: 'Labor Law Assistant',
    description: 'Answers grounded in the consolidated Saudi Labor Law corpus with article-level citations.',
    dataset_ids: ['kb_saudi_labor_law'],
    llm: { model_name: 'deepseek-chat@deepseek', temperature: 0.1, top_p: 0.3, max_tokens: 2048, presence_penalty: 0.4, frequency_penalty: 0.7 },
    prompt: { similarity_threshold: 0.2, keywords_similarity_weight: 0.7, top_n: 8, top_k: 1024, show_quote: true, rerank_id: 'BAAI/bge-reranker-v2-m3@BAAI', system: 'Answer strictly from the retrieved articles. Reply in Arabic unless the question is asked in English. Always cite the article number.', variables: [{ key: 'jurisdiction' }, { key: 'employee_class', optional: true }] },
    create_time: ago(days(30)),
    update_time: ago(hours(5)),
  },
  {
    id: 'chat_docs',
    name: 'Platform Copilot',
    description: 'Product and API questions across the documentation corpus.',
    dataset_ids: ['kb_product_docs'],
    llm: { model_name: 'gpt-5@openai', temperature: 0.2, top_p: 0.8, max_tokens: 4096, presence_penalty: 0.1, frequency_penalty: 0.2 },
    prompt: { similarity_threshold: 0.25, keywords_similarity_weight: 0.6, top_n: 6, top_k: 512, show_quote: true, system: 'You are the platform copilot. Prefer code examples and cite the documentation section.' },
    create_time: ago(days(84)),
    update_time: ago(minutes(40)),
  },
  {
    id: 'chat_support',
    name: 'Support Triage',
    description: 'First-line support, resolves the most common tickets from the internal runbooks.',
    dataset_ids: ['kb_support_tickets', 'kb_product_docs'],
    llm: { model_name: 'claude-sonnet-4.5@anthropic', temperature: 0.3, top_p: 0.9, max_tokens: 2048 },
    prompt: { similarity_threshold: 0.3, keywords_similarity_weight: 0.5, top_n: 5, top_k: 256, show_quote: true, system: 'Be concise. Give the operator the fix, the diagnostic step, and the escalation path.' },
    create_time: ago(days(120)),
    update_time: ago(hours(30)),
  },
  {
    id: 'chat_filings',
    name: 'Filings Analyst',
    description: 'Financial questions over quarterly disclosures, with table-level provenance.',
    dataset_ids: ['kb_finance_filings'],
    llm: { model_name: 'gpt-5@openai', temperature: 0.0, top_p: 0.5, max_tokens: 4096 },
    prompt: { similarity_threshold: 0.18, keywords_similarity_weight: 0.65, top_n: 10, top_k: 768, show_quote: true, rerank_id: 'rerank-2@voyage' },
    create_time: ago(days(59)),
    update_time: ago(hours(20)),
  },
];

export const demoSessions: ChatSession[] = [
  { id: 'sess_l1', chat_id: 'chat_labor', name: 'Ramadan working hours for shift staff', create_time: ago(hours(2)), update_time: ago(hours(2)) },
  { id: 'sess_l2', chat_id: 'chat_labor', name: 'Overtime rate for weekend work', create_time: ago(days(1)), update_time: ago(days(1)) },
  { id: 'sess_l3', chat_id: 'chat_labor', name: 'Termination notice periods', create_time: ago(days(4)), update_time: ago(days(4)) },
  { id: 'sess_d1', chat_id: 'chat_docs', name: 'How does ingestion resume after failure?', create_time: ago(minutes(40)), update_time: ago(minutes(40)) },
  { id: 'sess_d2', chat_id: 'chat_docs', name: 'Dataset API pagination', create_time: ago(days(2)), update_time: ago(days(2)) },
  { id: 'sess_s1', chat_id: 'chat_support', name: 'Empty retrieval after model swap', create_time: ago(hours(30)), update_time: ago(hours(30)) },
  { id: 'sess_f1', chat_id: 'chat_filings', name: 'Q2 revenue bridge', create_time: ago(hours(20)), update_time: ago(hours(20)) },
];

export const demoMessages: Record<string, ChatMessage[]> = {
  sess_l1: [
    {
      id: 'msg_l1_1',
      session_id: 'sess_l1',
      role: 'user',
      content: 'هل يمكن تشغيل موظفي الورديات ساعات عمل أقل في رمضان مع تعديل الأجر؟ وهل يمكن تعويض الفرق بساعات إضافية لاحقاً؟',
      created_at: ago(hours(2) + minutes(3)),
      tokens: 46,
    },
    {
      id: 'msg_l1_2',
      session_id: 'sess_l1',
      role: 'assistant',
      content:
        'نعم. تقلص ساعات العمل الفعلية في رمضان بحيث لا تزيد على **ست ساعات في اليوم** أو **ست وثلاثين ساعة في الأسبوع**، وتُعدّ هذه حدوداً إلزامية لا يجوز تجاوزها بالاتفاق.\n\nبالنسبة للتعويض:\n\n- **لا يجوز** تعويض ساعات رمضان المخفّضة بساعات لاحقة تعويضاً عن النقص ذاته؛ فالتخفيض حكم نظامي مرتبط بالشهر.\n- **يجوز** تكليف العامل بعمل إضافي بعد انتهاء ساعات العمل المخفّضة، بشرط أن يكون ذلك وفق ضوابط العمل الإضافي وألا يتجاوز الحد الأقصى اليومي.\n- العمل الإضافي في رمضان يُحسب بواقع أجر الساعة مضافاً إليه 50% للموظف العادي، و100% إذا وقع العمل في يوم عطلة.[citation:1][citation:3]\n\nما لم ينص عقد العمل أو لائحة العمل الداخلية على ميزة أفضل، فلا يجوز النزول عن هذا الحد.',
      reference: [
        { chunk_id: 'chk_0002', doc_id: 'doc_001', doc_name: 'نظام العمل - المرسوم الملكي م-51.pdf', content: chunkSeeds[1].text, similarity: 0.912, vector_similarity: 0.881, term_similarity: 0.34, index: 1 },
        { chunk_id: 'chk_0001', doc_id: 'doc_001', doc_name: 'نظام العمل - المرسوم الملكي م-51.pdf', content: chunkSeeds[0].text, similarity: 0.874, vector_similarity: 0.842, term_similarity: 0.41, index: 2 },
        { chunk_id: 'chk_0003', doc_id: 'doc_002', doc_name: 'اللائحة التنفيذية لنظام العمل.pdf', content: chunkSeeds[2].text, similarity: 0.788, vector_similarity: 0.755, term_similarity: 0.27, index: 3 },
      ],
      created_at: ago(hours(2) + minutes(2)),
      latency_ms: 2_140,
      tokens: 638,
    },
  ],
  sess_l2: [
    { id: 'msg_l2_1', session_id: 'sess_l2', role: 'user', content: 'What is the overtime rate for work performed on a rest day?', created_at: ago(days(1) + minutes(4)), tokens: 14 },
    {
      id: 'msg_l2_2',
      session_id: 'sess_l2',
      role: 'assistant',
      content:
        'Work performed on a rest day is compensated at the hourly wage plus **100%** — double the base hourly rate.\n\n- The base hourly rate is the basic wage divided by 30, then by 8.[citation:1]\n- If the work is on a rest day *and* the week has already exceeded 48 hours, both the overtime and the rest-day premiums apply, computed on the same hourly base.\n- The employer must keep a record of overtime hours; the burden of proof sits with the employer.[citation:2]',
      reference: [
        { chunk_id: 'chk_0003', doc_id: 'doc_002', doc_name: 'اللائحة التنفيذية لنظام العمل.pdf', content: chunkSeeds[2].text, similarity: 0.933, vector_similarity: 0.902, term_similarity: 0.52, index: 1 },
        { chunk_id: 'chk_0001', doc_id: 'doc_001', doc_name: 'نظام العمل - المرسوم الملكي م-51.pdf', content: chunkSeeds[0].text, similarity: 0.801, vector_similarity: 0.778, term_similarity: 0.31, index: 2 },
      ],
      created_at: ago(days(1) + minutes(3)),
      latency_ms: 1_882,
      tokens: 512,
    },
  ],
  sess_d1: [
    { id: 'msg_d1_1', session_id: 'sess_d1', role: 'user', content: 'If a document fails midway through ingestion, does OwnRAG re-parse it from the beginning?', created_at: ago(minutes(42)), tokens: 18 },
    {
      id: 'msg_d1_2',
      session_id: 'sess_d1',
      role: 'assistant',
      content:
        'No. The ingestion pipeline writes a **checkpoint per stage** (fetch → parse → chunk → embed → index). On retry the executor resumes from the last completed stage.[citation:1]\n\nWhat that means in practice:\n\n1. A failure in `embed` re-runs embedding and indexing only — the PDF is not parsed again.\n2. A failure in `parse` restarts from parsing, because every downstream chunk depends on it.\n3. Cancelling a run leaves the checkpoint intact, so a manual re-run costs the same as a retry.\n\nIf you need a guaranteed clean slate (for example after changing the embedding model), use **Delete chunks** and re-run, because vectors from a different model are dimensionally incompatible.[citation:2]',
      reference: [
        { chunk_id: 'chk_0005', doc_id: 'doc_009', doc_name: 'Ingestion Pipeline Design.md', content: chunkSeeds[4].text, similarity: 0.941, vector_similarity: 0.912, term_similarity: 0.44, index: 1 },
        { chunk_id: 'chk_0010', doc_id: 'doc_019', doc_name: 'runbook-model-rollback.md', content: chunkSeeds[9].text, similarity: 0.836, vector_similarity: 0.804, term_similarity: 0.29, index: 2 },
      ],
      created_at: ago(minutes(40)),
      latency_ms: 1_640,
      tokens: 486,
    },
  ],
};

/* ------------------------------------------------------------------ agents */

const retrievalNode = (id: string, x: number, y: number, label: string, kb: string) => ({
  id,
  kind: 'retrieval' as const,
  label,
  x,
  y,
  config: { dataset_ids: [kb], similarity_threshold: 0.2, top_n: 6, top_k: 1024, rerank_id: 'BAAI/bge-reranker-v2-m3@BAAI' },
});

export const demoAgents: Agent[] = [
  {
    id: 'agent_contract_review',
    title: 'Contract Review Agent',
    description: 'Extracts obligations, deadlines and liability caps from vendor contracts, then drafts a review memo.',
    dsl: {
      graph: {
        nodes: [
          { id: 'begin', kind: 'begin', label: 'Start', x: 40, y: 200, config: { inputs: [{ key: 'contract_pdf', type: 'file', required: true }, { key: 'jurisdiction', type: 'text', default: 'SA' }] } },
          retrievalNode('retrieve_clauses', 280, 200, 'Retrieve clauses', 'kb_contracts_draft'),
          { id: 'categorize', kind: 'categorize', label: 'Classify clause', x: 540, y: 120, config: { model: 'gpt-5@openai', categories: ['obligation', 'termination', 'liability', 'payment'] } },
          { id: 'extract', kind: 'generate', label: 'Extract obligations', x: 540, y: 320, config: { model: 'claude-sonnet-4.5@anthropic', temperature: 0.1, system: 'Return a table: obligation, article, deadline, risk.' } },
          { id: 'code_calc', kind: 'code', label: 'Compute deadlines', x: 800, y: 320, config: { language: 'python', timeout_s: 20 } },
          { id: 'memo', kind: 'generate', label: 'Draft memo', x: 800, y: 120, config: { model: 'gpt-5@openai', stream: true } },
          { id: 'out', kind: 'message', label: 'Respond', x: 1060, y: 220, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'begin', target: 'retrieve_clauses' },
          { id: 'e2', source: 'retrieve_clauses', target: 'categorize' },
          { id: 'e3', source: 'retrieve_clauses', target: 'extract' },
          { id: 'e4', source: 'extract', target: 'code_calc' },
          { id: 'e5', source: 'categorize', target: 'memo' },
          { id: 'e6', source: 'code_calc', target: 'memo' },
          { id: 'e7', source: 'memo', target: 'out' },
        ],
      },
      globals: { sys_prompt: 'You are a contract analyst.', timeout_s: 120 },
    },
    permission: 'team',
    create_time: ago(days(12)),
    update_time: ago(hours(6)),
    tags: ['legal', 'extraction'],
    status: 'published',
    run_count: 1_284,
  },
  {
    id: 'agent_support_triage',
    title: 'Support Triage',
    description: 'Classifies an incoming ticket, retrieves runbooks, and answers or escalates.',
    dsl: {
      graph: {
        nodes: [
          { id: 'begin', kind: 'begin', label: 'Ticket', x: 40, y: 180, config: { inputs: [{ key: 'ticket_body', type: 'text', required: true }, { key: 'customer_tier', type: 'select', options: ['free', 'pro', 'enterprise'] }] } },
          retrievalNode('retrieve_runbook', 280, 180, 'Retrieve runbook', 'kb_support_tickets'),
          { id: 'gen', kind: 'generate', label: 'Draft reply', x: 540, y: 180, config: { model: 'claude-sonnet-4.5@anthropic', temperature: 0.3 } },
          { id: 'switch', kind: 'switch', label: 'Confidence gate', x: 800, y: 180, config: { condition: 'citation_count >= 2', cases: ['answer', 'escalate'] } },
          { id: 'out', kind: 'message', label: 'Reply / escalate', x: 1060, y: 180, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'begin', target: 'retrieve_runbook' },
          { id: 'e2', source: 'retrieve_runbook', target: 'gen' },
          { id: 'e3', source: 'gen', target: 'switch' },
          { id: 'e4', source: 'switch', target: 'out' },
        ],
      },
    },
    permission: 'team',
    create_time: ago(days(40)),
    update_time: ago(hours(28)),
    tags: ['support', 'production'],
    status: 'published',
    run_count: 24_906,
  },
  {
    id: 'agent_law_research',
    title: 'Legal Research Assistant',
    description: 'Multi-hop research over the labor-law corpus with an iteration node over article groups.',
    dsl: {
      graph: {
        nodes: [
          { id: 'begin', kind: 'begin', label: 'Question', x: 40, y: 200, config: { inputs: [{ key: 'question', type: 'text', required: true }] } },
          { id: 'iter', kind: 'iteration', label: 'Iterate sub-questions', x: 280, y: 200, config: { max_iterations: 4 } },
          retrievalNode('retrieve', 520, 200, 'Retrieve articles', 'kb_saudi_labor_law'),
          { id: 'gen', kind: 'generate', label: 'Compose answer', x: 760, y: 200, config: { model: 'deepseek-chat@deepseek', temperature: 0.1, system: 'Answer in Arabic with article citations.' } },
          { id: 'out', kind: 'message', label: 'Respond', x: 1000, y: 200, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'begin', target: 'iter' },
          { id: 'e2', source: 'iter', target: 'retrieve' },
          { id: 'e3', source: 'retrieve', target: 'gen' },
          { id: 'e4', source: 'gen', target: 'out' },
        ],
      },
      globals: { sys_prompt: 'Cite the article number for every claim.' },
    },
    permission: 'me',
    create_time: ago(days(22)),
    update_time: ago(days(1)),
    tags: ['legal', 'arabic'],
    status: 'draft',
    run_count: 312,
  },
  {
    id: 'agent_filing_copilot',
    title: 'Filings Analyst',
    description: 'Answers financial questions with table-level provenance and a code node for ratio maths.',
    dsl: {
      graph: {
        nodes: [
          { id: 'begin', kind: 'begin', label: 'Question', x: 40, y: 180, config: { inputs: [{ key: 'question', type: 'text', required: true }, { key: 'quarter', type: 'select', options: ['Q1', 'Q2', 'Q3', 'Q4'] }] } },
          retrievalNode('retrieve_tables', 280, 180, 'Retrieve tables', 'kb_finance_filings'),
          { id: 'code', kind: 'code', label: 'Ratio maths', x: 540, y: 180, config: { language: 'python', timeout_s: 15 } },
          { id: 'gen', kind: 'generate', label: 'Narrate', x: 800, y: 180, config: { model: 'gpt-5@openai', temperature: 0 } },
          { id: 'out', kind: 'message', label: 'Respond', x: 1040, y: 180, config: {} },
        ],
        edges: [
          { id: 'e1', source: 'begin', target: 'retrieve_tables' },
          { id: 'e2', source: 'retrieve_tables', target: 'code' },
          { id: 'e3', source: 'code', target: 'gen' },
          { id: 'e4', source: 'gen', target: 'out' },
        ],
      },
    },
    permission: 'team',
    create_time: ago(days(51)),
    update_time: ago(hours(18)),
    tags: ['finance'],
    status: 'published',
    run_count: 4_118,
  },
];

export const demoAgentTemplates: AgentTemplate[] = [
  { id: 'tpl_rag_deep', title: 'Deep research RAG', description: 'Iterative retrieval with sub-question decomposition and citation-grade output.', category: 'Research', avatar: '🧭' },
  { id: 'tpl_qa_bot', title: 'Knowledge Q&A bot', description: 'Grounded single-pass assistant over one or more knowledge bases.', category: 'Assistant', avatar: '💬' },
  { id: 'tpl_doc_extract', title: 'Document extraction', description: 'Parse, classify and extract structured fields from uploaded documents.', category: 'Extraction', avatar: '📄' },
  { id: 'tpl_support', title: 'Support triage', description: 'Classify, retrieve runbooks, answer or escalate with a confidence gate.', category: 'Operations', avatar: '🛟' },
  { id: 'tpl_sql_agent', title: 'Database analyst', description: 'Text-to-SQL over a registered database with a validation step.', category: 'Analytics', avatar: '🗄️' },
  { id: 'tpl_web_research', title: 'Web + corpus research', description: 'Fuses web search with your own corpus and reconciles conflicts.', category: 'Research', avatar: '🌐' },
];

/* ------------------------------------------------------------------ models */

export const demoProviders: ModelProvider[] = [
  {
    name: 'openai',
    label: 'OpenAI',
    kind: 'llm',
    status: 'added',
    instances: [
      {
        id: 'inst_openai_prod',
        provider: 'openai',
        instance_name: 'production',
        api_base: 'https://api.openai.com/v1',
        status: 'connected',
        has_api_key: true,
        models: [
          { id: 'gpt-5', name: 'gpt-5@openai', model_type: 'chat', status: 'active', context_length: 400_000, max_tokens: 16_384, tags: ['chat', 'tools'] },
          { id: 'gpt-5-mini', name: 'gpt-5-mini@openai', model_type: 'chat', status: 'active', context_length: 200_000, tags: ['chat', 'fast'] },
          { id: 'text-embedding-3-large', name: 'text-embedding-3-large@openai', model_type: 'embedding', status: 'active', tags: ['embedding', '3072d'] },
          { id: 'gpt-image-1', name: 'gpt-image-1@openai', model_type: 'vision', status: 'inactive', tags: ['vision'] },
        ],
      },
    ],
  },
  {
    name: 'anthropic',
    label: 'Anthropic',
    kind: 'llm',
    status: 'added',
    instances: [
      {
        id: 'inst_anthropic_prod',
        provider: 'anthropic',
        instance_name: 'production',
        api_base: 'https://api.anthropic.com',
        status: 'connected',
        has_api_key: true,
        models: [
          { id: 'claude-sonnet-4.5', name: 'claude-sonnet-4.5@anthropic', model_type: 'chat', status: 'active', context_length: 200_000, tags: ['chat', 'long-context'] },
          { id: 'claude-haiku-4.5', name: 'claude-haiku-4.5@anthropic', model_type: 'chat', status: 'active', tags: ['chat', 'fast'] },
        ],
      },
    ],
  },
  {
    name: 'deepseek',
    label: 'DeepSeek',
    kind: 'llm',
    status: 'added',
    instances: [
      {
        id: 'inst_deepseek_prod',
        provider: 'deepseek',
        instance_name: 'production',
        api_base: 'https://api.deepseek.com',
        status: 'connected',
        has_api_key: true,
        models: [
          { id: 'deepseek-chat', name: 'deepseek-chat@deepseek', model_type: 'chat', status: 'active', context_length: 128_000, tags: ['chat', 'cheap'] },
          { id: 'deepseek-reasoner', name: 'deepseek-reasoner@deepseek', model_type: 'chat', status: 'active', context_length: 128_000, tags: ['reasoning'] },
        ],
      },
    ],
  },
  {
    name: 'BAAI',
    label: 'BAAI (self-hosted)',
    kind: 'embedding',
    status: 'added',
    instances: [
      {
        id: 'inst_baai_local',
        provider: 'BAAI',
        instance_name: 'vllm-cluster',
        api_base: 'http://embed.internal:8000/v1',
        status: 'connected',
        has_api_key: false,
        models: [
          { id: 'bge-m3', name: 'BAAI/bge-m3@BAAI', model_type: ['embedding', 'rerank'], status: 'active', tags: ['multilingual', '1024d'] },
          { id: 'bge-large-en-v1.5', name: 'BAAI/bge-large-en-v1.5@BAAI', model_type: 'embedding', status: 'active', tags: ['english', '1024d'] },
          { id: 'bge-reranker-v2-m3', name: 'BAAI/bge-reranker-v2-m3@BAAI', model_type: 'rerank', status: 'active', tags: ['multilingual'] },
        ],
      },
    ],
  },
  {
    name: 'voyage',
    label: 'Voyage AI',
    kind: 'embedding',
    status: 'added',
    instances: [
      {
        id: 'inst_voyage',
        provider: 'voyage',
        instance_name: 'default',
        status: 'unverified',
        has_api_key: true,
        models: [{ id: 'rerank-2', name: 'rerank-2@voyage', model_type: 'rerank', status: 'active', tags: ['rerank'] }],
      },
    ],
  },
  {
    name: 'ollama',
    label: 'Ollama (local)',
    kind: 'llm',
    status: 'available',
    instances: [],
  },
  {
    name: 'mistral',
    label: 'Mistral AI',
    kind: 'llm',
    status: 'available',
    instances: [],
  },
  {
    name: 'together',
    label: 'Together AI',
    kind: 'llm',
    status: 'available',
    instances: [],
  },
  {
    name: 'jina',
    label: 'Jina AI',
    kind: 'embedding',
    status: 'available',
    instances: [],
  },
];

/* ------------------------------------------------------------------ connectors, tokens, memory, mcp */

export const demoConnectors: Connector[] = [
  { id: 'conn_01', name: 'Docs repository (S3)', source_type: 's3', status: 'connected', dataset_ids: ['kb_product_docs'], schedule: '0 2 * * *', last_sync_at: ago(hours(7)), documents_synced: 318 },
  { id: 'conn_02', name: 'Slack — #product', source_type: 'slack', status: 'connected', dataset_ids: ['kb_product_docs'], schedule: '0 */6 * * *', last_sync_at: ago(hours(1)), documents_synced: 214 },
  { id: 'conn_03', name: 'Gmail — Engineering', source_type: 'gmail', status: 'syncing', dataset_ids: ['kb_product_docs'], schedule: '0 3 * * *', last_sync_at: ago(hours(9)), documents_synced: 104 },
  { id: 'conn_04', name: 'Google Drive — Legal', source_type: 'google-drive', status: 'error', dataset_ids: ['kb_saudi_labor_law'], schedule: '0 4 * * 1', last_sync_at: ago(days(6)), documents_synced: 42, error: 'OAuth refresh token expired — reconnect the connector to resume sync.' },
  { id: 'conn_05', name: 'SharePoint — Contracts', source_type: 'sharepoint', status: 'paused', dataset_ids: ['kb_contracts_draft'], documents_synced: 12 },
];

export const demoTokens: ApiToken[] = [
  { id: 'tok_demo_732', token: 'ownrag-9f2c41d78ab34e1188c0e5f6a7b2d901', name: 'ci-ingestion', create_date: '2026-07-12', create_time: ago(days(84)), last_used_at: ago(minutes(12)) },
  { id: 'tok_demo_733', token: 'ownrag-3ad8c0f1e7b2497ba1c4d5e6f7089a12', name: 'support-agent-prod', create_date: '2026-08-02', create_time: ago(days(63)), last_used_at: ago(minutes(2)) },
  { id: 'tok_demo_734', token: 'ownrag-77b1e2a9c4d84f0e9a3b2c1d0e5f6a7b', name: 'notebook-evals', create_date: '2026-09-18', create_time: ago(days(16)), last_used_at: ago(days(3)) },
];

export const demoMemory: MemoryRecord[] = [
  { id: 'mem_01', name: 'Support agent memory', description: 'Resolved-ticket context carried across sessions.', memory_type: 'semantic', message_count: 12_408, storage_type: 'vector', create_time: ago(days(46)) },
  { id: 'mem_02', name: 'Contract review session memory', description: 'JPEG memory of the current contract negotiation thread.', memory_type: 'raw', message_count: 318, storage_type: 'table', create_time: ago(days(12)) },
];

export const demoMcpServers: McpServer[] = [
  { id: 'mcp_01', name: 'filesystem', url: 'http://mcp-fs:8080/sse', transport: 'sse', enabled: true, status: 'ok', last_check_at: ago(minutes(4)), tools: [{ name: 'read_file' }, { name: 'list_dir' }, { name: 'search_files' }] },
  { id: 'mcp_02', name: 'postgres-readonly', url: 'http://mcp-pg:8081/mcp', transport: 'streamable-http', enabled: true, status: 'ok', last_check_at: ago(minutes(11)), tools: [{ name: 'query' }, { name: 'list_tables' }] },
  { id: 'mcp_03', name: 'intercom', url: 'https://mcp.intercom.com/sse', transport: 'sse', enabled: false, status: 'error', last_check_at: ago(hours(3)), tools: [{ name: 'search_conversations' }] },
];

/* ------------------------------------------------------------------ dashboard */

export const demoMetrics: DashboardMetric[] = [
  { key: 'kbs', label: 'Knowledge bases', value: 6, delta: 1, hint: '4 shared with the team' },
  { key: 'documents', label: 'Documents', value: 1_899, delta: 42, hint: '318 synced in the last 24h' },
  { key: 'chunks', label: 'Indexed chunks', value: 128_255, delta: 3_104, hint: '18.4k in the labor-law corpus' },
  { key: 'tokens', label: 'Indexed tokens', value: 74_653_114, delta: 1_204_882, hint: 'Across 3 embedding models' },
];

export const demoThroughput = [
  { label: 'Mon', ingest: 12_400, query: 41_200 },
  { label: 'Tue', ingest: 18_900, query: 46_800 },
  { label: 'Wed', ingest: 9_640, query: 52_100 },
  { label: 'Thu', ingest: 22_118, query: 49_400 },
  { label: 'Fri', ingest: 14_882, query: 61_200 },
  { label: 'Sat', ingest: 4_118, query: 22_800 },
  { label: 'Sun', ingest: 6_204, query: 28_400 },
];

export const demoLatencySeries = [212, 198, 246, 188, 174, 162, 158, 171, 149, 138, 142, 128, 119, 126, 118, 112, 109, 104, 111, 98, 96, 92, 88, 91];

export const demoActivities: ActivityEvent[] = [
  { id: 'act_01', kind: 'ingest', title: 'Ingestion finished', detail: 'نظام العمل - المرسوم الملكي م-51.pdf → 1,842 chunks', at: ago(minutes(6)), status: 'ok' },
  { id: 'act_02', kind: 'chat', title: 'Labor Law Assistant answered', detail: 'Ramadan working hours for shift staff · 3 citations · 2.1s', at: ago(minutes(14)), status: 'ok' },
  { id: 'act_03', kind: 'connector', title: 'Google Drive sync failed', detail: 'OAuth refresh token expired — Legal connector', at: ago(hours(3)), status: 'error' },
  { id: 'act_04', kind: 'ingest', title: 'Parsing queued', detail: 'قرارات هيئات تسوية الخلافات العمالية.pdf · page 214 / 341', at: ago(hours(1)), status: 'running' },
  { id: 'act_05', kind: 'agent', title: 'Support Triage deployed', detail: 'v14 published · 1,204 runs in the last 24h', at: ago(hours(5)), status: 'ok' },
  { id: 'act_06', kind: 'model', title: 'Embedding model added', detail: 'jina-embeddings-v3@jina on instance "default"', at: ago(hours(18)), status: 'ok' },
  { id: 'act_07', kind: 'ingest', title: 'Ingestion failed', detail: 'أسئلة شائعة - وزارة الموارد البشرية.csv · unterminated quoted field', at: ago(hours(21)), status: 'error' },
  { id: 'act_08', kind: 'system', title: 'Reranker latency improved', detail: 'p95 96ms → 88ms after instance scaling', at: ago(days(1)), status: 'ok' },
];

export const demoPipelineStages = [
  { key: 'fetch', label: 'Fetch', done: 42, running: 0, failed: 0, queued: 0 },
  { key: 'parse', label: 'Parse', done: 40, running: 1, failed: 1, queued: 0 },
  { key: 'chunk', label: 'Chunk', done: 40, running: 0, failed: 0, queued: 1 },
  { key: 'embed', label: 'Embed', done: 40, running: 0, failed: 0, queued: 1 },
  { key: 'index', label: 'Index', done: 40, running: 0, failed: 0, queued: 1 },
];

export const demoSystem: SystemInfo = {
  version: 'v0.1.0-ownrag',
  build: '2400ca8-derived',
  doc_engine: 'DeepDOC (Go)',
  storage: 'MinIO',
  database: 'PostgreSQL 16',
  kvstore: 'Kvrocks',
  os: 'linux/arm64',
};

export const demoChunkingMethods = [
  { value: 'naive', label: 'General', hint: 'Token window with delimiter awareness. The safe default.' },
  { value: 'laws', label: 'Laws', hint: 'Article-aware splitting for statutory text; keeps article headers with their body.' },
  { value: 'paper', label: 'Paper', hint: 'Section-aware splitting for academic PDFs; keeps abstracts and captions together.' },
  { value: 'book', label: 'Book', hint: 'Chapter and heading hierarchy for long-form documents.' },
  { value: 'presentation', label: 'Presentation', hint: 'One chunk per slide plus extracted speaker notes.' },
  { value: 'table', label: 'Table', hint: 'Table-aware parsing that keeps headers attached to rows.' },
  { value: 'qa', label: 'Q&A', hint: 'Question/answer pairs become one chunk each — ideal for ticket exports.' },
  { value: 'resume', label: 'Resume', hint: 'Section-aware splitting tuned for CVs.' },
  { value: 'picture', label: 'Picture', hint: 'Caption-driven chunks for image-heavy documents.' },
  { value: 'knowledge_graph', label: 'Knowledge graph', hint: 'Entity and relation extraction into a graph plus text chunks.' },
  { value: 'email', label: 'Email', hint: 'Header-aware splitting for mail archives.' },
  { value: 'one', label: 'Whole document', hint: 'The entire document becomes a single chunk.' },
];

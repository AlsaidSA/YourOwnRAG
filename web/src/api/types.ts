/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Domain types for the console. Field names follow the preserved backend payloads
 * (snake_case, `_kwd` suffixes, `content_with_weight`), so no adapter layer is required.
 */

export type DocRunStatus =
  | 'UNSTART'
  | 'RUNNING'
  | 'DONE'
  | 'FAIL'
  | 'CANCEL'
  // Both come from the ingestion guard: a document with no native text is deferred to OCR,
  // and one whose bytes are not text at all is refused. Neither is a generic failure.
  | 'NEEDS_OCR'
  | 'REJECTED';
export type ParseMethod = 'naive' | 'manual' | 'paper' | 'book' | 'laws' | 'presentation' | 'picture' | 'one' | 'qa' | 'table' | 'resume' | 'knowledge_graph' | 'email' | 'tag';

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  avatar?: string | null;
  language?: string;
  embedding_model: string;
  chunk_method: ParseMethod;
  parser_config?: Record<string, unknown>;
  document_count: number;
  chunk_count: number;
  token_count?: number;
  similarity_threshold?: number;
  vector_similarity_weight?: number;
  top_k?: number;
  rerank_model?: string | null;
  permission?: 'me' | 'team';
  created_by?: string;
  create_time?: number;
  update_time?: number;
  status?: '1' | '0';
  tags?: string[];
}

export interface KbDocument {
  id: string;
  kb_id: string;
  name: string;
  location?: string;
  type: string;
  size: number;
  chunk_count: number;
  token_count?: number;
  progress: number;
  progress_msg?: string;
  run: DocRunStatus;
  parser_id?: ParseMethod;
  parser_config?: Record<string, unknown>;
  source_type?: string;
  created_by?: string;
  create_time?: number;
  update_time?: number;
  thumbnail?: string | null;
  meta_fields?: Record<string, unknown>;
}

export interface Chunk {
  id: string;
  content_with_weight: string;
  document_id: string;
  document_keyword?: string;
  dataset_id?: string;
  important_kwd?: string[];
  question_kwd?: string[];
  available_int?: number;
  positions?: Array<[number, number, number, number, number]>;
  vector_similarity?: number;
  term_similarity?: number;
  similarity?: number;
  rerank_score?: number;
  index?: number;
}

export interface RetrievalSettings {
  dataset_ids: string[];
  question: string;
  page?: number;
  page_size?: number;
  similarity_threshold: number;
  vector_similarity_weight: number;
  top_k: number;
  rerank_id?: string | null;
  keyword?: boolean;
  highlight?: boolean;
  doc_ids?: string[];
}

export interface RetrievalResult {
  total: number;
  chunks: Chunk[];
  doc_aggs?: Array<{ doc_id: string; doc_name: string; count: number }>;
  keywords?: string[];
  elapsed_ms?: number;
}

export type ModelKind = 'chat' | 'embedding' | 'rerank' | 'asr' | 'tts' | 'ocr' | 'vision' | 'speech2text';

export interface ModelProvider {
  name: string;
  label: string;
  kind: string;
  status: 'added' | 'available';
  logo?: string;
  /** False for the engine's own in-process model, which cannot be removed. Absent means unknown. */
  removable?: boolean;
  instances: ProviderInstance[];
}

/** An addable provider, as the engine describes it: how it would be reached, and by which backend. */
export interface ProviderCatalogEntry {
  name: string;
  label: string;
  /** Well-known endpoint, or '' when the address carries account-specific parts (Azure, a gateway). */
  base_url: string;
  /** 'openai' — this engine can call it; 'go' — only the preserved Go backend has the driver. */
  engine: 'openai' | 'go';
  note?: string;
  configured?: boolean;
}

export interface ProviderInstance {
  id: string;
  provider: string;
  instance_name: string;
  api_base?: string;
  status: 'connected' | 'unverified' | 'error';
  models: ProviderModel[];
  has_api_key: boolean;
}

export interface ProviderModel {
  id: string;
  name: string;
  model_type: ModelKind | ModelKind[];
  status: 'active' | 'inactive';
  max_tokens?: number;
  context_length?: number;
  tags?: string[];
}

export interface ChatAssistant {
  id: string;
  name: string;
  description?: string;
  avatar?: string | null;
  dataset_ids: string[];
  llm: {
    model_name?: string;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
  };
  prompt?: {
    similarity_threshold?: number;
    keywords_similarity_weight?: number;
    top_n?: number;
    top_k?: number;
    empty_response?: string;
    opener?: string;
    show_quote?: boolean;
    system?: string;
    rerank_id?: string;
    variables?: Array<{ key: string; optional?: boolean }>;
  };
  create_time?: number;
  update_time?: number;
}

export interface ChatSession {
  id: string;
  chat_id: string;
  name: string;
  create_time?: number;
  update_time?: number;
}

export interface Citation {
  chunk_id: string;
  doc_id: string;
  doc_name: string;
  content: string;
  similarity?: number;
  vector_similarity?: number;
  term_similarity?: number;
  positions?: unknown;
  index?: number;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  reference?: Citation[];
  created_at?: number;
  /** Present on user turns that ran the toolkit (web search, code executor). */
  tool_calls?: Array<{ name: string; summary?: string; elapsed_ms?: number }>;
  feedback?: 'up' | 'down' | null;
  latency_ms?: number;
  tokens?: number;
}

export type AgentNodeKind =
  | 'begin'
  | 'retrieval'
  | 'generate'
  | 'message'
  | 'categorize'
  | 'switch'
  | 'code'
  | 'agent'
  | 'tool'
  | 'mcp'
  | 'iteration'
  | 'loop'
  | 'wikipedia'
  | 'websearch'
  | 'docs';

export interface AgentNode {
  id: string;
  kind: AgentNodeKind;
  label: string;
  x: number;
  y: number;
  config?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
}

export interface AgentEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

export interface Agent {
  id: string;
  title: string;
  description?: string;
  avatar?: string | null;
  dsl: {
    graph: { nodes: AgentNode[]; edges: AgentEdge[] };
    components?: Record<string, unknown>;
    globals?: Record<string, unknown>;
  };
  permission?: 'me' | 'team';
  create_time?: number;
  update_time?: number;
  tags?: string[];
  status?: 'draft' | 'published';
  /** Run counters shown in the console before the first live execution. */
  run_count?: number;
}

export interface AgentTemplate {
  id: string;
  title: string;
  description: string;
  category: string;
  avatar?: string;
  dsl?: Agent['dsl'];
}

export interface Connector {
  id: string;
  name: string;
  source_type: string;
  status: 'connected' | 'syncing' | 'error' | 'paused';
  dataset_ids: string[];
  schedule?: string;
  last_sync_at?: number;
  documents_synced?: number;
  error?: string;
  message?: string;
}

/** One selectable data source as the engine describes it: whether it can pull, and which fields to show. */
export interface ConnectorSource {
  source_type: string;
  pull: boolean;
  needs: string;
  fields: Array<{ key: string; label: string; hint?: string; kind?: 'text' | 'secret' | 'lines' | 'bool'; required?: boolean }>;
}

export interface ApiToken {
  id: string;
  token: string;
  name: string;
  create_date?: string;
  create_time?: number;
  last_used_at?: number;
  tenant_id?: string;
}

export interface SystemInfo {
  version: string;
  build: string;
  doc_engine?: string;
  storage?: string;
  database?: string;
  kvstore?: string;
  os?: string;
}

export interface McpServer {
  id: string;
  name: string;
  url: string;
  transport: 'sse' | 'streamable-http';
  enabled: boolean;
  tools?: Array<{ name: string; description?: string }>;
  last_check_at?: number;
  status?: 'ok' | 'error';
}

export interface MemoryRecord {
  id: string;
  name: string;
  description?: string;
  memory_type: 'raw' | 'semantic';
  message_count: number;
  storage_type?: string;
  create_time?: number;
}

export interface DashboardMetric {
  key: string;
  label: string;
  value: number;
  delta?: number;
  unit?: string;
  series?: number[];
  hint?: string;
}

export interface ActivityEvent {
  id: string;
  kind: 'ingest' | 'chat' | 'agent' | 'model' | 'connector' | 'system';
  title: string;
  detail?: string;
  at: number;
  status: 'ok' | 'warn' | 'error' | 'running';
}

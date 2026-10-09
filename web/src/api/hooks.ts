/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Query layer: key factories plus the read/write hooks the console pages consume.
 *
 * Convention inherited from upstream and kept deliberately: every `useQuery` and every
 * `invalidateQueries` references the same `as const` key factory, so a page can never drift
 * from the cache key it invalidates.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import { toast } from '@/components/ui/toaster';
import type {
  Agent,
  AgentTemplate,
  ApiToken,
  ChatAssistant,
  ChatMessage,
  ChatSession,
  Chunk,
  Connector,
  ConnectorSource,
  KbDocument,
  KnowledgeBase,
  McpServer,
  MemoryRecord,
  ModelProvider,
  ProviderCatalogEntry,
  SystemInfo,
} from '@/api/types';

/* ------------------------------------------------------------------ key factories */

export const SessionKeys = {
  user: () => ['session', 'user'] as const,
  version: () => ['session', 'version'] as const,
  tokens: () => ['session', 'tokens'] as const,
};

export const KnowledgeKeys = {
  list: (params?: Record<string, unknown>) => ['knowledge', 'list', params ?? {}] as const,
  detail: (id: string) => ['knowledge', 'detail', id] as const,
  summary: (id: string) => ['knowledge', 'summary', id] as const,
  ingestions: (id: string) => ['knowledge', 'ingestions', id] as const,
  metadata: (id: string) => ['knowledge', 'metadata', id] as const,
  graph: (id: string) => ['knowledge', 'graph', id] as const,
  documents: (id: string, params?: Record<string, unknown>) =>
    ['knowledge', id, 'documents', params ?? {}] as const,
  document: (id: string, docId: string) => ['knowledge', id, 'document', docId] as const,
  chunks: (id: string, docId: string, params?: Record<string, unknown>) =>
    ['knowledge', id, 'document', docId, 'chunks', params ?? {}] as const,
  tags: () => ['knowledge', 'tags'] as const,
};

export const RetrievalKeys = {
  result: (params: Record<string, unknown>) => ['retrieval', 'result', params] as const,
};

export const ChatKeys = {
  assistants: () => ['chat', 'assistants'] as const,
  assistant: (id: string) => ['chat', 'assistant', id] as const,
  sessions: (id: string) => ['chat', id, 'sessions'] as const,
  session: (chatId: string, sessionId: string) => ['chat', chatId, 'session', sessionId] as const,
};

export const AgentKeys = {
  list: () => ['agents', 'list'] as const,
  detail: (id: string) => ['agents', 'detail', id] as const,
  templates: () => ['agents', 'templates'] as const,
  versions: (id: string) => ['agents', id, 'versions'] as const,
};

export const ModelKeys = {
  providers: (params?: Record<string, unknown>) => ['models', 'providers', params ?? {}] as const,
  catalog: () => ['models', 'catalog'] as const,
  instances: (provider: string) => ['models', 'provider', provider, 'instances'] as const,
  instance: (provider: string, instance: string) => ['models', 'provider', provider, 'instance', instance] as const,
  allModels: () => ['models', 'all'] as const,
  tools: () => ['models', 'tools'] as const,
  defaultModel: () => ['models', 'default'] as const,
};

export const SystemKeys = {
  connectors: () => ['system', 'connectors'] as const,
  connectorSources: () => ['system', 'connector-sources'] as const,
  connector: (id: string) => ['system', 'connectors', id] as const,
  mcp: () => ['system', 'mcp'] as const,
  memory: () => ['system', 'memory'] as const,
  tokens: () => ['system', 'tokens'] as const,
  userModels: () => ['system', 'user-models'] as const,
};

/* ------------------------------------------------------------------ session */

export function useSystemInfo() {
  return useQuery({
    queryKey: SessionKeys.version(),
    queryFn: () => api.get<SystemInfo>(endpoints.systemVersion),
    staleTime: 5 * 60_000,
  });
}

export function useSessionUser() {
  return useQuery({
    queryKey: SessionKeys.user(),
    queryFn: () => api.get<Record<string, unknown>>(endpoints.userInfo),
    staleTime: 5 * 60_000,
  });
}

export function useAvailableModels() {
  return useQuery({
    queryKey: SystemKeys.userModels(),
    queryFn: () =>
      api.get<{ chat: string[]; embedding: string[]; rerank: string[] }>(endpoints.userModels),
    staleTime: 5 * 60_000,
  });
}

/* ------------------------------------------------------------------ knowledge bases */

export function useKnowledgeBases(params?: { keyword?: string; page?: number; page_size?: number }) {
  return useQuery({
    queryKey: KnowledgeKeys.list(params),
    queryFn: () => api.list<KnowledgeBase>(endpoints.kbList, { params }),
  });
}

export function useKnowledgeBase(id?: string) {
  return useQuery({
    queryKey: KnowledgeKeys.detail(id ?? ''),
    queryFn: () => api.get<KnowledgeBase>(endpoints.kbDetail(id as string)),
    enabled: Boolean(id),
  });
}

export interface IngestionSummary {
  total: number;
  done: number;
  running: number;
  failed: number;
  unstart: number;
  chunks: number;
  tokens: number;
}

export function useIngestionSummary(id?: string) {
  return useQuery({
    queryKey: KnowledgeKeys.summary(id ?? ''),
    queryFn: () => api.get<IngestionSummary>(endpoints.kbIngestionSummary(id as string)),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.running ? 4000 : false),
  });
}

export function useKbTags() {
  return useQuery({
    queryKey: KnowledgeKeys.tags(),
    queryFn: () => api.get<Record<string, number>>(endpoints.kbTagAggregation),
    staleTime: 60_000,
  });
}

export function useCreateKnowledgeBase() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<KnowledgeBase[]>(endpoints.createKb, body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['knowledge'] });
      toast({ title: 'Knowledge base created', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not create the knowledge base', description: error.message, variant: 'error' }),
  });
}

export function useUpdateKnowledgeBase() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put<boolean>(endpoints.kbUpdate(id), body),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ['knowledge'] });
      client.invalidateQueries({ queryKey: KnowledgeKeys.detail(variables.id) });
      toast({ title: 'Settings saved', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not save', description: error.message, variant: 'error' }),
  });
}

export function useDeleteKnowledgeBase() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.delete<boolean>(endpoints.removeKb, { ids }),
    onSuccess: (_data, ids) => {
      // Drop every cached view of the deleted bases first. Invalidating them instead made each one
      // refetch an id the engine had just removed, so the screen held its skeleton on 404s until a
      // manual refresh.
      ids.forEach((id) =>
        client.removeQueries({ predicate: (query) => query.queryKey.some((part) => part === id) }),
      );
      client.invalidateQueries({ queryKey: ['knowledge'] });
      toast({ title: 'Knowledge base deleted', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not delete', description: error.message, variant: 'error' }),
  });
}

/* ------------------------------------------------------------------ documents */

export function useDocuments(
  kbId?: string,
  params?: {
    /** The live handler reads `keywords`; keep it primary. `keyword` is accepted by the demo transport too. */
    keywords?: string;
    keyword?: string;
    page?: number;
    page_size?: number;
    run?: string;
    orderby?: string;
  },
) {
  return useQuery({
    queryKey: KnowledgeKeys.documents(kbId ?? '', params),
    queryFn: () => api.list<KbDocument>(endpoints.documentList(kbId as string), { params }),
    enabled: Boolean(kbId),
    refetchInterval: (query) =>
      query.state.data?.items?.some((doc) => doc.run === 'RUNNING') ? 3000 : false,
  });
}

export function useDocument(kbId?: string, docId?: string) {
  return useQuery({
    queryKey: KnowledgeKeys.document(kbId ?? '', docId ?? ''),
    queryFn: () => api.get<KbDocument>(endpoints.documentDetail(kbId as string, docId as string)),
    enabled: Boolean(kbId && docId),
  });
}

export function useDocumentChunks(
  kbId?: string,
  docId?: string,
  params?: { page?: number; page_size?: number },
) {
  return useQuery({
    queryKey: KnowledgeKeys.chunks(kbId ?? '', docId ?? '', params),
    queryFn: () =>
      api.list<Chunk>(endpoints.documentChunks(kbId as string, docId as string), { params }),
    enabled: Boolean(kbId && docId),
  });
}

export function useUploadDocuments() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ kbId, files = [], names = [] }: { kbId: string; files?: File[]; names?: string[] }) => {
      // A real file has bytes; a bare name does not. Only the former can be parsed.
      if (files.length > 0) {
        const form = new FormData();
        files.forEach((file) => form.append('file', file, file.name));
        return api.upload<unknown>(endpoints.documentUpload(kbId), form);
      }
      return api.post<unknown>(endpoints.documentUpload(kbId), { names });
    },
    onSuccess: (_data, variables) => {
      const count = (variables.files?.length ?? 0) + (variables.names?.length ?? 0);
      client.invalidateQueries({ queryKey: KnowledgeKeys.documents(variables.kbId) });
      client.invalidateQueries({ queryKey: KnowledgeKeys.list() });
      toast({
        title: `${count} file${count === 1 ? '' : 's'} added`,
        description: 'Parsing starts when you run ingestion.',
        variant: 'success',
      });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Upload failed', description: error.message, variant: 'error' }),
  });
}

export function useDeleteDocuments() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ kbId, ids }: { kbId: string; ids: string[] }) =>
      api.delete<boolean>(endpoints.documentDelete(kbId), { ids }),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: KnowledgeKeys.documents(variables.kbId) });
      toast({ title: 'Documents removed', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not remove documents', description: error.message, variant: 'error' }),
  });
}

export function useStartIngestion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ kbId, documentIds }: { kbId: string; documentIds: string[] }) =>
      api.post<boolean>(endpoints.documentIngest, { kb_id: kbId, document_ids: documentIds }),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: KnowledgeKeys.documents(variables.kbId) });
      client.invalidateQueries({ queryKey: KnowledgeKeys.summary(variables.kbId) });
      toast({
        title: 'Ingestion queued',
        description: `${variables.documentIds.length} document${variables.documentIds.length === 1 ? '' : 's'} entering the pipeline.`,
        variant: 'success',
      });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not start ingestion', description: error.message, variant: 'error' }),
  });
}

export function useUpdateDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      kbId,
      docId,
      body,
    }: {
      kbId: string;
      docId: string;
      body: Record<string, unknown>;
    }) => api.put<boolean>(endpoints.documentDetail(kbId, docId), body),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: KnowledgeKeys.documents(variables.kbId) });
      client.invalidateQueries({ queryKey: KnowledgeKeys.document(variables.kbId, variables.docId) });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not update the document', description: error.message, variant: 'error' }),
  });
}

/* ------------------------------------------------------------------ retrieval */

export function useRetrievalPreview(input: Record<string, unknown> | null) {
  return useQuery({
    queryKey: RetrievalKeys.result(input ?? {}),
    queryFn: () =>
      api.post<{ total: number; chunks: Chunk[]; doc_aggs: Array<{ doc_id: string; doc_name: string; count: number }>; keywords: string[]; elapsed_ms?: number }>(
        endpoints.retrievalTest,
        input,
      ),
    enabled: Boolean(input && (input as { question?: string }).question),
    staleTime: 0,
    gcTime: 0,
  });
}

export function useRunRetrieval() {
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ total: number; chunks: Chunk[]; doc_aggs: Array<{ doc_id: string; doc_name: string; count: number }>; keywords: string[]; elapsed_ms?: number }>(
        endpoints.retrievalTest,
        body,
      ),
    onError: (error: ApiError) =>
      toast({ title: 'Retrieval failed', description: error.message, variant: 'error' }),
  });
}

/* ------------------------------------------------------------------ chat */

export function useAssistants() {
  return useQuery({
    queryKey: ChatKeys.assistants(),
    queryFn: () => api.list<ChatAssistant>(endpoints.listChats),
  });
}

export function useAssistant(id?: string) {
  return useQuery({
    queryKey: ChatKeys.assistant(id ?? ''),
    queryFn: () => api.get<ChatAssistant>(endpoints.chatDetail(id as string)),
    enabled: Boolean(id),
  });
}

export function useUpdateAssistant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put<boolean>(endpoints.chatUpdate(id), body),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ChatKeys.assistant(variables.id) });
      client.invalidateQueries({ queryKey: ChatKeys.assistants() });
      toast({ title: 'Assistant updated', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not update the assistant', description: error.message, variant: 'error' }),
  });
}

export function useCreateAssistant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<ChatAssistant>(endpoints.createChat, body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ChatKeys.assistants() });
      toast({ title: 'Assistant created', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not create the assistant', description: error.message, variant: 'error' }),
  });
}

export function useDeleteAssistant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<boolean>(endpoints.chatDelete(id)),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ChatKeys.assistants() });
      toast({ title: 'Assistant deleted', variant: 'success' });
    },
  });
}

export function useSessions(chatId?: string) {
  return useQuery({
    queryKey: ChatKeys.sessions(chatId ?? ''),
    queryFn: () => api.list<ChatSession>(endpoints.sessionList(chatId as string)),
    enabled: Boolean(chatId),
  });
}

export function useSession(chatId?: string, sessionId?: string) {
  return useQuery({
    queryKey: ChatKeys.session(chatId ?? '', sessionId ?? ''),
    queryFn: () =>
      api.get<ChatSession & { messages: ChatMessage[] }>(
        endpoints.sessionDetail(chatId as string, sessionId as string),
      ),
    enabled: Boolean(chatId && sessionId),
  });
}

export function useCreateSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, name }: { chatId: string; name: string }) =>
      api.post<ChatSession>(endpoints.sessionCreate(chatId), { name }),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ChatKeys.sessions(variables.chatId) });
    },
  });
}

export function useDeleteSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, sessionId }: { chatId: string; sessionId: string }) =>
      api.delete<boolean>(endpoints.sessionDelete(chatId, sessionId)),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ChatKeys.sessions(variables.chatId) });
      toast({ title: 'Conversation deleted', variant: 'success' });
    },
  });
}

/* ------------------------------------------------------------------ agents */

export function useAgents() {
  return useQuery({
    queryKey: AgentKeys.list(),
    queryFn: () => api.list<Agent>(endpoints.listAgents),
  });
}

export function useAgent(id?: string) {
  return useQuery({
    queryKey: AgentKeys.detail(id ?? ''),
    queryFn: () => api.get<Agent>(endpoints.agentDetail(id as string)),
    enabled: Boolean(id),
  });
}

export function useAgentTemplates() {
  return useQuery({
    queryKey: AgentKeys.templates(),
    queryFn: () => api.get<AgentTemplate[]>(endpoints.agentTemplates),
    staleTime: 5 * 60_000,
  });
}

export function useCreateAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<Agent>(endpoints.createAgent, body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: AgentKeys.list() });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not create the agent', description: error.message, variant: 'error' }),
  });
}

export function useUpdateAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put<boolean>(endpoints.agentUpdate(id), body),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: AgentKeys.detail(variables.id) });
      client.invalidateQueries({ queryKey: AgentKeys.list() });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not save the agent', description: error.message, variant: 'error' }),
  });
}

export function useDeleteAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<boolean>(endpoints.agentDelete(id)),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: AgentKeys.list() });
      toast({ title: 'Agent deleted', variant: 'success' });
    },
  });
}

/* ------------------------------------------------------------------ models */

export function useProviders(params?: { available?: boolean }) {
  return useQuery({
    queryKey: ModelKeys.providers(params),
    queryFn: () => api.get<ModelProvider[]>(endpoints.providers, { params }),
  });
}

export function useProviderInstances(provider?: string) {
  return useQuery({
    queryKey: ModelKeys.instances(provider ?? ''),
    queryFn: () => api.get<ModelProvider['instances']>(endpoints.providerInstances(provider as string)),
    enabled: Boolean(provider),
  });
}

/** The providers the engine says it can reach — the console does not hardcode a vendor list. */
export function useProviderCatalog() {
  return useQuery({
    queryKey: ModelKeys.catalog(),
    queryFn: () => api.get<ProviderCatalogEntry[]>(endpoints.providerCatalog),
    staleTime: 5 * 60_000,
  });
}

/**
 * Ask the endpoint which models it serves and enable them.
 *
 * Linking a provider with an empty model list leaves the engine on its built-in path, which reads
 * as the provider being ignored — this is the step that makes chat actually use it.
 */
export function useDiscoverModels() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, instance }: { provider: string; instance: string }) =>
      api.post<{ available: string[]; registered: string[]; kinds: string[] }>(
        endpoints.providerDiscoverModels(provider, instance),
        {},
      ),
    onSuccess: (data) => {
      client.invalidateQueries({ queryKey: ModelKeys.providers() });
      client.invalidateQueries({ queryKey: ModelKeys.allModels() });
      client.invalidateQueries({ queryKey: SystemKeys.userModels() });
      const found = data.registered.length;
      toast({
        title: found > 0 ? `Enabled ${found} model${found === 1 ? '' : 's'}` : 'No new chat models found',
        description:
          found > 0
            ? data.registered.join(', ')
            : `${data.available.length} model(s) answered at this endpoint — add one by name if it is an embedding or rerank model.`,
        variant: found > 0 ? 'success' : 'error',
      });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not fetch models', description: error.message, variant: 'error' }),
  });
}

export function useProviderConnectionTest() {
  return useMutation({
    mutationFn: (provider: string) =>
      api.get<{ status: string; elapsed_ms?: number }>(endpoints.providerConnection(provider)),
    onSuccess: (data) =>
      toast({
        title: data.status === 'ok' ? 'Connection verified' : 'Connection failed',
        description: data.elapsed_ms ? `Round trip ${data.elapsed_ms} ms` : undefined,
        variant: data.status === 'ok' ? 'success' : 'error',
      }),
    onError: (error: ApiError) =>
      toast({ title: 'Connection failed', description: error.message, variant: 'error' }),
  });
}

export function useAddInstance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, body }: { provider: string; body: Record<string, unknown> }) =>
      api.post<boolean>(`${endpoints.providers}/${provider}/instances`, body),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ModelKeys.providers() });
      client.invalidateQueries({ queryKey: ModelKeys.instances(variables.provider) });
      toast({ title: 'Model provider connected', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not connect the provider', description: error.message, variant: 'error' }),
  });
}

/**
 * Remove a provider. The engine deletes its models with it and re-resolves any assistant pinned to one of
 * them, so the count it returns is worth showing — a removal is not always a no-op for chats.
 */
export function useDeleteProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) =>
      api.delete<{ provider: string; models_removed: number; assistants_repinned: number }>(
        endpoints.providerDelete(provider),
      ),
    onSuccess: (data, provider) => {
      client.invalidateQueries({ queryKey: ModelKeys.providers() });
      client.invalidateQueries({ queryKey: ModelKeys.allModels() });
      // The chat header's model menu reads this: a removed provider's models must leave it at once.
      client.invalidateQueries({ queryKey: SystemKeys.userModels() });
      toast({
        title: `Removed ${provider}`,
        description:
          `${data.models_removed} model${data.models_removed === 1 ? '' : 's'} deleted` +
          (data.assistants_repinned
            ? `, ${data.assistants_repinned} assistant${data.assistants_repinned === 1 ? '' : 's'} moved to the workspace's own model.`
            : '.'),
        variant: 'success',
      });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not remove the provider', description: error.message, variant: 'error' }),
  });
}

export function useAddProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<boolean>(endpoints.providers, body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ModelKeys.providers() });
      toast({ title: 'Provider added', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not add the provider', description: error.message, variant: 'error' }),
  });
}

export function useAllModels() {
  return useQuery({
    queryKey: ModelKeys.allModels(),
    queryFn: () => api.get<Array<{ name: string; model_type: string | string[]; provider?: string; tags?: string[] }>>(endpoints.allModels),
  });
}

export function useTools() {
  return useQuery({
    queryKey: ModelKeys.tools(),
    queryFn: () => api.get<Array<{ name: string; label: string; description: string }>>(endpoints.llmTools),
    staleTime: 5 * 60_000,
  });
}

/* ------------------------------------------------------------------ system */

export function useConnectors() {
  return useQuery({
    queryKey: SystemKeys.connectors(),
    queryFn: () => api.get<Connector[]>(endpoints.connectorList),
  });
}

export function useConnectorSources() {
  return useQuery({
    queryKey: SystemKeys.connectorSources(),
    queryFn: () => api.get<ConnectorSource[]>(endpoints.connectorSources),
    staleTime: 5 * 60_000,
  });
}

export function useTestConnector() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; message: string }>(endpoints.connectorTest(id)),
    onSuccess: (data) => {
      client.invalidateQueries({ queryKey: SystemKeys.connectors() });
      toast({
        title: data.ok ? 'Source reachable' : 'Source unreachable',
        description: data.message,
        variant: data.ok ? 'success' : 'error',
      });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Connector test failed', description: error.message, variant: 'error' }),
  });
}

export function useMcpServers() {
  return useQuery({
    queryKey: SystemKeys.mcp(),
    queryFn: () => api.get<McpServer[]>(endpoints.mcpServers),
  });
}

export function useMemories() {
  return useQuery({
    queryKey: SystemKeys.memory(),
    queryFn: () => api.get<MemoryRecord[]>(endpoints.memoryList),
  });
}

export function useApiTokens() {
  return useQuery({
    queryKey: SystemKeys.tokens(),
    queryFn: () => api.get<ApiToken[]>(endpoints.systemTokens),
  });
}

export function useCreateApiToken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<ApiToken>(endpoints.systemTokens, { name }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: SystemKeys.tokens() });
      toast({ title: 'API key created', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not create the key', description: error.message, variant: 'error' }),
  });
}

export function useDeleteApiToken() {
  const client = useQueryClient();
  return useMutation({
    // Keys are listed and revoked by id: the listing never returns the raw token value.
    mutationFn: (id: string) => api.delete<boolean>(endpoints.systemTokens, { id }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: SystemKeys.tokens() });
      toast({ title: 'API key revoked', variant: 'success' });
    },
  });
}

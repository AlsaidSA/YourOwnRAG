/*
 * Copyright 2026 OwnRAG contributors
 * Modified for OwnRAG from the upstream Apache-2.0 project; see NOTICE.
 * Copyright 2026 The InfiniFlow Authors. Licensed under the Apache License, Version 2.0.
 *
 * Endpoint map. These paths mirror the upstream HTTP contract exactly — the OwnRAG
 * console is a new client of the preserved backend, not a new protocol. `/api/v1/*` and `/v1/*`
 * are served by the API server (default :9380); the admin surface lives on :9381.
 */

const webAPI = `/v1`;
const restAPIv1 = `/api/v1`;

export { restAPIv1, webAPI };

export const endpoints = {
  // ---- session ----
  login: `${restAPIv1}/auth/login`,
  logout: `${restAPIv1}/auth/logout`,
  register: `${restAPIv1}/users`,
  userInfo: `${restAPIv1}/users/me`,
  userModels: `${restAPIv1}/users/me/models`,
  loginChannels: `${restAPIv1}/auth/login/channels`,

  // ---- tenant / team ----
  listTenant: `${restAPIv1}/tenants`,
  tenantUsers: (tenantId: string) => `${restAPIv1}/tenants/${tenantId}/users`,
  tenantUser: (tenantId: string, userId: string) => `${restAPIv1}/tenants/${tenantId}/users/${userId}`,
  invitations: (tenantId: string) => `${restAPIv1}/tenants/${tenantId}/invitations`,
  invitation: (tenantId: string, inviteId: string) => `${restAPIv1}/tenants/${tenantId}/invitations/${inviteId}`,
  invitationResend: (tenantId: string, inviteId: string) =>
    `${restAPIv1}/tenants/${tenantId}/invitations/${inviteId}/resend`,
  invitationInfo: (token: string) => `${restAPIv1}/invitations/${encodeURIComponent(token)}`,
  invitationAccept: (token: string) => `${restAPIv1}/invitations/${encodeURIComponent(token)}/accept`,

  // ---- knowledge bases (upstream resource name: datasets) ----
  kbList: `${restAPIv1}/datasets`,
  createKb: `${restAPIv1}/datasets`,
  removeKb: `${restAPIv1}/datasets`,
  kbDetail: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}`,
  kbUpdate: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}`,
  kbIngestionSummary: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}/ingestions/summary`,
  kbIngestionLogs: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}/ingestions`,
  kbTags: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}/tags`,
  kbTagAggregation: `${restAPIv1}/datasets/tags/aggregation`,
  kbMetadataConfig: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}/metadata/config`,
  kbMetadataSummary: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}/metadata/summary`,
  kbGraph: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}/graph`,
  kbCheckEmbedding: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}/embedding/check`,
  kbNavigation: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}/navigation`,
  retrievalTest: `${restAPIv1}/datasets/search`,
  listPipelines: `${restAPIv1}/pipelines?type=builtin`,

  // ---- documents ----
  documentList: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}/documents`,
  documentDelete: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}/documents`,
  documentDetail: (datasetId: string, documentId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/${documentId}`,
  documentChunks: (datasetId: string, documentId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/${documentId}/chunks`,
  documentChunk: (datasetId: string, documentId: string, chunkId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/${documentId}/chunks/${chunkId}`,
  documentGraph: (datasetId: string, documentId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/${documentId}/structure/graph`,
  documentClaims: (datasetId: string, documentId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/${documentId}/structure/claims`,
  documentStatus: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}/documents`,
  documentParser: (datasetId: string, documentId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/${documentId}`,
  documentIngest: `${restAPIv1}/documents/ingest`,
  documentUpload: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}/documents`,
  documentFile: `${restAPIv1}/documents`,
  documentFileDownload: (datasetId: string, documentId: string) =>
    `${restAPIv1}/datasets/${datasetId}/documents/${documentId}`,
  thumbnails: `${restAPIv1}/thumbnails`,
  webCrawl: (datasetId: string) => `${restAPIv1}/datasets/${datasetId}/documents`,

  // ---- chat (assistants + sessions) ----
  listChats: `${restAPIv1}/chats`,
  createChat: `${restAPIv1}/chats`,
  chatDetail: (chatId: string) => `${restAPIv1}/chats/${chatId}`,
  chatUpdate: (chatId: string) => `${restAPIv1}/chats/${chatId}`,
  chatDelete: (chatId: string) => `${restAPIv1}/chats/${chatId}`,
  sessionList: (chatId: string) => `${restAPIv1}/chats/${chatId}/sessions`,
  sessionCreate: (chatId: string) => `${restAPIv1}/chats/${chatId}/sessions`,
  sessionDetail: (chatId: string, sessionId: string) =>
    `${restAPIv1}/chats/${chatId}/sessions/${sessionId}`,
  completion: `${restAPIv1}/chat/completions`,
  relatedQuestions: `${restAPIv1}/chat/recommendation`,
  mindmap: `${restAPIv1}/chat/mindmap`,
  audioSpeech: `${restAPIv1}/chat/audio/speech`,
  audioTranscription: `${restAPIv1}/chat/audio/transcription`,
  messageFeedback: (chatId: string, sessionId: string, msgId: string) =>
    `${restAPIv1}/chats/${chatId}/sessions/${sessionId}/messages/${msgId}`,
  sessionDelete: (chatId: string, sessionId: string) =>
    `${restAPIv1}/chats/${chatId}/sessions/${sessionId}`,

  // ---- agents (the workflow/agent builder) ----
  listAgents: `${restAPIv1}/agents`,
  createAgent: `${restAPIv1}/agents`,
  agentDetail: (agentId: string) => `${restAPIv1}/agents/${agentId}`,
  agentUpdate: (agentId: string) => `${restAPIv1}/agents/${agentId}`,
  agentDelete: (agentId: string) => `${restAPIv1}/agents/${agentId}`,
  agentReset: (agentId: string) => `${restAPIv1}/agents/${agentId}/reset`,
  agentTemplates: `${restAPIv1}/agents/templates`,
  agentCompletion: `${restAPIv1}/agents/chat/completions`,
  agentInputForm: (agentId: string, componentId: string) =>
    `${restAPIv1}/agents/${agentId}/components/${componentId}/input-form`,
  agentVersions: (agentId: string) => `${restAPIv1}/agents/${agentId}/versions`,
  agentVersion: (agentId: string, versionId: string) =>
    `${restAPIv1}/agents/${agentId}/versions/${versionId}`,
  agentLogs: (agentId: string) => `${restAPIv1}/agents/${agentId}/logs`,
  agentSessions: (agentId: string) => `${restAPIv1}/agents/${agentId}/sessions`,
  agentWebhookTest: (agentId: string) => `${restAPIv1}/agents/${agentId}/webhook/test`,
  agentWebhookLogs: (agentId: string) => `${restAPIv1}/agents/${agentId}/webhook/logs`,
  agentPrompt: `${restAPIv1}/agents/prompts`,
  agentUpload: (agentId: string) => `${restAPIv1}/agents/${agentId}/upload`,
  canvasInputElements: `${webAPI}/canvas/input_elements`,
  canvasSessionList: (canvasId: string) => `${webAPI}/canvas/${canvasId}/sessions`,
  taskCancel: (taskId: string) => `${restAPIv1}/tasks/${taskId}/cancel`,
  dbTest: `${restAPIv1}/agents/test_db_connection`,

  // ---- models & providers (bring your own models) ----
  providers: `${restAPIv1}/providers`,
  /** The engine's own list of addable providers — the console does not hardcode vendors. */
  providerCatalog: `${restAPIv1}/providers/catalog`,
  providerInstance: (provider: string, instance: string) =>
    `${restAPIv1}/providers/${provider}/instances/${instance}`,
  providerInstances: (provider: string) => `${restAPIv1}/providers/${provider}/instances`,
  /** Remove a provider and the models it serves. The engine refuses its own in-process provider. */
  providerDelete: (provider: string) => `${restAPIv1}/providers/${provider}`,
  providerDiscoverModels: (provider: string, instance: string) =>
    `${restAPIv1}/providers/${provider}/instances/${instance}/models/discover`,
  providerConnection: (provider: string) => `${restAPIv1}/providers/${provider}/connection`,
  providerModels: (provider: string) => `${restAPIv1}/providers/${provider}/models`,
  instanceModels: (provider: string, instance: string) =>
    `${restAPIv1}/providers/${provider}/instances/${instance}/models`,
  instanceModel: (provider: string, instance: string, model: string) =>
    `${restAPIv1}/providers/${provider}/instances/${instance}/models/${model}`,
  instanceBalance: (provider: string, instance: string) =>
    `${restAPIv1}/providers/${provider}/instances/${instance}/balance`,
  allModels: `${restAPIv1}/models`,
  defaultModel: `${restAPIv1}/models/default`,
  llmTools: `${restAPIv1}/plugin/tools`,

  // ---- retrieval / search ----
  searchList: `${restAPIv1}/searches`,
  searchDetail: (searchId: string) => `${restAPIv1}/searches/${searchId}`,
  searchCompletion: (searchId: string) => `${restAPIv1}/searches/${searchId}/completions`,
  searchbotsRetrievalTest: `${restAPIv1}/searchbots/retrieval_test`,
  searchbotsAsk: `${restAPIv1}/searchbots/ask`,
  difyRetrieval: `${restAPIv1}/dify/retrieval`,

  // ---- connectors / data sources ----
  connectorList: `${restAPIv1}/connectors`,
  connectorSources: `${restAPIv1}/connectors/sources`,
  connectorDetail: (id: string) => `${restAPIv1}/connectors/${id}`,
  connectorRebuild: (id: string) => `${restAPIv1}/connectors/${id}/rebuild`,
  connectorLogs: (id: string) => `${restAPIv1}/connectors/${id}/logs`,
  connectorTest: (id: string) => `${restAPIv1}/connectors/${id}/test`,
  connectorSyncLogs: `${restAPIv1}/connectors/sync_logs`,

  // ---- MCP ----
  mcpServers: `${restAPIv1}/mcp/servers`,
  mcpServer: (id: string) => `${restAPIv1}/mcp/servers/${id}`,

  // ---- files & workspace ----
  fileList: `${restAPIv1}/files`,
  fileUpload: `${restAPIv1}/files`,
  fileLinkToDatasets: `${restAPIv1}/files/link-to-datasets`,
  fileMove: `${restAPIv1}/files/move`,
  fileVersions: (fileId: string) => `${restAPIv1}/workspace-files/${fileId}/versions`,

  // ---- memory ----
  memoryList: `${restAPIv1}/memories`,
  memoryDetail: (id: string) => `${restAPIv1}/memories/${id}`,
  memoryConfig: (id: string) => `${restAPIv1}/memories/${id}/config`,

  // ---- system, keys, observability ----
  systemVersion: `${restAPIv1}/system/version`,
  systemConfig: `${restAPIv1}/system/config`,
  systemTokens: `${restAPIv1}/system/tokens`,
  langfuseKey: `${restAPIv1}/langfuse/api-key`,

  // ---- chat channels ----
  chatChannels: `${restAPIv1}/chat-channels`,
  chatChannel: (id: string) => `${restAPIv1}/chat-channels/${id}`,
  chatChannelRuntime: (id: string) => `${restAPIv1}/chat-channels/${id}/runtime`,
};

export type EndpointMap = typeof endpoints;

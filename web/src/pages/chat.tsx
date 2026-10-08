/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Chat: the grounded-assistant workspace for /chat, /chat/:chatId and
 * /chat/:chatId/:sessionId. A conversation rail, a streaming transcript and a first-class
 * citation inspector share the screen, with the URL as the single source of truth for the
 * selected assistant and session.
 */
import { useMutation } from '@tanstack/react-query';
import { MessageSquarePlus, PanelLeft, Plus, Settings, Sparkles } from 'lucide-react';
import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, isDemoMode } from '@/api/client';
import { streamChat } from '@/api/chat-stream';
import { endpoints } from '@/api/endpoints';
import { useAssistants, useAssistant, useCreateAssistant, useCreateSession, useSession } from '@/api/hooks';
import { PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { EmptyState, ErrorState, type ErrorLike } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { AssistantSettings } from '@/pages/chat/assistant-settings';
import { CitationPanel, citationKey } from '@/pages/chat/citation-panel';
import { Composer } from '@/pages/chat/composer';
import { MessageList } from '@/pages/chat/message-list';
import type { FeedbackValue } from '@/pages/chat/message-item';
import { SessionList } from '@/pages/chat/session-list';
import { useAuthStore } from '@/store/auth';
import { shortId } from '@/lib/utils';
import type { ChatMessage, Citation } from '@/api/types';

interface StreamState {
  sessionId: string;
  question: string;
  userMessageId: string;
  assistantMessageId: string;
  text: string;
  citations: Citation[];
  thought: string | null;
  status: 'streaming' | 'done' | 'error';
  error: string | null;
  elapsedMs: number | null;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  React.useEffect(() => {
    const media = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(media.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

/** First-message title for a freshly created conversation. */
function titleFor(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New conversation';
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean;
}

export default function ChatPage() {
  const navigate = useNavigate();
  const params = useParams<{ chatId?: string; sessionId?: string }>();
  const chatId = params.chatId;
  const sessionId = params.sessionId;
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const assistantsQuery = useAssistants();
  const assistantQuery = useAssistant(chatId);
  const sessionQuery = useSession(chatId, sessionId);
  const createSession = useCreateSession();
  const createAssistant = useCreateAssistant();
  const userName = useAuthStore((state) => state.user?.nickname);

  const assistants = React.useMemo(() => assistantsQuery.data?.items ?? [], [assistantsQuery.data]);
  const assistant = assistantQuery.data ?? assistants.find((item) => item.id === chatId) ?? null;

  const [localMessages, setLocalMessages] = React.useState<ChatMessage[]>([]);
  const [streamState, setStreamState] = React.useState<StreamState | null>(null);
  const streamRef = React.useRef<StreamState | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const streamingSessionRef = React.useRef<string | null>(null);
  const localId = React.useRef(0);

  const [sessionsOpen, setSessionsOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [citationDrawerOpen, setCitationDrawerOpen] = React.useState(false);
  const [citationContext, setCitationContext] = React.useState<{ citations: Citation[] } | null>(null);
  const [selectedCitationKey, setSelectedCitationKey] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<Record<string, FeedbackValue>>({});

  const nextId = (prefix: string) => {
    localId.current += 1;
    return `${prefix}_${Date.now().toString(36)}_${localId.current}`;
  };

  /* ---- keep the URL pointed at a real assistant ---- */
  React.useEffect(() => {
    if (!chatId && assistants.length > 0) {
      navigate(`/chat/${assistants[0].id}`, { replace: true });
    }
  }, [chatId, assistants, navigate]);

  /* ---- reset transient turn state when the session changes ---- */
  React.useEffect(() => {
    if (streamingSessionRef.current && streamingSessionRef.current === sessionId) return;
    abortRef.current?.abort();
    abortRef.current = null;
    streamRef.current = null;
    streamingSessionRef.current = null;
    setStreamState(null);
    setLocalMessages([]);
    setCitationContext(null);
    setSelectedCitationKey(null);
  }, [sessionId]);

  const patchStream = (patch: Partial<StreamState>) => {
    if (!streamRef.current) return;
    streamRef.current = { ...streamRef.current, ...patch };
    setStreamState(streamRef.current);
  };

  const finalizeStream = React.useCallback(() => {
    const current = streamRef.current;
    streamRef.current = null;
    abortRef.current = null;
    streamingSessionRef.current = null;
    setStreamState(null);
    if (!current) return;
    const userMessage: ChatMessage = {
      id: current.userMessageId,
      session_id: current.sessionId,
      role: 'user',
      content: current.question,
      created_at: Date.now(),
    };
    const assistantMessage: ChatMessage = {
      id: current.assistantMessageId,
      session_id: current.sessionId,
      role: 'assistant',
      content: current.text,
      reference: current.citations.length ? current.citations : undefined,
      created_at: Date.now(),
      latency_ms: current.elapsedMs ?? undefined,
    };
    setLocalMessages((previous) => [...previous, userMessage, assistantMessage]);
  }, []);

  const streamAnswer = React.useCallback(
    async (target: string, question: string) => {
      const state: StreamState = {
        sessionId: target,
        question,
        userMessageId: nextId('msg_u'),
        assistantMessageId: nextId('msg_a'),
        text: '',
        citations: [],
        thought: null,
        status: 'streaming',
        error: null,
        elapsedMs: null,
      };
      streamRef.current = state;
      streamingSessionRef.current = target;
      setStreamState(state);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        for await (const delta of streamChat({
          body: { chat_id: chatId, session_id: target, question, stream: true, platform: 'chat' },
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) break;
          if (delta.kind === 'thought') {
            patchStream({ thought: delta.text ?? null });
          } else if (delta.kind === 'reference') {
            patchStream({ citations: delta.citations ?? [] });
          } else if (delta.kind === 'delta') {
            const current = streamRef.current;
            if (current) patchStream({ text: current.text + (delta.text ?? '') });
          } else if (delta.kind === 'done') {
            patchStream({ status: 'done', elapsedMs: delta.elapsedMs ?? null });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The answer failed mid-stream.';
        patchStream({ status: 'error', error: message });
        toast({ title: 'The answer stopped early', description: message, variant: 'error' });
        return;
      }
      finalizeStream();
    },
    [chatId, finalizeStream],
  );

  const send = React.useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || !chatId || streamRef.current?.status === 'streaming') return;
      let target: string | null = sessionId ?? null;
      if (!target) {
        try {
          const created = await createSession.mutateAsync({ chatId, name: titleFor(question) });
          target = created?.id ?? null;
        } catch {
          return; // the mutation surfaces its own copy
        }
        if (!target) {
          toast({
            title: 'Could not start the conversation',
            description: 'The API did not return a session id.',
            variant: 'error',
          });
          return;
        }
        navigate(`/chat/${chatId}/${target}`, { replace: true });
      }
      await streamAnswer(target, question);
    },
    [chatId, sessionId, createSession, navigate, streamAnswer],
  );

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retryStream = React.useCallback(() => {
    const question = streamRef.current?.question;
    if (question) void send(question);
  }, [send]);

  /* ---- message feedback ---- */
  const feedbackMutation = useMutation({
    mutationFn: ({ chat, session, message, value }: { chat: string; session: string; message: string; value: FeedbackValue }) =>
      api.put<boolean>(endpoints.messageFeedback(chat, session, message), {
        feedback: value ?? '',
      }),
    onSuccess: () => toast({ title: 'Feedback saved', variant: 'success' }),
    onError: (error: unknown) => {
      if (isDemoMode()) {
        toast({
          title: 'Feedback kept for this session',
          description: 'The demo corpus is read-only, so nothing was written to a backend.',
          variant: 'info',
        });
        return;
      }
      toast({
        title: 'Could not save feedback',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    },
  });

  const handleFeedback = (message: ChatMessage, value: FeedbackValue) => {
    setFeedback((previous) => ({ ...previous, [message.id]: value }));
    if (chatId && message.session_id) {
      feedbackMutation.mutate({ chat: chatId, session: message.session_id, message: message.id, value });
    }
  };

  /* ---- derived transcript & citations ---- */
  const serverMessages = React.useMemo(() => sessionQuery.data?.messages ?? [], [sessionQuery.data]);

  const renderedMessages = React.useMemo(() => {
    const list: ChatMessage[] = [...serverMessages, ...localMessages];
    if (streamState && streamState.sessionId === sessionId) {
      list.push({
        id: streamState.userMessageId,
        session_id: streamState.sessionId,
        role: 'user',
        content: streamState.question,
      });
      list.push({
        id: streamState.assistantMessageId,
        session_id: streamState.sessionId,
        role: 'assistant',
        content: streamState.text,
        reference: streamState.citations.length ? streamState.citations : undefined,
        latency_ms: streamState.elapsedMs ?? undefined,
      });
    }
    return list;
  }, [serverMessages, localMessages, streamState, sessionId]);

  const lastAssistantMessage = React.useMemo(() => {
    for (let index = renderedMessages.length - 1; index >= 0; index -= 1) {
      const message = renderedMessages[index];
      if (message.role === 'assistant' && message.reference && message.reference.length > 0) return message;
    }
    return null;
  }, [renderedMessages]);

  const panelCitations = React.useMemo(
    () => citationContext?.citations ?? lastAssistantMessage?.reference ?? [],
    [citationContext, lastAssistantMessage],
  );

  const panelSelectedKey = React.useMemo(() => {
    if (panelCitations.length === 0) return null;
    if (selectedCitationKey && panelCitations.some((citation, index) => citationKey(citation, index) === selectedCitationKey)) {
      return selectedCitationKey;
    }
    return citationKey(panelCitations[0], 0);
  }, [panelCitations, selectedCitationKey]);

  const handleSelectCitation = (citation: Citation, citations: Citation[]) => {
    setCitationContext({ citations });
    setSelectedCitationKey(citationKey(citation, citations.indexOf(citation)));
    setCitationDrawerOpen(true);
  };

  /* ---- centre pane state ---- */
  const loading = (assistantsQuery.isLoading && !chatId) || (Boolean(sessionId) && sessionQuery.isLoading);

  const centreError = React.useMemo<ErrorLike | null>(() => {
    if (chatId && assistantQuery.isError) return assistantQuery.error;
    if (sessionId && sessionQuery.isError) return sessionQuery.error;
    return null;
  }, [chatId, assistantQuery.isError, assistantQuery.error, sessionId, sessionQuery.isError, sessionQuery.error]);

  const retryCentre = () => {
    if (assistantQuery.isError) void assistantQuery.refetch();
    if (sessionQuery.isError) void sessionQuery.refetch();
  };

  const startNewSession = async () => {
    if (!chatId) return;
    try {
      const created = await createSession.mutateAsync({ chatId, name: 'New conversation' });
      if (created?.id) navigate(`/chat/${chatId}/${created.id}`);
    } catch {
      // no-op: the mutation reports the failure
    }
  };

  const createFirstAssistant = async () => {
    try {
      const created = await createAssistant.mutateAsync({ name: 'New assistant', description: '', dataset_ids: [] });
      if (created?.id) navigate(`/chat/${created.id}`);
    } catch {
      // no-op: the mutation reports the failure
    }
  };

  const emptyState = !chatId ? (
    <EmptyState
      icon={<Sparkles />}
      title="Choose an assistant"
      description="Pick an assistant from the conversation rail to begin."
    />
  ) : !sessionId ? (
    <EmptyState
      icon={<MessageSquarePlus />}
      title={assistant ? `Ask ${assistant.name}` : 'Start a conversation'}
      description="Every answer resolves to the passages it used — open a citation to inspect the source."
      action={
        <Button
          variant="primary"
          size="sm"
          loading={createSession.isPending}
          onClick={() => void startNewSession()}
        >
          <Plus />
          New conversation
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={<MessageSquarePlus />}
      title={assistant ? `Ask ${assistant.name}` : 'Ask a question'}
      description="This conversation is empty. Ask a question to begin — every answer will cite the passages it used."
    />
  );

  /* ---- page-level guards ---- */
  if (assistantsQuery.isError && assistants.length === 0) {
    return (
      <>
        <PageHeader title="Chat" description="Grounded assistants with citations." />
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <ErrorState error={assistantsQuery.error} onRetry={() => void assistantsQuery.refetch()} />
        </div>
      </>
    );
  }

  if (assistantsQuery.isSuccess && assistants.length === 0) {
    return (
      <>
        <PageHeader title="Chat" description="Grounded assistants with citations." />
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState
            icon={<Sparkles />}
            title="No assistants yet"
            description="Create your first grounded assistant to start asking questions."
            action={
              <Button variant="primary" size="sm" loading={createAssistant.isPending} onClick={() => void createFirstAssistant()}>
                <Plus />
                Create assistant
              </Button>
            }
          />
        </div>
      </>
    );
  }

  const streaming = streamState?.status === 'streaming';

  return (
    <>
      <PageHeader
        title={assistant?.name ?? 'Chat'}
        description={
          assistant?.description ?? 'Grounded answers with the passages behind them, side by side.'
        }
        meta={
          assistant ? (
            <>
              <Badge tone="neutral" size="sm">
                {assistant.llm?.model_name ?? 'No model set'}
              </Badge>
              <Badge tone="outline" size="sm">
                {assistant.dataset_ids?.length ?? 0} knowledge base
                {(assistant.dataset_ids?.length ?? 0) === 1 ? '' : 's'}
              </Badge>
              <span className="font-mono text-2xs text-ink-3">{shortId(assistant.id, 14)}</span>
            </>
          ) : undefined
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="lg:hidden"
              disabled={!chatId}
              onClick={() => setSessionsOpen(true)}
            >
              <PanelLeft />
              Conversations
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!chatId}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings />
              Assistant settings
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface-1 lg:flex">
          <SessionList chatId={chatId} sessionId={sessionId} />
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <MessageList
            messages={renderedMessages}
            loading={loading}
            error={centreError}
            onRetry={retryCentre}
            emptyState={emptyState}
            assistantName={assistant?.name}
            userName={userName}
            streamingId={streamState ? streamState.assistantMessageId : null}
            streaming={streaming}
            thought={streamState?.thought}
            streamError={streamState && streamState.status === 'error' ? streamState.error : null}
            onRetryStream={retryStream}
            selectedCitationKey={selectedCitationKey}
            onSelectCitation={handleSelectCitation}
            feedbackFor={(message) => feedback[message.id] ?? message.feedback ?? null}
            onFeedback={handleFeedback}
          />
          <Composer
            onSend={(text) => void send(text)}
            onStop={stop}
            streaming={streaming}
            disabled={!chatId}
            placeholder={
              assistant ? `Ask ${assistant.name} a question…` : 'Select an assistant to start…'
            }
          />
        </section>

        <aside className="hidden w-[20rem] shrink-0 flex-col border-l border-line bg-surface-1 lg:flex">
          <CitationPanel
            citations={panelCitations}
            selectedKey={panelSelectedKey}
            onSelect={setSelectedCitationKey}
            datasetIds={assistant?.dataset_ids}
          />
        </aside>
      </div>

      <Dialog open={sessionsOpen && !isDesktop} onOpenChange={setSessionsOpen}>
        <DialogContent size="sm" className="h-[78vh] max-w-sm p-0">
          <DialogHeader title="Conversations" description={assistant?.name ?? 'Assistant'} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <SessionList chatId={chatId} sessionId={sessionId} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={citationDrawerOpen && !isDesktop} onOpenChange={setCitationDrawerOpen}>
        <DialogContent size="lg" className="h-[82vh] p-0">
          <DialogHeader title="Sources" description="The passages behind the current answer." />
          <div className="min-h-0 flex-1 overflow-hidden">
            <CitationPanel
              citations={panelCitations}
              selectedKey={panelSelectedKey}
              onSelect={setSelectedCitationKey}
              datasetIds={assistant?.dataset_ids}
            />
          </div>
        </DialogContent>
      </Dialog>

      <AssistantSettings assistantId={chatId} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

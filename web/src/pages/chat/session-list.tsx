/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Conversation rail: the assistant switcher, a new-conversation action, and every session
 * for the active assistant. Owns its own reads/writes; navigation is driven from the URL.
 */
import { MessageSquarePlus, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router';
import {
  useAssistants,
  useCreateSession,
  useDeleteSession,
  useSessions,
} from '@/api/hooks';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { EmptyState, ErrorState, InlineError } from '@/components/ui/states';
import { Skeleton } from '@/components/ui/surface';
import { toast } from '@/components/ui/toaster';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ChatSession } from '@/api/types';

export interface SessionListProps {
  chatId?: string;
  sessionId?: string;
  className?: string;
}

export function SessionList({ chatId, sessionId, className }: SessionListProps) {
  const navigate = useNavigate();
  const assistantsQuery = useAssistants();
  const sessionsQuery = useSessions(chatId);
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();
  const [pendingDelete, setPendingDelete] = React.useState<ChatSession | null>(null);

  const assistants = assistantsQuery.data?.items ?? [];
  const sessions = sessionsQuery.data?.items ?? [];

  const newConversation = async () => {
    if (!chatId) return;
    try {
      const created = await createSession.mutateAsync({ chatId, name: 'New conversation' });
      if (created?.id) navigate(`/chat/${chatId}/${created.id}`);
    } catch {
      // The mutation surfaces copy elsewhere; keep the rail usable.
    }
  };

  const confirmDelete = async () => {
    if (!chatId || !pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteSession.mutateAsync({ chatId, sessionId: target.id });
      if (target.id === sessionId) navigate(`/chat/${chatId}`, { replace: true });
    } catch (error) {
      toast({
        title: 'Could not delete the conversation',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    }
  };

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex shrink-0 flex-col gap-2 border-b border-line p-2">
        {assistantsQuery.isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : assistantsQuery.isError ? (
          <InlineError
            message={assistantsQuery.error.message}
            onRetry={() => {
              void assistantsQuery.refetch();
            }}
          />
        ) : (
          <Select value={chatId} onValueChange={(id) => navigate(`/chat/${id}`)}>
            <SelectTrigger aria-label="Assistant">
              <SelectValue placeholder="Select an assistant" />
            </SelectTrigger>
            <SelectContent>
              {assistants.map((assistant) => (
                <SelectItem key={assistant.id} value={assistant.id}>
                  {assistant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={!chatId}
          loading={createSession.isPending}
          onClick={() => void newConversation()}
        >
          <Plus />
          New conversation
        </Button>
      </div>

      <div className="shrink-0 px-3 pb-1 pt-2.5">
        <p className="text-2xs font-medium uppercase tracking-wide text-ink-3">
          Conversations
          {sessions.length > 0 && <span className="ml-1.5 font-mono text-ink-3">{sessions.length}</span>}
        </p>
      </div>

      <div className="or-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {sessionsQuery.isLoading ? (
          <div className="flex flex-col gap-1.5 px-1 pt-1">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : sessionsQuery.isError ? (
          <ErrorState
            compact
            title="Could not load conversations"
            error={sessionsQuery.error}
            onRetry={() => {
              void sessionsQuery.refetch();
            }}
          />
        ) : sessions.length === 0 ? (
          <EmptyState
            compact
            icon={<MessageSquarePlus />}
            title="No conversations yet"
            description="Start one and it will appear here."
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sessions.map((session) => {
              const active = session.id === sessionId;
              return (
                <li key={session.id} className="group flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => chatId && navigate(`/chat/${chatId}/${session.id}`)}
                    aria-current={active || undefined}
                    className={cn(
                      'flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors duration-[110ms]',
                      active ? 'bg-accent-soft' : 'hover:bg-surface-2',
                    )}
                  >
                    <span className={cn('or-truncate w-full text-xs', active ? 'text-ink' : 'text-ink-2')}>
                      {session.name || 'Untitled conversation'}
                    </span>
                    <span className="font-mono text-[10px] text-ink-3">
                      {formatRelativeTime(session.update_time ?? session.create_time)}
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="shrink-0 opacity-60 group-hover:opacity-100"
                        aria-label="Conversation actions"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem destructive icon={<Trash2 />} onClick={() => setPendingDelete(session)}>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this conversation?"
        description={
          pendingDelete
            ? `“${pendingDelete.name}” and its messages will be removed. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete conversation"
        destructive
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

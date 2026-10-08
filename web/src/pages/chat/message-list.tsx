/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Transcript: the scroll body of the centre pane. Renders loading, empty, error and loaded
 * states, and keeps the view pinned to the newest turn as an answer streams in.
 */
import * as React from 'react';
import { ErrorState, type ErrorLike } from '@/components/ui/states';
import { Skeleton } from '@/components/ui/surface';
import { MessageItem, type FeedbackValue } from '@/pages/chat/message-item';
import { cn } from '@/lib/utils';
import type { ChatMessage, Citation } from '@/api/types';

function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3 sm:p-4">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-[26px] shrink-0 rounded-md" />
          <div className="flex-1 space-y-2 py-0.5">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className={index % 2 === 0 ? 'h-3 w-4/5' : 'h-3 w-3/5'} />
            {index !== 1 && <Skeleton className="h-3 w-2/3" />}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface MessageListProps {
  messages: ChatMessage[];
  loading?: boolean;
  error?: ErrorLike | null;
  onRetry?: () => void;
  emptyState?: React.ReactNode;
  assistantName?: string;
  userName?: string;
  /** Id of the assistant message that is streaming or has failed mid-stream. */
  streamingId?: string | null;
  /** True only while tokens are actively arriving. */
  streaming?: boolean;
  thought?: string | null;
  streamError?: string | null;
  onRetryStream?: () => void;
  selectedCitationKey?: string | null;
  onSelectCitation?: (citation: Citation, citations: Citation[]) => void;
  feedbackFor?: (message: ChatMessage) => FeedbackValue;
  onFeedback?: (message: ChatMessage, value: FeedbackValue) => void;
  className?: string;
}

export function MessageList({
  messages,
  loading,
  error,
  onRetry,
  emptyState,
  assistantName,
  userName,
  streamingId,
  streaming,
  thought,
  streamError,
  onRetryStream,
  selectedCitationKey,
  onSelectCitation,
  feedbackFor,
  onFeedback,
  className,
}: MessageListProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const previousLength = React.useRef(0);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length !== previousLength.current;
    previousLength.current = messages.length;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (grew || nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div ref={scrollRef} className="or-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl">
          {loading ? (
            <MessageSkeleton />
          ) : error ? (
            <ErrorState error={error} onRetry={onRetry} />
          ) : messages.length === 0 ? (
            emptyState
          ) : (
            <div className="divide-y divide-line/60 pb-4">
              {messages.map((message) => {
                const active = Boolean(streamingId && message.id === streamingId);
                return (
                  <MessageItem
                    key={message.id}
                    message={message}
                    assistantName={assistantName}
                    userName={userName}
                    streaming={active && Boolean(streaming)}
                    thought={active ? thought : null}
                    streamError={active ? streamError : null}
                    onRetryStream={onRetryStream}
                    selectedCitationKey={selectedCitationKey}
                    onSelectCitation={onSelectCitation}
                    feedbackValue={feedbackFor ? feedbackFor(message) : undefined}
                    onFeedback={onFeedback}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

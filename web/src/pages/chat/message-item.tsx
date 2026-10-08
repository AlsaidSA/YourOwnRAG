/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * One turn in the transcript. Assistant answers render as markdown with `[citation:N]`
 * markers turned into inline chips that drive the citation inspector; user turns show the
 * raw question plus any tool calls that ran.
 */
import { FileText, ThumbsDown, ThumbsUp, Wrench } from 'lucide-react';
import * as React from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { OwnRagMark } from '@/components/brand/logo';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonSpinner } from '@/components/ui/button';
import { Avatar, Hint } from '@/components/ui/controls';
import { InlineError } from '@/components/ui/states';
import { citationKey } from '@/pages/chat/citation-panel';
import { formatDuration, formatNumber, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ChatMessage, Citation } from '@/api/types';

export type FeedbackValue = 'up' | 'down' | null;

export interface MessageItemProps {
  message: ChatMessage;
  assistantName?: string;
  userName?: string;
  streaming?: boolean;
  thought?: string | null;
  streamError?: string | null;
  onRetryStream?: () => void;
  selectedCitationKey?: string | null;
  onSelectCitation?: (citation: Citation, citations: Citation[]) => void;
  feedbackValue?: FeedbackValue;
  onFeedback?: (message: ChatMessage, value: FeedbackValue) => void;
}

export function MessageItem({
  message,
  assistantName,
  userName,
  streaming,
  thought,
  streamError,
  onRetryStream,
  selectedCitationKey,
  onSelectCitation,
  feedbackValue,
  onFeedback,
}: MessageItemProps) {
  const isUser = message.role === 'user';
  const citations = message.reference ?? [];
  const currentFeedback = feedbackValue ?? message.feedback ?? null;

  const markdownComponents = React.useMemo<Components>(
    () => ({
      p: ({ children }) => <p className="mt-2.5 text-sm leading-relaxed text-ink-2 first:mt-0">{children}</p>,
      ul: ({ children }) => (
        <ul className="mt-2.5 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-2">{children}</ul>
      ),
      ol: ({ children }) => (
        <ol className="mt-2.5 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-ink-2">{children}</ol>
      ),
      li: ({ children }) => <li className="pl-0.5">{children}</li>,
      h1: ({ children }) => <h1 className="mt-3 text-base font-medium text-ink">{children}</h1>,
      h2: ({ children }) => <h2 className="mt-3 text-sm font-medium text-ink">{children}</h2>,
      h3: ({ children }) => <h3 className="mt-3 text-sm font-medium text-ink">{children}</h3>,
      strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
      blockquote: ({ children }) => (
        <blockquote className="mt-2.5 border-l-2 border-line-strong pl-3 text-sm leading-relaxed text-ink-3">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="my-3 border-line" />,
      pre: ({ children }) => (
        <pre className="or-scroll mt-2.5 overflow-x-auto rounded-md border border-line bg-inset p-2.5 font-mono text-xs leading-relaxed text-ink">
          {children}
        </pre>
      ),
      code: ({ className, children }) => {
        const isBlock = typeof className === 'string' && className.includes('language-');
        if (isBlock) return <code className={cn('font-mono text-xs', className)}>{children}</code>;
        return <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs text-ink">{children}</code>;
      },
      table: ({ children }) => (
        <div className="or-scroll mt-2.5 overflow-x-auto">
          <table className="w-full border-collapse text-xs">{children}</table>
        </div>
      ),
      th: ({ children }) => (
        <th className="border-b border-line px-2 py-1 text-left font-medium text-ink-2">{children}</th>
      ),
      td: ({ children }) => <td className="border-b border-line px-2 py-1 align-top text-ink-2">{children}</td>,
      a: ({ href, children }) => {
        if (href && href.startsWith('#citation-')) {
          const rank = Number(href.slice('#citation-'.length));
          const citation = citations.find((item) => (item.index ?? 0) === rank) ?? citations[rank - 1];
          if (!citation) return <span className="text-ink-3">{children}</span>;
          const key = citationKey(citation, rank - 1);
          const active = selectedCitationKey === key;
          return (
            <button
              type="button"
              aria-label={`Inspect source ${rank}: ${citation.doc_name}`}
              onClick={() => onSelectCitation?.(citation, citations)}
              className={cn(
                'mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border px-1 align-baseline font-mono text-[10px] leading-none transition-colors duration-[110ms]',
                active
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-line-accent bg-accent-soft text-accent hover:bg-accent-soft-strong',
              )}
            >
              {children}
            </button>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline underline-offset-2"
          >
            {children}
          </a>
        );
      },
    }),
    [citations, onSelectCitation, selectedCitationKey],
  );

  // `[citation:N]` → an inline markdown link the renderer below intercepts as a chip.
  const body = React.useMemo(
    () => message.content.replace(/\[citation:(\d+)\]/g, (_match, rank: string) => `[${rank}](#citation-${rank})`),
    [message.content],
  );

  return (
    <article className={cn('flex gap-3 px-3 py-3 sm:px-4', isUser ? 'bg-transparent' : 'bg-surface-1')}>
      <div className="shrink-0 pt-0.5">
        {isUser ? (
          <Avatar name={userName || 'You'} size={26} />
        ) : (
          <span className="flex size-[26px] items-center justify-center rounded-md border border-line bg-surface-2">
            <OwnRagMark size={15} />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-xs font-medium text-ink">{isUser ? userName || 'You' : assistantName || 'Assistant'}</span>
          {message.created_at ? (
            <span className="font-mono text-[10px] text-ink-3">{formatRelativeTime(message.created_at)}</span>
          ) : null}
        </div>

        {!isUser && streaming && (
          <div className="mt-2 flex items-center gap-2 text-2xs text-ink-3">
            <ButtonSpinner className="size-3 text-accent" />
            <span>{thought || 'Generating…'}</span>
          </div>
        )}

        {isUser && message.tool_calls && message.tool_calls.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.tool_calls.map((tool, index) => (
              <Badge key={`${tool.name}-${index}`} tone="outline" size="sm">
                <Wrench className="size-3" />
                {tool.name}
                {typeof tool.elapsed_ms === 'number' && (
                  <span className="font-mono text-ink-3">{formatDuration(tool.elapsed_ms / 1000)}</span>
                )}
              </Badge>
            ))}
          </div>
        )}

        {isUser ? (
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{message.content}</p>
        ) : message.content ? (
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
            className="text-sm leading-relaxed text-ink-2 [&>*:first-child]:mt-0"
          >
            {body}
          </Markdown>
        ) : null}

        {!isUser && streaming && !streamError && (
          <span className="mt-1 inline-block h-3.5 w-1.5 animate-pulse rounded-[1px] bg-accent align-middle" />
        )}

        {streamError && <InlineError message={streamError} onRetry={onRetryStream} />}

        {!isUser && !streaming && message.content && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-3">
            {citations.length > 0 && (
              <span className="flex items-center gap-1">
                <FileText className="size-3" />
                {citations.length} source{citations.length === 1 ? '' : 's'}
              </span>
            )}
            {typeof message.latency_ms === 'number' && (
              <span className="font-mono">{formatDuration(message.latency_ms / 1000)}</span>
            )}
            {typeof message.tokens === 'number' && (
              <span className="font-mono">{formatNumber(message.tokens)} tokens</span>
            )}
            <div className="ml-auto flex items-center gap-0.5">
              <Hint label="Helpful">
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Mark helpful"
                  aria-pressed={currentFeedback === 'up'}
                  className={cn(currentFeedback === 'up' && 'text-accent')}
                  onClick={() => onFeedback?.(message, currentFeedback === 'up' ? null : 'up')}
                >
                  <ThumbsUp />
                </Button>
              </Hint>
              <Hint label="Not helpful">
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Mark not helpful"
                  aria-pressed={currentFeedback === 'down'}
                  className={cn(currentFeedback === 'down' && 'text-danger')}
                  onClick={() => onFeedback?.(message, currentFeedback === 'down' ? null : 'down')}
                >
                  <ThumbsDown />
                </Button>
              </Hint>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Composer: the single input for a turn. Enter sends, Shift+Enter breaks a line, and the
 * send control becomes a stop control while an answer streams.
 */
import { Send, Square } from 'lucide-react';
import * as React from 'react';
import { isDemoMode } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/controls';
import { cn } from '@/lib/utils';

export interface ComposerProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function Composer({
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
  className,
}: ComposerProps) {
  const [value, setValue] = React.useState('');
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const resize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  React.useEffect(() => {
    resize();
  }, [value, resize]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled || streaming) return;
    onSend(text);
    setValue('');
    requestAnimationFrame(resize);
  };

  return (
    <div className={cn('shrink-0 border-t border-line bg-canvas px-3 py-3 sm:px-4', className)}>
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-end gap-2 rounded-lg border border-line bg-surface-1 p-1.5 transition-colors focus-within:border-line-accent">
          <textarea
            ref={ref}
            value={value}
            rows={1}
            disabled={disabled}
            aria-label="Message"
            placeholder={placeholder ?? 'Ask a question grounded in your knowledge bases…'}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className="or-scroll max-h-[200px] min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none disabled:opacity-55"
          />
          {streaming ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="size-9"
              onClick={onStop}
              aria-label="Stop generating"
            >
              <Square />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="primary"
              className="size-9"
              onClick={submit}
              disabled={disabled || !value.trim()}
              aria-label="Send message"
            >
              <Send />
            </Button>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-0.5 text-2xs text-ink-3">
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd>
            <span>to send</span>
            <span className="mx-0.5">·</span>
            <Kbd>Shift</Kbd>
            <Kbd>Enter</Kbd>
            <span>for a new line</span>
          </span>
          <span>
            {isDemoMode()
              ? 'Demo corpus — answers are seeded, not generated live.'
              : 'Answers are grounded in the linked knowledge bases.'}
          </span>
        </div>
      </div>
    </div>
  );
}

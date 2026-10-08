/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * OwnRAG identity: a mark and a typographic wordmark.
 *
 * The mark is an abstract "owned core": a container, a wired edge, and a node at the centre.
 * It is drawn from three primitives so it stays legible at 16px. The wordmark is type, not a
 * redrawn logo — "Own" in the interface face, "RAG" in mono — which is what makes it read as
 * an independent product rather than a re-lettered badge.
 */
import { cn } from '@/lib/utils';

export function OwnRagMark({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="OwnRAG"
    >
      <rect x="2.4" y="2.4" width="19.2" height="19.2" rx="6" stroke="var(--or-accent)" strokeWidth="1.6" />
      <rect x="7.4" y="7.4" width="9.2" height="9.2" rx="2.6" fill="var(--or-accent)" fillOpacity="0.16" />
      <circle cx="12" cy="12" r="2.3" fill="var(--or-accent)" />
      <path
        d="M4.6 4.6l2.2 2.2M19.4 19.4l-2.2-2.2M4.6 19.4l2.2-2.2M19.4 4.6l-2.2 2.2"
        stroke="var(--or-accent)"
        strokeOpacity="0.4"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function OwnRagWordmark({
  className,
  size = 'md',
  showMark = true,
  markSize,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showMark?: boolean;
  markSize?: number;
}) {
  const scale = {
    sm: { text: 'text-xs', mark: 16, gap: 'gap-1.5' },
    md: { text: 'text-sm', mark: 20, gap: 'gap-2' },
    lg: { text: 'text-base', mark: 24, gap: 'gap-2' },
    xl: { text: 'text-2xl', mark: 34, gap: 'gap-2.5' },
  }[size];

  return (
    <span className={cn('inline-flex items-center', scale.gap, className)}>
      {showMark && <OwnRagMark size={markSize ?? scale.mark} />}
      <span className={cn('select-none tracking-[-0.01em]', scale.text)}>
        <span className="font-medium text-ink">Own</span>
        <span className="font-mono font-medium tracking-[0.02em] text-accent">RAG</span>
      </span>
    </span>
  );
}

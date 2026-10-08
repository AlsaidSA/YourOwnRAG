/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Badge / StatusPill. Tone is the only axis: the console never uses colour decoratively,
 * so a coloured pill always means a state you can act on.
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-line bg-surface-2 text-ink-2',
        outline: 'border-line-strong bg-transparent text-ink-2',
        accent: 'border-transparent bg-accent-soft text-accent',
        ok: 'border-transparent bg-ok-soft text-ok',
        warn: 'border-transparent bg-warn-soft text-warn',
        danger: 'border-transparent bg-danger-soft text-danger',
        info: 'border-transparent bg-info-soft text-info',
        violet: 'border-transparent bg-violet-soft text-violet',
      },
      size: {
        sm: 'h-[18px] px-1.5 text-2xs',
        md: 'h-5 px-2 text-2xs',
        lg: 'h-6 px-2.5 text-xs',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

export const Dot = ({ tone = 'neutral' }: { tone?: NonNullable<BadgeProps['tone']> }) => {
  const colour: Record<string, string> = {
    neutral: 'bg-ink-3',
    outline: 'bg-ink-3',
    accent: 'bg-accent',
    ok: 'bg-ok',
    warn: 'bg-warn',
    danger: 'bg-danger',
    info: 'bg-info',
    violet: 'bg-violet',
  };
  return <span className={cn('size-1.5 shrink-0 rounded-full', colour[tone])} />;
};

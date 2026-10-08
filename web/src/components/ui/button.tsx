/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Button — the console's single action primitive. Variants are semantic (intent), never
 * decorative: `primary` is the one action a screen is about, everything else steps down.
 */
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,opacity] duration-[110ms] ease-[cubic-bezier(0.16,1,0.3,1)] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink hover:bg-accent-hover active:brightness-95 shadow-e1',
        secondary:
          'border border-line bg-surface-2 text-ink hover:bg-surface-3 hover:border-line-strong',
        outline: 'border border-line-strong bg-transparent text-ink hover:bg-surface-2',
        ghost: 'bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink',
        subtle: 'bg-accent-soft text-accent hover:bg-accent-soft-strong',
        danger: 'bg-danger text-white hover:brightness-110',
        'danger-ghost': 'bg-transparent text-danger hover:bg-danger-soft',
        link: 'bg-transparent text-accent underline-offset-4 hover:underline px-0',
      },
      size: {
        xs: 'h-6 px-2 text-2xs [&_svg]:size-3',
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
        md: 'h-8 px-3 text-sm [&_svg]:size-4',
        lg: 'h-9 px-4 text-base [&_svg]:size-4',
        icon: 'size-8 p-0 [&_svg]:size-4',
        'icon-sm': 'size-7 p-0 [&_svg]:size-3.5',
        'icon-xs': 'size-6 p-0 [&_svg]:size-3',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Spinner = ({ className }: { className?: string }) => (
  <svg className={cn('animate-spin', className)} viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
    <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
);

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        data-loading={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Spinner className="size-3.5" />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants, Spinner as ButtonSpinner };

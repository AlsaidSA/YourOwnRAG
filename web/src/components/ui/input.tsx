/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Form primitives: Input, Textarea, Label, Field (label + hint + error wrapper).
 */
import * as LabelPrimitive from '@radix-ui/react-label';
import * as React from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-md border border-line bg-inset text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-[110ms] disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  inputSize?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputSize = 'md', invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        fieldBase,
        inputSize === 'sm' && 'h-7 px-2 text-xs',
        inputSize === 'md' && 'h-8 px-2.5 text-sm',
        inputSize === 'lg' && 'h-9 px-3 text-base',
        invalid && 'border-danger focus-visible:border-danger focus-visible:ring-danger-soft',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        fieldBase,
        'min-h-20 px-2.5 py-2 text-sm leading-relaxed or-scroll',
        invalid && 'border-danger focus-visible:border-danger focus-visible:ring-danger-soft',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-xs font-medium text-ink-2 select-none', className)}
    {...props}
  />
));
Label.displayName = 'Label';

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
  action,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || action) && (
        <div className="flex items-center justify-between gap-2">
          {label ? (
            <Label htmlFor={htmlFor} className="flex items-center gap-1">
              {label}
              {required && <span className="text-danger">*</span>}
            </Label>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {children}
      {error ? (
        <p className="text-2xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-2xs text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Dialog + Sheet (mobile drawer) + ConfirmDialog. Overlays sit on surface-3 with one
 * elevation step; no backdrop blur, no glass.
 */
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  size = 'md',
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0.15_0.01_265/0.55)] data-[state=open]:or-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-line-strong bg-surface-3 shadow-e3 or-rise-in flex flex-col',
          size === 'sm' && 'max-w-sm',
          size === 'md' && 'max-w-lg',
          size === 'lg' && 'max-w-2xl',
          size === 'xl' && 'max-w-4xl',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-3.5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  title,
  description,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('border-b border-line px-4 py-3 pr-10', className)}>
      <DialogPrimitive.Title className="text-base font-medium text-ink">{title}</DialogPrimitive.Title>
      {description && (
        <DialogPrimitive.Description className="mt-1 text-xs leading-relaxed text-ink-3">
          {description}
        </DialogPrimitive.Description>
      )}
    </div>
  );
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('or-scroll flex-1 overflow-y-auto px-4 py-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-end gap-2 border-t border-line px-4 py-3', className)}
      {...props}
    />
  );
}

/** Confirm an irreversible action. The destructive label repeats the verb, never "OK". */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0.15_0.01_265/0.55)] data-[state=open]:or-fade-in" />
        <AlertDialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line-strong bg-surface-3 p-4 shadow-e3 or-rise-in">
          <AlertDialogPrimitive.Title className="text-base font-medium text-ink">
            {title}
          </AlertDialogPrimitive.Title>
          {description && (
            <AlertDialogPrimitive.Description className="mt-1.5 text-xs leading-relaxed text-ink-2">
              {description}
            </AlertDialogPrimitive.Description>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="ghost" size="sm">
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              size="sm"
              variant={destructive ? 'danger' : 'primary'}
              loading={loading}
              onClick={(event) => {
                event.preventDefault();
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

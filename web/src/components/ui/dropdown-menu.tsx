/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * DropdownMenu — row actions, workspace switcher and other transient menus.
 */
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Root, defaulting to non-modal.
 *
 * A modal Radix menu writes `pointer-events: none` onto <body> while it is open and removes it on
 * close. When the menu's owner unmounts before that close finishes — a card removing itself from
 * the list it was just deleted from — the restore never runs and the entire page stops accepting
 * clicks until a reload. Nothing in this console needs a modal menu, so the default is off here
 * rather than at each call site.
 */
export function DropdownMenu({
  modal = false,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root modal={modal} {...props} />;
}

export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const contentClass =
  'z-50 min-w-[11rem] overflow-hidden rounded-lg border border-line-strong bg-surface-3 p-1 shadow-e3 or-rise-in';

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content sideOffset={sideOffset} className={cn(contentClass, className)} {...props} />
    </DropdownMenuPrimitive.Portal>
  );
}

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    destructive?: boolean;
    icon?: React.ReactNode;
  }
>(({ className, destructive, icon, children, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none transition-colors data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0',
      destructive ? 'text-danger data-[highlighted]:bg-danger-soft' : 'text-ink',
      className,
    )}
    {...props}
  >
    {icon}
    {children}
  </DropdownMenuPrimitive.Item>
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    checked={checked}
    className={cn(
      'flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-6 text-xs text-ink outline-none data-[highlighted]:bg-surface-2',
      className,
    )}
    {...props}
  >
    {children}
    {checked && <Check className="absolute right-2 size-3.5 text-accent" />}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

export function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn('px-2 py-1.5 text-2xs font-medium uppercase tracking-wide text-ink-3', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-line', className)} {...props} />;
}

export function DropdownMenuShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('ml-auto font-mono text-2xs tracking-wider text-ink-3', className)}
      {...props}
    />
  );
}

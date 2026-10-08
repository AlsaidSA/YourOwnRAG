/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Select, Switch, Checkbox, Slider, Segmented control, Tooltip, ScrollArea, Separator,
 * Avatar, Progress, Kbd. Small Radix wrappers, styled once, reused everywhere.
 */
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';
import { initialsOf } from '@/lib/format';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ Select */

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-line bg-inset px-2.5 text-sm text-ink transition-colors hover:border-line-strong focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-55 data-[placeholder]:text-ink-3',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-3.5 shrink-0 text-ink-3" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        'z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line-strong bg-surface-3 p-1 shadow-e3 or-rise-in',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="or-scroll max-h-72 overflow-y-auto">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = 'SelectContent';

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center rounded-md py-1.5 pl-6 pr-2 text-xs text-ink outline-none data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-3.5 text-accent" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = 'SelectItem';

export function SelectLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn('px-2 py-1 pr-6 text-2xs font-medium uppercase tracking-wide text-ink-3', className)}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ Switch */

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent data-[state=unchecked]:bg-surface-2 data-[state=unchecked]:border-line-strong',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-white shadow-e1 transition-transform duration-[160ms] data-[state=checked]:translate-x-[15px]" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

/* ------------------------------------------------------------------ Checkbox */

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer size-3.5 shrink-0 rounded-[4px] border border-line-strong bg-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-accent-ink">
      <Check className="size-3 stroke-[3]" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

/* ------------------------------------------------------------------ Slider */

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn('relative flex w-full touch-none select-none items-center py-1.5', className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-surface-2">
      <SliderPrimitive.Range className="absolute h-full bg-accent" />
    </SliderPrimitive.Track>
    {(props.value ?? props.defaultValue ?? [0]).map((_, index) => (
      <SliderPrimitive.Thumb
        key={index}
        className="block size-3.5 rounded-full border border-accent bg-canvas shadow-e1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
    ))}
  </SliderPrimitive.Root>
));
Slider.displayName = 'Slider';

/* ------------------------------------------------------------------ Segmented */

export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = 'md',
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: Array<{ value: T; label: React.ReactNode; icon?: React.ReactNode }>;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(next) => next && onValueChange(next as T)}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-line bg-inset p-0.5',
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[5px] font-medium text-ink-3 transition-colors hover:text-ink data-[state=on]:bg-surface-2 data-[state=on]:text-ink [&_svg]:size-3.5',
            size === 'sm' ? 'h-6 px-2 text-2xs' : 'h-7 px-2.5 text-xs',
          )}
        >
          {option.icon}
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ Tooltip */

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-xs rounded-md border border-line-strong bg-surface-3 px-2 py-1 text-2xs leading-relaxed text-ink shadow-e2 or-fade-in',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/** Convenience wrapper for the common "icon button + tooltip" case. */
export function Hint({
  label,
  children,
  side = 'top',
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ ScrollArea */

export const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={cn('relative overflow-hidden', className)} {...props}>
    <ScrollAreaPrimitive.Viewport className="size-full rounded-[inherit]">{children}</ScrollAreaPrimitive.Viewport>
    <ScrollAreaPrimitive.Scrollbar
      orientation="vertical"
      className="flex w-2 touch-none select-none p-0.5 transition-colors"
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-line-strong" />
    </ScrollAreaPrimitive.Scrollbar>
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = 'ScrollArea';

/* ------------------------------------------------------------------ Separator */

export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn('shrink-0 bg-line', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
    {...props}
  />
));
Separator.displayName = 'Separator';

/* ------------------------------------------------------------------ Avatar */

export function Avatar({
  name,
  src,
  size = 28,
  className,
}: {
  name?: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <AvatarPrimitive.Root
      className={cn('relative flex shrink-0 overflow-hidden rounded-md bg-surface-2', className)}
      style={{ width: size, height: size }}
    >
      {src ? <AvatarPrimitive.Image src={src} className="size-full object-cover" alt={name ?? ''} /> : null}
      <AvatarPrimitive.Fallback
        className="flex size-full items-center justify-center font-medium text-ink-2"
        style={{ fontSize: Math.max(9, size * 0.36) }}
      >
        {initialsOf(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ Progress */

export function Progress({
  value,
  tone = 'accent',
  className,
  indeterminate,
}: {
  value: number;
  tone?: 'accent' | 'ok' | 'warn' | 'danger' | 'violet';
  className?: string;
  indeterminate?: boolean;
}) {
  const toneClass: Record<string, string> = {
    accent: 'bg-accent',
    ok: 'bg-ok',
    warn: 'bg-warn',
    danger: 'bg-danger',
    violet: 'bg-violet',
  };
  return (
    <ProgressPrimitive.Root
      value={indeterminate ? undefined : Math.round(Math.min(100, Math.max(0, value * 100)))}
      className={cn('relative h-1 w-full overflow-hidden rounded-full bg-surface-2', className)}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full w-full transition-transform duration-[240ms]', toneClass[tone], indeterminate && 'or-shimmer')}
        style={indeterminate ? undefined : { transform: `translateX(-${100 - Math.min(100, Math.max(0, value * 100))}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ Kbd */

export function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-mono text-[10px] font-medium text-ink-3',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

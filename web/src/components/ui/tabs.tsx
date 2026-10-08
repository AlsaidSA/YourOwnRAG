/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Tabs — underline style for page-level views, segmented style for inline switches.
 */
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('or-scroll flex items-center gap-4 overflow-x-auto border-b border-line', className)}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { count?: number }
>(({ className, children, count, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative -mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-0.5 pb-2 pt-1 text-sm text-ink-3 transition-colors duration-[110ms] hover:text-ink-2 data-[state=active]:border-accent data-[state=active]:text-ink',
      className,
    )}
    {...props}
  >
    {children}
    {count !== undefined && (
      <span className="rounded-full bg-surface-2 px-1.5 font-mono text-2xs text-ink-3">{count}</span>
    )}
  </TabsPrimitive.Trigger>
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('outline-none', className)} {...props} />
));
TabsContent.displayName = 'TabsContent';

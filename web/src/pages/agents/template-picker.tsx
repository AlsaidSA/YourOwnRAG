/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 *
 * Template picker — the create-agent surface. It offers the backend's agent templates plus an
 * explicit blank canvas, and owns its own loading / empty / error states because it is the
 * only place those templates are read.
 *
 * Template avatars from the API may be emoji; product chrome never renders them, so each card
 * shows a token-tinted glyph instead.
 */
import { LayoutGrid, Plus, Search, Sparkles } from 'lucide-react';
import * as React from 'react';
import type { AgentTemplate } from '@/api/types';
import { useAgentTemplates } from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/controls';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/ui/states';

function TemplateCard({
  title,
  description,
  category,
  onClick,
  disabled,
  blank,
}: {
  title: string;
  description: string;
  category: string;
  onClick: () => void;
  disabled?: boolean;
  blank?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex h-full flex-col rounded-lg border border-line bg-surface-1 p-3 text-left transition-colors duration-[110ms] hover:border-line-strong hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-50"
    >
      <div className="flex items-center gap-2">
        <span
          className="flex size-7 items-center justify-center rounded-md border border-line"
          style={{ backgroundColor: 'var(--or-accent-soft)', color: 'var(--or-accent)' }}
        >
          {blank ? <Plus className="size-3.5" /> : <Sparkles className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{title}</span>
      </div>
      <p className="mt-2 line-clamp-2 flex-1 text-xs leading-relaxed text-ink-3">{description}</p>
      <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2">
        <Badge tone={blank ? 'accent' : 'neutral'} size="sm">
          {category}
        </Badge>
      </div>
    </button>
  );
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
  creating = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: AgentTemplate | null) => void;
  creating?: boolean;
}) {
  const { data, isLoading, isError, error, refetch } = useAgentTemplates();
  const templates = data ?? [];
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState('all');

  React.useEffect(() => {
    if (!open) {
      setQuery('');
      setCategory('all');
    }
  }, [open]);

  const categories = React.useMemo(
    () => Array.from(new Set(templates.map((template) => template.category))).sort(),
    [templates],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter(
      (template) =>
        (category === 'all' || template.category === category) &&
        (!q ||
          template.title.toLowerCase().includes(q) ||
          template.description.toLowerCase().includes(q) ||
          template.category.toLowerCase().includes(q)),
    );
  }, [templates, category, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title="New agent"
          description="Start from a template, or open a blank canvas and build the workflow yourself."
        />

        <DialogBody className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
              <Input
                inputSize="sm"
                className="pl-8"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search templates…"
                aria-label="Search templates"
              />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-7 text-xs sm:w-48">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {entry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <CardGridSkeleton count={6} />
          ) : isError ? (
            <ErrorState
              compact
              title="Could not load templates"
              error={error}
              onRetry={() => refetch()}
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TemplateCard
                  blank
                  title="Blank agent"
                  description="An empty canvas with no nodes — wire up the pipeline from scratch."
                  category="Custom"
                  disabled={creating}
                  onClick={() => onSelect(null)}
                />
                {filtered.map((template) => (
                  <TemplateCard
                    key={template.id}
                    title={template.title}
                    description={template.description}
                    category={template.category}
                    disabled={creating}
                    onClick={() => onSelect(template)}
                  />
                ))}
              </div>

              {templates.length === 0 && (
                <EmptyState
                  compact
                  icon={<LayoutGrid />}
                  title="No templates available"
                  description="The API returned no agent templates. You can still start from a blank canvas."
                  action={
                    <Button size="sm" variant="primary" disabled={creating} onClick={() => onSelect(null)}>
                      <Plus />
                      Blank agent
                    </Button>
                  }
                />
              )}

              {templates.length > 0 && filtered.length === 0 && (
                <EmptyState
                  compact
                  icon={<Search />}
                  title="No templates match"
                  description="Try a different search term or category, or start from a blank canvas."
                />
              )}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

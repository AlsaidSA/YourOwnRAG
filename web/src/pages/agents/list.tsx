/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 *
 * Agents list (/agents). A card gallery of every agent the account can see, with a derived
 * summary strip, client-side search and filters, and the four required async states. Creating
 * an agent goes through the template picker; tapping a card opens the builder.
 */
import { ArrowRight, Bot, Clock, Copy, Ellipsis, Play, Plus, Search, Trash, Workflow } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router';
import { useAgents, useCreateAgent, useDeleteAgent } from '@/api/hooks';
import type { Agent, AgentTemplate } from '@/api/types';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Avatar, Segmented, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Panel, Toolbar } from '@/components/ui/surface';
import { CardGridSkeleton, EmptyState, ErrorState, StatsSkeleton } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { TemplatePicker } from '@/pages/agents/template-picker';
import { formatCompact, formatNumber, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type StatusFilter = 'all' | 'published' | 'draft';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Panel className="p-3">
      <p className="text-2xs uppercase tracking-wide text-ink-3">{label}</p>
      <p className="mt-1.5 font-mono text-lg text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-2xs text-ink-3">{hint}</p>}
    </Panel>
  );
}

function AgentCard({
  agent,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  agent: Agent;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const nodeCount = agent.dsl?.graph?.nodes?.length ?? 0;
  const edgeCount = agent.dsl?.graph?.edges?.length ?? 0;
  const published = agent.status === 'published';
  const tags = agent.tags ?? [];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer flex-col rounded-lg border border-line bg-surface-1 p-3 text-left transition-colors duration-[110ms] hover:border-line-strong hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
    >
      <div className="flex items-start gap-2.5">
        <Avatar name={agent.title} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-ink">{agent.title}</p>
            <Badge tone={published ? 'ok' : 'neutral'} size="sm" dot>
              {published ? 'Published' : 'Draft'}
            </Badge>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-3">
            {agent.description || 'No description yet.'}
          </p>
        </div>
        <span onClick={(event) => event.stopPropagation()} className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${agent.title}`}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<ArrowRight />} onClick={onOpen}>
                Open
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Copy />} onClick={onDuplicate}>
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive icon={<Trash />} onClick={onDelete}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2.5 text-2xs text-ink-3">
        <span className="inline-flex items-center gap-1">
          <Workflow className="size-3" />
          <span className="font-mono">{nodeCount}</span> nodes
        </span>
        <span className="inline-flex items-center gap-1">
          <Play className="size-3" />
          <span className="font-mono">{edgeCount}</span> edges
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="font-mono">{formatCompact(agent.run_count ?? 0)}</span> runs
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Clock className="size-3" />
          {formatRelativeTime(agent.update_time)}
        </span>
      </div>

      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={tag} tone="outline" size="sm">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentsListPage() {
  const navigate = useNavigate();
  const agentsQuery = useAgents();
  const createAgent = useCreateAgent();
  const deleteAgent = useDeleteAgent();

  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState<StatusFilter>('all');
  const [tag, setTag] = React.useState('all');
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<Agent | null>(null);

  const agents = agentsQuery.data?.items ?? [];

  const tags = React.useMemo(
    () => Array.from(new Set(agents.flatMap((agent) => agent.tags ?? []))).sort(),
    [agents],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents
      .filter((agent) => status === 'all' || (agent.status ?? 'draft') === status)
      .filter((agent) => tag === 'all' || (agent.tags ?? []).includes(tag))
      .filter(
        (agent) =>
          !q ||
          agent.title.toLowerCase().includes(q) ||
          (agent.description ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => (b.update_time ?? 0) - (a.update_time ?? 0));
  }, [agents, query, status, tag]);

  const stats = React.useMemo(() => {
    const published = agents.filter((agent) => agent.status === 'published').length;
    const runs = agents.reduce((sum, agent) => sum + (agent.run_count ?? 0), 0);
    return { total: agents.length, published, drafts: agents.length - published, runs };
  }, [agents]);

  const handleCreate = (template: AgentTemplate | null) => {
    const dsl = template?.dsl ?? { graph: { nodes: [], edges: [] } };
    createAgent.mutate(
      {
        title: template?.title ?? 'Untitled agent',
        description: template?.description ?? '',
        dsl,
        status: 'draft',
      },
      {
        onSuccess: (created) => {
          toast({ title: 'Agent created', description: created.title, variant: 'success' });
          setPickerOpen(false);
          navigate(`/agents/${created.id}`);
        },
      },
    );
  };

  const handleDuplicate = (agent: Agent) => {
    createAgent.mutate(
      {
        title: `${agent.title} copy`,
        description: agent.description ?? '',
        dsl: agent.dsl ?? { graph: { nodes: [], edges: [] } },
        status: 'draft',
      },
      {
        onSuccess: (created) => {
          toast({ title: 'Agent duplicated', description: created.title, variant: 'success' });
          navigate(`/agents/${created.id}`);
        },
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteAgent.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  const isEmpty = !agentsQuery.isLoading && !agentsQuery.isError && agents.length === 0;
  const noMatches = !agentsQuery.isLoading && !agentsQuery.isError && agents.length > 0 && filtered.length === 0;

  return (
    <>
      <PageHeader
        title="Agents"
        description="Compose retrieval, generation and tool steps into a runnable workflow. Build on the canvas, publish when it is ready."
        actions={
          <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
            <Plus />
            New agent
          </Button>
        }
      />

      <PageBody>
        <div className="flex flex-col gap-5">
          {agentsQuery.isLoading ? (
            <StatsSkeleton count={4} />
          ) : agentsQuery.isError ? null : agents.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Agents" value={formatNumber(stats.total)} hint={`${formatNumber(stats.published)} published`} />
              <Stat label="Published" value={formatNumber(stats.published)} hint="Live and callable" />
              <Stat label="Drafts" value={formatNumber(stats.drafts)} hint="Still being edited" />
              <Stat label="Total runs" value={formatCompact(stats.runs)} hint="Across all agents" />
            </div>
          ) : null}

          <Toolbar className="gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
              <Input
                inputSize="sm"
                className="pl-8"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search agents…"
                aria-label="Search agents"
              />
            </div>
            <Segmented<StatusFilter>
              size="sm"
              value={status}
              onValueChange={setStatus}
              options={[
                { value: 'all', label: 'All' },
                { value: 'published', label: 'Published' },
                { value: 'draft', label: 'Draft' },
              ]}
            />
            {tags.length > 0 && (
              <Select value={tag} onValueChange={setTag}>
                <SelectTrigger className="h-7 w-40 text-xs">
                  <SelectValue placeholder="All tags" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tags</SelectItem>
                  {tags.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Toolbar>

          {agentsQuery.isLoading ? (
            <CardGridSkeleton count={6} />
          ) : agentsQuery.isError ? (
            <ErrorState error={agentsQuery.error} onRetry={() => agentsQuery.refetch()} />
          ) : isEmpty ? (
            <EmptyState
              icon={<Bot />}
              title="No agents yet"
              description="Agents chain retrieval, models and tools into a workflow you can run and publish. Start from a template, or open a blank canvas."
              action={
                <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
                  <Plus />
                  New agent
                </Button>
              }
            />
          ) : noMatches ? (
            <EmptyState
              compact
              icon={<Search />}
              title="No agents match"
              description="Adjust the search term or filters to see more agents."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onOpen={() => navigate(`/agents/${agent.id}`)}
                  onDuplicate={() => handleDuplicate(agent)}
                  onDelete={() => setDeleteTarget(agent)}
                />
              ))}
            </div>
          )}
        </div>
      </PageBody>

      <TemplatePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handleCreate}
        creating={createAgent.isPending}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete agent?"
        description={
          deleteTarget
            ? `“${deleteTarget.title}” and its graph will be removed. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete agent"
        destructive
        loading={deleteAgent.isPending}
        onConfirm={handleDelete}
      />
    </>
  );
}

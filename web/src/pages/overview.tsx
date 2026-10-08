/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 *
 * Overview — a Monitor surface, not a landing page.
 *
 * Every number on this screen is derived from resources the backend actually serves
 * (knowledge bases, their ingestion summaries, agents, connectors, the version endpoint).
 * Where the API cannot answer a question — there is no time-series or event-stream endpoint
 * in the console's contract — the panel says so instead of drawing a decorative chart.
 */
import { useQueries } from '@tanstack/react-query';
import {
  AlertOctagon,
  ArrowUpRight,
  Boxes,
  Database,
  FileStack,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  Workflow,
} from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import {
  KnowledgeKeys,
  useAgents,
  useConnectors,
  useKnowledgeBases,
  useProviders,
  useSystemInfo,
  type IngestionSummary,
} from '@/api/hooks';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StackedBar } from '@/components/ui/charts';
import { Hint, Progress } from '@/components/ui/controls';
import { Panel, PanelHeader, SectionHeader, Skeleton } from '@/components/ui/surface';
import { EmptyState, ErrorState, StatsSkeleton } from '@/components/ui/states';
import { formatCompact, formatNumber, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ metrics */

function MetricTile({
  label,
  value,
  hint,
  icon,
  loading,
  to,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  icon: React.ReactNode;
  loading?: boolean;
  to?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-2xs font-medium uppercase tracking-wide text-ink-3">{label}</span>
        <span className="text-ink-3 [&_svg]:size-3.5">{icon}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-24" />
      ) : (
        <p className="mt-2 font-mono text-2xl tracking-[-0.02em] text-ink">{value}</p>
      )}
      {hint && <p className="mt-1 text-2xs text-ink-3">{hint}</p>}
    </>
  );

  return to ? (
    <Link
      to={to}
      className="group rounded-lg border border-line bg-surface-1 p-3 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-line bg-surface-1 p-3">{body}</div>
  );
}

/* ------------------------------------------------------------------ pipeline */

const STAGES = [
  { key: 'done', label: 'Indexed', tone: 'ok' as const },
  { key: 'running', label: 'Parsing', tone: 'warn' as const },
  { key: 'unstart', label: 'Queued', tone: 'muted' as const },
  { key: 'failed', label: 'Failed', tone: 'danger' as const },
];

function PipelinePanel({
  summaries,
  loading,
  hasError,
}: {
  summaries: Array<IngestionSummary | undefined>;
  loading: boolean;
  hasError: boolean;
}) {
  const totals = summaries.reduce(
    (acc, summary) => ({
      total: acc.total + (summary?.total ?? 0),
      done: acc.done + (summary?.done ?? 0),
      running: acc.running + (summary?.running ?? 0),
      unstart: acc.unstart + (summary?.unstart ?? 0),
      failed: acc.failed + (summary?.failed ?? 0),
    }),
    { total: 0, done: 0, running: 0, unstart: 0, failed: 0 },
  );

  const completion = totals.total ? totals.done / totals.total : 0;

  return (
    <Panel>
      <PanelHeader
        title="Ingestion pipeline"
        description="Document state across every knowledge base, in the order the pipeline moves."
        icon={<Layers />}
        actions={
          totals.running > 0 ? (
            <Badge tone="warn" size="sm" dot>
              {totals.running} running
            </Badge>
          ) : (
            <Badge tone="neutral" size="sm">
              idle
            </Badge>
          )
        }
      />
      <div className="p-4">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : hasError || totals.total === 0 ? (
          <EmptyState
            compact
            title={hasError ? 'Ingestion state unavailable' : 'No documents ingested yet'}
            description={
              hasError
                ? 'The ingestion summary endpoint did not answer. Document state is read from each knowledge base.'
                : 'Add documents to a knowledge base and run ingestion — stage counts appear here as the pipeline advances.'
            }
            action={
              !hasError && (
                <Button size="sm" variant="secondary" asChild>
                  <Link to="/knowledge">
                    <Plus />
                    Add documents
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-lg text-ink">{formatNumber(totals.done)}</span>
              <span className="text-2xs text-ink-3">
                of {formatNumber(totals.total)} documents indexed
              </span>
            </div>
            <Progress value={completion} tone="ok" className="mt-2" />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STAGES.map((stage) => (
                <div key={stage.key} className="rounded-md border border-line bg-inset px-2.5 py-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        stage.tone === 'ok' && 'bg-ok',
                        stage.tone === 'warn' && 'bg-warn',
                        stage.tone === 'danger' && 'bg-danger',
                        stage.tone === 'muted' && 'bg-ink-3',
                      )}
                    />
                    <span className="text-2xs text-ink-3">{stage.label}</span>
                  </div>
                  <p className="mt-1 font-mono text-sm text-ink">
                    {formatNumber(totals[stage.key as keyof typeof totals])}
                  </p>
                </div>
              ))}
            </div>
            <StackedBar
              className="mt-3"
              height={6}
              segments={STAGES.map((stage) => ({
                value: totals[stage.key as keyof typeof totals],
                tone: stage.tone,
                label: `${stage.label}: ${totals[stage.key as keyof typeof totals]}`,
              }))}
            />
          </>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ attention */

interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  tone: 'danger' | 'warn';
  to: string;
}

function AttentionPanel({ items, loading }: { items: AttentionItem[]; loading: boolean }) {
  return (
    <Panel>
      <PanelHeader
        title="Needs attention"
        description="Failures and stalled work, with the thing to open next."
        icon={<AlertOctagon />}
        actions={
          items.length > 0 ? (
            <Badge tone="danger" size="sm">
              {items.length}
            </Badge>
          ) : null
        }
      />
      {loading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          compact
          icon={<Sparkles />}
          title="Nothing is broken"
          description="No failed ingestion runs and no connectors in an error state."
        />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={item.to}
                className="flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-surface-2"
              >
                <span
                  className={cn(
                    'mt-1 size-1.5 shrink-0 rounded-full',
                    item.tone === 'danger' ? 'bg-danger' : 'bg-warn',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-ink">{item.title}</span>
                  <span className="mt-0.5 block text-2xs leading-relaxed text-ink-3">{item.detail}</span>
                </span>
                <ArrowUpRight className="mt-0.5 size-3 shrink-0 text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ page */

export default function OverviewPage() {
  const navigate = useNavigate();
  const knowledgeQuery = useKnowledgeBases({ page_size: 100 });
  const agentsQuery = useAgents();
  const connectorsQuery = useConnectors();
  const providersQuery = useProviders();
  const systemQuery = useSystemInfo();

  const kbs = React.useMemo(
    () => (knowledgeQuery.data?.items ?? []).filter((kb) => kb.id),
    [knowledgeQuery.data],
  );

  // One ingestion summary per knowledge base — the only honest source of document state.
  const summaryQueries = useQueries({
    queries: kbs.slice(0, 12).map((kb) => ({
      queryKey: KnowledgeKeys.summary(kb.id),
      queryFn: () =>
        api.get<IngestionSummary>(endpoints.kbIngestionSummary(kb.id)),
      enabled: Boolean(kb.id),
      staleTime: 20_000,
    })),
  });

  const summaries = summaryQueries.map((query) => query.data);
  const summariesLoading = summaryQueries.some((query) => query.isLoading);
  const summariesErrored = summaryQueries.length > 0 && summaryQueries.every((query) => query.isError);

  const totals = React.useMemo(
    () =>
      kbs.reduce(
        (acc, kb) => ({
          documents: acc.documents + (kb.document_count ?? 0),
          chunks: acc.chunks + (kb.chunk_count ?? 0),
          tokens: acc.tokens + (kb.token_count ?? 0),
        }),
        { documents: 0, chunks: 0, tokens: 0 },
      ),
    [kbs],
  );

  const attention = React.useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    (connectorsQuery.data ?? [])
      .filter((connector) => connector.status === 'error')
      .forEach((connector) =>
        items.push({
          id: `conn-${connector.id}`,
          title: connector.name,
          detail: connector.error ?? 'Connector reported an error on the last sync.',
          tone: 'danger',
          to: '/data-sources',
        }),
      );
    kbs.forEach((kb, index) => {
      const summary = summaries[index];
      if (!summary) return;
      if (summary.failed > 0) {
        items.push({
          id: `fail-${kb.id}`,
          title: `${summary.failed} document${summary.failed === 1 ? '' : 's'} failed in ${kb.name}`,
          detail: 'Open the knowledge base and re-run ingestion after fixing the parse configuration.',
          tone: 'danger',
          to: `/knowledge/${kb.id}`,
        });
      }
      if (summary.running > 0) {
        items.push({
          id: `run-${kb.id}`,
          title: `${summary.running} parsing in ${kb.name}`,
          detail: 'In progress — the list polls itself and updates when the run completes.',
          tone: 'warn',
          to: `/knowledge/${kb.id}`,
        });
      }
    });
    return items.slice(0, 6);
  }, [connectorsQuery.data, kbs, summaries]);

  const connectedProviders = (providersQuery.data ?? []).filter((p) => p.status === 'added');
  const modelCount = connectedProviders.reduce(
    (sum, provider) => sum + provider.instances.reduce((inner, instance) => inner + instance.models.length, 0),
    0,
  );

  const isFirstRun = !knowledgeQuery.isLoading && kbs.length === 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Everything OwnRAG is holding for you: corpus size, pipeline health, and the surfaces that need a decision."
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/retrieval">Test retrieval</Link>
            </Button>
            <Button variant="primary" size="sm" onClick={() => navigate('/knowledge?new=1')}>
              <Plus />
              New knowledge base
            </Button>
          </>
        }
        meta={
          systemQuery.data && (
            <>
              <Badge tone="outline" size="sm">
                {systemQuery.data.version}
              </Badge>
              <span className="font-mono text-2xs text-ink-3">
                {systemQuery.data.database ?? 'database'} · {systemQuery.data.storage ?? 'storage'} ·{' '}
                {systemQuery.data.doc_engine ?? 'parser'}
              </span>
            </>
          )
        }
      />

      <PageBody>
        {knowledgeQuery.isError ? (
          <Panel className="p-6">
            <ErrorState
              error={knowledgeQuery.error as { message?: string; code?: number }}
              title="The knowledge base list did not load"
              onRetry={() => knowledgeQuery.refetch()}
            />
          </Panel>
        ) : isFirstRun ? (
          <Panel className="p-2">
            <div className="px-6 py-12">
              <SectionHeader
                title="Start with a corpus you own"
                description="OwnRAG does nothing useful until it has documents. Three steps, in order."
              />
              <ol className="mt-6 grid gap-3 md:grid-cols-3">
                {[
                  {
                    step: '1',
                    title: 'Create a knowledge base',
                    body: 'Pick the embedding model you want vectors from and the chunking template that matches the document shape.',
                    to: '/knowledge?new=1',
                    cta: 'Create one',
                  },
                  {
                    step: '2',
                    title: 'Add and parse documents',
                    body: 'Upload files or connect Amazon S3, Google Drive or a web crawl. Ingestion shows per-stage progress and resumes from checkpoints.',
                    to: '/data-sources',
                    cta: 'Connect a source',
                  },
                  {
                    step: '3',
                    title: 'Ask grounded questions',
                    body: 'Chat with citations back to the exact chunk, or wire the same retrieval into an agent workflow.',
                    to: '/chat',
                    cta: 'Open chat',
                  },
                ].map((item) => (
                  <li key={item.step} className="rounded-lg border border-line bg-surface-1 p-4">
                    <span className="font-mono text-2xs text-accent">STEP {item.step}</span>
                    <p className="mt-2 text-sm font-medium text-ink">{item.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-3">{item.body}</p>
                    <Button variant="ghost" size="sm" className="mt-3 px-0" asChild>
                      <Link to={item.to}>
                        {item.cta}
                        <ArrowUpRight className="size-3" />
                      </Link>
                    </Button>
                  </li>
                ))}
              </ol>
            </div>
          </Panel>
        ) : (
          <div className="flex flex-col gap-4">
            {knowledgeQuery.isLoading ? (
              <StatsSkeleton count={4} />
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricTile
                  label="Knowledge bases"
                  value={formatNumber(kbs.length)}
                  icon={<Database />}
                  hint={`${kbs.filter((kb) => kb.permission === 'team').length} shared with the team`}
                  to="/knowledge"
                />
                <MetricTile
                  label="Documents"
                  value={formatCompact(totals.documents)}
                  icon={<FileStack />}
                  hint="Across all knowledge bases"
                  to="/knowledge"
                />
                <MetricTile
                  label="Indexed chunks"
                  value={formatCompact(totals.chunks)}
                  icon={<Layers />}
                  hint="Retrievable units"
                  to="/retrieval"
                />
                <MetricTile
                  label="Indexed tokens"
                  value={formatCompact(totals.tokens)}
                  icon={<Boxes />}
                  hint={`${modelCount} models available`}
                  to="/models"
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="flex flex-col gap-4 xl:col-span-2">
                <PipelinePanel
                  summaries={summaries}
                  loading={summariesLoading && summaries.length > 0}
                  hasError={summariesErrored}
                />

                <Panel>
                  <PanelHeader
                    title="Knowledge bases"
                    description="Ordered by most recently updated."
                    icon={<Database />}
                    actions={
                      <Button variant="ghost" size="xs" asChild>
                        <Link to="/knowledge">
                          View all
                          <ArrowUpRight className="size-3" />
                        </Link>
                      </Button>
                    }
                  />
                  <ul className="divide-y divide-line">
                    {kbs.slice(0, 5).map((kb) => {
                      const summaryIndex = kbs.indexOf(kb);
                      const summary = summaries[summaryIndex];
                      const health =
                        summary && summary.failed > 0
                          ? { tone: 'danger' as const, label: `${summary.failed} failed` }
                          : summary && summary.running > 0
                            ? { tone: 'warn' as const, label: `${summary.running} parsing` }
                            : summary && summary.unstart > 0
                              ? { tone: 'neutral' as const, label: `${summary.unstart} queued` }
                              : { tone: 'ok' as const, label: 'healthy' };
                      return (
                        <li key={kb.id}>
                          <Link
                            to={`/knowledge/${kb.id}`}
                            className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-inset font-mono text-2xs text-ink-2">
                              {kb.chunk_method.slice(0, 2).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs text-ink">{kb.name}</span>
                              <span className="mt-0.5 block truncate font-mono text-2xs text-ink-3">
                                {kb.embedding_model}
                              </span>
                            </span>
                            <span className="hidden shrink-0 gap-4 font-mono text-2xs text-ink-3 sm:flex">
                              <span>{formatCompact(kb.document_count)} docs</span>
                              <span>{formatCompact(kb.chunk_count)} chunks</span>
                            </span>
                            <Badge tone={health.tone} size="sm" className="shrink-0">
                              {health.label}
                            </Badge>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              </div>

              <div className="flex flex-col gap-4">
                <AttentionPanel items={attention} loading={connectorsQuery.isLoading || summariesLoading} />

                <Panel>
                  <PanelHeader
                    title="Agents"
                    description="Workflows built on this corpus."
                    icon={<Workflow />}
                    actions={
                      <Button variant="ghost" size="xs" asChild>
                        <Link to="/agents">
                          Open
                          <ArrowUpRight className="size-3" />
                        </Link>
                      </Button>
                    }
                  />
                  {agentsQuery.isLoading ? (
                    <div className="space-y-2 p-4">
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ) : (agentsQuery.data?.items ?? []).length === 0 ? (
                    <EmptyState
                      compact
                      icon={<Workflow />}
                      title="No agents yet"
                      description="Compose retrieval, tools and code into a workflow you can version."
                      action={
                        <Button size="sm" variant="secondary" asChild>
                          <Link to="/agents">Browse templates</Link>
                        </Button>
                      }
                    />
                  ) : (
                    <ul className="divide-y divide-line">
                      {(agentsQuery.data?.items ?? []).slice(0, 4).map((agent) => (
                        <li key={agent.id}>
                          <Link
                            to={`/agents/${agent.id}`}
                            className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-surface-2"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs text-ink">{agent.title}</span>
                              <span className="mt-0.5 block text-2xs text-ink-3">
                                {agent.dsl?.graph?.nodes?.length ?? 0} nodes ·{' '}
                                {agent.run_count ? `${formatCompact(agent.run_count)} runs` : 'never run'}
                              </span>
                            </span>
                            <Badge tone={agent.status === 'published' ? 'ok' : 'neutral'} size="sm">
                              {agent.status ?? 'draft'}
                            </Badge>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                <Panel>
                  <PanelHeader title="System" description="What this deployment is running on." icon={<Boxes />} />
                  <div className="p-4">
                    {systemQuery.isLoading ? (
                      <Skeleton className="h-20 w-full" />
                    ) : systemQuery.isError ? (
                      <EmptyState
                        compact
                        title="Version endpoint unavailable"
                        description="The console could not read /system/version."
                      />
                    ) : (
                      <dl className="grid grid-cols-2 gap-3">
                        {[
                          { label: 'Version', value: systemQuery.data?.version },
                          { label: 'Build', value: systemQuery.data?.build },
                          { label: 'Parser', value: systemQuery.data?.doc_engine },
                          { label: 'Storage', value: systemQuery.data?.storage },
                          { label: 'Database', value: systemQuery.data?.database },
                          { label: 'Key-value', value: systemQuery.data?.kvstore },
                        ].map((row) => (
                          <div key={row.label} className="min-w-0">
                            <dt className="text-2xs text-ink-3">{row.label}</dt>
                            <dd className="mt-0.5 truncate font-mono text-2xs text-ink">
                              {row.value ?? '—'}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <div className="mt-4 flex items-center gap-1.5 border-t border-line pt-3 text-2xs text-ink-3">
                      <Hint label="Derived from and modified from RAGFlow (Apache-2.0)">
                        <span className="cursor-default underline decoration-dotted underline-offset-2">
                          Derived from RAGFlow
                        </span>
                      </Hint>
                      <span>·</span>
                      <span>Apache-2.0</span>
                    </div>
                  </div>
                </Panel>
              </div>
            </div>

            {knowledgeQuery.isFetching && !knowledgeQuery.isLoading && (
              <p className="flex items-center gap-1.5 text-2xs text-ink-3">
                <Loader2 className="size-3 animate-spin" />
                Refreshing knowledge base state…
              </p>
            )}
            <p className="text-2xs text-ink-3">
              Corpus totals are summed from the knowledge base list; pipeline state is read per
              knowledge base from its ingestion summary. Last updated{' '}
              {formatRelativeTime(knowledgeQuery.dataUpdatedAt || undefined)}.
            </p>
          </div>
        )}
      </PageBody>
    </>
  );
}

/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * Knowledge base workspace — the operating surface for one corpus.
 *
 * Left: the document table with search, status filter and bulk actions.
 * Right: an inspector with the KB's settings, retrieval defaults and extracted metadata.
 *
 * Every list reads without query parameters so the same calls resolve against both the live
 * backend and the bundled demo corpus, which models these paths exactly (query strings
 * included in the URL would not match its handlers). Filtering, sorting and paging therefore
 * happen client-side over the loaded page of documents.
 */
import { Play, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { DocRunStatus } from '@/api/types';
import {
  useDeleteDocuments,
  useDocuments,
  useIngestionSummary,
  useKnowledgeBase,
  useStartIngestion,
} from '@/api/hooks';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ErrorState, InlineError, StatsSkeleton } from '@/components/ui/states';
import { Panel } from '@/components/ui/surface';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCompact, formatNumber, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DocumentsTable } from '@/pages/knowledge/components/documents-table';
import { KbMetadataPanel } from '@/pages/knowledge/components/kb-metadata-panel';
import { KbRetrievalPanel } from '@/pages/knowledge/components/kb-retrieval-panel';
import { KbSettingsForm } from '@/pages/knowledge/components/kb-settings-form';
import { UploadDialog } from '@/pages/knowledge/components/upload-dialog';

type RunFilter = 'ALL' | DocRunStatus;

const STAT_TONE: Record<string, string> = {
  neutral: 'text-ink',
  accent: 'text-accent',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
};

function StatTile({ label, value, tone = 'neutral' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <Panel elevation={1} className="px-3 py-2.5">
      <p className="text-2xs uppercase tracking-wide text-ink-3">{label}</p>
      <p className={cn('mt-1 font-mono text-lg', STAT_TONE[tone] ?? 'text-ink')}>{value}</p>
    </Panel>
  );
}

export default function KnowledgeDetailPage() {
  const { kbId = '' } = useParams();
  const navigate = useNavigate();

  const kbQuery = useKnowledgeBase(kbId);
  const summaryQuery = useIngestionSummary(kbId);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(30);
  const [keyword, setKeyword] = React.useState('');
  const [run, setRun] = React.useState<RunFilter>('ALL');
  // Debounce the search term: the input stays instant while the API sees one request per pause.
  const [debouncedKeyword, setDebouncedKeyword] = React.useState('');
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);
  // Paging, search and the status filter are server-side: the live handler reads
  // `keywords`/`page`/`page_size`/`run`, and the demo transport honours the same names, so
  // one request shape drives both. Filtering a single page on the client would make every
  // document past page one unreachable.
  const docsQuery = useDocuments(kbId, {
    keywords: debouncedKeyword.trim() || undefined,
    run: run === 'ALL' ? undefined : run,
    page,
    page_size: pageSize,
  });
  const startIngestion = useStartIngestion();
  const removeDocs = useDeleteDocuments();

  const [selected, setSelected] = React.useState<string[]>([]);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const kb = kbQuery.data;
  const allDocs = React.useMemo(() => docsQuery.data?.items ?? [], [docsQuery.data]);
  const serverTotal = docsQuery.data?.total ?? allDocs.length;

  // The server has already applied the keyword and status filters, so the returned items are
  // the page to render. `filtered` is kept as the single list the rest of the screen reads.
  const filtered = allDocs;

  React.useEffect(() => {
    setPage(1);
  }, [keyword, run, pageSize]);

  React.useEffect(() => {
    setSelected((previous) => {
      const next = previous.filter((id) => allDocs.some((doc) => doc.id === id));
      return next.length === previous.length ? previous : next;
    });
  }, [allDocs]);

  const pendingDocs = filtered.filter((doc) => doc.run === 'UNSTART' || doc.run === 'FAIL');

  const breadcrumb = (
    <>
      <Link to="/knowledge" className="transition-colors hover:text-ink">
        Knowledge
      </Link>
      <span>/</span>
      <span className="or-truncate text-ink-2">{kb?.name ?? 'Knowledge base'}</span>
    </>
  );

  if (kbQuery.isLoading) {
    return (
      <>
        <PageHeader title="Loading knowledge base…" breadcrumb={breadcrumb} />
        <PageBody>
          <div className="space-y-4">
            <StatsSkeleton count={4} />
            <Panel elevation={1} className="p-4">
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-9 rounded-md or-shimmer" />
                ))}
              </div>
            </Panel>
          </div>
        </PageBody>
      </>
    );
  }

  if (kbQuery.isError || !kb) {
    return (
      <>
        <PageHeader title="Knowledge base" breadcrumb={breadcrumb} />
        <PageBody>
          <ErrorState
            error={kbQuery.error}
            title="Could not load this knowledge base"
            onRetry={() => {
              void kbQuery.refetch();
            }}
          />
        </PageBody>
      </>
    );
  }

  const summary = summaryQuery.data;

  return (
    <>
      <PageHeader
        breadcrumb={breadcrumb}
        title={kb.name}
        description={kb.description}
        meta={
          <>
            <Badge tone="outline" size="sm">
              {titleCase(kb.chunk_method)} chunking
            </Badge>
            <Badge tone="outline" size="sm" className="font-mono">
              {kb.embedding_model}
            </Badge>
            <Badge tone={kb.permission === 'team' ? 'info' : 'neutral'} size="sm">
              {kb.permission === 'team' ? 'Team' : 'Private'}
            </Badge>
            <span className="font-mono text-2xs text-ink-3">
              {formatCompact(kb.document_count)} docs · {formatCompact(kb.chunk_count)} chunks ·{' '}
              {formatCompact(kb.token_count ?? 0)} tokens
            </span>
          </>
        }
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh"
              onClick={() => {
                void kbQuery.refetch();
                void docsQuery.refetch();
                void summaryQuery.refetch();
              }}
            >
              <RefreshCw />
            </Button>
            <Button variant="primary" size="md" onClick={() => setUploadOpen(true)}>
              <Upload />
              Upload
            </Button>
          </>
        }
      />
      <PageBody wide>
        <div className="space-y-4">
          {summaryQuery.isLoading ? (
            <StatsSkeleton count={4} />
          ) : (
            <div className="space-y-3">
              {summaryQuery.isError && (
                <InlineError
                  message="Ingestion summary is unavailable — document counts below come from the list only."
                  onRetry={() => {
                    void summaryQuery.refetch();
                  }}
                />
              )}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Documents" value={formatNumber(summary?.total ?? kb.document_count)} />
                <StatTile label="Indexed" value={summary ? formatNumber(summary.done) : '—'} tone="ok" />
                <StatTile label="Running" value={summary ? formatNumber(summary.running) : '—'} tone="accent" />
                <StatTile
                  label="Failed"
                  value={summary ? formatNumber(summary.failed) : '—'}
                  tone={summary?.failed ? 'danger' : 'neutral'}
                />
              </div>
            </div>
          )}

          {summary && summary.running > 0 && (
            <Panel elevation={0} className="flex items-center gap-3 border border-line-accent bg-accent-soft px-3 py-2">
              <Progress value={0} indeterminate className="w-24" />
              <p className="text-xs text-ink-2">
                {summary.running} document{summary.running === 1 ? '' : 's'} parsing — the list refreshes
                automatically.
              </p>
            </Panel>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-2 py-1.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
                  <Input
                    inputSize="sm"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="Search documents"
                    aria-label="Search documents"
                    className="w-52 pr-2.5 pl-7"
                  />
                </div>
                <Select value={run} onValueChange={(value) => setRun(value as RunFilter)}>
                  <SelectTrigger className="h-7 w-40 text-xs">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All statuses</SelectItem>
                    <SelectItem value="DONE">Indexed</SelectItem>
                    <SelectItem value="RUNNING">Running</SelectItem>
                    <SelectItem value="UNSTART">Not started</SelectItem>
                    <SelectItem value="FAIL">Failed</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex-1" />

                {selected.length > 0 ? (
                  <>
                    <span className="font-mono text-2xs text-ink-3">{selected.length} selected</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={startIngestion.isPending}
                      onClick={() => startIngestion.mutate({ kbId, documentIds: selected })}
                    >
                      <Play />
                      Run ingestion
                    </Button>
                    <Button size="sm" variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
                      <Trash2 />
                      Remove
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-2xs text-ink-3">
                      {filtered.length} shown
                      {serverTotal > allDocs.length ? ` · ${allDocs.length} of ${serverTotal} loaded` : ''}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pendingDocs.length === 0 || startIngestion.isPending}
                      loading={startIngestion.isPending}
                      onClick={() =>
                        startIngestion.mutate({ kbId, documentIds: pendingDocs.map((doc) => doc.id) })
                      }
                    >
                      <Play />
                      Ingest pending
                    </Button>
                  </>
                )}
              </div>

              <Panel elevation={1} className="flex max-h-[72vh] min-h-[420px] flex-col overflow-hidden">
                <DocumentsTable
                  documents={filtered}
                  loading={docsQuery.isLoading}
                  error={docsQuery.error}
                  onRetry={() => {
                    void docsQuery.refetch();
                  }}
                  page={page}
                  pageSize={pageSize}
                  // The server owns pagination: it returns one page and the true total, so the
                  // table must not slice again.
                  serverTotal={serverTotal}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  selected={selected}
                  onSelectedChange={setSelected}
                  onOpen={(doc) => navigate(`/knowledge/${kbId}/documents/${doc.id}`)}
                  onIngest={(ids) => startIngestion.mutate({ kbId, documentIds: ids })}
                  onDelete={(ids) => {
                    setSelected(ids);
                    setConfirmDelete(true);
                  }}
                  emptyAction={
                    <Button size="sm" variant="primary" onClick={() => setUploadOpen(true)}>
                      <Upload />
                      Upload documents
                    </Button>
                  }
                />
              </Panel>
            </div>

            <div className="min-w-0">
              <Panel elevation={1} className="overflow-hidden">
                <Tabs defaultValue="settings">
                  <TabsList className="px-3 pt-2">
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                    <TabsTrigger value="retrieval">Retrieval</TabsTrigger>
                    <TabsTrigger value="metadata">Metadata</TabsTrigger>
                  </TabsList>
                  <TabsContent value="settings" className="p-4">
                    <KbSettingsForm kb={kb} />
                  </TabsContent>
                  <TabsContent value="retrieval" className="p-4">
                    <KbRetrievalPanel kb={kb} />
                  </TabsContent>
                  <TabsContent value="metadata" className="p-4">
                    <KbMetadataPanel kbId={kb.id} />
                  </TabsContent>
                </Tabs>
              </Panel>
            </div>
          </div>
        </div>
      </PageBody>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} kbId={kbId} />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Remove ${selected.length} document${selected.length === 1 ? '' : 's'}?`}
        description="The documents, their chunks and their vectors are deleted permanently. This cannot be undone."
        confirmLabel="Remove documents"
        destructive
        loading={removeDocs.isPending}
        onConfirm={() =>
          removeDocs.mutate(
            { kbId, ids: selected },
            {
              onSuccess: () => {
                setSelected([]);
                setConfirmDelete(false);
              },
            },
          )
        }
      />
    </>
  );
}

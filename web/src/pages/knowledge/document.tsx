/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * Document viewer — inspect a single document's parsed chunks.
 *
 * The outline rail and the content pane read the same loaded page of chunks, so selecting a
 * chunk in one highlights and scrolls it in the other. As with the workspace, chunks are read
 * without query parameters (the demo transport matches paths exactly) and paged client-side.
 */
import { ArrowLeft, Play, RefreshCw, Search } from 'lucide-react';
import * as React from 'react';
import { Link, useParams } from 'react-router';
import { useDocument, useDocumentChunks, useKnowledgeBase, useStartIngestion } from '@/api/hooks';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/controls';
import { Input } from '@/components/ui/input';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { Panel } from '@/components/ui/surface';
import { formatBytes, formatCompact, formatDateTime, titleCase } from '@/lib/format';
import { ChunkOutline } from '@/pages/knowledge/components/chunk-outline';
import { DocumentViewer } from '@/pages/knowledge/components/document-viewer';
import { RunStatusBadge } from '@/pages/knowledge/components/documents-table';

export default function DocumentPage() {
  const { kbId = '', docId = '' } = useParams();
  const kbQuery = useKnowledgeBase(kbId);
  const docQuery = useDocument(kbId, docId);
  const chunksQuery = useDocumentChunks(kbId, docId);
  const startIngestion = useStartIngestion();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [activeId, setActiveId] = React.useState<string | undefined>();
  const [filter, setFilter] = React.useState('');

  const doc = docQuery.data;
  const allChunks = React.useMemo(() => chunksQuery.data?.items ?? [], [chunksQuery.data]);

  const filteredChunks = React.useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return allChunks;
    return allChunks.filter(
      (chunk) =>
        chunk.content_with_weight.toLowerCase().includes(query) ||
        (chunk.important_kwd ?? []).some((keyword) => keyword.toLowerCase().includes(query)),
    );
  }, [allChunks, filter]);

  React.useEffect(() => {
    setPage(1);
  }, [filter, pageSize]);

  const total = filteredChunks.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const pageChunks = React.useMemo(
    () => filteredChunks.slice((current - 1) * pageSize, current * pageSize),
    [filteredChunks, current, pageSize],
  );

  // Keep the selected chunk on the visible page.
  React.useEffect(() => {
    if (pageChunks.length === 0) return;
    if (!activeId || !pageChunks.some((chunk) => chunk.id === activeId)) {
      setActiveId(pageChunks[0]?.id);
    }
  }, [pageChunks, activeId]);

  // A running document keeps refreshing until parsing settles.
  const refetchDoc = docQuery.refetch;
  const refetchChunks = chunksQuery.refetch;
  React.useEffect(() => {
    if (doc?.run !== 'RUNNING') return;
    const timer = window.setInterval(() => {
      void refetchDoc();
      void refetchChunks();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [doc?.run, refetchDoc, refetchChunks]);

  const breadcrumb = (
    <>
      <Link to="/knowledge" className="transition-colors hover:text-ink">
        Knowledge
      </Link>
      <span>/</span>
      <Link to={`/knowledge/${kbId}`} className="or-truncate transition-colors hover:text-ink">
        {kbQuery.data?.name ?? 'Knowledge base'}
      </Link>
      <span>/</span>
      <span className="or-truncate text-ink-2">{doc?.name ?? 'Document'}</span>
    </>
  );

  if (docQuery.isLoading) {
    return (
      <>
        <PageHeader title="Loading document…" breadcrumb={breadcrumb} />
        <PageBody>
          <Panel elevation={1} className="overflow-hidden">
            <TableSkeleton rows={8} columns={4} />
          </Panel>
        </PageBody>
      </>
    );
  }

  if (docQuery.isError || !doc) {
    return (
      <>
        <PageHeader title="Document" breadcrumb={breadcrumb} />
        <PageBody>
          <ErrorState
            error={docQuery.error}
            title="Could not load this document"
            onRetry={() => {
              void docQuery.refetch();
            }}
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={breadcrumb}
        title={doc.name}
        description={doc.location ?? doc.source_type}
        meta={
          <>
            <RunStatusBadge run={doc.run} />
            <Badge tone="outline" size="sm" className="uppercase">
              {doc.type}
            </Badge>
            {doc.parser_id && (
              <Badge tone="outline" size="sm">
                {titleCase(doc.parser_id)}
              </Badge>
            )}
            <span className="font-mono text-2xs text-ink-3">
              {formatCompact(doc.chunk_count)} chunks · {formatCompact(doc.token_count ?? 0)} tokens ·{' '}
              {formatBytes(doc.size)}
            </span>
            <span className="font-mono text-2xs text-ink-3">
              updated {formatDateTime(doc.update_time ?? doc.create_time)}
            </span>
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="icon" asChild aria-label="Back to knowledge base">
              <Link to={`/knowledge/${kbId}`}>
                <ArrowLeft />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh"
              onClick={() => {
                void docQuery.refetch();
                void chunksQuery.refetch();
              }}
            >
              <RefreshCw />
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={startIngestion.isPending}
              disabled={doc.run === 'RUNNING'}
              onClick={() =>
                startIngestion.mutate(
                  { kbId, documentIds: [docId] },
                  {
                    onSuccess: () => {
                      void docQuery.refetch();
                      void chunksQuery.refetch();
                    },
                  },
                )
              }
            >
              <Play />
              {doc.run === 'DONE' ? 'Re-index' : 'Run ingestion'}
            </Button>
          </>
        }
      />
      <PageBody wide>
        <div className="flex flex-col gap-4">
          {doc.run === 'RUNNING' && (
            <Panel elevation={0} className="flex items-center gap-3 border border-line-accent bg-accent-soft px-3 py-2">
              <Progress value={doc.progress} className="w-40" />
              <p className="min-w-0 flex-1 text-xs text-ink-2">
                {doc.progress_msg ?? 'Parsing in progress…'}
              </p>
              <span className="font-mono text-2xs text-ink-3">{Math.round(doc.progress * 100)}%</span>
            </Panel>
          )}

          <div className="relative mb-0 flex items-center gap-1.5">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
            <Input
              inputSize="sm"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter chunks in this page"
              aria-label="Filter chunks"
              className="w-64 pr-2.5 pl-7"
            />
            <span className="font-mono text-2xs text-ink-3">{total} chunks</span>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)]">
            <ChunkOutline
              chunks={pageChunks}
              activeId={activeId}
              onSelect={setActiveId}
              loading={chunksQuery.isLoading}
              error={chunksQuery.error}
              onRetry={() => {
                void chunksQuery.refetch();
              }}
              total={total}
              page={current}
              pageSize={pageSize}
              onPageChange={setPage}
            />
            <DocumentViewer
              document={doc}
              chunks={pageChunks}
              activeId={activeId}
              onSelect={setActiveId}
              loading={chunksQuery.isLoading}
              error={chunksQuery.error}
              onRetry={() => {
                void chunksQuery.refetch();
              }}
              total={total}
              page={current}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        </div>
      </PageBody>
    </>
  );
}

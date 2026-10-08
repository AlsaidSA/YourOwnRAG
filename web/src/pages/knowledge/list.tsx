/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * /knowledge — the knowledge-base list and creation entry point.
 *
 * Server truth comes from GET /api/v1/datasets (keyword + pagination) and the tag aggregation
 * endpoint; creation and deletion go through the shared mutations. The screen is the same in
 * live and demo mode — only the copy changes when the console is reading the bundled corpus.
 */
import { Database, Plus, RefreshCw, Search, Tag, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useDeleteKnowledgeBase, useKbTags, useKnowledgeBases } from '@/api/hooks';
import type { KnowledgeBase } from '@/api/types';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { TablePagination } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { Toolbar } from '@/components/ui/surface';
import { formatNumber } from '@/lib/format';
import { useUiStore } from '@/store/ui';
import { CreateKbDialog } from '@/pages/knowledge/components/create-kb-dialog';
import { KbCard } from '@/pages/knowledge/components/kb-card';

const PAGE_SIZE = 24;
const ALL_TAGS = '__all_tags__';

const SORT_OPTIONS = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'documents', label: 'Most documents' },
  { value: 'chunks', label: 'Most chunks' },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]['value'];

function compareKbs(a: KnowledgeBase, b: KnowledgeBase, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'documents':
      return b.document_count - a.document_count;
    case 'chunks':
      return b.chunk_count - a.chunk_count;
    case 'recent':
      return (b.update_time ?? b.create_time ?? 0) - (a.update_time ?? a.create_time ?? 0);
    default:
      return 0;
  }
}

export default function KnowledgeListPage() {
  const demoMode = useUiStore((state) => state.demoMode);

  const [search, setSearch] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<KnowledgeBase | null>(null);

  // Debounce the search box so every keystroke does not become a request.
  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  // A new term invalidates the current page offset.
  useEffect(() => {
    setPage(1);
  }, [keyword]);

  const params = useMemo(
    () => ({ keyword: keyword || undefined, page, page_size: PAGE_SIZE }),
    [keyword, page],
  );

  const query = useKnowledgeBases(params);
  const tagsQuery = useKbTags();
  const remove = useDeleteKnowledgeBase();

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const tagOptions = useMemo(
    () => Object.entries(tagsQuery.data ?? {}).sort((a, b) => b[1] - a[1]),
    [tagsQuery.data],
  );

  const visible = useMemo(() => {
    const filtered = tag ? items.filter((kb) => (kb.tags ?? []).includes(tag)) : items;
    return [...filtered].sort((a, b) => compareKbs(a, b, sort));
  }, [items, tag, sort]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const isSearch = keyword.length > 0;
  const isTagEmpty = total > 0 && visible.length === 0;

  return (
    <>
      <PageHeader
        title="Knowledge bases"
        description="Every corpus the console can retrieve from. Open one to inspect ingestion, chunks and retrieval settings."
        meta={
          <>
            <Badge tone="neutral" size="md">
              {formatNumber(total)} total
            </Badge>
            {demoMode && (
              <Badge tone="info" size="md" dot>
                Demo corpus
              </Badge>
            )}
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={query.isFetching ? 'animate-spin' : undefined} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
              <Plus />
              New knowledge base
            </Button>
          </>
        }
      />

      <PageBody>
        <Toolbar className="mb-4 gap-2">
          <div className="relative w-full min-w-0 sm:w-auto sm:flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or description"
              className="pl-8 pr-8"
              aria-label="Search knowledge bases"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {tagOptions.length > 0 && (
            <Select value={tag || ALL_TAGS} onValueChange={(value) => setTag(value === ALL_TAGS ? '' : value)}>
              <SelectTrigger className="w-full sm:w-[11rem]" aria-label="Filter by tag">
                <SelectValue placeholder="All tags" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TAGS}>All tags</SelectItem>
                {tagOptions.map(([name, count]) => (
                  <SelectItem key={name} value={name}>
                    <span className="flex w-full items-center justify-between gap-3">
                      <span className="or-truncate">{name}</span>
                      <span className="font-mono text-2xs text-ink-3">{count}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
            <SelectTrigger className="w-full sm:w-[11rem]" aria-label="Sort knowledge bases">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Toolbar>

        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.isLoading ? (
          <CardGridSkeleton count={6} />
        ) : total === 0 ? (
          <EmptyState
            icon={<Database />}
            title={isSearch ? `No knowledge bases match “${keyword}”` : 'No knowledge bases yet'}
            description={
              isSearch
                ? 'Nothing matched that term. Try a different search, or clear it to see every corpus.'
                : 'A knowledge base is the unit of retrieval: upload documents, parse them into chunks, then point an assistant or agent at it.'
            }
            action={
              isSearch ? (
                <Button variant="secondary" size="md" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              ) : (
                <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
                  <Plus />
                  New knowledge base
                </Button>
              )
            }
          />
        ) : isTagEmpty ? (
          <EmptyState
            icon={<Tag />}
            compact
            title={`No knowledge bases tagged “${tag}” on this page`}
            description="The tag filter narrows the results already loaded. Clear it, or search to bring the matching corpus into view."
            action={
              <Button variant="secondary" size="md" onClick={() => setTag('')}>
                Clear tag filter
              </Button>
            }
          />
        ) : (
          <>
            <p className="mb-3 text-xs text-ink-3">
              Showing <span className="font-mono text-ink-2">{visible.length}</span> of{' '}
              <span className="font-mono text-ink-2">{formatNumber(total)}</span>
              {tag && (
                <>
                  {' '}
                  tagged <span className="font-mono text-ink-2">{tag}</span>
                </>
              )}
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((kb) => (
                <KbCard key={kb.id} kb={kb} onDelete={setPendingDelete} />
              ))}
            </div>
            {total > PAGE_SIZE && (
              <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface-1">
                <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </PageBody>

      <CreateKbDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          // Dismissible even mid-flight. Refusing to close while the delete was pending trapped the
          // whole page behind an unclosable modal whenever the engine was slow to answer.
          if (!next) setPendingDelete(null);
        }}
        title={pendingDelete ? `Delete “${pendingDelete.name}”?` : 'Delete knowledge base?'}
        description="This removes the knowledge base, its documents and every indexed chunk. Retrieval stops returning them immediately. This cannot be undone."
        confirmLabel="Delete knowledge base"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          // Close on settle, never on success alone: a rejected delete used to leave this modal
          // mounted, and a dialog that never unmounts blocks every click on the page.
          remove.mutate([pendingDelete.id], { onSettled: () => setPendingDelete(null) });
        }}
      />
    </>
  );
}

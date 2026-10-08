/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * DocumentsTable — the dense document list for a knowledge base. Paging, sorting and the
 * four async states are owned here so detail.tsx only manages filters, selection and
 * mutations. The table never fetches: it renders exactly what it is handed.
 */
import {
  FileSpreadsheet,
  FileText,
  FileType2,
  MoreHorizontal,
  Play,
  Trash2,
  Eye,
} from 'lucide-react';
import * as React from 'react';
import type { DocRunStatus, KbDocument } from '@/api/types';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/controls';
import { DataTable, type Column } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ErrorLike } from '@/components/ui/states';
import { formatBytes, formatCompact, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const RUN_TONE: Record<DocRunStatus, NonNullable<BadgeProps['tone']>> = {
  DONE: 'ok',
  RUNNING: 'accent',
  UNSTART: 'neutral',
  FAIL: 'danger',
  CANCEL: 'warn',
  NEEDS_OCR: 'warn',
  REJECTED: 'danger',
};

const RUN_LABEL: Record<DocRunStatus, string> = {
  DONE: 'Indexed',
  RUNNING: 'Running',
  UNSTART: 'Not started',
  NEEDS_OCR: 'Needs OCR',
  REJECTED: 'Unreadable',
  FAIL: 'Failed',
  CANCEL: 'Cancelled',
};

/** Shared status pill — also used by the document viewer header. */
export function RunStatusBadge({ run }: { run: DocRunStatus }) {
  return (
    <Badge tone={RUN_TONE[run]} size="sm" dot>
      {RUN_LABEL[run]}
    </Badge>
  );
}

const SHEET_EXT = new Set(['xls', 'xlsx', 'csv', 'tsv']);
const DOC_EXT = new Set(['doc', 'docx', 'pdf', 'md', 'txt', 'rtf']);

function DocTypeIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const Icon = SHEET_EXT.has(ext) ? FileSpreadsheet : DOC_EXT.has(ext) ? FileText : FileType2;
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-ink-3 [&_svg]:size-3.5">
      <Icon />
    </span>
  );
}

type SortDirection = 'asc' | 'desc';

export interface DocumentsTableProps {
  /** The full, already-filtered document set. The table sorts and pages it locally. */
  documents: KbDocument[];
  loading?: boolean;
  error?: ErrorLike | null;
  onRetry?: () => void;
  page: number;
  pageSize: number;
  /** Set when the API paginates; omit for a fully-loaded list that the table should slice itself. */
  serverTotal?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  selected: string[];
  onSelectedChange: (keys: string[]) => void;
  onOpen: (doc: KbDocument) => void;
  onIngest: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
  emptyAction?: React.ReactNode;
}

export function DocumentsTable({
  documents,
  loading,
  error,
  onRetry,
  page,
  pageSize,
  serverTotal,
  onPageChange,
  onPageSizeChange,
  selected,
  onSelectedChange,
  onOpen,
  onIngest,
  onDelete,
  emptyAction,
}: DocumentsTableProps) {
  const [sort, setSort] = React.useState<{ key: string; direction: SortDirection } | undefined>({
    key: 'update_time',
    direction: 'desc',
  });

  const sorted = React.useMemo(() => {
    const copy = [...documents];
    if (!sort) return copy;
    const dir = sort.direction === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      let left: number | string;
      let right: number | string;
      switch (sort.key) {
        case 'name':
          left = a.name.toLowerCase();
          right = b.name.toLowerCase();
          break;
        case 'chunk_count':
          left = a.chunk_count;
          right = b.chunk_count;
          break;
        case 'token_count':
          left = a.token_count ?? 0;
          right = b.token_count ?? 0;
          break;
        case 'size':
          left = a.size;
          right = b.size;
          break;
        default:
          left = a.update_time ?? a.create_time ?? 0;
          right = b.update_time ?? b.create_time ?? 0;
      }
      if (left < right) return -1 * dir;
      if (left > right) return 1 * dir;
      return 0;
    });
    return copy;
  }, [documents, sort]);

  const total = serverTotal ?? sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  // When the server paginates, the payload already is one page — slicing again would show a
  // fraction of a page. Client-side slicing only applies to fully-loaded lists.
  const rows = serverTotal === undefined ? sorted.slice((current - 1) * pageSize, current * pageSize) : sorted;

  const columns: Column<KbDocument>[] = [
    {
      key: 'name',
      header: 'Document',
      width: '42%',
      sortable: true,
      render: (doc) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <DocTypeIcon name={doc.name} />
          <div className="min-w-0">
            <p className="or-truncate text-sm text-ink" title={doc.name}>
              {doc.name}
            </p>
            <p className="mt-0.5 or-truncate font-mono text-2xs uppercase text-ink-3">
              {doc.type}
              {doc.source_type ? ` · ${doc.source_type}` : ''}
              {doc.parser_id ? ` · ${doc.parser_id}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'run',
      header: 'Status',
      width: '180px',
      render: (doc) => (
        <div className="min-w-[140px]">
          <RunStatusBadge run={doc.run} />
          {doc.run === 'RUNNING' && (
            <div className="mt-1.5 max-w-[160px]">
              <Progress value={doc.progress} />
              {doc.progress_msg && (
                <p className="mt-1 or-truncate text-2xs text-ink-3" title={doc.progress_msg}>
                  {doc.progress_msg}
                </p>
              )}
            </div>
          )}
          {doc.run === 'FAIL' && doc.progress_msg && (
            <p className="mt-1 max-w-[160px] or-truncate text-2xs text-danger" title={doc.progress_msg}>
              {doc.progress_msg}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'chunk_count',
      header: 'Chunks',
      align: 'right',
      width: '88px',
      sortable: true,
      render: (doc) => <span className="font-mono text-xs text-ink-2">{formatCompact(doc.chunk_count)}</span>,
    },
    {
      key: 'token_count',
      header: 'Tokens',
      align: 'right',
      width: '96px',
      sortable: true,
      render: (doc) => (
        <span className="font-mono text-xs text-ink-3">{formatCompact(doc.token_count ?? 0)}</span>
      ),
    },
    {
      key: 'size',
      header: 'Size',
      align: 'right',
      width: '80px',
      sortable: true,
      render: (doc) => <span className="font-mono text-xs text-ink-3">{formatBytes(doc.size)}</span>,
    },
    {
      key: 'update_time',
      header: 'Updated',
      align: 'right',
      width: '120px',
      sortable: true,
      render: (doc) => (
        <span className="font-mono text-2xs text-ink-3">{formatDateTime(doc.update_time ?? doc.create_time)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '44px',
      render: (doc) => (
        <span onClick={(event) => event.stopPropagation()} className="inline-flex">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${doc.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<Eye />} onSelect={() => onOpen(doc)}>
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<Play />}
                disabled={doc.run === 'RUNNING'}
                onSelect={() => onIngest([doc.id])}
              >
                Run ingestion
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive icon={<Trash2 />} onSelect={() => onDelete([doc.id])}>
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      emptyTitle="No documents to show"
      emptyDescription="Upload documents, or clear the filters to see documents already in this knowledge base."
      emptyAction={emptyAction}
      onRowClick={onOpen}
      selectedKeys={selected}
      onSelectedKeysChange={onSelectedChange}
      page={current}
      pageSize={pageSize}
      total={total}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      sort={sort}
      onSortChange={(next) => {
        setSort(next);
        onPageChange(1);
      }}
      rowClassName={() => cn('cursor-pointer')}
    />
  );
}

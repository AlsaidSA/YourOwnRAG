/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Dense table primitives plus a DataTable that owns the four async states.
 * Rows are 36px: this is an instrument panel, not a marketing table.
 */
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/controls';
import { EmptyState, ErrorState, TableSkeleton, type ErrorLike } from '@/components/ui/states';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="or-scroll w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('sticky top-0 z-10 bg-surface-1 [&_th]:border-b [&_th]:border-line', className)}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-line', className)} {...props} />;
}

export function TR({
  className,
  interactive,
  selected,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean; selected?: boolean }) {
  return (
    <tr
      className={cn(
        'group transition-colors',
        interactive && 'cursor-pointer hover:bg-surface-2',
        selected && 'bg-accent-soft hover:bg-accent-soft-strong',
        className,
      )}
      {...props}
    />
  );
}

export function TH({
  className,
  align = 'left',
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      className={cn(
        'whitespace-nowrap px-3 py-2 text-2xs font-medium uppercase tracking-wide text-ink-3',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  align = 'left',
  mono,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center'; mono?: boolean }) {
  return (
    <td
      className={cn(
        'px-3 py-2 align-middle text-sm text-ink-2',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        mono && 'font-mono text-xs',
        className,
      )}
      {...props}
    />
  );
}

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  width?: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  className?: string;
  render: (row: T, index: number) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  error?: ErrorLike | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  onRowClick?: (row: T) => void;
  selectedKeys?: string[];
  onSelectedKeysChange?: (keys: string[]) => void;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  sort?: { key: string; direction: 'asc' | 'desc' };
  onSortChange?: (sort: { key: string; direction: 'asc' | 'desc' } | undefined) => void;
  rowClassName?: (row: T) => string | undefined;
  footer?: React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  onRowClick,
  selectedKeys,
  onSelectedKeysChange,
  page = 1,
  pageSize = 30,
  total,
  onPageChange,
  onPageSizeChange,
  sort,
  onSortChange,
  rowClassName,
  footer,
}: DataTableProps<T>) {
  const selectable = Boolean(selectedKeys && onSelectedKeysChange);
  const visibleKeys = rows.map((row, index) => rowKey(row, index));
  const allSelected = selectable && visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys!.includes(key));
  const someSelected = selectable && visibleKeys.some((key) => selectedKeys!.includes(key));

  if (error) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="or-scroll min-h-0 flex-1 overflow-auto">
        <Table>
          <THead>
            <tr>
              {selectable && (
                <TH className="w-9 pr-0">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={(checked) =>
                      onSelectedKeysChange!(checked ? Array.from(new Set([...(selectedKeys ?? []), ...visibleKeys])) : [])
                    }
                    aria-label="Select all rows"
                  />
                </TH>
              )}
              {columns.map((column) => (
                <TH
                  key={column.key}
                  align={column.align}
                  style={column.width ? { width: column.width } : undefined}
                  className={column.className}
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 transition-colors hover:text-ink"
                      onClick={() =>
                        onSortChange(
                          sort?.key === column.key
                            ? sort.direction === 'desc'
                              ? { key: column.key, direction: 'asc' }
                              : undefined
                            : { key: column.key, direction: 'desc' },
                        )
                      }
                    >
                      {column.header}
                      {sort?.key === column.key &&
                        (sort.direction === 'desc' ? (
                          <ArrowDown className="size-3" />
                        ) : (
                          <ArrowUp className="size-3" />
                        ))}
                    </button>
                  ) : (
                    column.header
                  )}
                </TH>
              ))}
            </tr>
          </THead>
          {!loading && (
            <TBody>
              {rows.map((row, index) => {
                const key = rowKey(row, index);
                return (
                  <TR
                    key={key}
                    interactive={Boolean(onRowClick)}
                    selected={selectedKeys?.includes(key)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={rowClassName?.(row)}
                  >
                    {selectable && (
                      <TD className="w-9 pr-0">
                        <span onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            checked={selectedKeys!.includes(key)}
                            onCheckedChange={(checked) =>
                              onSelectedKeysChange!(
                                checked
                                  ? [...selectedKeys!, key]
                                  : selectedKeys!.filter((k) => k !== key),
                              )
                            }
                            aria-label="Select row"
                          />
                        </span>
                      </TD>
                    )}
                    {columns.map((column) => (
                      <TD key={column.key} align={column.align} className={column.className}>
                        {column.render(row, index)}
                      </TD>
                    ))}
                  </TR>
                );
              })}
            </TBody>
          )}
        </Table>
        {loading && <TableSkeleton rows={6} columns={columns.length + (selectable ? 1 : 0)} />}
        {!loading && rows.length === 0 && (
          <EmptyState icon={<Inbox />} title={emptyTitle} description={emptyDescription} action={emptyAction} />
        )}
      </div>
      {footer}
      {total !== undefined && onPageChange && total > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </div>
  );
}

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-3 py-2">
      <p className="font-mono text-2xs text-ink-3">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-1.5">
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-6 rounded border border-line bg-inset px-1 font-mono text-2xs text-ink-2"
            aria-label="Rows per page"
          >
            {[10, 20, 30, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        <span className="font-mono text-2xs text-ink-3">
          {page}/{pages}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

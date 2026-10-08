/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * Memory — the long-lived stores that carry context across agent sessions. A store is either
 * raw (verbatim turns, keyed lookups) or semantic (embedded and recall-ranked); this screen
 * lists both, shows how much each holds, and owns their lifecycle.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Brain,
  Database,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { api, ApiError } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import { SystemKeys } from '@/api/hooks';
import type { MemoryRecord } from '@/api/types';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, Field } from '@/components/ui/input';
import { Segmented, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { Panel, Toolbar } from '@/components/ui/surface';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toaster';
import { formatNumber, formatRelativeTime } from '@/lib/format';

type MemoryType = MemoryRecord['memory_type'];

const STORAGE_TYPES = [
  { value: 'vector', label: 'Vector index' },
  { value: 'table', label: 'Relational table' },
  { value: 'kv', label: 'Key–value store' },
];

function useMemoriesQuery() {
  return useQuery({
    queryKey: SystemKeys.memory(),
    queryFn: () => api.get<MemoryRecord[]>(endpoints.memoryList),
  });
}

function useSaveMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id?: string; body: Record<string, unknown> }): Promise<unknown> =>
      id ? api.put<boolean>(endpoints.memoryDetail(id), body) : api.post<MemoryRecord>(endpoints.memoryList, body),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: SystemKeys.memory() });
      toast({ title: variables.id ? 'Memory store updated' : 'Memory store created', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not save the memory store', description: error.message, variant: 'error' }),
  });
}

function useDeleteMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<boolean>(endpoints.memoryDetail(id)),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: SystemKeys.memory() });
      toast({ title: 'Memory store deleted', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not delete the memory store', description: error.message, variant: 'error' }),
  });
}

export default function MemoryPage() {
  const { data: memories, isLoading, isError, error, refetch } = useMemoriesQuery();
  const remove = useDeleteMemory();
  const [filter, setFilter] = React.useState<'all' | MemoryType>('all');
  const [editing, setEditing] = React.useState<MemoryRecord | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<MemoryRecord | null>(null);

  const all = memories ?? [];
  const rows = filter === 'all' ? all : all.filter((m) => m.memory_type === filter);

  const semantic = all.filter((m) => m.memory_type === 'semantic').length;
  const totalMessages = all.reduce((sum, m) => sum + m.message_count, 0);

  return (
    <>
      <PageHeader
        title="Memory"
        description="Stores that persist context between sessions so agents remember what happened last time. Raw stores keep turns verbatim; semantic stores embed them for recall."
        meta={
          <>
            <Badge tone={all.length > 0 ? 'accent' : 'neutral'} dot>
              {all.length} store{all.length === 1 ? '' : 's'}
            </Badge>
            <Badge tone="outline">{semantic} semantic</Badge>
            <Badge tone="outline">{all.length - semantic} raw</Badge>
            <Badge tone="neutral">{formatNumber(totalMessages)} messages</Badge>
          </>
        }
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New store
          </Button>
        }
      />

      <PageBody>
        {all.length > 0 && (
          <Toolbar className="mb-4 justify-between">
            <Segmented
              value={filter}
              onValueChange={(value) => setFilter(value as 'all' | MemoryType)}
              options={[
                { value: 'all', label: 'All' },
                { value: 'raw', label: 'Raw' },
                { value: 'semantic', label: 'Semantic' },
              ]}
            />
            <span className="px-1 text-2xs text-ink-3">
              {rows.length} shown · {formatNumber(rows.reduce((s, m) => s + m.message_count, 0))} messages
            </span>
          </Toolbar>
        )}

        {isLoading ? (
          <CardGridSkeleton count={4} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Brain />}
            title="No memory stores yet"
            description="Create a store to give agents long-term recall. Raw stores hold conversation turns for exact replay; semantic stores embed them so agents can retrieve relevant memories by meaning."
            action={
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Plus />
                New memory store
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon={<Brain />}
            title={`No ${filter} stores`}
            description={`None of your ${all.length} stores are of type "${filter}". Switch the filter to see the others.`}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                onEdit={() => setEditing(memory)}
                onDelete={() => setPendingDelete(memory)}
              />
            ))}
          </div>
        )}
      </PageBody>

      {(creating || editing) && (
        <MemoryFormDialog
          record={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this memory store?"
        description={
          pendingDelete
            ? `“${pendingDelete.name}” holds ${formatNumber(pendingDelete.message_count)} messages. Agents using it lose their recall history; this cannot be undone.`
            : undefined
        }
        confirmLabel="Delete store"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (pendingDelete) {
            remove.mutate(pendingDelete.id, { onSuccess: () => setPendingDelete(null) });
          }
        }}
      />
    </>
  );
}

function MemoryCard({
  memory,
  onEdit,
  onDelete,
}: {
  memory: MemoryRecord;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const semantic = memory.memory_type === 'semantic';
  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-ink-3 [&_svg]:size-4">
            {semantic ? <Sparkles /> : <Layers />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{memory.name}</p>
            <p className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-ink-3">
              {memory.description || 'No description'}
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Memory actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={<Pencil />} onClick={onEdit}>
              Edit store
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive icon={<Trash2 />} onClick={onDelete}>
              Delete store
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-line pt-3">
        <Stat label="Messages" value={formatNumber(memory.message_count)} />
        <Stat label="Type" value={semantic ? 'Semantic' : 'Raw'} />
        <Stat label="Storage" value={memory.storage_type ?? '—'} mono />
      </div>

      <div className="flex items-center justify-between border-t border-line pt-2.5">
        <Badge tone={semantic ? 'accent' : 'outline'} size="sm">
          {semantic ? 'semantic recall' : 'verbatim turns'}
        </Badge>
        <span className="text-2xs text-ink-3">
          {memory.create_time ? `created ${formatRelativeTime(memory.create_time)}` : memory.id}
        </span>
      </div>
    </Panel>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs uppercase tracking-wide text-ink-3">{label}</p>
      <p className={`mt-0.5 truncate text-sm text-ink ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}

function MemoryFormDialog({ record, onClose }: { record: MemoryRecord | null; onClose: () => void }) {
  const save = useSaveMemory();
  const [name, setName] = React.useState(record?.name ?? '');
  const [description, setDescription] = React.useState(record?.description ?? '');
  const [memoryType, setMemoryType] = React.useState<MemoryType>(record?.memory_type ?? 'semantic');
  const [storageType, setStorageType] = React.useState(record?.storage_type ?? 'vector');

  const submit = () => {
    if (!name.trim()) {
      toast({ title: 'Name the memory store', variant: 'error' });
      return;
    }
    save.mutate(
      {
        id: record?.id,
        body: {
          name: name.trim(),
          description: description.trim(),
          memory_type: memoryType,
          storage_type: storageType,
        },
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader
          title={record ? 'Edit memory store' : 'New memory store'}
          description="A store backs one class of recall. Agents attach to it; how it stores memory is set once."
        />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Support agent memory" />
          </Field>
          <Field label="Description" hint="What this store is for — shown to whoever attaches it.">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Resolved-ticket context carried across support sessions."
              rows={2}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <Label>Memory type</Label>
            <Segmented
              value={memoryType}
              onValueChange={(value) => setMemoryType(value as MemoryType)}
              options={[
                { value: 'raw', label: 'Raw', icon: <Layers className="size-3.5" /> },
                { value: 'semantic', label: 'Semantic', icon: <Sparkles className="size-3.5" /> },
              ]}
            />
            <p className="text-2xs text-ink-3">
              {memoryType === 'raw'
                ? 'Raw stores keep turns verbatim and are read back by key — precise, no embedding cost.'
                : 'Semantic stores embed turns so recall is ranked by meaning — better for fuzzy, long-horizon context.'}
            </p>
          </div>
          <Field label="Storage type" hint="Where the store is physically kept on this deployment.">
            <Select value={storageType} onValueChange={setStorageType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STORAGE_TYPES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={save.isPending} onClick={submit}>
            <Database />
            {record ? 'Save changes' : 'Create store'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

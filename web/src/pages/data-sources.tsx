/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * Data sources — the connectors that push outside content into knowledge bases. Each row
 * carries its live sync state, the cron schedule that drives it, when it last ran and how
 * much it brought in, with test / sync / pause acting in place.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Database,
  FileText,
  Folder,
  Globe,
  HardDrive,
  Hash,
  Inbox,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Package,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { api, ApiError, isDemoMode } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import { SystemKeys, useConnectors, useConnectorSources, useKnowledgeBases, useTestConnector } from '@/api/hooks';
import type { Connector } from '@/api/types';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Label } from '@/components/ui/input';
import { Checkbox, Hint } from '@/components/ui/controls';
import { Column, DataTable } from '@/components/ui/data-table';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Toolbar } from '@/components/ui/surface';
import { toast } from '@/components/ui/toaster';
import { formatNumber, formatRelativeTime } from '@/lib/format';

type SourceType = Connector['source_type'];

const SOURCE_TYPES: Array<{ value: SourceType; label: string; icon: React.ElementType }> = [
  { value: 's3', label: 'Amazon S3', icon: Database },
  { value: 'google-drive', label: 'Google Drive', icon: HardDrive },
  { value: 'gmail', label: 'Gmail', icon: Mail },
  { value: 'sharepoint', label: 'SharePoint', icon: Folder },
  { value: 'slack', label: 'Slack', icon: Hash },
  { value: 'box', label: 'Box', icon: Package },
  { value: 'web', label: 'Web crawl', icon: Globe },
];

const sourceMeta = (type: SourceType) =>
  SOURCE_TYPES.find((s) => s.value === type) ?? { value: type, label: type, icon: Globe };

function statusTone(status: Connector['status']): 'ok' | 'info' | 'danger' | 'warn' {
  if (status === 'connected') return 'ok';
  if (status === 'syncing') return 'info';
  if (status === 'error') return 'danger';
  return 'warn';
}

function useCreateConnector() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<Connector>(endpoints.connectorList, body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: SystemKeys.connectors() });
      toast({ title: 'Connector added', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not add the connector', description: error.message, variant: 'error' }),
  });
}

function useSyncConnector() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ ok: boolean; documents_synced?: number; message: string }>(endpoints.connectorRebuild(id)),
    onSuccess: (data) => {
      client.invalidateQueries({ queryKey: SystemKeys.connectors() });
      toast({
        title: data.ok ? 'Sync finished' : 'Nothing was pulled',
        description: data.message,
        variant: data.ok ? 'success' : 'error',
      });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Sync failed', description: error.message, variant: 'error' }),
  });
}

function useUpdateConnector() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put<boolean>(endpoints.connectorDetail(id), body),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: SystemKeys.connectors() });
      toast({
        title: variables.body.status === 'paused' ? 'Connector paused' : 'Connector resumed',
        variant: 'success',
      });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not update the connector', description: error.message, variant: 'error' }),
  });
}

function useDeleteConnector() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<boolean>(endpoints.connectorDetail(id)),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: SystemKeys.connectors() });
      toast({ title: 'Connector removed', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not remove the connector', description: error.message, variant: 'error' }),
  });
}

export default function DataSourcesPage() {
  const { data: connectors, isLoading, isError, error, refetch } = useConnectors();
  const [addOpen, setAddOpen] = React.useState(false);

  const rows = connectors ?? [];
  const counts = React.useMemo(
    () => ({
      connected: rows.filter((r) => r.status === 'connected').length,
      syncing: rows.filter((r) => r.status === 'syncing').length,
      error: rows.filter((r) => r.status === 'error').length,
      paused: rows.filter((r) => r.status === 'paused').length,
    }),
    [rows],
  );

  return (
    <>
      <PageHeader
        title="Data sources"
        description="Keep indexes current by syncing from the systems where your content already lives. Connectors run on your deployment and write straight into the knowledge bases you choose."
        meta={
          <>
            <Badge tone={counts.connected > 0 ? 'ok' : 'neutral'} dot>
              {counts.connected} connected
            </Badge>
            {counts.syncing > 0 && (
              <Badge tone="info" dot>
                {counts.syncing} syncing
              </Badge>
            )}
            {counts.error > 0 && (
              <Badge tone="danger" dot>
                {counts.error} failing
              </Badge>
            )}
            {counts.paused > 0 && <Badge tone="warn">{counts.paused} paused</Badge>}
          </>
        }
        actions={
          <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
            <Plus />
            Add connector
          </Button>
        }
      />

      <PageBody wide padded={false}>
        <div className="px-4 pt-4 sm:px-6">
          <Toolbar>
            <span className="px-1 text-2xs text-ink-3">
              {rows.length} connector{rows.length === 1 ? '' : 's'} · schedules are cron expressions evaluated in UTC
            </span>
          </Toolbar>
        </div>
        <div className="mt-3 px-4 pb-4 sm:px-6">
          <ConnectorTable
            rows={rows}
            loading={isLoading}
            error={isError ? error : null}
            onRetry={() => refetch()}
            onAdd={() => setAddOpen(true)}
          />
        </div>
      </PageBody>

      {addOpen && <AddConnectorDialog onClose={() => setAddOpen(false)} />}
    </>
  );
}

function ConnectorTable({
  rows,
  loading,
  error,
  onRetry,
  onAdd,
}: {
  rows: Connector[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  onAdd: () => void;
}) {
  const test = useTestConnector();
  const sync = useSyncConnector();
  const update = useUpdateConnector();
  const remove = useDeleteConnector();

  const columns: Column<Connector>[] = [
    {
      key: 'name',
      header: 'Connector',
      render: (row) => {
        const meta = sourceMeta(row.source_type);
        const Icon = meta.icon;
        return (
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-ink-3 [&_svg]:size-3.5">
              <Icon />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm text-ink">{row.name}</p>
              <p className="font-mono text-2xs text-ink-3">{meta.label}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={statusTone(row.status)} size="sm" dot>
            {row.status}
          </Badge>
          {row.error && <span className="max-w-[220px] text-2xs text-danger">{row.error}</span>}
        </div>
      ),
    },
    {
      key: 'schedule',
      header: 'Schedule',
      render: (row) =>
        row.schedule ? (
          <span className="font-mono text-xs text-ink-2">{row.schedule}</span>
        ) : (
          <span className="text-2xs text-ink-3">Manual</span>
        ),
    },
    {
      key: 'last_sync',
      header: 'Last sync',
      render: (row) =>
        row.last_sync_at ? (
          <span className="text-xs text-ink-2">{formatRelativeTime(row.last_sync_at)}</span>
        ) : (
          <span className="text-2xs text-ink-3">Never</span>
        ),
    },
    {
      key: 'documents',
      header: 'Documents',
      align: 'right',
      render: (row) => (
        <span className="font-mono text-xs text-ink-2">{formatNumber(row.documents_synced ?? 0)}</span>
      ),
    },
    {
      key: 'target',
      header: 'Writes to',
      render: (row) =>
        row.dataset_ids.length > 0 ? (
          <span className="font-mono text-2xs text-ink-3">{row.dataset_ids.join(', ')}</span>
        ) : (
          <span className="text-2xs text-ink-3">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => {
        const paused = row.status === 'paused';
        return (
          <div className="flex items-center justify-end gap-0.5">
            <Hint label="Test connection">
              <Button
                variant="ghost"
                size="icon-sm"
                loading={test.isPending && test.variables === row.id}
                onClick={() => test.mutate(row.id)}
                aria-label="Test connection"
              >
                <RefreshCw />
              </Button>
            </Hint>
            <Hint label="Sync now">
              <Button
                variant="ghost"
                size="icon-sm"
                loading={sync.isPending && sync.variables === row.id}
                disabled={paused}
                onClick={() => sync.mutate(row.id)}
                aria-label="Sync now"
              >
                <Play />
              </Button>
            </Hint>
            <Hint label={paused ? 'Resume' : 'Pause'}>
              <Button
                variant="ghost"
                size="icon-sm"
                loading={update.isPending && update.variables?.id === row.id}
                onClick={() => update.mutate({ id: row.id, body: { status: paused ? 'connected' : 'paused' } })}
                aria-label={paused ? 'Resume connector' : 'Pause connector'}
              >
                {paused ? <Play /> : <Pause />}
              </Button>
            </Hint>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => test.mutate(row.id)} icon={<RefreshCw />}>
                  Test connection
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sync.mutate(row.id)} icon={<Play />}>
                  Run sync now
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  icon={<Trash2 />}
                  onClick={() => remove.mutate(row.id)}
                >
                  Remove connector
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface-1">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={onRetry}
        emptyTitle="No connectors yet"
        emptyDescription="Connect Amazon S3, Google Drive, Gmail, SharePoint, Slack, Box or a web crawl so your knowledge bases stay current automatically."
        emptyAction={
          <Button variant="primary" size="sm" onClick={onAdd}>
            <Plus />
            Add connector
          </Button>
        }
      />
    </div>
  );
}

function AddConnectorDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateConnector();
  const { data: knowledge } = useKnowledgeBases({ page_size: 100 });
  const { data: sources } = useConnectorSources();
  const [name, setName] = React.useState('');
  const [sourceType, setSourceType] = React.useState<SourceType>('web');
  const [schedule, setSchedule] = React.useState('0 2 * * *');
  const [selectedKbs, setSelectedKbs] = React.useState<string[]>([]);
  const [settingsValues, setSettingsValues] = React.useState<Record<string, string>>({});
  const activeSource = (sources ?? []).find((s) => s.source_type === sourceType);
  const setSetting = (key: string, value: string) => setSettingsValues((prev) => ({ ...prev, [key]: value }));

  const toggleKb = (id: string, checked: boolean) =>
    setSelectedKbs((prev) => (checked ? [...prev, id] : prev.filter((k) => k !== id)));

  const submit = () => {
    if (!name.trim()) {
      toast({ title: 'Give the connector a name', variant: 'error' });
      return;
    }
    const settings: Record<string, unknown> = {};
    for (const field of activeSource?.fields ?? []) {
      if (field.kind === 'bool') {
        if (settingsValues[field.key] === 'true') settings[field.key] = true;
        continue;
      }
      const raw = (settingsValues[field.key] ?? '').trim();
      if (!raw) continue;
      settings[field.key] =
        field.kind === 'lines'
          ? raw
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
          : raw;
    }
    create.mutate(
      {
        name: name.trim(),
        source_type: sourceType,
        schedule: schedule.trim() || undefined,
        dataset_ids: selectedKbs,
        settings,
      },
      { onSuccess: () => onClose() },
    );
  };

  const activeMeta = sourceMeta(sourceType);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader
          title="Add a data source"
          description="Pick where the content lives and which knowledge bases should receive it. Credentials are stored on this deployment and used only by the sync you start here."
        />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Connector name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering wiki" />
          </Field>

          <div className="flex flex-col gap-1.5">
            <Label>Source</Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {SOURCE_TYPES.map((option) => {
                const Icon = option.icon;
                const active = option.value === sourceType;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSourceType(option.value)}
                    className={
                      'flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors ' +
                      (active
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line bg-surface-1 text-ink-2 hover:border-line-strong hover:bg-surface-2')
                    }
                  >
                    <Icon className={'size-3.5 shrink-0 ' + (active ? 'text-accent' : 'text-ink-3')} />
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {activeSource && !activeSource.pull && (
            <p className="rounded-md border border-line bg-surface-1 px-3 py-2.5 text-xs text-ink-3">
              This engine cannot read {activeMeta.label} yet — it needs {activeSource.needs}. Save the connector anyway if
              the schedule matters to you: syncing reports exactly what is missing until those credentials exist.
            </p>
          )}

          {(activeSource?.fields ?? []).map((field) => (
            <Field
              key={field.key}
              label={field.required ? `${field.label} *` : field.label}
              hint={field.required ? `${field.hint ? `${field.hint} ` : ''}Required.` : field.hint}
            >
              {field.kind === 'bool' ? (
                <Checkbox
                  checked={settingsValues[field.key] === 'true'}
                  onCheckedChange={(checked) => setSetting(field.key, checked === true ? 'true' : 'false')}
                  aria-label={field.label}
                />
              ) : field.kind === 'lines' ? (
                <textarea
                  value={settingsValues[field.key] ?? ''}
                  onChange={(event) => setSetting(field.key, event.target.value)}
                  placeholder="https://example.com/handbook"
                  rows={3}
                  className="or-scroll w-full resize-y rounded-md border border-line bg-surface-1 px-3 py-2 font-mono text-xs text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
                />
              ) : (
                <Input
                  type={field.kind === 'secret' ? 'password' : 'text'}
                  value={settingsValues[field.key] ?? ''}
                  onChange={(event) => setSetting(field.key, event.target.value)}
                  autoComplete={field.kind === 'secret' ? 'new-password' : 'off'}
                />
              )}
            </Field>
          ))}

          <Field
            label="Sync schedule"
            hint="Cron expression in UTC. Leave blank to sync only when you press Sync now."
            action={<span className="text-2xs text-ink-3">{activeMeta.label}</span>}
          >
            <Input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 2 * * *" className="font-mono" />
          </Field>

          <div className="flex flex-col gap-1.5">
            <Label>Knowledge bases to write into</Label>
            {(knowledge?.items ?? []).length === 0 ? (
              <p className="rounded-md border border-line bg-surface-1 px-3 py-2.5 text-xs text-ink-3">
                <Inbox className="mr-1.5 inline size-3.5 align-text-bottom" />
                No knowledge bases available yet. Create one first, then come back to point this connector at it.
              </p>
            ) : (
              <div className="or-scroll max-h-44 overflow-y-auto rounded-md border border-line bg-surface-1">
                {(knowledge?.items ?? []).map((kb) => (
                  <div
                    key={kb.id}
                    role="checkbox"
                    aria-checked={selectedKbs.includes(kb.id)}
                    tabIndex={0}
                    onClick={() => toggleKb(kb.id, !selectedKbs.includes(kb.id))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleKb(kb.id, !selectedKbs.includes(kb.id));
                      }
                    }}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 last:border-0 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                  >
                    <span onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={selectedKbs.includes(kb.id)}
                        onCheckedChange={(checked) => toggleKb(kb.id, checked === true)}
                        aria-label={`Include ${kb.name}`}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-ink">{kb.name}</span>
                      <span className="block font-mono text-2xs text-ink-3">{kb.id}</span>
                    </span>
                    <span className="shrink-0 font-mono text-2xs text-ink-3">{formatNumber(kb.document_count)} docs</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isDemoMode() && (
            <p className="text-2xs text-ink-3">
              Demo mode — the connector is created in the sample corpus; no external system is contacted.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={create.isPending}
            disabled={(activeSource?.fields ?? []).some(
              (field) => field.required && !(settingsValues[field.key] ?? '').trim(),
            )}
            onClick={submit}
          >
            <Plus />
            Add connector
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

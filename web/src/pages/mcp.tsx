/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * MCP servers — the tool servers agents can call. Each server exposes a transport endpoint
 * and an inventory of tools; this screen shows reachability, lets you enable or disable a
 * server globally, and owns registration.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  Wrench,
} from 'lucide-react';
import * as React from 'react';
import { api, ApiError, isDemoMode } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import { SystemKeys, useMcpServers } from '@/api/hooks';
import type { McpServer } from '@/api/types';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Label } from '@/components/ui/input';
import { Switch } from '@/components/ui/controls';
import { Panel } from '@/components/ui/surface';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toaster';
import { formatNumber, formatRelativeTime } from '@/lib/format';

type Transport = McpServer['transport'];

function transportLabel(transport: Transport): string {
  return transport === 'sse' ? 'SSE' : 'Streamable HTTP';
}

function useSaveMcp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id?: string; body: Record<string, unknown> }): Promise<unknown> =>
      id ? api.put<boolean>(endpoints.mcpServer(id), body) : api.post<McpServer>(endpoints.mcpServers, body),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: SystemKeys.mcp() });
      toast({ title: variables.id ? 'MCP server updated' : 'MCP server added', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not save the MCP server', description: error.message, variant: 'error' }),
  });
}

function useDeleteMcp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<boolean>(endpoints.mcpServer(id)),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: SystemKeys.mcp() });
      toast({ title: 'MCP server removed', variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not remove the MCP server', description: error.message, variant: 'error' }),
  });
}

export default function McpPage() {
  const { data: servers, isLoading, isError, error, refetch, isFetching } = useMcpServers();
  const save = useSaveMcp();
  const remove = useDeleteMcp();
  const [dialog, setDialog] = React.useState<{ open: boolean; record: McpServer | null }>({
    open: false,
    record: null,
  });

  const all = servers ?? [];
  const enabled = all.filter((s) => s.enabled).length;
  const failing = all.filter((s) => s.status === 'error').length;
  const toolCount = all.reduce((sum, s) => sum + (s.tools?.length ?? 0), 0);

  const toggle = (server: McpServer, next: boolean) => {
    save.mutate({ id: server.id, body: { enabled: next } });
  };

  return (
    <>
      <PageHeader
        title="MCP servers"
        description="Model Context Protocol servers surface their tools to agents. Register a transport endpoint, watch its reachability, and turn a server off for the whole workspace in one switch."
        meta={
          <>
            <Badge tone={all.length > 0 ? 'accent' : 'neutral'} dot>
              {all.length} server{all.length === 1 ? '' : 's'}
            </Badge>
            <Badge tone="outline">{enabled} enabled</Badge>
            <Badge tone="outline">{formatNumber(toolCount)} tools</Badge>
            {failing > 0 && (
              <Badge tone="danger" dot>
                {failing} unreachable
              </Badge>
            )}
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" loading={isFetching} onClick={() => refetch()}>
              <RefreshCw />
              Recheck
            </Button>
            <Button variant="primary" size="sm" onClick={() => setDialog({ open: true, record: null })}>
              <Plus />
              Add server
            </Button>
          </>
        }
      />

      <PageBody>
        {isLoading ? (
          <CardGridSkeleton count={4} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Plug />}
            title="No MCP servers registered"
            description="Add a Model Context Protocol server to expose its tools to your agents. Both the SSE and Streamable HTTP transports are supported; the endpoint must be reachable from this deployment."
            action={
              <Button variant="primary" size="sm" onClick={() => setDialog({ open: true, record: null })}>
                <Plus />
                Add MCP server
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {all.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                toggling={save.isPending && save.variables?.id === server.id}
                onToggle={(next) => toggle(server, next)}
                onEdit={() => setDialog({ open: true, record: server })}
                onDelete={() => remove.mutate(server.id)}
              />
            ))}
          </div>
        )}
      </PageBody>

      {dialog.open && (
        <McpFormDialog record={dialog.record} onClose={() => setDialog({ open: false, record: null })} />
      )}
    </>
  );
}

function ServerCard({
  server,
  toggling,
  onToggle,
  onEdit,
  onDelete,
}: {
  server: McpServer;
  toggling: boolean;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const tools = server.tools ?? [];
  return (
    <Panel className={`flex flex-col gap-3 p-4 ${server.enabled ? '' : 'opacity-75'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-ink-3 [&_svg]:size-4">
            <Plug />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium text-ink">{server.name}</span>
              {server.status === 'ok' ? (
                <Badge tone="ok" size="sm" dot>
                  reachable
                </Badge>
              ) : server.status === 'error' ? (
                <Badge tone="danger" size="sm" dot>
                  error
                </Badge>
              ) : (
                <Badge tone="neutral" size="sm">
                  unchecked
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate font-mono text-2xs text-ink-3">{server.url}</p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Server actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={<Pencil />} onClick={onEdit}>
              Edit server
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Power />} onClick={() => onToggle(!server.enabled)}>
              {server.enabled ? 'Disable server' : 'Enable server'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive icon={<Trash2 />} onClick={onDelete}>
              Remove server
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3">
        <div className="flex items-center gap-1.5">
          <span className="text-2xs uppercase tracking-wide text-ink-3">Transport</span>
          <Badge tone="outline" size="sm">
            {transportLabel(server.transport)}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-2xs uppercase tracking-wide text-ink-3">Last check</span>
          <span className="text-xs text-ink-2">
            {server.last_check_at ? formatRelativeTime(server.last_check_at) : 'never'}
          </span>
        </div>
      </div>

      <div className="border-t border-line pt-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Wrench className="size-3.5 text-ink-3" />
          <span className="text-2xs uppercase tracking-wide text-ink-3">
            Tool inventory · {tools.length}
          </span>
        </div>
        {tools.length === 0 ? (
          <p className="text-2xs text-ink-3">
            No tools reported. The server will list its tools once it answers a handshake.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {tools.map((tool) => (
              <span
                key={tool.name}
                title={tool.description}
                className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-ink-2"
              >
                {tool.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line pt-3">
        <span className="text-xs text-ink-2">{server.enabled ? 'Enabled for agents' : 'Disabled'}</span>
        <Switch
          checked={server.enabled}
          disabled={toggling}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${server.name}`}
        />
      </div>
    </Panel>
  );
}

function McpFormDialog({ record, onClose }: { record: McpServer | null; onClose: () => void }) {
  const save = useSaveMcp();
  const [name, setName] = React.useState(record?.name ?? '');
  const [url, setUrl] = React.useState(record?.url ?? '');
  const [transport, setTransport] = React.useState<Transport>(record?.transport ?? 'sse');
  const [enabled, setEnabled] = React.useState(record?.enabled ?? true);

  const submit = () => {
    if (!name.trim() || !url.trim()) {
      toast({ title: 'Name and URL are required', variant: 'error' });
      return;
    }
    save.mutate(
      { id: record?.id, body: { name: name.trim(), url: url.trim(), transport, enabled } },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader
          title={record ? 'Edit MCP server' : 'Add MCP server'}
          description="Point at a Model Context Protocol endpoint reachable from this deployment. Tools are discovered over the chosen transport."
        />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="postgres-readonly" />
          </Field>
          <Field label="Endpoint URL" required hint="The MCP transport URL, e.g. http://mcp-host:8080/sse">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://mcp-host:8080/sse"
              className="font-mono"
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <Label>Transport</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {(['sse', 'streamable-http'] as Transport[]).map((option) => {
                const active = transport === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setTransport(option)}
                    className={
                      'rounded-md border px-3 py-2 text-left text-xs transition-colors ' +
                      (active
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line bg-surface-1 text-ink-2 hover:border-line-strong hover:bg-surface-2')
                    }
                  >
                    {transportLabel(option)}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-1 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-xs text-ink">Enabled</span>
              <span className="block text-2xs text-ink-3">Expose this server's tools to agents immediately.</span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>
          {isDemoMode() && (
            <p className="text-2xs text-ink-3">
              Demo mode — the server is registered in the sample corpus; no handshake is attempted.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={save.isPending} onClick={submit}>
            <Plug />
            {record ? 'Save changes' : 'Add server'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

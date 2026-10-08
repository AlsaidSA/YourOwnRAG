/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * Settings — the workspace, its people, and the console's own preferences, in tabs. Server
 * truth (profile, members) is read from the API; purely local choices (theme, ingestion
 * defaults) persist on this device and are labelled as such.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  Database,
  KeyRound,
  Moon,
  Palette,
  Settings2,
  ShieldAlert,
  Sun,
  Trash2,
  Users,
} from 'lucide-react';
import * as React from 'react';
import { api, ApiError } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import { SystemKeys, useSessionUser } from '@/api/hooks';
import type { ApiToken } from '@/api/types';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import {
  Avatar,
  Segmented,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@/components/ui/controls';
import { Panel, PanelHeader, DescriptionList, SectionHeader } from '@/components/ui/surface';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Column, DataTable } from '@/components/ui/data-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { formatRelativeTime, titleCase } from '@/lib/format';
import { safeStorage } from '@/lib/utils';
import { useUiStore, type ThemeMode } from '@/store/ui';

const INGESTION_KEY = 'ownrag.defaults.ingestion';

interface IngestionDefaults {
  chunkMethod: string;
  chunkTokenNum: number;
  delimiter: string;
  layoutRecognize: boolean;
}

const DEFAULT_INGESTION: IngestionDefaults = {
  chunkMethod: 'naive',
  chunkTokenNum: 512,
  delimiter: '\\n!?;。；！？',
  layoutRecognize: true,
};

const CHUNK_METHODS = [
  { value: 'naive', label: 'General — token window with delimiter awareness' },
  { value: 'laws', label: 'Laws — article-aware statutory splitting' },
  { value: 'paper', label: 'Paper — section-aware academic splitting' },
  { value: 'book', label: 'Book — chapter and heading hierarchy' },
  { value: 'presentation', label: 'Presentation — one chunk per slide' },
  { value: 'table', label: 'Table — headers kept with rows' },
  { value: 'qa', label: 'Q&A — one chunk per question/answer pair' },
  { value: 'email', label: 'Email — header-aware mail splitting' },
  { value: 'one', label: 'Whole document — a single chunk' },
];

interface Tenant {
  tenant_id: string;
  name: string;
  role?: string;
  member_count?: number;
}

interface TenantMember {
  user_id?: string;
  id?: string;
  email?: string;
  nickname?: string;
  role?: string;
  create_time?: number;
}

const SettingsKeys = {
  tenants: () => ['settings', 'tenants'] as const,
  members: (tenantId: string) => ['settings', 'tenant', tenantId, 'members'] as const,
};

function useTenants() {
  return useQuery({
    queryKey: SettingsKeys.tenants(),
    queryFn: () => api.get<Tenant[]>(endpoints.listTenant),
    staleTime: 60_000,
  });
}

function useTenantMembers(tenantId?: string) {
  return useQuery({
    queryKey: SettingsKeys.members(tenantId ?? ''),
    queryFn: () => api.get<TenantMember[]>(endpoints.tenantUsers(tenantId as string)),
    enabled: Boolean(tenantId),
  });
}

function readIngestionDefaults(): IngestionDefaults {
  const storage = safeStorage();
  const raw = storage?.getItem(INGESTION_KEY);
  if (!raw) return DEFAULT_INGESTION;
  try {
    return { ...DEFAULT_INGESTION, ...(JSON.parse(raw) as Partial<IngestionDefaults>) };
  } catch {
    return DEFAULT_INGESTION;
  }
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast({ title: 'Copied to clipboard', variant: 'success' });
  } catch {
    toast({ title: 'Could not copy', description: 'Your browser blocked clipboard access.', variant: 'error' });
  }
}

export default function SettingsPage() {
  const [tab, setTab] = React.useState('workspace');

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <PageHeader
        title="Settings"
        description="Workspace identity, the people who share it, how the console looks, and the defaults new knowledge bases start from."
        tabs={
          <TabsList>
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="ingestion">Ingestion</TabsTrigger>
            <TabsTrigger value="danger">Danger zone</TabsTrigger>
          </TabsList>
        }
      />
      <PageBody>
        <TabsContent value="workspace" className="max-w-3xl">
          <WorkspaceTab />
        </TabsContent>
        <TabsContent value="team">
          <TeamTab />
        </TabsContent>
        <TabsContent value="appearance" className="max-w-3xl">
          <AppearanceTab />
        </TabsContent>
        <TabsContent value="ingestion" className="max-w-3xl">
          <IngestionTab />
        </TabsContent>
        <TabsContent value="danger" className="max-w-3xl">
          <DangerTab />
        </TabsContent>
      </PageBody>
    </Tabs>
  );
}

function WorkspaceTab() {
  const { data: user, isLoading, isError, error, refetch } = useSessionUser();
  const { data: tenants } = useTenants();
  const tenant = tenants?.[0];

  const str = (key: string, fallback = '—') => {
    const value = user?.[key];
    return typeof value === 'string' && value ? value : fallback;
  };

  if (isLoading) {
    return (
      <Panel className="p-4">
        <TableSkeleton rows={5} columns={2} />
      </Panel>
    );
  }
  if (isError) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          title="Workspace profile"
          description="Read from the API server this console is connected to."
          icon={<Settings2 />}
        />
        <div className="px-4 py-2">
          <DescriptionList
            items={[
              { label: 'Workspace', value: tenant?.name ?? str('tenant_id') },
              { label: 'Workspace ID', value: str('tenant_id'), mono: true },
              { label: 'Your role', value: tenant?.role ? titleCase(tenant.role) : str('is_admin', 'member') },
              { label: 'Signed in as', value: `${str('nickname')} · ${str('email')}` },
              { label: 'Language', value: str('language', 'en') },
              {
                label: 'Administrator',
                value: user?.is_admin === true ? 'Yes' : 'No',
              },
            ]}
          />
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <p className="text-2xs text-ink-3">
            Renaming the workspace or changing its plan is done by the operator on the deployment.
          </p>
          <Button variant="ghost" size="xs" onClick={() => copyText(str('tenant_id', ''))}>
            <Copy />
            Copy ID
          </Button>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="How this console is connected" icon={<Database />} />
        <div className="px-4 py-2">
          <DescriptionList
            items={[
              { label: 'API surface', value: 'Preserved RAGFlow v1', mono: true },
              { label: 'Workspace', value: tenant ? `${tenant.member_count ?? '—'} members` : '—' },
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}

function TeamTab() {
  const { data: tenants } = useTenants();
  const tenantId = tenants?.[0]?.tenant_id;
  const { data: members, isLoading, isError, error, refetch } = useTenantMembers(tenantId);

  const columns: Column<TenantMember>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.nickname ?? row.email ?? row.user_id} size={24} />
          <div className="min-w-0">
            <p className="truncate text-sm text-ink">{row.nickname ?? row.email ?? row.user_id ?? 'Member'}</p>
            <p className="truncate font-mono text-2xs text-ink-3">{row.email ?? row.user_id ?? '—'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => (
        <Badge tone={row.role === 'owner' ? 'accent' : 'outline'} size="sm">
          {row.role ? titleCase(row.role) : 'member'}
        </Badge>
      ),
    },
    {
      key: 'joined',
      header: 'Joined',
      render: (row) =>
        row.create_time ? (
          <span className="text-xs text-ink-2">{formatRelativeTime(row.create_time)}</span>
        ) : (
          <span className="text-2xs text-ink-3">—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={tenants?.[0]?.name ?? 'Workspace members'}
        description="Everyone with access to this workspace and the role that gates what they can change."
        actions={
          tenants?.[0]?.member_count !== undefined ? (
            <Badge tone="outline">{tenants[0].member_count} members</Badge>
          ) : undefined
        }
      />
      <div className="overflow-hidden rounded-lg border border-line bg-surface-1">
        {isLoading ? (
          <TableSkeleton rows={4} columns={3} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : (members ?? []).length === 0 ? (
          <EmptyState
            compact
            icon={<Users />}
            title="No members to show"
            description="This workspace has no member list yet. Invitations and role changes are handled on the API server; members appear here once they join."
          />
        ) : (
          <DataTable columns={columns} rows={members ?? []} rowKey={(row, i) => row.user_id ?? row.id ?? String(i)} />
        )}
      </div>
      <p className="text-2xs text-ink-3">
        Roles: owner (full control), admin (manage content and members), member (build and query). Invite and role
        changes are issued by the deployment operator against the tenants API.
      </p>
    </div>
  );
}

function AppearanceTab() {
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          title="Theme"
          description="Applies to this browser immediately and is remembered on this device."
          icon={<Palette />}
        />
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-xs leading-relaxed text-ink-3">
            The console ships a dark and a light posture built from the same tokens, so charts, scores and state pills
            read identically either way.
          </p>
          <Segmented
            value={theme}
            onValueChange={(value) => setTheme(value as ThemeMode)}
            options={[
              { value: 'light', label: 'Light', icon: <Sun className="size-3.5" /> },
              { value: 'dark', label: 'Dark', icon: <Moon className="size-3.5" /> },
            ]}
          />
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Density" description="OwnRAG is a dense instrument panel by design." />
        <p className="px-4 py-3 text-xs leading-relaxed text-ink-3">
          Rows are 28–36px and metadata is set at the smallest step of the type scale. There is no compact/comfortable
          toggle — the density is tuned for scanning, and every table scrolls rather than wraps on a narrow screen.
        </p>
      </Panel>
    </div>
  );
}

function IngestionTab() {
  const [defaults, setDefaults] = React.useState<IngestionDefaults>(() => readIngestionDefaults());
  const [dirty, setDirty] = React.useState(false);

  const update = <K extends keyof IngestionDefaults>(key: K, value: IngestionDefaults[K]) => {
    setDefaults((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const save = () => {
    const storage = safeStorage();
    storage?.setItem(INGESTION_KEY, JSON.stringify(defaults));
    setDirty(false);
    toast({
      title: 'Ingestion defaults saved',
      description: 'Applied to new knowledge bases created from this device.',
      variant: 'success',
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          title="Ingestion defaults"
          description="The starting parser configuration for new knowledge bases. These are local console preferences."
          icon={<Database />}
        />
        <div className="flex flex-col gap-4 px-4 py-4">
          <Field label="Default chunk method" hint="Chosen when a knowledge base is created without an explicit method.">
            <Select value={defaults.chunkMethod} onValueChange={(value) => update('chunkMethod', value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHUNK_METHODS.map((method) => (
                  <SelectItem key={method.value} value={method.value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Chunk token size" hint="Target tokens per chunk before overlap is applied.">
              <Input
                type="number"
                min={64}
                max={2048}
                value={defaults.chunkTokenNum}
                onChange={(e) => update('chunkTokenNum', Number(e.target.value) || 0)}
                className="font-mono"
              />
            </Field>
            <Field label="Delimiter" hint="Characters that may split a chunk at a natural boundary.">
              <Input
                value={defaults.delimiter}
                onChange={(e) => update('delimiter', e.target.value)}
                className="font-mono"
              />
            </Field>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-1 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-xs text-ink">Layout recognition</span>
              <span className="block text-2xs text-ink-3">
                Run the layout model on PDFs so tables and columns survive parsing.
              </span>
            </span>
            <Switch checked={defaults.layoutRecognize} onCheckedChange={(value) => update('layoutRecognize', value)} />
          </label>
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <p className="text-2xs text-ink-3">
            Retrieval settings (thresholds, top-k, rerank) live per knowledge base and per assistant.
          </p>
          <Button variant="primary" size="sm" disabled={!dirty} onClick={save}>
            <Check />
            Save defaults
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function DangerTab() {
  const client = useQueryClient();
  const workspaceId = useSessionUser().data?.tenant_id;
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [confirmKeys, setConfirmKeys] = React.useState(false);

  const revokeAllKeys = useMutation({
    mutationFn: async () => {
      const tokens = await api.get<ApiToken[]>(endpoints.systemTokens);
      await Promise.all(tokens.map((token) => api.delete<boolean>(endpoints.systemTokens, { id: token.id })));
      return tokens.length;
    },
    onSuccess: (count) => {
      client.invalidateQueries({ queryKey: SystemKeys.tokens() });
      toast({ title: `${count} API key${count === 1 ? '' : 's'} revoked`, variant: 'success' });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not revoke the API keys', description: error.message, variant: 'error' }),
  });

  const resetPreferences = () => {
    const storage = safeStorage();
    storage?.removeItem(INGESTION_KEY);
    toast({ title: 'Console preferences reset', description: 'Ingestion defaults returned to factory values.', variant: 'success' });
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel className="border-danger/40">
        <PanelHeader
          title="Danger zone"
          description="Irreversible operations. Each asks for confirmation first."
          icon={<ShieldAlert />}
        />
        <div className="divide-y divide-line">
          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-ink">Reset console preferences</p>
              <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
                Clears the ingestion defaults saved on this device. Theme and navigation are untouched. No server data
                is affected.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>
              Reset preferences
            </Button>
          </div>

          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-ink">Revoke all API keys</p>
              <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
                Immediately invalidates every token issued for this workspace. Any integration using them breaks until a
                new key is created in Developers.
              </p>
            </div>
            <Button variant="danger" size="sm" loading={revokeAllKeys.isPending} onClick={() => setConfirmKeys(true)}>
              <KeyRound />
              Revoke all keys
            </Button>
          </div>

          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-ink">Delete workspace</p>
              <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
                Removes every knowledge base, document and index in workspace{' '}
                <span className="font-mono">{typeof workspaceId === 'string' ? workspaceId : '—'}</span>. Because it
                destroys data across services, deletion is run by the operator on the deployment
                (<span className="font-mono">ownrag-admin workspace delete</span>); it is not exposed to the console.
              </p>
            </div>
            <Button variant="danger-ghost" size="sm" disabled>
              <Trash2 />
              Delete workspace
            </Button>
          </div>
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset console preferences?"
        description="Ingestion defaults return to their factory values on this device."
        confirmLabel="Reset preferences"
        onConfirm={() => {
          resetPreferences();
          setConfirmReset(false);
        }}
      />
      <ConfirmDialog
        open={confirmKeys}
        onOpenChange={setConfirmKeys}
        title="Revoke every API key?"
        description="All tokens for this workspace stop working at once. This cannot be undone; create new keys afterwards."
        confirmLabel="Revoke all keys"
        destructive
        loading={revokeAllKeys.isPending}
        onConfirm={() => revokeAllKeys.mutate(undefined, { onSuccess: () => setConfirmKeys(false) })}
      />
    </div>
  );
}

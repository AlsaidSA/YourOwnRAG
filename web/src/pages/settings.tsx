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
  MailPlus,
  Moon,
  Palette,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Sun,
  Trash2,
  UserPlus,
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
import { EmptyState, ErrorState, InlineError, TableSkeleton } from '@/components/ui/states';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
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
  /** Whether the signed-in account may invite people and manage members. The engine enforces this. */
  can_manage?: boolean;
}

interface TenantMember {
  user_id?: string;
  id?: string;
  email?: string;
  nickname?: string;
  avatar?: string;
  role?: string;
  status?: string;
  is_admin?: boolean;
  create_time?: number;
}

interface TenantInvitation {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  create_time?: number;
  expires_at?: number;
  invited_by?: string;
  /** Only ever present in the response that created or resent the link: the engine stores a hash. */
  token?: string;
  invite_url?: string;
}

const SettingsKeys = {
  tenants: () => ['settings', 'tenants'] as const,
  members: (tenantId: string) => ['settings', 'tenant', tenantId, 'members'] as const,
  invitations: (tenantId: string) => ['settings', 'tenant', tenantId, 'invitations'] as const,
};

function useTenants() {
  return useQuery({
    queryKey: SettingsKeys.tenants(),
    queryFn: () => api.get<Tenant[]>(endpoints.listTenant),
    staleTime: 60_000,
  });
}

/**
 * What the signed-in account may do here. The engine is the authority — this only decides whether
 * the console offers the controls at all, so a member never sees buttons that would fail.
 */
function useWorkspaceRole(tenantId?: string) {
  const { data: tenants } = useTenants();
  const tenant = tenants?.find((t) => t.tenant_id === tenantId);
  const role = tenant?.role ?? 'member';
  return {
    role,
    canManage: Boolean(tenant?.can_manage ?? (role === 'owner' || role === 'admin')),
  };
}

function useTenantMembers(tenantId?: string) {
  return useQuery({
    queryKey: SettingsKeys.members(tenantId ?? ''),
    queryFn: () => api.get<TenantMember[]>(endpoints.tenantUsers(tenantId as string)),
    enabled: Boolean(tenantId),
  });
}

/** Pending invitations, fetched only for someone who may manage them. */
function useTenantInvitations(tenantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: SettingsKeys.invitations(tenantId ?? ''),
    queryFn: () => api.get<TenantInvitation[]>(endpoints.invitations(tenantId as string)),
    enabled: Boolean(tenantId) && enabled,
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
              { label: 'API surface', value: 'Preserved upstream v1', mono: true },
              { label: 'Workspace', value: tenant ? `${tenant.member_count ?? '—'} members` : '—' },
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}

/** Uniform failure text: the engine's message when it gave one, otherwise a plain fallback. */
function errorMessage(e: unknown, fallback = 'The engine refused the request.') {
  return e instanceof ApiError ? e.message : fallback;
}

function TeamTab() {
  const { data: tenants } = useTenants();
  const tenantId = tenants?.[0]?.tenant_id;
  const { role, canManage } = useWorkspaceRole(tenantId);
  const { data: members, isLoading, isError, error, refetch } = useTenantMembers(tenantId);
  const invites = useTenantInvitations(tenantId, canManage);
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [issued, setIssued] = React.useState<TenantInvitation | null>(null);
  const [removing, setRemoving] = React.useState<TenantMember | null>(null);
  // The target id lives in its own state: the confirm dialog's open/close events must not be
  // able to clear it out from under the handler that acts on it. Only the mutation clears it.
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SettingsKeys.members(tenantId ?? '') });
    void queryClient.invalidateQueries({ queryKey: SettingsKeys.invitations(tenantId ?? '') });
    void queryClient.invalidateQueries({ queryKey: SettingsKeys.tenants() });
  }, [queryClient, tenantId]);

  const changeRole = useMutation({
    mutationFn: ({ userId, role: next }: { userId: string; role: string }) =>
      api.patch(endpoints.tenantUser(tenantId as string, userId), { role: next }),
    onSuccess: (_data, vars) => {
      toast({ title: 'Role updated', description: `That member is now ${vars.role}.`, variant: 'success' });
      refresh();
    },
    onError: (e) => toast({ title: 'Could not change the role', description: errorMessage(e), variant: 'error' }),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete(endpoints.tenantUser(tenantId as string, userId)),
    onSuccess: () => {
      toast({ title: 'Member removed', description: 'Their sessions were revoked immediately.', variant: 'success' });
      setRemoving(null);
      setRemovingId(null);
      refresh();
    },
    onError: (e) => {
      toast({ title: 'Could not remove the member', description: errorMessage(e), variant: 'error' });
      setRemoving(null);
      setRemovingId(null);
    },
  });

  const resend = useMutation({
    mutationFn: (inviteId: string) =>
      api.post<TenantInvitation>(endpoints.invitationResend(tenantId as string, inviteId), {}),
    onSuccess: (invite) => {
      setIssued(invite);
      refresh();
    },
    onError: (e) => toast({ title: 'Could not resend the invitation', description: errorMessage(e), variant: 'error' }),
  });

  const revoke = useMutation({
    mutationFn: (inviteId: string) => api.delete(endpoints.invitation(tenantId as string, inviteId)),
    onSuccess: () => {
      toast({ title: 'Invitation revoked', description: 'The link no longer works.', variant: 'success' });
      refresh();
    },
    onError: (e) => toast({ title: 'Could not revoke the invitation', description: errorMessage(e), variant: 'error' }),
  });

  const memberColumns: Column<TenantMember>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.nickname ?? row.email ?? row.user_id} src={row.avatar} size={24} />
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
      render: (row) => {
        const userId = row.user_id ?? row.id;
        // The owner's role is fixed by the engine, and a member may not edit anyone at all, so the
        // control is only offered where it can actually succeed.
        if (!canManage || row.role === 'owner' || !userId) {
          return (
            <Badge tone={row.role === 'owner' ? 'accent' : 'outline'} size="sm">
              {row.role ? titleCase(row.role) : 'member'}
            </Badge>
          );
        }
        return (
          <Select
            value={row.role ?? 'member'}
            onValueChange={(next) => changeRole.mutate({ userId, role: next })}
          >
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin" disabled={role !== 'owner'}>
                Admin
              </SelectItem>
            </SelectContent>
          </Select>
        );
      },
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
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => {
        const userId = row.user_id ?? row.id;
        if (!canManage || !userId || row.role === 'owner') return <span className="text-2xs text-ink-3">—</span>;
        return (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove ${row.email ?? userId}`}
            onClick={() => {
              setRemoving(row);
              setRemovingId(row.user_id ?? row.id ?? null);
            }}
          >
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        );
      },
    },
  ];

  const inviteColumns: Column<TenantInvitation>[] = [
    {
      key: 'email',
      header: 'Invited',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-ink">{row.email}</p>
          <p className="text-2xs text-ink-3">
            {row.create_time ? `sent ${formatRelativeTime(row.create_time)}` : 'pending'}
          </p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => (
        <Badge tone="outline" size="sm">
          {titleCase(row.role)}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={row.status === 'pending' ? 'accent' : row.status === 'accepted' ? 'outline' : 'danger'} size="sm">
          {titleCase(row.status)}
        </Badge>
      ),
    },
    {
      key: 'expires',
      header: 'Expires',
      render: (row) =>
        row.status === 'pending' && row.expires_at ? (
          <span className="text-xs text-ink-2">{formatRelativeTime(row.expires_at)}</span>
        ) : (
          <span className="text-2xs text-ink-3">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={row.status === 'accepted' || resend.isPending}
            onClick={() => resend.mutate(row.id)}
          >
            <RefreshCw className="size-3.5" />
            Resend
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={row.status === 'accepted' || revoke.isPending}
            onClick={() => revoke.mutate(row.id)}
          >
            Revoke
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={tenants?.[0]?.name ?? 'Workspace members'}
        description="Everyone with access to this workspace and the role that gates what they can change."
        actions={
          <div className="flex items-center gap-2">
            {tenants?.[0]?.member_count !== undefined ? (
              <Badge tone="outline">{tenants[0].member_count} members</Badge>
            ) : null}
            {canManage ? (
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-3.5" />
                Invite people
              </Button>
            ) : null}
          </div>
        }
      />

      {issued ? <InvitationLink invite={issued} onDismiss={() => setIssued(null)} /> : null}

      <div className="overflow-hidden rounded-lg border border-line bg-surface-1">
        {isLoading ? (
          <TableSkeleton rows={4} columns={4} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : (members ?? []).length === 0 ? (
          <EmptyState
            compact
            icon={<Users />}
            title="No members to show"
            description="You are the only account in this workspace so far. Invite someone to work alongside you."
          />
        ) : (
          <DataTable columns={memberColumns} rows={members ?? []} rowKey={(row, i) => row.user_id ?? row.id ?? String(i)} />
        )}
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <SectionHeader
          title="Invitations"
          description="A link is the credential. It is shown once when issued, and resending replaces it with a fresh one."
        />
        <div className="overflow-hidden rounded-lg border border-line bg-surface-1">
          {!canManage ? (
            <EmptyState
              compact
              icon={<ShieldAlert />}
              title="Only owners and admins can see invitations"
              description="Ask an owner or admin of this workspace to invite people."
            />
          ) : invites.isLoading ? (
            <TableSkeleton rows={2} columns={4} />
          ) : invites.isError ? (
            <ErrorState error={invites.error} onRetry={() => void invites.refetch()} />
          ) : (invites.data ?? []).length === 0 ? (
            <EmptyState
              compact
              icon={<MailPlus />}
              title="No invitations yet"
              description="Invite a colleague by email address and share the link the console issues."
            />
          ) : (
            <DataTable
              columns={inviteColumns}
              rows={invites.data ?? []}
              rowKey={(row) => row.id}
            />
          )}
        </div>
      </div>

      <p className="text-2xs text-ink-3">
        Roles: owner (full control) · admin (manage content and members) · member (build and query). The engine enforces
        every rule above — the console only hides what would fail. This engine has no mail server, so an invitation is
        delivered as a link you copy and send yourself.
      </p>

      <InvitePeopleDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        tenantId={tenantId}
        canGrantAdmin={role === 'owner'}
        onCreated={(invite) => {
          setIssued(invite);
          refresh();
        }}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this member?"
        description={`${removing?.email ?? 'This account'} loses access immediately and any session they hold stops working. They can be invited again later.`}
        confirmLabel="Remove member"
        destructive
        loading={removeMember.isPending}
        onConfirm={() => {
          if (removingId) removeMember.mutate(removingId);
        }}
      />
    </div>
  );
}

/** The one moment an invitation link exists: shown with a copy button, then gone by design. */
function InvitationLink({ invite, onDismiss }: { invite: TenantInvitation; onDismiss: () => void }) {
  const link = invite.invite_url ?? (invite.token ? `${window.location.origin}/invite/${invite.token}` : '');
  return (
    <Panel className="border-accent/40">
      <PanelHeader
        title={`Invitation link for ${invite.email}`}
        description="Send this link to the person you invited. It expires, and only this one time it is shown here — resend from the list below for another."
        icon={<Copy />}
        actions={
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        }
      />
      <div className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center">
        <Input readOnly value={link} className="font-mono text-xs" aria-label="Invitation link" />
        <Button size="sm" onClick={() => void copyText(link)} className="shrink-0">
          <Copy className="size-3.5" />
          Copy link
        </Button>
      </div>
    </Panel>
  );
}

function InvitePeopleDialog({
  open,
  onOpenChange,
  tenantId,
  canGrantAdmin,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId?: string;
  canGrantAdmin: boolean;
  onCreated: (invite: TenantInvitation) => void;
}) {
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('member');
  const [error, setError] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<TenantInvitation | null>(null);

  React.useEffect(() => {
    if (open) return;
    setEmail('');
    setRole('member');
    setError(null);
    setIssued(null);
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      api.post<TenantInvitation>(endpoints.invitations(tenantId as string), { email: email.trim(), role }),
    onSuccess: (invite) => {
      setIssued(invite);
      setEmail('');
      onCreated(invite);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Invite people"
          description="The engine issues a one-time link. Copy it and send it however you like."
        />
        <DialogBody>
          {issued ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-ink-2">
                Invitation ready for <span className="font-mono text-ink">{issued.email}</span> as {titleCase(issued.role)}.
              </p>
              <InvitationLink invite={issued} onDismiss={() => setIssued(null)} />
            </div>
          ) : (
            <form className="flex flex-col gap-3" onSubmit={submit}>
              <Field label="Email address" hint="They sign in as this address.">
                <Input
                  type="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                />
              </Field>
              <Field
                label="Role"
                hint={
                  canGrantAdmin
                    ? 'Admins manage content and members. Only the owner can create admins.'
                    : 'Only the workspace owner can invite an admin.'
                }
              >
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member — build and query</SelectItem>
                    <SelectItem value="admin" disabled={!canGrantAdmin}>
                      Admin — manage content and members
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {error ? <InlineError message={error} /> : null}
            </form>
          )}
        </DialogBody>
        <DialogFooter>
          {issued ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={create.isPending || !email.trim()}>
                {create.isPending ? 'Creating…' : 'Create invitation'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * Models — bring your own model. The console never ships a hosted inference path: every
 * chat, embedding, rerank, vision or speech call leaves this deployment for an endpoint the
 * operator configured here. The screen is built around that posture — providers are cards,
 * each carrying its API base, key state, live connection test and per-model enable switches.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  Info,
  KeyRound,
  Plus,
  Plug,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import * as React from 'react';
import { api, ApiError, isDemoMode } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import {
  ModelKeys,
  useAddInstance,
  useAddProvider,
  useAvailableModels,
  useDeleteProvider,
  useDiscoverModels,
  useProviderConnectionTest,
  useProviderCatalog,
  useProviders,
  SystemKeys,
} from '@/api/hooks';
import type { ModelKind, ModelProvider, ProviderCatalogEntry, ProviderInstance, ProviderModel } from '@/api/types';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/controls';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/data-table';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { SectionHeader, Panel, PanelHeader } from '@/components/ui/surface';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { formatCompact, formatNumber, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

const KIND_ORDER: ModelKind[] = ['chat', 'embedding', 'rerank', 'vision', 'asr', 'tts', 'speech2text', 'ocr'];

function typesOf(model: ProviderModel): ModelKind[] {
  return Array.isArray(model.model_type) ? model.model_type : [model.model_type];
}

function kindLabel(kind: string): string {
  return titleCase(kind);
}

function instanceTone(status: ProviderInstance['status']): 'ok' | 'warn' | 'danger' {
  if (status === 'connected') return 'ok';
  if (status === 'error') return 'danger';
  return 'warn';
}

/** Per-model enable/disable. The backend exposes the model as a sub-resource of its instance. */
function useSetModelStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider: string; instance: string; model: string; status: 'active' | 'inactive' }) =>
      api.put<boolean>(endpoints.instanceModel(input.provider, input.instance, input.model), {
        status: input.status,
      }),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ModelKeys.providers() });
      // The chat tab's model menu lists the same models; switching one on here must offer it there at once,
      // not after the five-minute stale time.
      client.invalidateQueries({ queryKey: SystemKeys.userModels() });
      toast({
        title: variables.status === 'active' ? 'Model enabled' : 'Model disabled',
        variant: 'success',
      });
    },
    onError: (error: ApiError) =>
      toast({ title: 'Could not update the model', description: error.message, variant: 'error' }),
  });
}

export default function ModelsPage() {
  const { data: providers, isLoading, isError, error, refetch } = useProviders({ available: true });
  const { data: catalogue } = useAvailableModels();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [connectTarget, setConnectTarget] = React.useState<ModelProvider | null>(null);

  const sorted = React.useMemo(() => {
    const list = [...(providers ?? [])];
    list.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'added' ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return list;
  }, [providers]);

  const addedCount = sorted.filter((p) => p.status === 'added').length;
  const modelCount = sorted.reduce((sum, p) => sum + p.instances.reduce((s, i) => s + i.models.length, 0), 0);

  const active =
    sorted.find((p) => p.name === selected) ?? sorted.find((p) => p.status === 'added') ?? sorted[0];

  const typesConfigured = React.useMemo(() => {
    const set = new Set<string>();
    (providers ?? []).forEach((p) =>
      p.instances.forEach((i) => i.models.forEach((m) => typesOf(m).forEach((t) => set.add(t)))),
    );
    return set;
  }, [providers]);

  return (
    <>
      <PageHeader
        title="Models"
        description="Connect the chat, embedding, rerank, vision and speech endpoints you already pay for. OwnRAG routes inference to the providers below — never through a hosted OwnRAG cloud."
        meta={
          <>
            <Badge tone={addedCount > 0 ? 'ok' : 'neutral'} dot>
              {formatNumber(addedCount)} provider{addedCount === 1 ? '' : 's'} connected
            </Badge>
            <Badge tone="outline">{formatNumber(modelCount)} models</Badge>
            {catalogue && (
              <>
                <Badge tone="neutral">{catalogue.chat.length} chat</Badge>
                <Badge tone="neutral">{catalogue.embedding.length} embedding</Badge>
                <Badge tone="neutral">{catalogue.rerank.length} rerank</Badge>
              </>
            )}
          </>
        }
        actions={
          <Button variant="primary" size="sm" onClick={() => setConnectTarget({ name: '', label: '', kind: '', status: 'available', instances: [] })}>
            <Plug />
            Add provider
          </Button>
        }
      />

      <PageBody>
        <Panel className="flex items-start gap-3 border-accent/30 bg-accent-soft">
          <span className="mt-0.5 text-accent [&_svg]:size-4">
            <ShieldCheck />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">These are your endpoints</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-2">
              Every API base, key and model listed here belongs to your deployment. Prompts,
              documents and completions travel only between this server and the providers you
              configure; OwnRAG keeps the connection map, not the traffic.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {KIND_ORDER.filter((k) => typesConfigured.has(k)).map((k) => (
                <Badge key={k} tone="outline">
                  {kindLabel(k)}
                </Badge>
              ))}
              {typesConfigured.size === 0 && (
                <span className="text-2xs text-ink-3">
                  No model types configured yet — connect a provider to begin.
                </span>
              )}
            </div>
          </div>
        </Panel>

        {isLoading ? (
          <div className="mt-4">
            <CardGridSkeleton count={6} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} className="mt-4" />
        ) : sorted.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={<Server />}
            title="No model providers yet"
            description="Connect OpenAI, Anthropic, a self-hosted vLLM cluster or any OpenAI-compatible endpoint. Providers you add here appear as the model list for chat, retrieval and agents."
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setConnectTarget({ name: '', label: '', kind: '', status: 'available', instances: [] })}
              >
                <Plus />
                Add provider
              </Button>
            }
          />
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className="flex flex-col gap-2">
              <SectionHeader
                title="Providers"
                description={`${addedCount} connected · ${sorted.length - addedCount} available`}
              />
              {sorted.map((provider) => (
                <ProviderCard
                  key={provider.name}
                  provider={provider}
                  selected={active?.name === provider.name}
                  onSelect={() => setSelected(provider.name)}
                  onConnect={() => setConnectTarget(provider)}
                />
              ))}
            </div>

            <div className="min-w-0">
              {active ? (
                <ProviderInspector
                  // Keyed by provider: the card's state belongs to one provider. Un-keyed, React reused the
                  // instance when the list changed underneath it and the removed provider's open confirm
                  // dialog reappeared over the next one's card.
                  key={active.name}
                  provider={active}
                  onAddInstance={() => setConnectTarget({ ...active, status: active.status })}
                />
              ) : null}
            </div>
          </div>
        )}
      </PageBody>

      {connectTarget && (
        <ConnectProviderDialog
          provider={connectTarget}
          onClose={() => setConnectTarget(null)}
        />
      )}
    </>
  );
}

function ProviderCard({
  provider,
  selected,
  onSelect,
  onConnect,
}: {
  provider: ModelProvider;
  selected: boolean;
  onSelect: () => void;
  onConnect: () => void;
}) {
  const models = provider.instances.reduce((sum, i) => sum + i.models.length, 0);
  const connected = provider.status === 'added';
  return (
    <button
      type="button"
      onClick={connected ? onSelect : onConnect}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
        selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface-1 hover:border-line-strong hover:bg-surface-2',
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-ink-3 [&_svg]:size-4">
        <Server />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink">{provider.label}</span>
          {connected ? (
            <Badge tone="ok" size="sm" dot>
              connected
            </Badge>
          ) : (
            <Badge tone="neutral" size="sm">
              available
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block font-mono text-2xs text-ink-3">
          {provider.name} · {kindLabel(provider.kind || 'llm')}
        </span>
        <span className="mt-1 block text-2xs text-ink-3">
          {connected
            ? `${provider.instances.length} instance${provider.instances.length === 1 ? '' : 's'} · ${models} model${models === 1 ? '' : 's'}`
            : 'Not connected — add an API base and key'}
        </span>
      </span>
      <ChevronRight className={cn('size-3.5 shrink-0', connected ? 'text-ink-3' : 'text-accent')} />
    </button>
  );
}

function ProviderInspector({
  provider,
  onAddInstance,
}: {
  provider: ModelProvider;
  onAddInstance: () => void;
}) {
  const test = useProviderConnectionTest();
  const setStatus = useSetModelStatus();
  const remove = useDeleteProvider();
  // A boolean, not the provider: the handler reads the provider from props, so nothing the dialog does on
  // open or close can blank the value the mutation needs.
  const [confirming, setConfirming] = React.useState(false);
  const models = provider.instances.reduce((sum, instance) => sum + instance.models.length, 0);
  const testing = test.isPending && test.variables === provider.name;

  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <PanelHeader
          title={provider.label}
          description={
            provider.status === 'added'
              ? `${provider.instances.length} instance${provider.instances.length === 1 ? '' : 's'} configured`
              : 'Not connected yet'
          }
          icon={<ProviderMark name={provider.label} />}
          actions={
            <>
              <Button
                variant="secondary"
                size="sm"
                loading={testing}
                onClick={() => test.mutate(provider.name)}
                disabled={provider.instances.length === 0}
              >
                <RefreshCw />
                Test connection
              </Button>
              <Button variant="primary" size="sm" onClick={onAddInstance}>
                <Plus />
                Add instance
              </Button>
              {provider.removable !== false && (
                <Button variant="danger-ghost" size="sm" onClick={() => setConfirming(true)}>
                  <Trash2 />
                  Remove
                </Button>
              )}
            </>
          }
        />
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          destructive
          title={`Remove ${provider.label}?`}
          description={
            <>
              This deletes the provider and the {models} model{models === 1 ? '' : 's'} it serves, along with
              the stored key. Any assistant pinned to one of them moves to the workspace's own model.
            </>
          }
          confirmLabel="Remove provider"
          loading={remove.isPending}
          // The dialog stays open until this succeeds: a failure is the one case where the user needs it
          // still there to retry. `ConfirmDialog`'s confirm button prevents default, so nothing else closes
          // it — without this the removal left the dialog open over the next provider's card.
          onConfirm={() => remove.mutate(provider.name, { onSuccess: () => setConfirming(false) })}
        />
        <div className="px-4 py-3">
          {provider.instances.length === 0 ? (
            <EmptyState
              compact
              icon={<Server />}
              title="No instances for this provider"
              description="An instance is one API base plus one key — for example a production key and a sandbox key. Add one to expose its models to the rest of the console."
              action={
                <Button variant="primary" size="sm" onClick={onAddInstance}>
                  <Plus />
                  Add instance
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              {provider.instances.map((instance) => (
                <InstanceBlock
                  key={instance.id}
                  provider={provider.name}
                  instance={instance}
                  onToggle={(model, active) =>
                    setStatus.mutate({
                      provider: provider.name,
                      instance: instance.id,
                      model: model.id,
                      status: active ? 'active' : 'inactive',
                    })
                  }
                  pendingModel={setStatus.isPending ? setStatus.variables?.model : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

/** Initials for a provider's mark: two words give two letters, one word gives its first two. */
const providerInitials = (name: string) =>
  (() => {
    const words = name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // DeepSeek -> Deep Seek, so the mark reads DS
      .replace(/[^A-Za-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return (words[0] ?? name).slice(0, 2).toUpperCase();
  })();

/**
 * A provider's mark. Neutral on purpose: colour in this console means an actionable state, and no
 * vendor artwork is shipped here — so every provider gets a legible tile instead of a fake logo.
 */
function ProviderMark({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      title={name}
      className={
        'inline-flex shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 font-semibold uppercase tracking-tight text-ink-2 ' +
        (size === 'sm' ? 'size-5 text-[9px]' : 'size-7 text-2xs')
      }
    >
      {providerInitials(name)}
    </span>
  );
}

function InstanceBlock({
  provider,
  instance,
  onToggle,
  pendingModel,
}: {
  provider: string;
  instance: ProviderInstance;
  onToggle: (model: ProviderModel, active: boolean) => void;
  pendingModel?: string;
}) {
  const discover = useDiscoverModels();
  return (
    <div className="rounded-lg border border-line bg-surface-2">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{instance.instance_name}</span>
            <Badge tone={instanceTone(instance.status)} size="sm" dot>
              {instance.status}
            </Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-2xs text-ink-3">{instance.api_base || 'provider default endpoint'}</span>
            <span className="inline-flex items-center gap-1 text-2xs text-ink-3">
              <KeyRound className="size-3" />
              {instance.has_api_key ? 'API key set' : 'No API key'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={discover.isPending || !instance.api_base}
            title={
              instance.api_base
                ? 'Ask this endpoint which chat models it serves and enable them'
                : 'This provider has no endpoint yet'
            }
            onClick={() => discover.mutate({ provider, instance: instance.instance_name })}
          >
            {discover.isPending ? 'Fetching…' : 'Fetch models'}
          </Button>
          <ProviderMark name={provider} />
          <span className="font-mono text-2xs text-ink-3">{provider}</span>
        </div>
      </div>
      {instance.models.length === 0 ? (
        <p className="px-3 py-3 text-xs text-ink-3">
          No models registered on this instance yet. <span className="text-ink-2">Fetch models</span> asks the
          endpoint what it serves and enables the chat models it lists — until then answers stay on the engine's
          built-in path.
        </p>
      ) : (
        <Table className="text-xs">
          <THead>
            <tr>
              <TH>Model</TH>
              <TH>Type</TH>
              <TH align="right">Context</TH>
              <TH align="right">Max out</TH>
              <TH align="right">Enabled</TH>
            </tr>
          </THead>
          <TBody>
            {instance.models.map((model) => (
              <TR key={model.id}>
                <TD>
                  <span className="font-mono text-xs text-ink">{model.name}</span>
                  {model.tags && model.tags.length > 0 && (
                    <span className="ml-2 text-2xs text-ink-3">{model.tags.slice(0, 2).join(' · ')}</span>
                  )}
                </TD>
                <TD>
                  <span className="flex flex-wrap gap-1">
                    {typesOf(model).map((type) => (
                      <Badge key={type} tone="outline" size="sm">
                        {kindLabel(type)}
                      </Badge>
                    ))}
                  </span>
                </TD>
                <TD align="right" mono>
                  {model.context_length ? formatCompact(model.context_length) : '—'}
                </TD>
                <TD align="right" mono>
                  {model.max_tokens ? formatCompact(model.max_tokens) : '—'}
                </TD>
                <TD align="right">
                  <span className="inline-flex items-center gap-2">
                    <Switch
                      checked={model.status === 'active'}
                      disabled={pendingModel === model.id}
                      onCheckedChange={(checked) => onToggle(model, checked)}
                      aria-label={`Toggle ${model.name}`}
                    />
                  </span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}



/** One group of the provider picker. The rows reuse the selected/unselected treatment of the
 * configured providers below, so the picker reads as the same surface rather than a second idiom. */
function CatalogGroup({
  title,
  entries,
  chosen,
  onPick,
}: {
  title: string;
  entries: ProviderCatalogEntry[];
  chosen: string;
  onPick: (entry: ProviderCatalogEntry) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="border-b border-line bg-surface-2 px-3 py-1.5 text-2xs font-medium uppercase tracking-wide text-ink-3">
        {title}
      </p>
      {entries.map((entry) => (
        <button
          key={entry.name}
          type="button"
          aria-selected={entry.name === chosen}
          onClick={() => onPick(entry)}
          className={`flex w-full items-center justify-between gap-3 border-b border-line px-3 py-2 text-left transition-colors duration-[110ms] last:border-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${
            entry.name === chosen ? 'bg-accent-soft' : 'hover:bg-surface-2'
          }`}
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2 text-xs text-ink">
              {entry.label}
              {entry.configured && (
                <Badge tone="outline" size="sm">
                  Configured
                </Badge>
              )}
            </span>
            <span className="truncate font-mono text-2xs text-ink-3">
              {entry.base_url || 'API base required'}
            </span>
          </span>
          <span className="shrink-0 font-mono text-2xs text-ink-3">{entry.name}</span>
        </button>
      ))}
    </div>
  );
}

function ConnectProviderDialog({
  provider,
  onClose,
}: {
  provider: ModelProvider;
  onClose: () => void;
}) {
  const addInstance = useAddInstance();
  const addProvider = useAddProvider();
  const [providerName, setProviderName] = React.useState(provider.name || '');
  const [label, setLabel] = React.useState(provider.label || '');
  const [instanceName, setInstanceName] = React.useState('production');
  const [apiBase, setApiBase] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [query, setQuery] = React.useState('');

  const catalog = useProviderCatalog();
  const isNewProvider = !provider.name;
  const pending = addInstance.isPending || addProvider.isPending;

  // The engine owns the list of providers it can reach; picking one fills in the id, the label and
  // the address, so a typo cannot silently point a provider at a host that does not exist.
  const pick = (entry: ProviderCatalogEntry) => {
    setProviderName(entry.name);
    setLabel(entry.label);
    setApiBase(entry.base_url);
  };

  const needle = query.trim().toLowerCase();
  const entries = catalog.data ?? [];
  const matches = entries.filter(
    (entry) => !needle || `${entry.label} ${entry.name}`.toLowerCase().includes(needle),
  );
  const reachable = matches.filter((entry) => entry.engine === 'openai');
  const nativeOnly = matches.filter((entry) => entry.engine === 'go');
  const chosen = entries.find((entry) => entry.name === providerName);

  const submit = () => {
    const name = providerName.trim();
    if (!name) {
      toast({ title: 'Provider name is required', variant: 'error' });
      return;
    }
    const body = {
      instance_name: instanceName.trim() || 'default',
      api_base: apiBase.trim() || undefined,
      api_key: apiKey.trim() || undefined,
    };

    const afterProvider = () => {
      addInstance.mutate(
        { provider: name, body },
        { onSuccess: () => onClose() },
      );
    };

    if (isNewProvider) {
      addProvider.mutate(
        { provider_name: name, label: label.trim() || name },
        { onSuccess: afterProvider },
      );
    } else {
      afterProvider();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader
          title={isNewProvider ? 'Add a model provider' : `Connect ${provider.label}`}
          description="OwnRAG stores the API base and key on this deployment. Nothing is sent to a vendor control plane."
        />
        <DialogBody className="flex flex-col gap-3">
          {isNewProvider && (
            <>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search providers — OpenAI, DeepSeek, Ollama, vLLM…"
                aria-label="Search providers"
              />
              <div className="max-h-60 overflow-y-auto rounded-lg border border-line">
                <CatalogGroup
                  title="Answered by this engine"
                  entries={reachable}
                  chosen={providerName}
                  onPick={pick}
                />
                <CatalogGroup
                  title="Native driver in the preserved Go backend"
                  entries={nativeOnly}
                  chosen={providerName}
                  onPick={pick}
                />
                {matches.length === 0 && (
                  <p className="px-3 py-3 text-xs text-ink-3">
                    Nothing matches “{query}”. Name it yourself below and point the API base at it.
                  </p>
                )}
              </div>
              {chosen?.note && (
                <p className="flex items-start gap-2 text-2xs text-ink-3">
                  {chosen.engine === 'go' ? (
                    <TriangleAlert className="mt-0.5 size-3 shrink-0 text-warn" />
                  ) : (
                    <Info className="mt-0.5 size-3 shrink-0" />
                  )}
                  <span>
                    {chosen.note}
                    {chosen.engine === 'go' &&
                      ' The local engine will only call it if you give it an OpenAI-compatible base.'}
                  </span>
                </p>
              )}
              <Field
                label="Provider id"
                hint="Lowercase handle. Pick one above, or name your own for an endpoint that is not listed."
                required
              >
                <Input value={providerName} onChange={(e) => setProviderName(e.target.value)} placeholder="vllm" />
              </Field>
              <Field label="Display name">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Self-hosted vLLM" />
              </Field>
            </>
          )}
          <Field label="Instance name" hint="One key per instance — keep production and sandbox apart." required>
            <Input value={instanceName} onChange={(e) => setInstanceName(e.target.value)} placeholder="production" />
          </Field>
          <Field label="API base" hint="Leave blank to use the provider's public endpoint.">
            <Input
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </Field>
          <Field label="API key" hint="Sent as the Authorization header when this provider is invoked.">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
            />
          </Field>
          {isDemoMode() && (
            <p className="flex items-start gap-2 text-2xs text-ink-3">
              <TriangleAlert className="mt-0.5 size-3 shrink-0 text-warn" />
              Demo mode — the request is modelled, but no real provider is contacted.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={pending} onClick={submit}>
            <Plug />
            {isNewProvider ? 'Add provider' : 'Connect instance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

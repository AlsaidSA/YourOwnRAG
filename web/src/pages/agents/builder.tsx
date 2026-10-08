/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 *
 * Agent / workflow builder (/agents/:agentId).
 *
 * Layout mirrors the console's one canvas surface: a node library on the left, the React Flow
 * canvas in the middle, and the inspector on the right. Below `xl` the inspector becomes a
 * bottom sheet and below `lg` the library does too, so the canvas always keeps a usable
 * viewport. The graph lives in local state while editing and is written back as the agent DSL.
 */
import { ChevronRight, ArrowLeft, Copy, Ellipsis, History, PanelLeft, Rocket, Save, SlidersHorizontal, Trash } from 'lucide-react';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import { AgentKeys, useAgent, useCreateAgent, useDeleteAgent, useUpdateAgent } from '@/api/hooks';
import type { AgentEdge, AgentNode, AgentNodeKind } from '@/api/types';
import { PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
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
import { Panel, Skeleton } from '@/components/ui/surface';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { AgentCanvas } from '@/pages/agents/canvas';
import { AgentInspector } from '@/pages/agents/inspector';
import { defaultNodeConfig, NodeLibrary, nodeKindMeta } from '@/pages/agents/node-library';
import { formatCompact, formatDateTime } from '@/lib/format';
import { shortId } from '@/lib/utils';

interface AgentVersion {
  id: string;
  title?: string;
  create_time?: number;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  React.useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Next free slot to the right of the graph, so click-added nodes never stack on one point. */
function nextPosition(nodes: AgentNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 60, y: 120 };
  const maxX = Math.max(...nodes.map((node) => node.x));
  const column = nodes.filter((node) => node.x === maxX);
  return { x: maxX + 260, y: 60 + column.length * 96 };
}

export default function AgentBuilderPage() {
  const { agentId = '' } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const isLg = useMediaQuery('(min-width: 1024px)');
  const isXl = useMediaQuery('(min-width: 1280px)');

  const agentQuery = useAgent(agentId);
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();
  const createAgent = useCreateAgent();

  const [nodes, setNodes] = React.useState<AgentNode[]>([]);
  const [edges, setEdges] = React.useState<AgentEdge[]>([]);
  const [globals, setGlobals] = React.useState<Record<string, unknown>>({});
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [status, setStatus] = React.useState<'draft' | 'published'>('draft');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [mobilePanel, setMobilePanel] = React.useState<'none' | 'library' | 'inspector'>('none');
  const [versionsOpen, setVersionsOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const idCounter = React.useRef(0);

  const agent = agentQuery.data;

  // Reseed the editable copy whenever the loaded agent (or a saved revision of it) changes.
  const seedKey = agent ? `${agent.id}:${agent.update_time ?? 0}` : '';
  React.useEffect(() => {
    if (!agent) return;
    const nextNodes = agent.dsl?.graph?.nodes ?? [];
    setNodes(nextNodes);
    setEdges(agent.dsl?.graph?.edges ?? []);
    setGlobals(agent.dsl?.globals ?? {});
    setTitle(agent.title);
    setDescription(agent.description ?? '');
    setStatus(agent.status === 'published' ? 'published' : 'draft');
    // Keep the current selection if the node still exists after the refresh.
    setSelectedId((current) => (current && nextNodes.some((node) => node.id === current) ? current : null));
    setDirty(false);
  }, [seedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const versions = useQuery({
    queryKey: AgentKeys.versions(agentId),
    queryFn: () => api.get<AgentVersion[]>(endpoints.agentVersions(agentId)),
    enabled: Boolean(agentId) && versionsOpen,
  });

  const makeId = React.useCallback((kind: AgentNodeKind) => {
    idCounter.current += 1;
    return `${kind}_${Date.now().toString(36)}${idCounter.current}`;
  }, []);

  const addNode = React.useCallback(
    (kind: AgentNodeKind, position?: { x: number; y: number }) => {
      const meta = nodeKindMeta(kind);
      const id = makeId(kind);
      setNodes((prev) => {
        const pos = position ?? nextPosition(prev);
        return [
          ...prev,
          {
            id,
            kind,
            label: meta.label,
            x: Math.round(pos.x),
            y: Math.round(pos.y),
            config: defaultNodeConfig(kind),
          },
        ];
      });
      setSelectedId(id);
      setDirty(true);
      if (!window.matchMedia('(min-width: 1280px)').matches) setMobilePanel('inspector');
    },
    [makeId],
  );

  const moveNode = React.useCallback((id: string, position: { x: number; y: number }) => {
    setNodes((prev) =>
      prev.map((node) =>
        node.id === id ? { ...node, x: Math.round(position.x), y: Math.round(position.y) } : node,
      ),
    );
    setDirty(true);
  }, []);

  const removeNodes = React.useCallback((ids: string[]) => {
    setNodes((prev) => prev.filter((node) => !ids.includes(node.id)));
    setEdges((prev) => prev.filter((edge) => !ids.includes(edge.source) && !ids.includes(edge.target)));
    setSelectedId((current) => (current && ids.includes(current) ? null : current));
    setDirty(true);
  }, []);

  const removeEdges = React.useCallback((ids: string[]) => {
    setEdges((prev) => prev.filter((edge) => !ids.includes(edge.id)));
    setDirty(true);
  }, []);

  const connect = React.useCallback(
    (connection: { source: string; target: string; sourceHandle?: string }) => {
      setEdges((prev) => {
        if (prev.some((edge) => edge.source === connection.source && edge.target === connection.target)) {
          return prev;
        }
        return [
          ...prev,
          {
            id: `e_${connection.source}_${connection.target}_${Date.now().toString(36)}`,
            source: connection.source,
            target: connection.target,
            sourceHandle: connection.sourceHandle,
          },
        ];
      });
      setDirty(true);
    },
    [],
  );

  const patchNode = React.useCallback((id: string, patch: Partial<AgentNode>) => {
    setNodes((prev) => prev.map((node) => (node.id === id ? { ...node, ...patch } : node)));
    setDirty(true);
  }, []);

  const patchConfig = React.useCallback((id: string, patch: Record<string, unknown>) => {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== id) return node;
        const next: Record<string, unknown> = { ...(node.config ?? {}) };
        Object.entries(patch).forEach(([key, value]) => {
          if (value === undefined) delete next[key];
          else next[key] = value;
        });
        return { ...node, config: next };
      }),
    );
    setDirty(true);
  }, []);

  const replaceConfig = React.useCallback((id: string, config: Record<string, unknown>) => {
    setNodes((prev) => prev.map((node) => (node.id === id ? { ...node, config } : node)));
    setDirty(true);
  }, []);

  const patchGlobals = React.useCallback((patch: Record<string, unknown>) => {
    setGlobals((prev) => {
      const next: Record<string, unknown> = { ...prev };
      Object.entries(patch).forEach(([key, value]) => {
        if (value === undefined) delete next[key];
        else next[key] = value;
      });
      return next;
    });
    setDirty(true);
  }, []);

  const duplicateNode = React.useCallback(
    (id: string) => {
      setNodes((prev) => {
        const source = prev.find((node) => node.id === id);
        if (!source) return prev;
        const clone: AgentNode = {
          ...source,
          id: makeId(source.kind),
          label: `${source.label} copy`,
          x: source.x + 32,
          y: source.y + 32,
          config: source.config ? (JSON.parse(JSON.stringify(source.config)) as Record<string, unknown>) : undefined,
        };
        return [...prev, clone];
      });
      setDirty(true);
    },
    [makeId],
  );

  const buildBody = React.useCallback(
    (overrides?: { status?: 'draft' | 'published' }) => ({
      title,
      description,
      status: overrides?.status ?? status,
      dsl: { graph: { nodes, edges }, globals },
    }),
    [title, description, status, nodes, edges, globals],
  );

  const save = React.useCallback(
    (overrides?: { status?: 'draft' | 'published' }) => {
      updateAgent.mutate(
        { id: agentId, body: buildBody(overrides) },
        {
          onSuccess: () => {
            toast({ title: 'Agent saved', variant: 'success' });
            setDirty(false);
          },
        },
      );
    },
    [agentId, buildBody, updateAgent],
  );

  const togglePublish = React.useCallback(() => {
    const next = status === 'published' ? 'draft' : 'published';
    setStatus(next);
    updateAgent.mutate(
      { id: agentId, body: buildBody({ status: next }) },
      {
        onSuccess: () => {
          toast({
            title: next === 'published' ? 'Agent published' : 'Agent moved to draft',
            variant: 'success',
          });
          setDirty(false);
        },
      },
    );
  }, [agentId, buildBody, status, updateAgent]);

  const duplicateAgent = React.useCallback(() => {
    createAgent.mutate(
      {
        title: `${title} copy`,
        description,
        dsl: { graph: { nodes, edges }, globals },
        status: 'draft',
      },
      {
        onSuccess: (created) => {
          toast({ title: 'Agent duplicated', description: created.title, variant: 'success' });
          navigate(`/agents/${created.id}`);
        },
      },
    );
  }, [description, createAgent, edges, globals, navigate, nodes, title]);

  const selectedNode = React.useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  /* ------------------------------------------------------------------ states */

  if (agentQuery.isLoading) {
    return (
      <>
        <PageHeader title="Agent" description="Loading the workflow and its graph…" />
        <div className="flex min-h-0 flex-1 p-4 sm:p-6">
          <div className="grid w-full gap-4 lg:grid-cols-[248px_1fr_320px]">
            <Panel className="hidden p-3 lg:block">
              <Skeleton className="h-3 w-24" />
              <div className="mt-4 space-y-2">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="h-6 w-full" />
                ))}
              </div>
            </Panel>
            <Panel className="min-h-[320px] p-3">
              <Skeleton className="h-full min-h-[300px] w-full" />
            </Panel>
            <Panel className="hidden p-3 xl:block">
              <Skeleton className="h-3 w-20" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-7 w-full" />
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </>
    );
  }

  if (agentQuery.isError || !agent) {
    const notFound =
      (agentQuery.error as { code?: number } | null)?.code === 404 ||
      /not found/i.test((agentQuery.error as { message?: string } | null)?.message ?? '');
    return (
      <>
        <PageHeader
          title="Agent"
          breadcrumb={
            <Link to="/agents" className="transition-colors hover:text-ink-2">
              Agents
            </Link>
          }
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate('/agents')}>
              <ArrowLeft />
              All agents
            </Button>
          }
        />
        <div className="or-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {notFound ? (
            <EmptyState
              title="Agent not found"
              description="This agent does not exist or is not visible to your workspace."
              action={
                <Button variant="primary" size="sm" onClick={() => navigate('/agents')}>
                  Back to agents
                </Button>
              }
            />
          ) : (
            <ErrorState error={agentQuery.error} onRetry={() => agentQuery.refetch()} />
          )}
        </div>
      </>
    );
  }

  /* ------------------------------------------------------------------ builder */

  const inspector = (
    <AgentInspector
      nodes={nodes}
      edges={edges}
      node={selectedNode}
      title={title}
      description={description}
      globals={globals}
      onChangeTitle={(value) => {
        setTitle(value);
        setDirty(true);
      }}
      onChangeDescription={(value) => {
        setDescription(value);
        setDirty(true);
      }}
      onSelectNode={(id) => setSelectedId(id)}
      onPatchNode={patchNode}
      onPatchConfig={patchConfig}
      onReplaceConfig={replaceConfig}
      onChangeGlobals={patchGlobals}
      onDeleteNode={(id) => removeNodes([id])}
      onDuplicateNode={duplicateNode}
      className="w-full"
    />
  );

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/agents" className="transition-colors hover:text-ink-2">
              Agents
            </Link>
            <ChevronRight className="size-3" />
            <span className="truncate text-ink-2">{title || 'Agent'}</span>
          </>
        }
        title={title || 'Untitled agent'}
        description={description}
        meta={
          <>
            <Badge tone={status === 'published' ? 'ok' : 'neutral'} size="sm" dot>
              {status === 'published' ? 'Published' : 'Draft'}
            </Badge>
            <span className="font-mono text-2xs text-ink-3">{shortId(agentId)}</span>
            <span className="text-2xs text-ink-3">
              {nodes.length} nodes · {edges.length} edges
            </span>
            {agent.run_count !== undefined && (
              <span className="text-2xs text-ink-3">
                <span className="font-mono">{formatCompact(agent.run_count)}</span> runs
              </span>
            )}
            {dirty && (
              <Badge tone="warn" size="sm">
                Unsaved changes
              </Badge>
            )}
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              className="lg:hidden"
              onClick={() => setMobilePanel('library')}
            >
              <PanelLeft />
              Nodes
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="xl:hidden"
              onClick={() => setMobilePanel('inspector')}
            >
              <SlidersHorizontal />
              Options
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={updateAgent.isPending}
              disabled={!dirty}
              onClick={() => save()}
            >
              <Save />
              Save
            </Button>
            <Button
              size="sm"
              variant={status === 'published' ? 'secondary' : 'primary'}
              disabled={updateAgent.isPending}
              onClick={togglePublish}
            >
              <Rocket />
              {status === 'published' ? 'Unpublish' : 'Publish'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="More agent actions">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem icon={<History />} onClick={() => setVersionsOpen(true)}>
                  Version history
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Copy />} onClick={duplicateAgent}>
                  Duplicate agent
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive icon={<Trash />} onClick={() => setConfirmDelete(true)}>
                  Delete agent
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        {isLg && (
          <aside className="flex w-[248px] shrink-0 border-r border-line bg-surface-1">
            <NodeLibrary onAdd={(kind) => addNode(kind)} className="w-full" />
          </aside>
        )}

        <div className="relative min-h-0 min-w-0 flex-1">
          <AgentCanvas
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedId}
            onSelectNode={(id) => {
              setSelectedId(id);
              if (id && !isXl) setMobilePanel('inspector');
            }}
            onMoveNode={moveNode}
            onRemoveNodes={removeNodes}
            onRemoveEdges={removeEdges}
            onConnect={connect}
            onAddNodeAt={addNode}
            onAddBegin={() => addNode('begin')}
          />
        </div>

        {isXl && (
          <aside className="flex w-[320px] shrink-0 border-l border-line bg-surface-1">{inspector}</aside>
        )}
      </div>

      {/* Below xl the library and inspector are sheets so the canvas keeps its viewport. */}
      <Dialog open={mobilePanel !== 'none'} onOpenChange={(open) => !open && setMobilePanel('none')}>
        <DialogContent
          className="bottom-0 left-0 right-0 top-auto h-[70vh] w-full max-w-none translate-x-0 translate-y-0 rounded-b-none"
        >
          <DialogHeader
            title={mobilePanel === 'library' ? 'Node library' : 'Options'}
            description={
              mobilePanel === 'library'
                ? 'Tap a node to add it to the canvas.'
                : 'Edit the selected node, or the graph settings.'
            }
          />
          <DialogBody className="p-0">
            {mobilePanel === 'library' ? (
              <NodeLibrary
                onAdd={(kind) => {
                  addNode(kind);
                  setMobilePanel('none');
                }}
                className="h-full"
              />
            ) : (
              inspector
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent size="md">
          <DialogHeader
            title="Version history"
            description="Snapshots recorded for this agent."
          />
          <DialogBody>
            {versions.isLoading ? (
              <TableSkeleton rows={3} columns={2} />
            ) : versions.isError ? (
              <ErrorState compact error={versions.error} onRetry={() => versions.refetch()} />
            ) : (versions.data?.length ?? 0) === 0 ? (
              <EmptyState
                compact
                title="No versions yet"
                description="Publish the agent to record its first snapshot."
              />
            ) : (
              <ul className="divide-y divide-line">
                {versions.data!.map((version) => (
                  <li key={version.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-xs text-ink">
                      {version.title || version.id}
                    </span>
                    <span className="shrink-0 font-mono text-2xs text-ink-3">
                      {formatDateTime(version.create_time)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setVersionsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete agent?"
        description={`“${title}” and its graph will be removed. This cannot be undone.`}
        confirmLabel="Delete agent"
        destructive
        loading={deleteAgent.isPending}
        onConfirm={() =>
          deleteAgent.mutate(agentId, {
            onSuccess: () => navigate('/agents'),
          })
        }
      />
    </>
  );
}

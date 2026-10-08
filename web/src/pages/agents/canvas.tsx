/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 *
 * The agent canvas. One @xyflow/react surface, styled entirely from design tokens.
 *
 * React Flow ships its own structural stylesheet (positioning of panes, handles, edges,
 * attribution). We import `base.css` — the minimal, unopinionated build — and then push every
 * *visual* value back through tokenized CSS variables on the container, because Tailwind
 * cannot reach inside React Flow's own class names. Nothing here hard-codes a colour.
 */
import '@xyflow/react/dist/base.css';
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import { Maximize2, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import * as React from 'react';
import type { AgentEdge, AgentNode, AgentNodeKind } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/controls';
import { EmptyState } from '@/components/ui/states';
import { AgentNodeGlyph, AGENT_NODE_KIND_ORDER, NODE_DRAG_MIME, nodeKindMeta } from '@/pages/agents/node-library';
import { cn } from '@/lib/utils';

export type AgentFlowNodeData = { node: AgentNode };
export type AgentFlowNode = Node<AgentFlowNodeData, 'agentNode'>;

/** Handles are drawn from tokens because React Flow defaults them to a hard-coded grey. */
const handleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  background: 'var(--or-surface-1)',
  border: '1.5px solid var(--or-line-strong)',
};

function AgentNodeView({ data, selected }: NodeProps<AgentFlowNode>) {
  const node = data.node;
  const meta = nodeKindMeta(node.kind);
  const configKeys = node.config ? Object.keys(node.config).length : 0;

  return (
    <div
      className={cn(
        'relative w-[200px] rounded-lg border bg-surface-1 py-2 pl-3.5 pr-2.5 transition-colors duration-[110ms]',
        selected ? 'border-accent' : 'border-line hover:border-line-strong',
      )}
      style={{ boxShadow: 'var(--or-shadow-sm)' }}
    >
      <span
        aria-hidden
        className="absolute inset-y-2 left-0 w-[3px] rounded-r-full"
        style={{ backgroundColor: meta.accentVar }}
      />
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <Handle type="source" position={Position.Right} style={handleStyle} />
      <div className="flex items-start gap-2">
        <AgentNodeGlyph kind={node.kind} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-ink">{node.label || meta.label}</p>
          <p className="mt-0.5 truncate text-2xs text-ink-3">{meta.label}</p>
        </div>
      </div>
      {configKeys > 0 && (
        <p className="mt-1.5 font-mono text-[10px] text-ink-3">
          {configKeys} option{configKeys === 1 ? '' : 's'}
        </p>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = { agentNode: AgentNodeView };

/** Token bridge for everything React Flow paints outside Tailwind's reach. */
const flowStyle = {
  backgroundColor: 'var(--or-canvas)',
  '--xy-edge-stroke': 'var(--or-line-strong)',
  '--xy-edge-stroke-width': '1.5',
  '--xy-edge-stroke-selected': 'var(--or-accent)',
  '--xy-connectionline-stroke': 'var(--or-accent)',
  '--xy-handle-background-color': 'var(--or-surface-1)',
  '--xy-selection-background-color': 'var(--or-accent-soft)',
  '--xy-selection-border': '1px dashed var(--or-line-accent)',
  '--xy-attribution-background-color': 'transparent',
} as React.CSSProperties;

const defaultEdgeOptions = {
  type: 'smoothstep',
  style: { stroke: 'var(--or-line-strong)', strokeWidth: 1.5 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: 'var(--or-line-strong)',
    width: 14,
    height: 14,
  },
};

export interface AgentCanvasProps {
  nodes: AgentNode[];
  edges: AgentEdge[];
  selectedNodeId: string | null;
  readOnly?: boolean;
  onSelectNode: (id: string | null) => void;
  onMoveNode: (id: string, position: { x: number; y: number }) => void;
  onRemoveNodes: (ids: string[]) => void;
  onRemoveEdges: (ids: string[]) => void;
  onConnect: (connection: { source: string; target: string; sourceHandle?: string }) => void;
  onAddNodeAt: (kind: AgentNodeKind, position: { x: number; y: number }) => void;
  onAddBegin: () => void;
}

function CanvasInner({
  nodes,
  edges,
  selectedNodeId,
  readOnly,
  onSelectNode,
  onMoveNode,
  onRemoveNodes,
  onRemoveEdges,
  onConnect,
  onAddNodeAt,
  onAddBegin,
}: AgentCanvasProps) {
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null);

  const rfNodes = React.useMemo<AgentFlowNode[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: 'agentNode',
        position: { x: node.x, y: node.y },
        data: { node },
        selected: node.id === selectedNodeId,
        draggable: !readOnly,
      })),
    [nodes, selectedNodeId, readOnly],
  );

  const rfEdges = React.useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        type: 'smoothstep',
        label: edge.label,
        selected: edge.id === selectedEdgeId,
      })),
    [edges, selectedEdgeId],
  );

  const handleNodesChange = React.useCallback(
    (changes: NodeChange[]) => {
      const removed: string[] = [];
      changes.forEach((change) => {
        if (change.type === 'position' && change.position) onMoveNode(change.id, change.position);
        else if (change.type === 'remove') removed.push(change.id);
      });
      if (removed.length) onRemoveNodes(removed);
    },
    [onMoveNode, onRemoveNodes],
  );

  const handleEdgesChange = React.useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
      if (removed.length) {
        onRemoveEdges(removed);
        setSelectedEdgeId((current) => (current && removed.includes(current) ? null : current));
      }
    },
    [onRemoveEdges],
  );

  const handleConnect = React.useCallback(
    (connection: { source: string | null; target: string | null; sourceHandle?: string | null }) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      onConnect({
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
      });
    },
    [onConnect],
  );

  const handleDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (readOnly) return;
      const kind = event.dataTransfer.getData(NODE_DRAG_MIME) as AgentNodeKind;
      // Guard against arbitrary drag payloads: only known node kinds are accepted.
      if (!kind || !AGENT_NODE_KIND_ORDER.includes(kind)) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onAddNodeAt(kind, position);
    },
    [onAddNodeAt, readOnly, screenToFlowPosition],
  );

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_event, node) => {
          setSelectedEdgeId(null);
          onSelectNode(node.id);
        }}
        onEdgeClick={(_event, edge) => setSelectedEdgeId(edge.id)}
        onPaneClick={() => {
          setSelectedEdgeId(null);
          onSelectNode(null);
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        // A legibility floor: on a three-pane layout the canvas is narrow, and letting fitView
        // pick the zoom for a wide graph shrinks a 200px node until its label is unreadable.
        // Below 0.55 the graph pans instead of fitting.
        fitViewOptions={{ padding: 0.2, minZoom: 0.55, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.75}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        preventScrolling
        // Attribution is deliberately left on. Upstream's licence does permit hiding it, but
        // OwnRAG's whole position is that attribution is not decoration: the graph surface is
        // powered by a third-party library and says so. See THIRD-PARTY-NOTICES.md.
        style={flowStyle}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="var(--or-line-strong)"
        />

        <Panel position="top-left">
          <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface-1 p-0.5 shadow-e2">
            <Hint label="Zoom out">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Zoom out"
                onClick={() => zoomOut({ duration: 160 })}
              >
                <ZoomOut />
              </Button>
            </Hint>
            <Hint label="Zoom in">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Zoom in"
                onClick={() => zoomIn({ duration: 160 })}
              >
                <ZoomIn />
              </Button>
            </Hint>
            <Hint label="Fit to view">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Fit to view"
                onClick={() => fitView({ padding: 0.25, duration: 200 })}
              >
                <Maximize2 />
              </Button>
            </Hint>
          </div>
        </Panel>

        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
            <div className="pointer-events-auto w-full max-w-sm rounded-lg border border-line bg-surface-1/95">
              <EmptyState
                compact
                icon={<Plus />}
                title="This graph is empty"
                description="Drag a node from the library onto the canvas, or start with a Begin node and wire the steps together."
                action={
                  <Button size="sm" variant="primary" onClick={onAddBegin}>
                    <Plus />
                    Add Begin node
                  </Button>
                }
              />
            </div>
          </div>
        )}
      </ReactFlow>
    </div>
  );
}

export function AgentCanvas(props: AgentCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

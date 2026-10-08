/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 *
 * Node library for the agent/flow builder.
 *
 * This file is the single source of truth for what a pipeline node *is*: its label, its
 * group, its icon and the design token that tints it. The canvas, the inspector and the
 * palette all read from `NODE_KIND_META`, so a kind can never be rendered differently in two
 * places.
 *
 * Colour: only design tokens. Each kind maps to a semantic hue via a CSS variable
 * (`--or-*`) that resolves per theme. Those hues express the node's *role* in the graph —
 * entry/exit, retrieval, generation, tooling, control flow — never decoration.
 */
import { BookOpen, Bot, Code2, FileText, Globe, Layers, ListChecks, MessageSquare, Play, Repeat, RotateCcw, Search, Sparkles, Split, Webhook, Wrench } from 'lucide-react';
import * as React from 'react';
import type { AgentNodeKind } from '@/api/types';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** MIME type used to carry a node kind from the palette onto the canvas during a drag. */
export const NODE_DRAG_MIME = 'application/ownrag-node-kind';

export type NodeKindGroup = 'Entry & exit' | 'Retrieval' | 'Generation' | 'Tools' | 'Control';

export interface NodeKindMeta {
  kind: AgentNodeKind;
  label: string;
  description: string;
  group: NodeKindGroup;
  icon: React.ComponentType<{ className?: string }>;
  /** Token CSS variable used for the node rail and icon tint. */
  accentVar: string;
  /** Token CSS variable used for the node icon well. */
  softVar: string;
}

const OK = 'var(--or-ok)';
const OK_SOFT = 'var(--or-ok-soft)';
const ACCENT = 'var(--or-accent)';
const ACCENT_SOFT = 'var(--or-accent-soft)';
const INFO = 'var(--or-info)';
const INFO_SOFT = 'var(--or-info-soft)';
const WARN = 'var(--or-warn)';
const WARN_SOFT = 'var(--or-warn-soft)';

export const NODE_KIND_META: Record<AgentNodeKind, NodeKindMeta> = {
  begin: {
    kind: 'begin',
    label: 'Begin',
    description: 'Entry point. Declares the inputs the run accepts.',
    group: 'Entry & exit',
    icon: Play,
    accentVar: OK,
    softVar: OK_SOFT,
  },
  message: {
    kind: 'message',
    label: 'Message',
    description: 'Terminal step. Returns the answer to the caller.',
    group: 'Entry & exit',
    icon: MessageSquare,
    accentVar: OK,
    softVar: OK_SOFT,
  },
  retrieval: {
    kind: 'retrieval',
    label: 'Retrieval',
    description: 'Vector + keyword search across one or more knowledge bases.',
    group: 'Retrieval',
    icon: Search,
    accentVar: ACCENT,
    softVar: ACCENT_SOFT,
  },
  docs: {
    kind: 'docs',
    label: 'Documents',
    description: 'Reads document metadata and chunk structure directly.',
    group: 'Retrieval',
    icon: FileText,
    accentVar: ACCENT,
    softVar: ACCENT_SOFT,
  },
  generate: {
    kind: 'generate',
    label: 'Generate',
    description: 'Calls a chat model with the incoming context.',
    group: 'Generation',
    icon: Sparkles,
    accentVar: INFO,
    softVar: INFO_SOFT,
  },
  agent: {
    kind: 'agent',
    label: 'Agent',
    description: 'Delegates to a sub-agent that plans and calls tools itself.',
    group: 'Generation',
    icon: Bot,
    accentVar: INFO,
    softVar: INFO_SOFT,
  },
  tool: {
    kind: 'tool',
    label: 'Tool',
    description: 'Runs a registered plugin tool and returns its output.',
    group: 'Tools',
    icon: Wrench,
    accentVar: ACCENT,
    softVar: ACCENT_SOFT,
  },
  mcp: {
    kind: 'mcp',
    label: 'MCP',
    description: 'Calls a tool exposed by a connected MCP server.',
    group: 'Tools',
    icon: Webhook,
    accentVar: ACCENT,
    softVar: ACCENT_SOFT,
  },
  code: {
    kind: 'code',
    label: 'Code',
    description: 'Executes a sandboxed snippet over the incoming payload.',
    group: 'Tools',
    icon: Code2,
    accentVar: ACCENT,
    softVar: ACCENT_SOFT,
  },
  wikipedia: {
    kind: 'wikipedia',
    label: 'Wikipedia',
    description: 'Looks entities up on Wikipedia.',
    group: 'Tools',
    icon: BookOpen,
    accentVar: ACCENT,
    softVar: ACCENT_SOFT,
  },
  websearch: {
    kind: 'websearch',
    label: 'Web search',
    description: 'Searches the public web and returns ranked snippets.',
    group: 'Tools',
    icon: Globe,
    accentVar: ACCENT,
    softVar: ACCENT_SOFT,
  },
  categorize: {
    kind: 'categorize',
    label: 'Categorize',
    description: 'Classifies the payload into one of a fixed set of labels.',
    group: 'Control',
    icon: ListChecks,
    accentVar: WARN,
    softVar: WARN_SOFT,
  },
  switch: {
    kind: 'switch',
    label: 'Switch',
    description: 'Branches on a condition or model decision.',
    group: 'Control',
    icon: Split,
    accentVar: WARN,
    softVar: WARN_SOFT,
  },
  iteration: {
    kind: 'iteration',
    label: 'Iteration',
    description: 'Repeats a sub-path until the exit condition holds.',
    group: 'Control',
    icon: Repeat,
    accentVar: WARN,
    softVar: WARN_SOFT,
  },
  loop: {
    kind: 'loop',
    label: 'Loop',
    description: 'Fixed-count repetition over a sub-path.',
    group: 'Control',
    icon: RotateCcw,
    accentVar: WARN,
    softVar: WARN_SOFT,
  },
};

/** Display order for the palette. Kept separate so the registry stays exhaustive-checked. */
export const AGENT_NODE_KIND_ORDER: AgentNodeKind[] = [
  'begin',
  'retrieval',
  'generate',
  'categorize',
  'switch',
  'code',
  'iteration',
  'loop',
  'agent',
  'tool',
  'mcp',
  'wikipedia',
  'websearch',
  'docs',
  'message',
];

export const AGENT_NODE_KIND_LIST: NodeKindMeta[] = AGENT_NODE_KIND_ORDER.map(
  (kind) => NODE_KIND_META[kind],
);

export function nodeKindMeta(kind: AgentNodeKind): NodeKindMeta {
  return NODE_KIND_META[kind];
}

/**
 * Sensible, non-fabricated starting options for a freshly dropped node. Retrieval and model
 * settings stay empty (or at the backend's documented defaults) so the operator fills in
 * their own knowledge bases and models rather than inheriting invented ones.
 */
export function defaultNodeConfig(kind: AgentNodeKind): Record<string, unknown> | undefined {
  switch (kind) {
    case 'begin':
      return { inputs: [{ key: 'question', type: 'text', required: true }] };
    case 'retrieval':
      return { dataset_ids: [], similarity_threshold: 0.2, top_n: 6, top_k: 1024 };
    case 'generate':
      return { model: '', temperature: 0.2 };
    case 'categorize':
      return { model: '', categories: [] };
    case 'switch':
      return { condition: '', cases: [] };
    case 'code':
      return { language: 'python', timeout_s: 20 };
    case 'iteration':
    case 'loop':
      return { max_iterations: 3 };
    default:
      return undefined;
  }
}

const GROUP_ORDER: NodeKindGroup[] = ['Entry & exit', 'Retrieval', 'Generation', 'Tools', 'Control'];

/** Icon well shared by the palette, the canvas nodes and the inspector header. */
export function AgentNodeGlyph({
  kind,
  size = 'md',
  className,
}: {
  kind: AgentNodeKind;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const meta = nodeKindMeta(kind);
  const Icon = meta.icon;
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md border border-line',
        size === 'sm' ? 'size-5' : 'size-6',
        className,
      )}
      style={{ backgroundColor: meta.softVar, color: meta.accentVar }}
    >
      <Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} />
    </span>
  );
}

/**
 * Drag-and-drop palette. Items carry `NODE_DRAG_MIME` so the canvas can drop them at the
 * pointer position; a plain click adds the node at a computed position (the touch/keyboard
 * path, and what the mobile sheet uses).
 */
export function NodeLibrary({
  onAdd,
  className,
}: {
  onAdd: (kind: AgentNodeKind) => void;
  className?: string;
}) {
  const [query, setQuery] = React.useState('');

  const groups = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = AGENT_NODE_KIND_LIST.filter(
      (meta) =>
        !q ||
        meta.label.toLowerCase().includes(q) ||
        meta.description.toLowerCase().includes(q) ||
        meta.kind.includes(q),
    );
    return GROUP_ORDER.map((group) => ({
      group,
      items: matches.filter((meta) => meta.group === group),
    })).filter((entry) => entry.items.length > 0);
  }, [query]);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="shrink-0 border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Layers className="size-3.5 text-ink-3" />
          <h3 className="text-sm font-medium text-ink">Node library</h3>
        </div>
        <p className="mt-1 text-2xs leading-relaxed text-ink-3">
          Drag a node onto the canvas, or tap to add it in sequence.
        </p>
        <Input
          inputSize="sm"
          className="mt-2"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter nodes…"
          aria-label="Filter nodes"
        />
      </div>

      <div className="or-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-2xs text-ink-3">
            No node matches “{query.trim()}”.
          </p>
        ) : (
          groups.map((entry) => (
            <div key={entry.group} className="mb-3 last:mb-0">
              <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-3">
                {entry.group}
              </p>
              <div className="flex flex-col gap-0.5">
                {entry.items.map((meta) => (
                  <button
                    key={meta.kind}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(NODE_DRAG_MIME, meta.kind);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => onAdd(meta.kind)}
                    className="group flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors duration-[110ms] hover:border-line hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                  >
                    <AgentNodeGlyph kind={meta.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-ink">{meta.label}</span>
                      <span className="mt-0.5 block text-2xs leading-snug text-ink-3">
                        {meta.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

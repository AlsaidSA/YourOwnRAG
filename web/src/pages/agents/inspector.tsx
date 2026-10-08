/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 *
 * The builder inspector. One panel, two jobs: edit the selected node, or — when nothing is
 * selected — edit the graph-wide settings (name, description, system prompt, timeout) and
 * jump to a node from the outline.
 *
 * Node options are rendered from typed field primitives; anything unrecognised falls back to
 * a generic editor derived from the value's own type, plus a raw JSON escape hatch. Nothing
 * is ever invented: a node with no options says so.
 */
import { ChevronLeft, Copy, Plus, Trash, X } from 'lucide-react';
import * as React from 'react';
import type { AgentEdge, AgentNode, AgentNodeKind } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Separator, Switch } from '@/components/ui/controls';
import { Field, Input, Textarea } from '@/components/ui/input';
import { DescriptionList, KeyValue } from '@/components/ui/surface';
import { SectionHeader } from '@/components/ui/surface';
import { EmptyState, InlineError } from '@/components/ui/states';
import { AgentNodeGlyph, nodeKindMeta } from '@/pages/agents/node-library';
import { cn, shortId } from '@/lib/utils';

/* ------------------------------------------------------------------ value helpers */

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Stable empty object so editors keyed on `config` do not reset every render. */
const EMPTY_CONFIG: Record<string, unknown> = {};

/* ------------------------------------------------------------------ field primitives */

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  mono,
}: {
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        inputSize="sm"
        className={mono ? 'font-mono' : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
}: {
  label: React.ReactNode;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: React.ReactNode;
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        inputSize="sm"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value === undefined ? '' : String(value)}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
      />
    </Field>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  hint,
  mono,
}: {
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <Textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={mono ? 'min-h-0 font-mono' : 'min-h-0'}
      />
    </Field>
  );
}

function SwitchField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="min-w-0">
        <span className="block text-xs text-ink-2">{label}</span>
        {hint && <span className="mt-0.5 block text-2xs text-ink-3">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={typeof label === 'string' ? label : undefined} />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: React.ReactNode;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  hint?: React.ReactNode;
}) {
  return (
    <Field label={label} hint={hint}>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function StringListField({
  label,
  items,
  onChange,
  placeholder,
  hint,
}: {
  label: React.ReactNode;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  hint?: React.ReactNode;
}) {
  const [draft, setDraft] = React.useState('');
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (!items.includes(value)) onChange([...items, value]);
    setDraft('');
  };
  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-wrap gap-1">
        {items.length === 0 && <span className="text-2xs text-ink-3">Nothing added yet.</span>}
        {items.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-2 pr-1 text-2xs text-ink-2"
          >
            <span className="font-mono">{item}</span>
            <button
              type="button"
              className="rounded-full p-0.5 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
              aria-label={`Remove ${item}`}
              onClick={() => onChange(items.filter((entry) => entry !== item))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <Input
          inputSize="sm"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button size="sm" variant="secondary" type="button" onClick={add}>
          <Plus />
          Add
        </Button>
      </div>
    </Field>
  );
}

interface NodeInputSpec {
  key: string;
  type: string;
  required?: boolean;
}

const INPUT_TYPES = ['text', 'number', 'file', 'select', 'password'];

function InputsField({
  inputs,
  onChange,
}: {
  inputs: NodeInputSpec[];
  onChange: (inputs: NodeInputSpec[]) => void;
}) {
  const update = (index: number, patch: Partial<NodeInputSpec>) =>
    onChange(inputs.map((input, i) => (i === index ? { ...input, ...patch } : input)));
  return (
    <Field label="Inputs" hint="Declared inputs appear in the run form and the API payload.">
      <div className="flex flex-col gap-2">
        {inputs.length === 0 && <span className="text-2xs text-ink-3">No inputs declared.</span>}
        {inputs.map((input, index) => (
          <div key={`${input.key}-${index}`} className="flex items-center gap-1.5">
            <Input
              inputSize="sm"
              className="flex-1 font-mono"
              value={input.key}
              placeholder="key"
              onChange={(event) => update(index, { key: event.target.value })}
            />
            <Select value={input.type} onValueChange={(value) => update(index, { type: value })}>
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INPUT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1 text-2xs text-ink-3">
              <Switch
                checked={Boolean(input.required)}
                onCheckedChange={(checked) => update(index, { required: checked })}
                aria-label="Required"
              />
              req
            </label>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Remove input"
              onClick={() => onChange(inputs.filter((_, i) => i !== index))}
            >
              <X />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          type="button"
          className="self-start"
          onClick={() => onChange([...inputs, { key: '', type: 'text', required: false }])}
        >
          <Plus />
          Add input
        </Button>
      </div>
    </Field>
  );
}

/* ------------------------------------------------------------------ node options */

function ConfigFields({
  node,
  onPatch,
}: {
  node: AgentNode;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const config = node.config ?? {};
  const set = (key: string, value: unknown) => onPatch({ [key]: value });
  const kind: AgentNodeKind = node.kind;

  switch (kind) {
    case 'begin':
      return (
        <InputsField
          inputs={Array.isArray(config.inputs) ? (config.inputs as NodeInputSpec[]) : []}
          onChange={(inputs) => set('inputs', inputs)}
        />
      );

    case 'retrieval':
      return (
        <>
          <StringListField
            label="Knowledge bases"
            hint="Dataset ids to search. Leave empty to search every base the account can read."
            items={asStringList(config.dataset_ids)}
            placeholder="kb_…"
            onChange={(items) => set('dataset_ids', items)}
          />
          <NumberField label="Top N" value={asNumber(config.top_n)} min={1} onChange={(v) => set('top_n', v)} />
          <NumberField label="Top K" value={asNumber(config.top_k)} min={1} onChange={(v) => set('top_k', v)} />
          <NumberField
            label="Similarity threshold"
            value={asNumber(config.similarity_threshold)}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => set('similarity_threshold', v)}
          />
          <TextField
            label="Rerank model"
            mono
            value={asString(config.rerank_id)}
            placeholder="BAAI/bge-reranker-v2-m3@BAAI"
            onChange={(v) => set('rerank_id', v)}
          />
        </>
      );

    case 'generate':
      return (
        <>
          <TextField
            label="Model"
            mono
            value={asString(config.model)}
            placeholder="gpt-5@openai"
            onChange={(v) => set('model', v)}
          />
          <NumberField
            label="Temperature"
            value={asNumber(config.temperature)}
            min={0}
            max={2}
            step={0.1}
            onChange={(v) => set('temperature', v)}
          />
          <NumberField
            label="Max tokens"
            value={asNumber(config.max_tokens)}
            min={1}
            step={64}
            onChange={(v) => set('max_tokens', v)}
          />
          <TextAreaField label="System prompt" value={asString(config.system)} onChange={(v) => set('system', v)} />
          <SwitchField label="Stream output" checked={config.stream === true} onChange={(v) => set('stream', v)} />
        </>
      );

    case 'agent':
      return (
        <>
          <TextField
            label="Model"
            mono
            value={asString(config.model)}
            placeholder="claude-sonnet-4.5@anthropic"
            onChange={(v) => set('model', v)}
          />
          <TextAreaField label="System prompt" value={asString(config.system)} onChange={(v) => set('system', v)} />
        </>
      );

    case 'categorize':
      return (
        <>
          <TextField
            label="Model"
            mono
            value={asString(config.model)}
            placeholder="gpt-5@openai"
            onChange={(v) => set('model', v)}
          />
          <StringListField
            label="Categories"
            hint="One label per branch. The model picks the closest."
            items={asStringList(config.categories)}
            placeholder="obligation"
            onChange={(items) => set('categories', items)}
          />
        </>
      );

    case 'switch':
      return (
        <>
          <TextField
            label="Condition"
            mono
            value={asString(config.condition)}
            placeholder="citation_count >= 2"
            onChange={(v) => set('condition', v)}
          />
          <StringListField
            label="Cases"
            items={asStringList(config.cases)}
            placeholder="answer"
            onChange={(items) => set('cases', items)}
          />
        </>
      );

    case 'code':
      return (
        <>
          <SelectField
            label="Language"
            value={asString(config.language) || 'python'}
            options={[
              { value: 'python', label: 'Python' },
              { value: 'javascript', label: 'JavaScript' },
              { value: 'sql', label: 'SQL' },
            ]}
            onChange={(v) => set('language', v)}
          />
          <NumberField
            label="Timeout (s)"
            value={asNumber(config.timeout_s)}
            min={1}
            onChange={(v) => set('timeout_s', v)}
          />
          <TextAreaField
            label="Script"
            mono
            value={asString(config.script)}
            placeholder="def run(inputs): …"
            onChange={(v) => set('script', v)}
          />
        </>
      );

    case 'iteration':
    case 'loop':
      return (
        <NumberField
          label="Max iterations"
          value={asNumber(config.max_iterations)}
          min={1}
          onChange={(v) => set('max_iterations', v)}
        />
      );

    case 'tool':
      return (
        <>
          <TextField
            label="Tool"
            mono
            value={asString(config.tool_name ?? config.name)}
            placeholder="web_search"
            onChange={(v) => set('tool_name', v)}
          />
        </>
      );

    case 'mcp':
      return (
        <>
          <TextField
            label="Server"
            mono
            value={asString(config.server_id ?? config.server)}
            placeholder="postgres-readonly"
            onChange={(v) => set('server_id', v)}
          />
          <TextField
            label="Tool"
            mono
            value={asString(config.tool_name)}
            placeholder="query"
            onChange={(v) => set('tool_name', v)}
          />
        </>
      );

    default:
      return <GenericFields config={config} onPatch={onPatch} />;
  }
}

function GenericFields({
  config,
  onPatch,
}: {
  config: Record<string, unknown>;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(config);
  if (entries.length === 0) {
    return <p className="text-2xs text-ink-3">This node type has no options yet.</p>;
  }
  return (
    <>
      {entries.map(([key, value]) => {
        if (typeof value === 'boolean') {
          return (
            <SwitchField key={key} label={key} checked={value} onChange={(v) => onPatch({ [key]: v })} />
          );
        }
        if (typeof value === 'number') {
          return (
            <NumberField key={key} label={key} value={value} onChange={(v) => onPatch({ [key]: v })} />
          );
        }
        if (typeof value === 'string') {
          return (
            <TextField key={key} label={key} value={value} onChange={(v) => onPatch({ [key]: v })} />
          );
        }
        if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
          return (
            <StringListField
              key={key}
              label={key}
              items={value as string[]}
              onChange={(v) => onPatch({ [key]: v })}
            />
          );
        }
        return (
          <KeyValue key={key} label={key} mono>
            {asString(value)}
          </KeyValue>
        );
      })}
    </>
  );
}

function RawJsonEditor({
  config,
  onApply,
}: {
  config: Record<string, unknown>;
  onApply: (config: Record<string, unknown>) => void;
}) {
  const [text, setText] = React.useState(() => JSON.stringify(config ?? {}, null, 2));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setText(JSON.stringify(config ?? {}, null, 2));
    setError(null);
  }, [config]);

  const apply = () => {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setError('Config must be a JSON object.');
        return;
      }
      setError(null);
      onApply(parsed as Record<string, unknown>);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  return (
    <details className="group rounded-md border border-line bg-surface-2/40">
      <summary className="cursor-pointer list-none select-none px-2.5 py-1.5 text-2xs font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
        Raw config (JSON)
      </summary>
      <div className="space-y-1.5 border-t border-line p-2.5">
        {error && <InlineError message={error} />}
        <Textarea
          rows={6}
          className="min-h-0 font-mono text-2xs"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" type="button" onClick={apply}>
            Apply
          </Button>
        </div>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ inspector */

export interface AgentInspectorProps {
  nodes: AgentNode[];
  edges: AgentEdge[];
  node: AgentNode | null;
  title: string;
  description: string;
  globals: Record<string, unknown>;
  onChangeTitle: (value: string) => void;
  onChangeDescription: (value: string) => void;
  onSelectNode: (id: string | null) => void;
  onPatchNode: (id: string, patch: Partial<AgentNode>) => void;
  onPatchConfig: (id: string, patch: Record<string, unknown>) => void;
  onReplaceConfig: (id: string, config: Record<string, unknown>) => void;
  onChangeGlobals: (patch: Record<string, unknown>) => void;
  onDeleteNode: (id: string) => void;
  onDuplicateNode: (id: string) => void;
  className?: string;
}

export function AgentInspector({
  nodes,
  edges,
  node,
  title,
  description,
  globals,
  onChangeTitle,
  onChangeDescription,
  onSelectNode,
  onPatchNode,
  onPatchConfig,
  onReplaceConfig,
  onChangeGlobals,
  onDeleteNode,
  onDuplicateNode,
  className,
}: AgentInspectorProps) {
  if (!node) {
    return (
      <div className={cn('flex h-full min-h-0 flex-col', className)}>
        <div className="shrink-0 border-b border-line px-3 py-2.5">
          <h3 className="text-sm font-medium text-ink">Graph settings</h3>
          <p className="mt-0.5 text-2xs text-ink-3">Select a node to edit its options.</p>
        </div>
        <div className="or-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
          <TextField label="Name" value={title} onChange={onChangeTitle} />
          <TextAreaField label="Description" value={description} onChange={onChangeDescription} rows={3} />
          <Separator />
          <TextField
            label="System prompt"
            value={asString(globals.sys_prompt)}
            placeholder="Applies to every model node unless overridden."
            onChange={(value) => onChangeGlobals({ sys_prompt: value })}
          />
          <NumberField
            label="Run timeout (s)"
            value={asNumber(globals.timeout_s)}
            min={1}
            onChange={(value) => onChangeGlobals({ timeout_s: value })}
          />

          <Separator />
          <SectionHeader title="Outline" description={`${nodes.length} node${nodes.length === 1 ? '' : 's'} in this graph`} />
          {nodes.length === 0 ? (
            <EmptyState
              compact
              title="No nodes yet"
              description="Add nodes from the library, then wire them together on the canvas."
            />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {nodes.map((entry) => {
                const meta = nodeKindMeta(entry.kind);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => onSelectNode(entry.id)}
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-surface-2"
                    >
                      <AgentNodeGlyph kind={entry.kind} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">{entry.label || meta.label}</span>
                      <span className="shrink-0 font-mono text-2xs text-ink-3">{meta.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  const meta = nodeKindMeta(node.kind);
  const incoming = edges.filter((edge) => edge.target === node.id).length;
  const outgoing = edges.filter((edge) => edge.source === node.id).length;

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Back to graph settings"
          onClick={() => onSelectNode(null)}
        >
          <ChevronLeft />
        </Button>
        <AgentNodeGlyph kind={node.kind} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-ink">{node.label || meta.label}</p>
          <p className="truncate text-2xs text-ink-3">{meta.label}</p>
        </div>
        <Badge tone="neutral" size="sm">
          {shortId(node.id)}
        </Badge>
      </div>

      <div className="or-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <TextField label="Label" value={node.label} onChange={(value) => onPatchNode(node.id, { label: value })} />

        <DescriptionList
          items={[
            { label: 'Node id', value: <span>{node.id}</span>, mono: true },
            { label: 'Position', value: `${node.x}, ${node.y}`, mono: true },
            { label: 'Incoming', value: <span className="font-mono">{incoming}</span> },
            { label: 'Outgoing', value: <span className="font-mono">{outgoing}</span> },
          ]}
        />

        <Separator />

        <SectionHeader title="Options" description={meta.description} />

        <ConfigFields node={node} onPatch={(patch) => onPatchConfig(node.id, patch)} />

        <RawJsonEditor config={node.config ?? EMPTY_CONFIG} onApply={(config) => onReplaceConfig(node.id, config)} />
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
        <Button size="sm" variant="secondary" onClick={() => onDuplicateNode(node.id)}>
          <Copy />
          Duplicate
        </Button>
        <Button
          size="sm"
          variant="danger-ghost"
          className="ml-auto"
          onClick={() => onDeleteNode(node.id)}
        >
          <Trash />
          Delete
        </Button>
      </div>
    </div>
  );
}

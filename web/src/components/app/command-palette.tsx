/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Command palette (⌘K). Navigation, live objects and actions in one list, ranked by a
 * simple prefix/word-start score so the first result is always the obvious one.
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Boxes,
  CornerDownLeft,
  Database,
  FileText,
  MessageSquare,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Waypoints,
  Workflow,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router';
import { useAgents, useAssistants, useKnowledgeBases } from '@/api/hooks';
import { Kbd } from '@/components/ui/controls';
import { useUiStore } from '@/store/ui';
import { cn } from '@/lib/utils';

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ReactNode;
  keywords?: string;
  run: () => void;
}

function score(query: string, item: CommandItem) {
  const haystack = `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  if (haystack.startsWith(q)) return 100;
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(haystack)) return 60;
  if (haystack.includes(q)) return 30;
  return 0;
}

export function CommandPalette() {
  const open = useUiStore((state) => state.commandOpen);
  const setOpen = useUiStore((state) => state.setCommandOpen);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const theme = useUiStore((state) => state.theme);
  const navigate = useNavigate();
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);

  const { data: knowledge } = useKnowledgeBases({ page_size: 50 });
  const { data: agents } = useAgents();
  const { data: assistants } = useAssistants();

  const go = React.useCallback(
    (path: string) => {
      setOpen(false);
      setQuery('');
      navigate(path);
    },
    [navigate, setOpen],
  );

  const items = React.useMemo<CommandItem[]>(() => {
    const staticItems: CommandItem[] = [
      { id: 'nav-overview', label: 'Overview', group: 'Go to', icon: <Waypoints />, keywords: 'dashboard home', run: () => go('/overview') },
      { id: 'nav-knowledge', label: 'Knowledge bases', group: 'Go to', icon: <Database />, keywords: 'datasets', run: () => go('/knowledge') },
      { id: 'nav-retrieval', label: 'Retrieval console', group: 'Go to', icon: <Search />, keywords: 'search test playground recall', run: () => go('/retrieval') },
      { id: 'nav-chat', label: 'Chat', group: 'Go to', icon: <MessageSquare />, keywords: 'assistant conversation', run: () => go('/chat') },
      { id: 'nav-agents', label: 'Agents', group: 'Go to', icon: <Workflow />, keywords: 'workflow builder', run: () => go('/agents') },
      { id: 'nav-sources', label: 'Data sources', group: 'Go to', icon: <Boxes />, keywords: 'connectors sync s3 drive slack', run: () => go('/data-sources') },
      { id: 'nav-models', label: 'Models', group: 'Go to', icon: <Settings />, keywords: 'providers embeddings rerank byo', run: () => go('/models') },
      { id: 'nav-developers', label: 'Developers & API', group: 'Go to', icon: <FileText />, keywords: 'keys tokens curl sdk', run: () => go('/developers') },
      { id: 'nav-settings', label: 'Settings', group: 'Go to', icon: <Settings />, run: () => go('/settings') },
      {
        id: 'act-new-kb',
        label: 'New knowledge base',
        group: 'Actions',
        icon: <Plus />,
        keywords: 'create dataset',
        run: () => go('/knowledge?new=1'),
      },
      {
        id: 'act-new-chat',
        label: 'New assistant',
        group: 'Actions',
        icon: <Plus />,
        keywords: 'create chat',
        run: () => go('/chat?new=1'),
      },
      {
        id: 'act-new-agent',
        label: 'New agent',
        group: 'Actions',
        icon: <Plus />,
        keywords: 'create workflow',
        run: () => go('/agents?new=1'),
      },
      {
        id: 'act-theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        group: 'Actions',
        icon: theme === 'dark' ? <Sun /> : <Moon />,
        run: () => {
          toggleTheme();
          setOpen(false);
        },
      },
    ];

    const kbItems: CommandItem[] = (knowledge?.items ?? []).map((kb) => ({
      id: `kb-${kb.id}`,
      label: kb.name,
      hint: `${kb.document_count.toLocaleString()} docs · ${kb.chunk_count.toLocaleString()} chunks`,
      group: 'Knowledge bases',
      icon: <Database />,
      keywords: `${kb.chunk_method} ${(kb.tags ?? []).join(' ')}`,
      run: () => go(`/knowledge/${kb.id}`),
    }));

    const agentItems: CommandItem[] = (agents?.items ?? []).map((agent) => ({
      id: `agent-${agent.id}`,
      label: agent.title,
      hint: agent.description,
      group: 'Agents',
      icon: <Workflow />,
      run: () => go(`/agents/${agent.id}`),
    }));

    const chatItems: CommandItem[] = (assistants?.items ?? []).map((assistant) => ({
      id: `chat-${assistant.id}`,
      label: assistant.name,
      hint: assistant.description,
      group: 'Assistants',
      icon: <MessageSquare />,
      run: () => go(`/chat/${assistant.id}`),
    }));

    return [...staticItems, ...kbItems, ...agentItems, ...chatItems];
  }, [agents, assistants, go, knowledge, setOpen, theme, toggleTheme]);

  const filtered = React.useMemo(() => {
    const ranked = items
      .map((item) => ({ item, value: score(query, item) }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 40)
      .map((entry) => entry.item);
    return ranked;
  }, [items, query]);

  React.useEffect(() => setActiveIndex(0), [query]);

  const groups = React.useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    filtered.forEach((item) => {
      map.set(item.group, [...(map.get(item.group) ?? []), item]);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const flat = groups.flatMap(([, groupItems]) => groupItems);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, flat.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      flat[activeIndex]?.run();
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-[oklch(0.15_0.01_265/0.5)] or-fade-in" />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          className="fixed left-1/2 top-[12vh] z-[91] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong bg-surface-3 shadow-e3 or-rise-in"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
            <Search className="size-4 text-ink-3" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search knowledge bases, agents, assistants, actions…"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
            />
            <Kbd>esc</Kbd>
          </div>
          <div className="or-scroll max-h-[52vh] overflow-y-auto p-1.5">
            {flat.length === 0 && (
              <p className="px-3 py-8 text-center text-xs text-ink-3">
                No match for “{query}”.
              </p>
            )}
            {groups.map(([group, groupItems]) => (
              <div key={group} className="mb-1">
                <p className="px-2 py-1 text-2xs font-medium uppercase tracking-wide text-ink-3">
                  {group}
                </p>
                {groupItems.map((item) => {
                  const index = flat.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={item.run}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                        index === activeIndex ? 'bg-surface-2' : 'hover:bg-surface-2',
                      )}
                    >
                      <span className="text-ink-3 [&_svg]:size-3.5">{item.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-ink">{item.label}</span>
                        {item.hint && (
                          <span className="block truncate text-2xs text-ink-3">{item.hint}</span>
                        )}
                      </span>
                      {index === activeIndex && <CornerDownLeft className="size-3 text-ink-3" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

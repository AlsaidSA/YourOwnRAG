/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Information architecture. Three groups, ordered by how the product is actually used:
 * build an index, connect the outside world, then operate it.
 */
import {
  Boxes,
  Brain,
  Database,
  FileCode2,
  MessageSquare,
  Plug,
  Search,
  Settings,
  SlidersHorizontal,
  Waypoints,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Match nested routes (detail pages) so the parent stays highlighted. */
  match?: string;
  badge?: 'kbs' | 'agents';
  description?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Build',
    items: [
      { label: 'Overview', to: '/overview', icon: Waypoints, description: 'Corpus health, ingestion and usage at a glance' },
      { label: 'Knowledge', to: '/knowledge', icon: Database, match: '/knowledge', badge: 'kbs', description: 'Knowledge bases, documents and chunking' },
      { label: 'Retrieval', to: '/retrieval', icon: Search, description: 'Test recall, reranking and thresholds' },
      { label: 'Chat', to: '/chat', icon: MessageSquare, match: '/chat', description: 'Grounded assistants with citations' },
      { label: 'Agents', to: '/agents', icon: Workflow, match: '/agents', badge: 'agents', description: 'Workflow builder and agent runs' },
    ],
  },
  {
    label: 'Connect',
    items: [
      { label: 'Models', to: '/models', icon: SlidersHorizontal, description: 'Bring your own chat, embedding and rerank models' },
      { label: 'Data sources', to: '/data-sources', icon: Boxes, description: 'Sync from S3, Drive, Slack and more' },
      { label: 'Memory', to: '/memory', icon: Brain, description: 'Long-lived agent memory stores' },
      { label: 'MCP servers', to: '/mcp', icon: Plug, description: 'Tool servers available to agents' },
    ],
  },
  {
    label: 'Operate',
    items: [
      { label: 'Developers', to: '/developers', icon: FileCode2, description: 'API keys, endpoints and SDK snippets' },
      { label: 'Settings', to: '/settings', icon: Settings, match: '/settings', description: 'Workspace, team and preferences' },
    ],
  },
];

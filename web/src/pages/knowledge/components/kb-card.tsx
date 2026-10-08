/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Knowledge-base card for the /knowledge grid. One glanceable unit: identity, tags, the three
 * counts that matter (documents, chunks, tokens), and the retrieval settings that explain them.
 * The whole card is a link to the detail route; row actions live in a menu on top of it.
 */
import { Copy, ExternalLink, MoreHorizontal, Trash2, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import type { KnowledgeBase } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/controls';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Panel } from '@/components/ui/surface';
import { toast } from '@/components/ui/toaster';
import { formatCompact, formatRelativeTime } from '@/lib/format';
import { chunkMethodLabel } from '@/pages/knowledge/components/create-kb-dialog';

export interface KbCardProps {
  kb: KnowledgeBase;
  onDelete?: (kb: KnowledgeBase) => void;
}

function StatCell({ value, label, title }: { value: string; label: string; title?: string }) {
  return (
    <div className="px-3 py-2" title={title}>
      <p className="font-mono text-sm text-ink">{value}</p>
      <p className="mt-0.5 text-2xs uppercase tracking-wide text-ink-3">{label}</p>
    </div>
  );
}

export function KbCard({ kb, onDelete }: KbCardProps) {
  const navigate = useNavigate();

  const tags = kb.tags ?? [];
  const parsing = kb.document_count > 0 && kb.chunk_count === 0;
  const disabled = kb.status === '0';

  const copyId = () => {
    if (!navigator.clipboard) {
      toast({ title: 'Could not copy the id', description: 'The clipboard is unavailable in this context.', variant: 'error' });
      return;
    }
    navigator.clipboard
      .writeText(kb.id)
      .then(() => toast({ title: 'Knowledge base id copied', description: kb.id, variant: 'success' }))
      .catch(() => toast({ title: 'Could not copy the id', variant: 'error' }));
  };

  return (
    <Panel className="group relative flex flex-col overflow-hidden transition-colors hover:border-line-strong">
      <Link to={`/knowledge/${kb.id}`} className="flex min-w-0 flex-1 flex-col gap-3 p-4 pr-12">
        <div className="flex items-start gap-3">
          <Avatar name={kb.name} src={kb.avatar} size={32} />
          <div className="min-w-0 flex-1">
            <span className="or-truncate block text-sm font-medium text-ink group-hover:text-accent">
              {kb.name}
            </span>
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-3">
              {kb.description?.trim() ? kb.description : 'No description yet.'}
            </p>
          </div>
        </div>

        {(kb.permission === 'team' || parsing || disabled || tags.length > 0) && (
          <div className="flex flex-wrap items-center gap-1">
            {disabled && (
              <Badge tone="neutral" size="sm">
                Disabled
              </Badge>
            )}
            {kb.permission === 'team' && (
              <Badge tone="neutral" size="sm">
                <Users className="size-3" />
                Team
              </Badge>
            )}
            {parsing && (
              <Badge tone="warn" size="sm" dot>
                Parsing
              </Badge>
            )}
            {tags.slice(0, 4).map((tag) => (
              <Badge key={tag} tone="outline" size="sm" className="max-w-[9rem] truncate">
                {tag}
              </Badge>
            ))}
            {tags.length > 4 && (
              <Badge tone="neutral" size="sm">
                +{tags.length - 4}
              </Badge>
            )}
          </div>
        )}
      </Link>

      <div className="absolute right-2 top-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${kb.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={<ExternalLink />} onSelect={() => navigate(`/knowledge/${kb.id}`)}>
              Open
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Copy />} onSelect={copyId}>
              Copy id
            </DropdownMenuItem>
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive icon={<Trash2 />} onSelect={() => onDelete(kb)}>
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid grid-cols-3 divide-x divide-line border-t border-line bg-surface-2">
        <StatCell
          value={formatCompact(kb.document_count)}
          label="Documents"
          title={`${kb.document_count.toLocaleString()} documents`}
        />
        <StatCell
          value={formatCompact(kb.chunk_count)}
          label="Chunks"
          title={`${kb.chunk_count.toLocaleString()} chunks`}
        />
        <StatCell value={formatCompact(kb.token_count)} label="Tokens" title="Indexed tokens" />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-2xs text-ink-3">
        <span className="or-truncate font-mono" title={kb.embedding_model}>
          {kb.embedding_model || '—'}
        </span>
        <span className="shrink-0 whitespace-nowrap">
          {chunkMethodLabel(kb.chunk_method)} · {formatRelativeTime(kb.update_time ?? kb.create_time)}
        </span>
      </div>
    </Panel>
  );
}

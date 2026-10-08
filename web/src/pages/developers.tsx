/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * Developers — the machine-facing side of the console: API keys with a one-time reveal, a
 * runnable reference for the four routes most integrations start from, and the build
 * identity of the server this console is talking to.
 */
import {
  Check,
  Copy,
  Eye,
  KeyRound,
  Plus,
  RefreshCw,
  ServerCog,
  Terminal,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { endpoints } from '@/api/endpoints';
import { useApiTokens, useCreateApiToken, useDeleteApiToken, useSystemInfo } from '@/api/hooks';
import type { ApiToken } from '@/api/types';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/controls';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/surface';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Column, DataTable } from '@/components/ui/data-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { formatRelativeTime } from '@/lib/format';

type Lang = 'curl' | 'python' | 'javascript';

const BASE = '$OWNRAG_BASE';
const KEY = '$OWNRAG_API_KEY';

interface RouteSpec {
  id: string;
  title: string;
  description: string;
  method: 'POST';
  path: string;
  snippets: Record<Lang, string>;
}

const ROUTES: RouteSpec[] = [
  {
    id: 'create-dataset',
    title: 'Create a knowledge base',
    description:
      'Creates a dataset (the backend name for a knowledge base) with the embedding model and parser it will use. Returns the new id.',
    method: 'POST',
    path: endpoints.createKb,
    snippets: {
      curl: [
        `curl -sS -X POST "${BASE}${endpoints.createKb}" \\`,
        `  -H "Authorization: Bearer ${KEY}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{"name":"labour-law","embedding_model":"BAAI/bge-m3@BAAI","chunk_method":"laws"}'`,
      ].join('\n'),
      python: [
        'import os',
        'import requests',
        '',
        "base = os.environ['OWNRAG_BASE']",
        "key = os.environ['OWNRAG_API_KEY']",
        '',
        'resp = requests.post(',
        `    f"{base}${endpoints.createKb}",`,
        '    headers={"Authorization": f"Bearer {key}"},',
        '    json={',
        '        "name": "labour-law",',
        '        "embedding_model": "BAAI/bge-m3@BAAI",',
        '        "chunk_method": "laws",',
        '    },',
        ')',
        'resp.raise_for_status()',
        'print(resp.json()["data"])',
      ].join('\n'),
      javascript: [
        'const base = process.env.OWNRAG_BASE;',
        'const key = process.env.OWNRAG_API_KEY;',
        '',
        `const res = await fetch(base + '${endpoints.createKb}', {`,
        "  method: 'POST',",
        "  headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },",
        "  body: JSON.stringify({ name: 'labour-law', embedding_model: 'BAAI/bge-m3@BAAI', chunk_method: 'laws' }),",
        '});',
        'const { data } = await res.json();',
        'console.log(data);',
      ].join('\n'),
    },
  },
  {
    id: 'upload-document',
    title: 'Upload a document',
    description:
      'Uploads one file into a dataset as a multipart request. Parsing is asynchronous — poll the document list until run reports DONE.',
    method: 'POST',
    path: endpoints.documentUpload('{dataset_id}'),
    snippets: {
      curl: [
        `curl -sS -X POST "${BASE}${endpoints.documentUpload('{dataset_id}')}" \\`,
        `  -H "Authorization: Bearer ${KEY}" \\`,
        `  -F "file=@./contract.pdf"`,
      ].join('\n'),
      python: [
        'import os',
        'import requests',
        '',
        "base = os.environ['OWNRAG_BASE']",
        "key = os.environ['OWNRAG_API_KEY']",
        '',
        "with open('contract.pdf', 'rb') as fh:",
        '    resp = requests.post(',
        `        f"{base}${endpoints.documentUpload('{dataset_id}')}",`,
        '        headers={"Authorization": f"Bearer {key}"},',
        "        files={'file': fh},",
        '    )',
        'resp.raise_for_status()',
        'print(resp.json())',
      ].join('\n'),
      javascript: [
        'const base = process.env.OWNRAG_BASE;',
        'const key = process.env.OWNRAG_API_KEY;',
        '',
        "const file = new Blob(['...pdf bytes...'], { type: 'application/pdf' });",
        'const form = new FormData();',
        "form.append('file', file, 'contract.pdf');",
        '',
        `const res = await fetch(base + '${endpoints.documentUpload('{dataset_id}')}', {`,
        "  method: 'POST',",
        "  headers: { Authorization: 'Bearer ' + key },",
        '  body: form,',
        '});',
        'console.log(await res.json());',
      ].join('\n'),
    },
  },
  {
    id: 'retrieval',
    title: 'Retrieve chunks',
    description:
      'Runs hybrid retrieval and reranking over one or more datasets, returning ranked chunks with vector and term similarity.',
    method: 'POST',
    path: endpoints.retrievalTest,
    snippets: {
      curl: [
        `curl -sS -X POST "${BASE}${endpoints.retrievalTest}" \\`,
        `  -H "Authorization: Bearer ${KEY}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{"question":"how many hours may I work in Ramadan?","dataset_ids":["<dataset_id>"],"top_k":8,"similarity_threshold":0.2}'`,
      ].join('\n'),
      python: [
        'import os',
        'import requests',
        '',
        "base = os.environ['OWNRAG_BASE']",
        "key = os.environ['OWNRAG_API_KEY']",
        '',
        'resp = requests.post(',
        `    f"{base}${endpoints.retrievalTest}",`,
        '    headers={"Authorization": f"Bearer {key}"},',
        '    json={',
        '        "question": "how many hours may I work in Ramadan?",',
        '        "dataset_ids": ["<dataset_id>"],',
        '        "top_k": 8,',
        '        "similarity_threshold": 0.2,',
        '    },',
        ')',
        'for chunk in resp.json()["data"]["chunks"]:',
        '    print(chunk["similarity"], chunk["content_with_weight"][:80])',
      ].join('\n'),
      javascript: [
        'const base = process.env.OWNRAG_BASE;',
        'const key = process.env.OWNRAG_API_KEY;',
        '',
        `const res = await fetch(base + '${endpoints.retrievalTest}', {`,
        "  method: 'POST',",
        "  headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },",
        "  body: JSON.stringify({ question: 'how many hours may I work in Ramadan?', dataset_ids: ['<dataset_id>'], top_k: 8, similarity_threshold: 0.2 }),",
        '});',
        'const { data } = await res.json();',
        'console.log(data.chunks);',
      ].join('\n'),
    },
  },
  {
    id: 'chat-completion',
    title: 'Chat completion',
    description:
      'Answers a question with grounded citations. Set stream to true to receive the answer incrementally as server-sent events.',
    method: 'POST',
    path: endpoints.completion,
    snippets: {
      curl: [
        `curl -sS -N -X POST "${BASE}${endpoints.completion}" \\`,
        `  -H "Authorization: Bearer ${KEY}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{"question":"What is the overtime rate?","session_id":"<session_id>","stream":true}'`,
      ].join('\n'),
      python: [
        'import os',
        'import requests',
        '',
        "base = os.environ['OWNRAG_BASE']",
        "key = os.environ['OWNRAG_API_KEY']",
        '',
        'resp = requests.post(',
        `    f"{base}${endpoints.completion}",`,
        '    headers={"Authorization": f"Bearer {key}"},',
        '    json={"question": "What is the overtime rate?", "session_id": "<session_id>", "stream": True},',
        '    stream=True,',
        ')',
        'for line in resp.iter_lines():',
        '    if line:',
        '        print(line.decode())',
      ].join('\n'),
      javascript: [
        'const base = process.env.OWNRAG_BASE;',
        'const key = process.env.OWNRAG_API_KEY;',
        '',
        `const res = await fetch(base + '${endpoints.completion}', {`,
        "  method: 'POST',",
        "  headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },",
        "  body: JSON.stringify({ question: 'What is the overtime rate?', session_id: '<session_id>', stream: false }),",
        '});',
        'const { data } = await res.json();',
        'console.log(data.answer, data.reference);',
      ].join('\n'),
    },
  },
];

async function copyText(value: string, label = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(value);
    toast({ title: label, variant: 'success' });
  } catch {
    toast({ title: 'Could not copy', description: 'Your browser blocked clipboard access.', variant: 'error' });
  }
}

function maskToken(token: string): string {
  if (!token) return '—';
  if (token.length <= 14) return token;
  return `${token.slice(0, 10)}…${token.slice(-4)}`;
}

export default function DevelopersPage() {
  const [tab, setTab] = React.useState('keys');
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <PageHeader
        title="Developers"
        description="Issue keys for machine access, copy a runnable snippet for the routes that matter, and check the build this console is serving."
        tabs={
          <TabsList>
            <TabsTrigger value="keys">API keys</TabsTrigger>
            <TabsTrigger value="reference">API reference</TabsTrigger>
            <TabsTrigger value="system">Build info</TabsTrigger>
          </TabsList>
        }
      />
      <PageBody>
        <TabsContent value="keys">
          <KeysTab />
        </TabsContent>
        <TabsContent value="reference" className="max-w-4xl">
          <ReferenceTab />
        </TabsContent>
        <TabsContent value="system" className="max-w-3xl">
          <SystemTab />
        </TabsContent>
      </PageBody>
    </Tabs>
  );
}

function KeysTab() {
  const { data: tokens, isLoading, isError, error, refetch } = useApiTokens();
  const remove = useDeleteApiToken();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [revealed, setRevealed] = React.useState<ApiToken | null>(null);
  const [pendingRevoke, setPendingRevoke] = React.useState<ApiToken | null>(null);

  const columns: Column<ApiToken>[] = [
    {
      key: 'name',
      header: 'Key',
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-ink-3 [&_svg]:size-3.5">
            <KeyRound />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm text-ink">{row.name}</p>
            <p className="truncate font-mono text-2xs text-ink-3">{row.token}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'masked',
      header: 'Value',
      render: (row) => <span className="font-mono text-xs text-ink-2">{maskToken(row.token)}</span>,
    },
    {
      key: 'created',
      header: 'Created',
      render: (row) => (
        <span className="text-xs text-ink-2">
          {row.create_date ? row.create_date : row.create_time ? formatRelativeTime(row.create_time) : '—'}
        </span>
      ),
    },
    {
      key: 'last_used',
      header: 'Last used',
      render: (row) =>
        row.last_used_at ? (
          <span className="text-xs text-ink-2">{formatRelativeTime(row.last_used_at)}</span>
        ) : (
          <span className="text-2xs text-ink-3">Never</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => copyText(row.token, 'Key copied')}
            aria-label="Copy key"
          >
            <Copy />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPendingRevoke(row)}
            aria-label="Revoke key"
            className="text-danger hover:bg-danger-soft"
          >
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          title="API keys"
          description="Bearer tokens for the preserved v1 API. A key is shown in full once, at creation, and never again."
          icon={<KeyRound />}
          actions={
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus />
              Create key
            </Button>
          }
        />
        <div className="overflow-hidden">
          {isLoading ? (
            <TableSkeleton rows={4} columns={5} />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : (
            <DataTable
              columns={columns}
              rows={tokens ?? []}
              rowKey={(row) => row.id}
              emptyTitle="No API keys yet"
              emptyDescription="Create a key to call the OwnRAG API from your own services. Each key carries the workspace's permissions and can be revoked at any time."
              emptyAction={
                <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus />
                  Create key
                </Button>
              }
            />
          )}
        </div>
      </Panel>
      <p className="text-2xs text-ink-3">
        Treat keys like passwords. They grant full API access to this workspace; revoke the moment one leaks.
      </p>

      {createOpen && (
        <CreateKeyDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(token) => {
            setCreateOpen(false);
            setRevealed(token);
          }}
        />
      )}
      {revealed && <RevealKeyDialog token={revealed} onClose={() => setRevealed(null)} />}

      <ConfirmDialog
        open={Boolean(pendingRevoke)}
        onOpenChange={(open) => !open && setPendingRevoke(null)}
        title="Revoke this API key?"
        description={
          pendingRevoke
            ? `“${pendingRevoke.name}” stops working immediately. Any service using it will fail until it presents a new key.`
            : undefined
        }
        confirmLabel="Revoke key"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (pendingRevoke) remove.mutate(pendingRevoke.id, { onSuccess: () => setPendingRevoke(null) });
        }}
      />
    </div>
  );
}

function CreateKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (token: ApiToken) => void }) {
  const create = useCreateApiToken();
  const [name, setName] = React.useState('');

  const submit = () => {
    if (!name.trim()) {
      toast({ title: 'Name the key', description: 'A name makes keys revocable with confidence.', variant: 'error' });
      return;
    }
    create.mutate(name.trim(), { onSuccess: (token) => onCreated(token) });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader
          title="Create an API key"
          description="The key is revealed once after it is created. Store it in your secret manager immediately."
        />
        <DialogBody>
          <Field label="Key name" hint="Where it will be used, e.g. ci-ingestion or support-agent-prod." required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ci-ingestion"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={create.isPending} onClick={submit}>
            <KeyRound />
            Create key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevealKeyDialog({ token, onClose }: { token: ApiToken; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader
          title="Your new API key"
          description="Copy it now — this is the only time it is shown. OwnRAG keeps only a hash after this point."
        />
        <DialogBody className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-md border border-line bg-inset px-3 py-2.5">
            <code className="or-scroll min-w-0 flex-1 overflow-x-auto font-mono text-xs text-ink">{token.token}</code>
            <Button
              variant={copied ? 'subtle' : 'secondary'}
              size="sm"
              onClick={() => {
                copyText(token.token, 'Key copied');
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-2xs leading-relaxed text-ink-3">
            Send it as <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>. The backend accepts the raw
            value too. If a key is lost, revoke it and create another — it cannot be recovered.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" size="sm" onClick={onClose}>
            <Eye />
            I have saved the key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReferenceTab() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-ink-3">
        Every request is a JSON envelope of the form{' '}
        <span className="font-mono">{'{ code, data, message, total? }'}</span> and returns HTTP 200;{' '}
        <span className="font-mono">code === 0</span> means success. Authenticate with a Bearer API key from the
        previous tab. Paths below are the preserved v1 routes this console itself uses.
      </p>
      {ROUTES.map((route) => (
        <RouteCard key={route.id} route={route} />
      ))}
    </div>
  );
}

function RouteCard({ route }: { route: RouteSpec }) {
  const [lang, setLang] = React.useState<Lang>('curl');
  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            <Badge tone="outline" size="sm" className="font-mono">
              {route.method}
            </Badge>
            <span>{route.title}</span>
          </span>
        }
        description={route.description}
        icon={<Terminal />}
      />
      <div className="flex flex-col gap-3 px-4 py-3">
        <code className="or-scroll block overflow-x-auto rounded-md border border-line bg-inset px-2.5 py-1.5 font-mono text-2xs text-ink-2">
          {route.path}
        </code>
        <div className="flex items-center justify-between gap-2">
          <Segmented
            size="sm"
            value={lang}
            onValueChange={(value) => setLang(value as Lang)}
            options={[
              { value: 'curl', label: 'curl' },
              { value: 'python', label: 'Python' },
              { value: 'javascript', label: 'JavaScript' },
            ]}
          />
          <Button variant="ghost" size="xs" onClick={() => copyText(route.snippets[lang])}>
            <Copy />
            Copy
          </Button>
        </div>
        <pre className="or-scroll overflow-x-auto rounded-md border border-line bg-inset p-3 font-mono text-2xs leading-relaxed text-ink-2">
          {route.snippets[lang]}
        </pre>
      </div>
    </Panel>
  );
}

function SystemTab() {
  const { data: system, isLoading, isError, error, isFetching, refetch } = useSystemInfo();

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
  if (!system) {
    return (
      <EmptyState
        icon={<ServerCog />}
        title="No build information"
        description="The version endpoint returned nothing. Once the API server is reachable it reports its version, build hash and backing services here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          title="Build & runtime"
          description="Reported by the API server at /api/v1/system/version."
          icon={<ServerCog />}
          actions={
            <Button variant="ghost" size="xs" loading={isFetching} onClick={() => refetch()}>
              <RefreshCw />
              Refresh
            </Button>
          }
        />
        <div className="px-4 py-2">
          <DescriptionList
            items={[
              { label: 'Version', value: system.version, mono: true },
              { label: 'Build', value: system.build, mono: true },
              { label: 'Document engine', value: system.doc_engine ?? '—' },
              { label: 'Object storage', value: system.storage ?? '—' },
              { label: 'Database', value: system.database ?? '—' },
              { label: 'KV store', value: system.kvstore ?? '—' },
              { label: 'Platform', value: system.os ?? '—', mono: true },
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}

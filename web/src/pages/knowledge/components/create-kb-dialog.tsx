/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Create-knowledge-base dialog. Collects exactly the fields the preserved backend accepts on
 * POST /api/v1/datasets, validates them locally, and never fabricates a model list: the
 * embedding options come from the user's registered providers, and the dialog degrades to a
 * free-text model id when the server has none.
 */
import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAvailableModels, useCreateKnowledgeBase } from '@/api/hooks';
import type { ParseMethod } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { InlineError } from '@/components/ui/states';
import { useUiStore } from '@/store/ui';

/** Parsing strategies the console offers. Mirrors the backend `chunk_method` enum (ParseMethod). */
export const CHUNK_METHODS: Array<{ value: ParseMethod; label: string; hint: string }> = [
  { value: 'naive', label: 'General', hint: 'Token window with delimiter awareness. The safe default.' },
  { value: 'laws', label: 'Laws', hint: 'Article-aware splitting for statutory text; keeps article headers with their body.' },
  { value: 'paper', label: 'Paper', hint: 'Section-aware splitting for academic PDFs; keeps abstracts and captions together.' },
  { value: 'book', label: 'Book', hint: 'Chapter and heading hierarchy for long-form documents.' },
  { value: 'presentation', label: 'Presentation', hint: 'One chunk per slide plus extracted speaker notes.' },
  { value: 'table', label: 'Table', hint: 'Table-aware parsing that keeps headers attached to rows.' },
  { value: 'qa', label: 'Q&A', hint: 'Question/answer pairs become one chunk each — ideal for ticket exports.' },
  { value: 'manual', label: 'Manual', hint: 'No automatic splitting — you author every chunk by hand.' },
  { value: 'resume', label: 'Resume', hint: 'Section-aware splitting tuned for CVs.' },
  { value: 'picture', label: 'Picture', hint: 'Caption-driven chunks for image-heavy documents.' },
  { value: 'knowledge_graph', label: 'Knowledge graph', hint: 'Entity and relation extraction into a graph plus text chunks.' },
  { value: 'email', label: 'Email', hint: 'Header-aware splitting for mail archives.' },
  { value: 'tag', label: 'Tag', hint: 'Split by user-supplied tags embedded in the source.' },
  { value: 'one', label: 'Whole document', hint: 'The entire document becomes a single chunk.' },
];

/** Human label for a KB's `chunk_method`, falling back to the raw value for unknown methods. */
export function chunkMethodLabel(value: string | undefined | null): string {
  if (!value) return '—';
  return CHUNK_METHODS.find((method) => method.value === value)?.label ?? value;
}

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
  { value: 'zh', label: 'Chinese' },
];

/** Stable identity so the embedding effect does not re-run on every render. */
const EMPTY_MODELS: string[] = [];

export function CreateKbDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createKb = useCreateKnowledgeBase();
  const models = useAvailableModels();
  const demoMode = useUiStore((state) => state.demoMode);

  const embeddingOptions = models.data?.embedding ?? EMPTY_MODELS;
  const usingSelect = embeddingOptions.length > 0;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [chunkMethod, setChunkMethod] = useState<ParseMethod>('naive');
  const [language, setLanguage] = useState('en');
  const [embeddingModel, setEmbeddingModel] = useState('');
  const [touched, setTouched] = useState(false);

  // Fresh form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setChunkMethod('naive');
    setLanguage('en');
    setEmbeddingModel(embeddingOptions[0] ?? '');
    setTouched(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // If models arrive after the dialog opened, adopt the first as the default.
  useEffect(() => {
    if (open && !embeddingModel && embeddingOptions.length > 0) {
      setEmbeddingModel(embeddingOptions[0]);
    }
  }, [open, embeddingModel, embeddingOptions]);

  const nameError = touched && !name.trim() ? 'Enter a name for the knowledge base.' : undefined;
  const modelError = touched && !embeddingModel.trim() ? 'Choose an embedding model.' : undefined;
  const canSubmit = name.trim().length > 0 && embeddingModel.trim().length > 0;

  const activeChunkHint = CHUNK_METHODS.find((method) => method.value === chunkMethod)?.hint;

  const handleOpenChange = (next: boolean) => {
    if (!next && createKb.isPending) return; // never drop a create in flight
    onOpenChange(next);
  };

  const submit = () => {
    setTouched(true);
    if (!canSubmit || createKb.isPending) return;
    createKb.mutate(
      {
        name: name.trim(),
        description: description.trim(),
        embedding_model: embeddingModel.trim(),
        chunk_method: chunkMethod,
        language,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title="New knowledge base"
          description="Name the corpus and pick how its documents are parsed. Ingestion settings can be tuned after creation."
        />
        <DialogBody className="space-y-4">
          {createKb.isError && (
            <InlineError
              message={createKb.error?.message ?? 'The API rejected the request. Check the fields and try again.'}
            />
          )}

          <Field label="Name" required htmlFor="kb-name" error={nameError}>
            <Input
              id="kb-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Vendor Contracts 2026"
              invalid={Boolean(nameError)}
              maxLength={128}
              autoComplete="off"
              autoFocus
            />
          </Field>

          <Field label="Description" htmlFor="kb-description" hint="Optional. Shown on the knowledge base card and in search.">
            <Textarea
              id="kb-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this corpus contains and who it is for."
              maxLength={512}
            />
          </Field>

          <Field
            label="Embedding model"
            required
            htmlFor="kb-embedding"
            error={modelError}
            hint={
              models.isLoading
                ? 'Loading the embedding models registered on this server…'
                : usingSelect
                  ? 'Embeds every chunk in this corpus. Changing it later requires a full re-index.'
                  : 'No embedding models are registered — type a model id, or connect a provider under Models.'
            }
          >
            {models.isLoading ? (
              <Select value={embeddingModel} onValueChange={setEmbeddingModel}>
                <SelectTrigger id="kb-embedding" disabled aria-label="Embedding model">
                  <SelectValue placeholder="Loading embedding models…" />
                </SelectTrigger>
                <SelectContent />
              </Select>
            ) : usingSelect ? (
              <Select value={embeddingModel} onValueChange={setEmbeddingModel}>
                <SelectTrigger id="kb-embedding" aria-label="Embedding model">
                  <SelectValue placeholder="Select an embedding model" />
                </SelectTrigger>
                <SelectContent>
                  {embeddingOptions.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="kb-embedding"
                value={embeddingModel}
                onChange={(event) => setEmbeddingModel(event.target.value)}
                placeholder="e.g. BAAI/bge-m3@BAAI"
                invalid={Boolean(modelError)}
                autoComplete="off"
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Chunking method" htmlFor="kb-chunk-method" hint={activeChunkHint}>
              <Select value={chunkMethod} onValueChange={(value) => setChunkMethod(value as ParseMethod)}>
                <SelectTrigger id="kb-chunk-method" aria-label="Chunking method">
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

            <Field label="Language" htmlFor="kb-language" hint="Primary language of the source documents.">
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="kb-language" aria-label="Language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {demoMode && (
            <div className="flex items-start gap-2 rounded-md border border-info/40 bg-info-soft px-2.5 py-2 text-2xs leading-relaxed text-info">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Demo mode — this knowledge base is written to the in-memory sample corpus and disappears when
                you reload. Connect the API server to create it for real.
              </span>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={() => handleOpenChange(false)} disabled={createKb.isPending}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={submit} loading={createKb.isPending} disabled={!canSubmit}>
            Create knowledge base
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

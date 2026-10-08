/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * KbSettingsForm — the identity and parsing configuration of one knowledge base. It edits a
 * local draft and only calls the update endpoint on save, so a half-typed name never
 * round-trips to the API.
 */
import { RotateCcw, Save } from 'lucide-react';
import * as React from 'react';
import { useAvailableModels, useUpdateKnowledgeBase } from '@/api/hooks';
import type { KnowledgeBase, ParseMethod } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { Field, Input, Textarea } from '@/components/ui/input';

const CHUNK_METHODS: Array<{ value: ParseMethod; label: string; hint: string }> = [
  { value: 'naive', label: 'General', hint: 'Token window with delimiter awareness. The safe default.' },
  { value: 'laws', label: 'Laws', hint: 'Article-aware splitting for statutory text.' },
  { value: 'paper', label: 'Paper', hint: 'Section-aware splitting for academic PDFs.' },
  { value: 'book', label: 'Book', hint: 'Chapter and heading hierarchy for long-form documents.' },
  { value: 'presentation', label: 'Presentation', hint: 'One chunk per slide plus speaker notes.' },
  { value: 'table', label: 'Table', hint: 'Table-aware parsing that keeps headers with rows.' },
  { value: 'qa', label: 'Q&A', hint: 'Question/answer pairs become one chunk each.' },
  { value: 'resume', label: 'Resume', hint: 'Section-aware splitting tuned for CVs.' },
  { value: 'picture', label: 'Picture', hint: 'Caption-driven chunks for image-heavy documents.' },
  { value: 'knowledge_graph', label: 'Knowledge graph', hint: 'Entity and relation extraction into a graph.' },
  { value: 'email', label: 'Email', hint: 'Header-aware splitting for mail archives.' },
  { value: 'one', label: 'Whole document', hint: 'The entire document becomes a single chunk.' },
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
];

interface SettingsForm {
  name: string;
  description: string;
  language: string;
  embedding_model: string;
  chunk_method: ParseMethod;
  permission: 'me' | 'team';
  tags: string;
}

function fromKb(kb: KnowledgeBase): SettingsForm {
  return {
    name: kb.name,
    description: kb.description ?? '',
    language: kb.language ?? 'en',
    embedding_model: kb.embedding_model,
    chunk_method: kb.chunk_method,
    permission: kb.permission ?? 'me',
    tags: (kb.tags ?? []).join(', '),
  };
}

export function KbSettingsForm({ kb }: { kb: KnowledgeBase }) {
  const update = useUpdateKnowledgeBase();
  const models = useAvailableModels();
  const [form, setForm] = React.useState<SettingsForm>(() => fromKb(kb));
  const initial = React.useRef<SettingsForm>(fromKb(kb));

  React.useEffect(() => {
    const next = fromKb(kb);
    initial.current = next;
    setForm(next);
  }, [kb.id, kb.update_time]);

  const dirty = React.useMemo(() => JSON.stringify(form) !== JSON.stringify(initial.current), [form]);

  const embeddingOptions = React.useMemo(() => {
    const options = new Set<string>(models.data?.embedding ?? []);
    if (form.embedding_model) options.add(form.embedding_model);
    return Array.from(options);
  }, [models.data?.embedding, form.embedding_model]);

  const chunkHint = CHUNK_METHODS.find((method) => method.value === form.chunk_method)?.hint;

  const save = () => {
    update.mutate({
      id: kb.id,
      body: {
        name: form.name.trim(),
        description: form.description.trim(),
        language: form.language,
        embedding_model: form.embedding_model,
        chunk_method: form.chunk_method,
        permission: form.permission,
        tags: form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      },
    });
  };

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Field label="Name" htmlFor="kb-name" required>
        <Input
          id="kb-name"
          value={form.name}
          onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
          placeholder="Knowledge base name"
        />
      </Field>

      <Field label="Description" htmlFor="kb-description">
        <Textarea
          id="kb-description"
          rows={3}
          value={form.description}
          onChange={(event) => setForm((previous) => ({ ...previous, description: event.target.value }))}
          placeholder="What this corpus covers"
        />
      </Field>

      <Field label="Language" hint="Tokenisation and the default answer language.">
        <Select
          value={form.language}
          onValueChange={(value) => setForm((previous) => ({ ...previous, language: value }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((language) => (
              <SelectItem key={language.value} value={language.value}>
                {language.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label="Embedding model"
        hint={
          models.isLoading
            ? 'Loading the models available to this account…'
            : 'Changing this requires re-indexing the corpus.'
        }
      >
        <Select
          value={form.embedding_model}
          onValueChange={(value) =>
            setForm((previous) => ({ ...previous, embedding_model: value }))
          }
          disabled={models.isLoading && embeddingOptions.length <= 1}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose a model" />
          </SelectTrigger>
          <SelectContent>
            {embeddingOptions.map((model) => (
              <SelectItem key={model} value={model}>
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Chunking method" hint={chunkHint}>
        <Select
          value={form.chunk_method}
          onValueChange={(value) =>
            setForm((previous) => ({ ...previous, chunk_method: value as ParseMethod }))
          }
        >
          <SelectTrigger>
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

      <Field label="Permission">
        <Select
          value={form.permission}
          onValueChange={(value) =>
            setForm((previous) => ({ ...previous, permission: value as 'me' | 'team' }))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="me">Private to me</SelectItem>
            <SelectItem value="team">Shared with the team</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="Tags" hint="Comma separated. Used to group knowledge bases.">
        <Input
          value={form.tags}
          onChange={(event) => setForm((previous) => ({ ...previous, tags: event.target.value }))}
          placeholder="arabic, statutory"
        />
      </Field>

      <div className="flex items-center justify-end gap-1.5 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!dirty || update.isPending}
          onClick={() => setForm(fromKb(kb))}
        >
          <RotateCcw />
          Reset
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={update.isPending} disabled={!dirty}>
          <Save />
          Save settings
        </Button>
      </div>
    </form>
  );
}

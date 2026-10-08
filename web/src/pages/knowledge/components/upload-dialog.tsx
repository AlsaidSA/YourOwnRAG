/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * UploadDialog — stages documents for a knowledge base. Picked files carry their bytes and are
 * uploaded for real; names typed by hand have no file behind them, and the dialog says so rather
 * than letting the operator discover it when the parse fails.
 */
import { FilePlus2, Plus, Upload, X } from 'lucide-react';
import * as React from 'react';
import { useUploadDocuments } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/states';

export interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kbId: string;
}

export function UploadDialog({ open, onOpenChange, kbId }: UploadDialogProps) {
  const upload = useUploadDocuments();
  const [files, setFiles] = React.useState<File[]>([]);
  const [names, setNames] = React.useState<string[]>([]);
  const [manual, setManual] = React.useState('');
  const [fileInputKey, setFileInputKey] = React.useState(0);

  React.useEffect(() => {
    if (!open) {
      setFiles([]);
      setNames([]);
      setManual('');
      setFileInputKey((key) => key + 1);
    }
  }, [open]);

  const addNames = React.useCallback((incoming: string[]) => {
    const clean = incoming.map((name) => name.trim()).filter(Boolean);
    if (clean.length === 0) return;
    setNames((previous) => Array.from(new Set([...previous, ...clean])));
  }, []);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (names.length === 0) return;
    upload.mutate(
      { kbId, files, names: names.filter((name) => !files.some((file) => file.name === name)) },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form onSubmit={onSubmit} className="flex max-h-[88vh] min-h-0 flex-col">
          <DialogHeader
            title="Upload documents"
            description="Picked files are uploaded with their contents. Parsing starts when you run ingestion."
          />
          <DialogBody className="space-y-4">
            <Field label="Choose files" hint="The file's contents are sent, not just its name.">
              <input
                key={fileInputKey}
                type="file"
                multiple
                onChange={(event) => {
                  const picked = event.target.files;
                  if (!picked) return;
                  const incoming = Array.from(picked);
                  setFiles((previous) => {
                    const seen = new Set(previous.map((file) => file.name));
                    return [...previous, ...incoming.filter((file) => !seen.has(file.name))];
                  });
                  addNames(incoming.map((file) => file.name));
                }}
                className="block w-full cursor-pointer rounded-md border border-line bg-inset p-2 text-xs text-ink-2 transition-colors file:mr-2 file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-xs file:font-medium file:text-ink hover:border-line-strong"
              />
            </Field>

            <div className="flex items-center gap-2">
              <span className="flex-1 border-t border-line" />
              <span className="text-2xs uppercase tracking-wide text-ink-3">or add by name</span>
              <span className="flex-1 border-t border-line" />
            </div>

            <Field label="Document name or path">
              <div className="flex items-center gap-1.5">
                <Input
                  value={manual}
                  onChange={(event) => setManual(event.target.value)}
                  placeholder="quarterly-filing-2026-q2.pdf"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addNames([manual]);
                      setManual('');
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    addNames([manual]);
                    setManual('');
                  }}
                  disabled={!manual.trim()}
                >
                  <Plus />
                  Add
                </Button>
              </div>
            </Field>

            <div className="rounded-lg border border-line bg-surface-1">
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <span className="text-xs font-medium text-ink">Staged</span>
                <span className="font-mono text-2xs text-ink-3">{names.length}</span>
              </div>
              {names.length === 0 ? (
                <EmptyState
                  compact
                  icon={<FilePlus2 />}
                  title="Nothing staged"
                  description="Pick files or add names; they will be uploaded together."
                />
              ) : (
                <ul className="or-scroll max-h-52 divide-y divide-line overflow-y-auto">
                  {names.map((name) => {
                    const staged = files.some((file) => file.name === name);
                    return (
                      <li key={name} className="flex items-center gap-2 px-3 py-2">
                        <span className="or-truncate flex-1 text-xs text-ink-2" title={name}>
                          {name}
                        </span>
                        {staged ? (
                          <span className="shrink-0 font-mono text-2xs text-ink-3">file</span>
                        ) : (
                          <span
                            className="shrink-0 text-2xs text-danger"
                            title="Added by name only — there is no file to parse, so ingestion will fail for it."
                          >
                            no file
                          </span>
                        )}
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Remove ${name}`}
                          onClick={() => {
                            setFiles((previous) => previous.filter((file) => file.name !== name));
                            setNames((previous) => previous.filter((entry) => entry !== name));
                          }}
                        >
                          <X />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary" size="sm" loading={upload.isPending} disabled={names.length === 0}>
              <Upload />
              {names.length > 0
                ? `Upload ${names.length} file${names.length === 1 ? '' : 's'}`
                : 'Add files'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

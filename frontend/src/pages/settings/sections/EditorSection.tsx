import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Code2 } from 'lucide-react';
import { preferencesApi } from '../../../api';
import type { EditorType } from '../../../api';
import { Button } from '../../../components/ui/Button';
import { SectionBody, SectionCard, SectionHeader } from '../../../components/ui/settings';

const EDITOR_OPTIONS: { value: EditorType; label: string }[] = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'cursor', label: 'Cursor' },
];

export function EditorSection() {
  const [editor, setEditor] = useState<EditorType>('vscode');
  const [sshHost, setSshHost] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    preferencesApi
      .getEditorConfig()
      .then((cfg) => {
        setEditor(cfg.editor);
        setSshHost(cfg.sshHost ?? 'codeburg-server');
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const saveMutation = useMutation({
    mutationFn: () =>
      preferencesApi.setEditorConfig({
        editor,
        sshHost: sshHost.trim() || null,
      }),
    onSuccess: () => {
      localStorage.setItem('editor_configured', '1');
      setSaved(true);
      setError('');
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaved(false);
    },
  });

  if (!loaded) return null;

  const inputClass =
    'block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md text-sm focus:outline-none focus:border-accent transition-colors';

  return (
    <SectionCard>
      <SectionHeader
        title="Editor"
        description="Open task worktrees in your editor"
        icon={<Code2 size={15} />}
      />
      <SectionBody bordered>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-primary)]">Editor</span>
          <div className="flex gap-1">
            {EDITOR_OPTIONS.map((entry) => (
              <button
                key={entry.value}
                onClick={() => setEditor(entry.value)}
                className={`px-3 py-2 text-xs rounded-md border transition-colors ${
                  editor === entry.value
                    ? 'bg-accent/15 border-accent text-accent'
                    : 'bg-primary border-subtle text-dim hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-dim)]'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      </SectionBody>
      <SectionBody>
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-[var(--color-error)]/8 border border-[var(--color-error)]/30 text-sm text-[var(--color-error)] mb-3">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}
        {saved && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-[var(--color-success)]/8 border border-[var(--color-success)]/30 text-sm text-[var(--color-success)] mb-3">
            <CheckCircle2 size={16} className="flex-shrink-0" />
            Saved
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-dim mb-1.5">SSH Host</label>
            <input
              type="text"
              value={sshHost}
              onChange={(e) => setSshHost(e.target.value)}
              className={inputClass}
              placeholder="e.g. codeburg-server"
            />
            <p className="text-xs text-dim mt-1.5">
              Host alias from your local{' '}
              <code className="px-1 py-0.5 bg-primary rounded">~/.ssh/config</code>. Leave empty for local mode.
            </p>
          </div>

          <Button
            variant="primary"
            size="md"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            loading={saveMutation.isPending}
          >
            Save
          </Button>
        </div>
      </SectionBody>
    </SectionCard>
  );
}

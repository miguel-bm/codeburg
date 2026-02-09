import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SquareArrowOutUpRight } from 'lucide-react';
import { preferencesApi } from '../../api';
import type { EditorConfig, EditorType } from '../../api';

function buildEditorUri(editor: EditorType, sshHost: string | null, path: string): string {
  const scheme = editor === 'cursor' ? 'cursor' : 'vscode';
  if (sshHost) {
    return `${scheme}://vscode-remote/ssh-remote+${sshHost}${path}`;
  }
  return `${scheme}://file${path}`;
}

interface Props {
  worktreePath: string;
}

export function OpenInEditorButton({ worktreePath }: Props) {
  const [showModal, setShowModal] = useState(false);
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ['preferences', 'editor-config'],
    queryFn: () => preferencesApi.getEditorConfig(),
    staleTime: 30_000,
  });

  const handleClick = () => {
    // If we have a configured editor (either explicitly set, or default vscode),
    // check if the user has ever saved editor preferences
    if (config && configuredBefore(config)) {
      const uri = buildEditorUri(config.editor, config.sshHost, worktreePath);
      window.open(uri, '_self');
    } else {
      setShowModal(true);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        disabled={isLoading}
        className="px-2 py-1.5 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-xs hover:bg-[var(--color-border)] transition-colors disabled:opacity-50 inline-flex items-center gap-1"
        title="Open in editor"
      >
        <SquareArrowOutUpRight size={13} />
        <span className="hidden sm:inline">Open</span>
      </button>

      {showModal && (
        <ConfigureEditorModal
          initialConfig={config}
          worktreePath={worktreePath}
          onClose={() => setShowModal(false)}
          onSaved={(cfg) => {
            queryClient.setQueryData(['preferences', 'editor-config'], cfg);
            setShowModal(false);
            const uri = buildEditorUri(cfg.editor, cfg.sshHost, worktreePath);
            window.open(uri, '_self');
          }}
        />
      )}
    </>
  );
}

/** Check if user has explicitly configured editor prefs (vs just getting defaults) */
function configuredBefore(config: EditorConfig): boolean {
  // If sshHost is set, they definitely configured it.
  // We also check localStorage for a flag we set on first save.
  return config.sshHost !== null || localStorage.getItem('editor_configured') === '1';
}

interface ModalProps {
  initialConfig?: EditorConfig;
  worktreePath: string;
  onClose: () => void;
  onSaved: (config: EditorConfig) => void;
}

function ConfigureEditorModal({ initialConfig, onClose, onSaved }: ModalProps) {
  const [editor, setEditor] = useState<EditorType>(initialConfig?.editor ?? 'vscode');
  const [sshHost, setSshHost] = useState(initialConfig?.sshHost ?? '');

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const saveMutation = useMutation({
    mutationFn: (cfg: EditorConfig) => preferencesApi.setEditorConfig(cfg),
    onSuccess: (_, cfg) => {
      localStorage.setItem('editor_configured', '1');
      onSaved(cfg);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cfg: EditorConfig = {
      editor,
      sshHost: sshHost.trim() || null,
    };
    saveMutation.mutate(cfg);
  };

  const EDITORS: { value: EditorType; label: string }[] = [
    { value: 'vscode', label: 'VS Code' },
    { value: 'cursor', label: 'Cursor' },
  ];

  return (
    <div className="fixed inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-elevated border border-subtle rounded-xl shadow-lg w-full max-w-sm">
        <div className="px-4 py-3 border-b border-subtle">
          <h2 className="text-sm font-medium">Configure Editor</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Editor selector */}
          <div>
            <label className="block text-sm text-dim mb-2">Editor</label>
            <div className="flex gap-1">
              {EDITORS.map((e) => (
                <button
                  key={e.value}
                  type="button"
                  onClick={() => setEditor(e.value)}
                  className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
                    editor === e.value
                      ? 'bg-accent/15 border-accent text-accent'
                      : 'bg-primary border-subtle text-dim hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-dim)]'
                  }`}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          {/* SSH Host */}
          <div>
            <label className="block text-sm text-dim mb-1">SSH Host</label>
            <input
              type="text"
              value={sshHost}
              onChange={(e) => setSshHost(e.target.value)}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md text-sm focus:outline-none focus:border-accent transition-colors"
              placeholder="e.g. codeburg-server"
            />
            <p className="text-xs text-dim mt-1.5">
              Host alias from your local <code className="px-1 py-0.5 bg-primary rounded">~/.ssh/config</code>. Leave empty for local mode.
            </p>
          </div>

          <p className="text-xs text-dim">You can change this later in Settings.</p>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-sm hover:bg-[var(--color-border)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="flex-1 py-2 px-4 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving...' : 'Save & Open'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

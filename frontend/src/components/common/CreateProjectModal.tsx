import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '../../api';
import type { CreateProjectInput } from '../../api';

function isGitHubURL(s: string): boolean {
  const trimmed = s.trim();
  return trimmed.startsWith('https://github.com/') ||
    trimmed.startsWith('http://github.com/') ||
    trimmed.startsWith('git@github.com:');
}

function parseRepoName(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  if (cleaned.startsWith('git@github.com:')) {
    cleaned = cleaned.replace('git@github.com:', '');
  }
  const parts = cleaned.split('/');
  return parts[parts.length - 1] || '';
}

function parseDirName(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '');
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || '';
}

interface CreateProjectModalProps {
  onClose: () => void;
}

type Mode = 'import' | 'create';

export function CreateProjectModal({ onClose }: CreateProjectModalProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const [mode, setMode] = useState<Mode>('import');
  // Import mode state
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  // Create mode state
  const [repoName, setRepoName] = useState('');
  const [repoDescription, setRepoDescription] = useState('');
  const [repoPrivate, setRepoPrivate] = useState(true);

  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const isClone = isGitHubURL(source);

  const handleSourceChange = (value: string) => {
    setSource(value);
    if (!nameManuallyEdited) {
      if (isGitHubURL(value)) {
        setName(parseRepoName(value));
      } else if (value.includes('/')) {
        setName(parseDirName(value));
      }
    }
  };

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setError('');
  };

  const createMutation = useMutation({
    mutationFn: (input: CreateProjectInput) => projectsApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar'] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'create') {
      createMutation.mutate({
        name: repoName,
        createRepo: true,
        description: repoDescription || undefined,
        private: repoPrivate,
      });
    } else if (isClone) {
      createMutation.mutate({ name, githubUrl: source });
    } else {
      createMutation.mutate({ name, path: source });
    }
  };

  const loadingText = mode === 'create'
    ? 'Creating repo...'
    : isClone ? 'Cloning...' : 'Creating...';

  return (
    <div className="fixed inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-elevated border border-subtle rounded-xl shadow-lg w-full max-w-md">
        <div className="px-4 py-3 border-b border-subtle">
          <h2 className="text-sm font-medium">New Project</h2>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-subtle">
          <button
            type="button"
            onClick={() => handleModeChange('import')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'import'
                ? 'text-[var(--color-text-primary)] border-b-2 border-[var(--color-accent)]'
                : 'text-dim hover:text-[var(--color-text-secondary)]'
            }`}
          >
            Import
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('create')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'create'
                ? 'text-[var(--color-text-primary)] border-b-2 border-[var(--color-accent)]'
                : 'text-dim hover:text-[var(--color-text-secondary)]'
            }`}
          >
            Create New
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="border border-[var(--color-error)] rounded-md p-3 text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}

          {mode === 'import' ? (
            <>
              <div>
                <label className="block text-sm text-dim mb-1">Path or GitHub URL</label>
                <input
                  type="text"
                  value={source}
                  onChange={(e) => handleSourceChange(e.target.value)}
                  className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)]"
                  placeholder="https://github.com/user/repo or /path/to/project"
                  required
                />
                {isClone && name && (
                  <p className="text-xs text-dim mt-1">
                    Will clone to ~/.codeburg/repos/{name}/
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm text-dim mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameManuallyEdited(true);
                  }}
                  className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)]"
                  placeholder="my-project"
                  required
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm text-dim mb-1">Repository name</label>
                <input
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)]"
                  placeholder="my-new-project"
                  required
                />
                {repoName && (
                  <p className="text-xs text-dim mt-1">
                    Will create on GitHub and clone to ~/.codeburg/repos/{repoName}/
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm text-dim mb-1">Description</label>
                <input
                  type="text"
                  value={repoDescription}
                  onChange={(e) => setRepoDescription(e.target.value)}
                  className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)]"
                  placeholder="Optional description"
                />
              </div>
              <div>
                <label className="block text-sm text-dim mb-1">Visibility</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="visibility"
                      checked={repoPrivate}
                      onChange={() => setRepoPrivate(true)}
                      className="accent-[var(--color-accent)]"
                    />
                    <span>Private</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="visibility"
                      checked={!repoPrivate}
                      onChange={() => setRepoPrivate(false)}
                      className="accent-[var(--color-accent)]"
                    />
                    <span>Public</span>
                  </label>
                </div>
              </div>
            </>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-sm hover:bg-[var(--color-border)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1 py-2 px-4 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? loadingText : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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

export function CreateProjectModal({ onClose }: CreateProjectModalProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
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
    if (isClone) {
      createMutation.mutate({ name, githubUrl: source });
    } else {
      createMutation.mutate({ name, path: source });
    }
  };

  return (
    <div className="fixed inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-elevated border border-subtle rounded-xl shadow-lg w-full max-w-md">
        <div className="px-4 py-3 border-b border-subtle">
          <h2 className="text-sm font-medium">New Project</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="border border-[var(--color-error)] rounded-md p-3 text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm text-dim mb-1">Path or GitHub URL</label>
            <input
              type="text"
              value={source}
              onChange={(e) => handleSourceChange(e.target.value)}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
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
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
              placeholder="my-project"
              required
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 bg-tertiary text-[var(--color-text-secondary)] rounded-md text-sm hover:bg-[var(--color-border)] transition-colors"
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1 py-2 px-4 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              {createMutation.isPending
                ? (isClone ? 'cloning...' : 'creating...')
                : 'create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

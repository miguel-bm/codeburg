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
    <div className="fixed inset-0 bg-[var(--color-bg-primary)]/80 flex items-center justify-center p-4 z-50">
      <div className="bg-secondary border border-subtle w-full max-w-md">
        <div className="px-4 py-3 border-b border-subtle">
          <h2 className="text-sm text-accent">// new_project</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="border border-[var(--color-error)] p-3 text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm text-dim mb-1">path or github url</label>
            <input
              type="text"
              value={source}
              onChange={(e) => handleSourceChange(e.target.value)}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none"
              placeholder="https://github.com/user/repo or /path/to/project"
              required
            />
            {isClone && name && (
              <p className="text-xs text-dim mt-1">
                // will clone to ~/.codeburg/repos/{name}/
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm text-dim mb-1">name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameManuallyEdited(true);
              }}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none"
              placeholder="my-project"
              required
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-subtle text-dim text-sm hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-primary)] transition-colors"
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1 py-2 px-4 border border-accent text-accent text-sm hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50"
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

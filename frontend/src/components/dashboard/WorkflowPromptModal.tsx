import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sessionsApi } from '../../api';
import { usePanelNavigation } from '../../hooks/usePanelNavigation';
import { Button } from '../ui/Button';

interface WorkflowPromptModalProps {
  taskId: string;
  onClose: () => void;
}

export function WorkflowPromptModal({ taskId, onClose }: WorkflowPromptModalProps) {
  const { navigateToPanel } = usePanelNavigation();
  const [provider, setProvider] = useState<'claude' | 'codex'>('claude');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const startMutation = useMutation({
    mutationFn: () => sessionsApi.start(taskId, { provider, prompt: prompt || undefined }),
    onSuccess: () => {
      onClose();
      navigateToPanel(`/tasks/${taskId}`);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    },
  });

  return (
    <div className="fixed inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-elevated border border-subtle rounded-xl shadow-lg w-full max-w-md">
        <div className="px-4 py-3">
          <h2 className="text-sm font-medium">Start Agent Session</h2>
        </div>
        <div className="p-4 space-y-4">
          {error && (
            <div className="border border-[var(--color-error)] rounded-md p-3 text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm text-dim mb-2">Provider</label>
            <div className="flex gap-2">
              {(['claude', 'codex'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`flex-1 py-2 px-4 border rounded-md text-sm transition-colors ${
                    provider === p
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-subtle text-dim hover:bg-tertiary'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm text-dim mb-1">Prompt (optional)</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)] resize-none"
              placeholder="describe what the agent should do..."
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={onClose}
              className="flex-1"
            >
              Skip
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              loading={startMutation.isPending}
              className="flex-1"
            >
              {startMutation.isPending ? 'Starting...' : 'Start'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { MessageSquareText, Play, SquareTerminal, X } from 'lucide-react';
import type { SessionProvider } from '../../api/sessions';
import claudeLogo from '../../assets/claude-logo.svg';
import openaiLogo from '../../assets/openai-logo.svg';
import { Toggle } from '../ui/settings';
import { useMobile } from '../../hooks/useMobile';

interface NewSessionComposerProps {
  taskTitle: string;
  taskDescription?: string;
  onStart: (provider: SessionProvider, prompt: string) => void;
  onCancel: () => void;
  isPending?: boolean;
  error?: string;
}

interface ProviderOption {
  id: SessionProvider;
  label: string;
  caption: string;
  detail: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    id: 'claude',
    label: 'Claude',
    caption: 'Anthropic',
    detail: 'Great for longer implementation and codebase navigation.',
  },
  {
    id: 'codex',
    label: 'Codex',
    caption: 'OpenAI',
    detail: 'Fast execution-focused workflow with tool-heavy iteration.',
  },
  {
    id: 'terminal',
    label: 'Terminal',
    caption: 'Shell',
    detail: 'Run commands directly in the task worktree.',
  },
];

function ProviderLogo({ provider }: { provider: SessionProvider }) {
  if (provider === 'claude') {
    return (
      <img
        src={claudeLogo}
        alt="Claude logo"
        className="h-7 w-7 object-contain"
      />
    );
  }

  if (provider === 'codex') {
    return (
      <img
        src={openaiLogo}
        alt="OpenAI logo"
        className="h-7 w-7 object-contain"
      />
    );
  }

  return (
    <SquareTerminal
      size={18}
      className="text-[var(--color-bg-primary)]"
      aria-hidden="true"
    />
  );
}

export function NewSessionComposer({
  taskTitle,
  taskDescription,
  onStart,
  onCancel,
  isPending = false,
  error,
}: NewSessionComposerProps) {
  const defaultPrompt = useMemo(
    () => (taskDescription ? `${taskTitle}\n\n${taskDescription}` : taskTitle),
    [taskDescription, taskTitle],
  );
  const isMobile = useMobile();

  const [provider, setProvider] = useState<SessionProvider>('claude');
  const [includePrompt, setIncludePrompt] = useState(true);
  const [prompt, setPrompt] = useState(defaultPrompt);

  const promptEnabled = provider !== 'terminal' && includePrompt;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const description = provider === 'terminal'
    ? 'Starts an interactive shell in this task worktree.'
    : includePrompt
      ? `Starts ${provider} with the prompt below.`
      : `Starts ${provider} interactively with no initial prompt.`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (provider === 'terminal') {
      onStart('terminal', '');
      return;
    }

    onStart(provider, includePrompt ? prompt.trim() : '');
  };

  return (
    <div className="h-full overflow-auto bg-primary">
      <form onSubmit={handleSubmit} className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-4 sm:px-6 sm:py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-wide text-[var(--color-text-primary)]">
              New Session
            </h2>
            <p className="text-xs text-dim">
              Choose provider, set prompt behavior, and launch.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-subtle bg-secondary text-dim transition-colors hover:border-[var(--color-error)]/50 hover:text-[var(--color-error)]"
            aria-label="Cancel new session"
          >
            <X size={14} />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-[var(--color-error)]/60 bg-[var(--color-error)]/10 px-3 py-2 text-xs text-[var(--color-error)]">
            {error}
          </div>
        )}

        <section className="mt-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-dim">
            Provider
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
            {PROVIDERS.map((option) => {
              const selected = provider === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setProvider(option.id)}
                  className={`rounded-xl border p-2.5 text-left transition-all sm:p-3 ${
                    selected
                      ? 'border-accent bg-accent/10 shadow-accent'
                      : 'border-subtle bg-secondary hover:border-[var(--color-text-secondary)]/50 hover:bg-tertiary'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:items-start sm:gap-3 sm:text-left">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-subtle bg-primary sm:h-10 sm:w-10">
                      <ProviderLogo provider={option.id} />
                    </span>
                    <span className="min-w-0 space-y-0.5">
                      <span className="block text-xs font-medium text-[var(--color-text-primary)] sm:text-sm">
                        {option.label}
                      </span>
                      <span className="hidden text-xs text-dim sm:block">
                        {option.caption}
                      </span>
                      <span className="hidden text-xs text-dim sm:block">
                        {option.detail}
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-5 flex-1 rounded-xl border border-subtle bg-secondary p-3 sm:mt-6 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 text-sm font-medium">
              <MessageSquareText size={15} className="text-accent" />
              Initial Prompt
            </div>
            <div className={`inline-flex items-center gap-2 ${provider === 'terminal' ? 'opacity-50' : ''}`}>
              <span className="text-xs text-dim">Include Prompt</span>
              <div className={provider === 'terminal' ? 'pointer-events-none' : ''}>
                <Toggle checked={includePrompt} onChange={setIncludePrompt} />
              </div>
            </div>
          </div>

          {provider === 'terminal' ? (
            <div className="rounded-lg border border-subtle bg-primary px-3 py-3 text-xs text-dim">
              Terminal sessions ignore initial prompts and start in interactive shell mode.
            </div>
          ) : promptEnabled ? (
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={12}
              autoFocus={!isMobile}
              className="block w-full min-h-44 max-h-[52vh] resize-y rounded-lg border border-subtle bg-primary px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-text-secondary)] focus:outline-none sm:min-h-56"
              placeholder="Describe what the session should do..."
            />
          ) : (
            <div className="rounded-lg border border-subtle bg-primary px-3 py-3 text-xs text-dim">
              Prompt disabled. The provider will start in interactive mode.
            </div>
          )}
        </section>

        <div className="sticky bottom-0 left-0 right-0 mt-6 -mx-4 border-t border-subtle bg-primary/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-center backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-2 sm:pb-6">
          <p className="mx-auto max-w-2xl text-xs text-dim">{description}</p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isPending}
              className="rounded-md border border-subtle bg-secondary px-5 py-2 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-tertiary disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-5 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
            >
              <Play size={12} />
              {isPending ? 'Starting...' : 'Start Session'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

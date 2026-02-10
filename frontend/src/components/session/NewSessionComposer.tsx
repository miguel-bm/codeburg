import { useEffect, useMemo, useState } from 'react';
import { MessageSquareText, Play, SquareTerminal, X } from 'lucide-react';
import type { SessionProvider } from '../../api/sessions';
import claudeLogo from '../../assets/claude-logo.svg';
import openaiLogo from '../../assets/openai-logo.svg';

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

  const [provider, setProvider] = useState<SessionProvider>('claude');
  const [includePrompt, setIncludePrompt] = useState(true);
  const [prompt, setPrompt] = useState(defaultPrompt);

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
    <div className="h-full overflow-auto bg-primary p-4 sm:p-6">
      <form
        onSubmit={handleSubmit}
        className="relative mx-auto flex w-full max-w-6xl flex-col gap-5 overflow-hidden rounded-2xl border border-subtle bg-elevated"
      >
        <div className="pointer-events-none absolute -top-20 left-12 h-56 w-56 rounded-full bg-accent/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 right-12 h-56 w-56 rounded-full bg-[var(--color-status-in-review)]/15 blur-3xl" />

        <div className="relative border-b border-subtle px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold tracking-wide text-[var(--color-text-primary)]">
                New Session
              </h2>
              <p className="text-xs text-dim">
                Choose provider, tune prompt, then launch in this task context.
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-subtle bg-secondary px-2.5 text-xs text-dim transition-colors hover:border-[var(--color-error)]/50 hover:text-[var(--color-error)]"
            >
              <X size={14} />
              Cancel
            </button>
          </div>
        </div>

        <div className="relative grid gap-6 px-5 pb-5 sm:px-6 sm:pb-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <section className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-dim">
              Provider
            </p>
            {PROVIDERS.map((option) => {
              const selected = provider === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setProvider(option.id)}
                  className={`w-full rounded-xl border p-3 text-left transition-all ${
                    selected
                      ? 'border-accent bg-accent/10 shadow-accent'
                      : 'border-subtle bg-secondary hover:border-[var(--color-text-secondary)]/50 hover:bg-tertiary'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white">
                      <ProviderLogo provider={option.id} />
                    </span>
                    <span className="min-w-0 space-y-0.5">
                      <span className="block text-sm font-medium text-[var(--color-text-primary)]">
                        {option.label}
                      </span>
                      <span className="block text-xs text-dim">
                        {option.caption}
                      </span>
                      <span className="block text-xs text-dim">
                        {option.detail}
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
          </section>

          <section className="space-y-4">
            {error && (
              <div className="rounded-lg border border-[var(--color-error)]/60 bg-[var(--color-error)]/10 px-3 py-2 text-xs text-[var(--color-error)]">
                {error}
              </div>
            )}

            <div className="rounded-xl border border-subtle bg-secondary p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-sm font-medium">
                  <MessageSquareText size={15} className="text-accent" />
                  Initial Prompt
                </div>
                {provider !== 'terminal' && (
                  <button
                    type="button"
                    onClick={() => setIncludePrompt((v) => !v)}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      includePrompt
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-subtle bg-primary text-dim hover:border-[var(--color-text-secondary)]/60'
                    }`}
                  >
                    {includePrompt ? 'Included' : 'Disabled'}
                  </button>
                )}
              </div>

              {provider === 'terminal' ? (
                <div className="rounded-lg border border-subtle bg-primary px-3 py-3 text-xs text-dim">
                  Terminal sessions ignore initial prompts and start in interactive shell mode.
                </div>
              ) : includePrompt ? (
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={12}
                  autoFocus
                  className="block w-full resize-y rounded-lg border border-subtle bg-primary px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-text-secondary)] focus:outline-none"
                  placeholder="Describe what the session should do..."
                />
              ) : (
                <div className="rounded-lg border border-subtle bg-primary px-3 py-3 text-xs text-dim">
                  Prompt is disabled. The provider will start in interactive mode.
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-subtle bg-secondary px-4 py-3">
              <p className="text-xs text-dim">{description}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={isPending}
                  className="rounded-md border border-subtle bg-primary px-3 py-1.5 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-tertiary disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
                >
                  <Play size={12} />
                  {isPending ? 'Starting...' : 'Start Session'}
                </button>
              </div>
            </div>
          </section>
        </div>
      </form>
    </div>
  );
}

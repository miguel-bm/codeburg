import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, MessageSquareText, Play, ShieldOff, X } from 'lucide-react';
import type { SessionProvider, SessionType } from '../../api/sessions';
import claudeLogo from '../../assets/claude-logo.svg';
import openaiLogo from '../../assets/openai-logo.svg';
import { Toggle } from '../ui/settings';
import { useMobile } from '../../hooks/useMobile';

interface NewSessionComposerProps {
  taskTitle: string;
  taskDescription?: string;
  onStart: (provider: SessionProvider, prompt: string, sessionType: SessionType, autoApprove: boolean) => void;
  onCancel: () => void;
  isPending?: boolean;
  error?: string;
  dismissible?: boolean;
  isProjectScope?: boolean;
}

interface ProviderOption {
  id: SessionProvider;
  label: string;
  caption: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: 'claude', label: 'Claude', caption: 'Anthropic' },
  { id: 'codex', label: 'Codex', caption: 'OpenAI' },
  { id: 'terminal', label: 'Terminal', caption: 'Shell' },
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
    <span
      aria-hidden="true"
      className="font-mono text-lg leading-none text-[var(--color-text-primary)]"
    >
      {'>'}
    </span>
  );
}

export function NewSessionComposer({
  taskTitle,
  taskDescription,
  onStart,
  onCancel,
  isPending = false,
  error,
  dismissible = true,
  isProjectScope = false,
}: NewSessionComposerProps) {
  const defaultPrompt = useMemo(
    () => isProjectScope ? '' : (taskDescription ? `${taskTitle}\n\n${taskDescription}` : taskTitle),
    [taskDescription, taskTitle, isProjectScope],
  );
  const isMobile = useMobile();

  const [provider, setProvider] = useState<SessionProvider>('claude');
  const [sessionType, setSessionType] = useState<SessionType>('terminal');
  const [includePrompt, setIncludePrompt] = useState(!isProjectScope);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [autoApprove, setAutoApprove] = useState(true);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const providerRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const promptEnabled = provider !== 'terminal' && includePrompt;

  useEffect(() => {
    if (!dismissible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, dismissible]);

  const description = provider === 'terminal'
    ? 'Starts an interactive shell in this task worktree.'
    : sessionType === 'chat'
      ? `Starts ${provider} in structured chat mode with rich tool cards.`
    : includePrompt
      ? `Starts ${provider} in terminal mode with the prompt below.`
      : `Starts ${provider} in terminal mode with no initial prompt.`;

  const startSession = () => {
    if (provider === 'terminal') {
      onStart('terminal', '', 'terminal', false);
      return;
    }
    onStart(provider, includePrompt ? prompt.trim() : '', sessionType, autoApprove);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startSession();
  };

  const handleProviderSelect = (id: SessionProvider) => {
    if (id === 'terminal') {
      if (!isPending) onStart('terminal', '', 'terminal', false);
      return;
    }
    setProvider(id);
  };

  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (!isPending) startSession();
    }
  };

  const handleProviderKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    let nextIndex = focusedIndex;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (focusedIndex + 1) % PROVIDERS.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (focusedIndex - 1 + PROVIDERS.length) % PROVIDERS.length;
    } else {
      return;
    }
    setFocusedIndex(nextIndex);
    providerRefs.current[nextIndex]?.focus();
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
          {dismissible && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-subtle bg-secondary text-dim transition-colors hover:border-[var(--color-error)]/50 hover:text-[var(--color-error)]"
              aria-label="Cancel new session"
            >
              <X size={14} />
            </button>
          )}
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
          <div className="grid grid-cols-3 gap-2 sm:gap-3" role="radiogroup" aria-label="Provider">
            {PROVIDERS.map((option, index) => {
              const selected = provider === option.id;
              return (
                <button
                  key={option.id}
                  ref={(el) => { providerRefs.current[index] = el; }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={focusedIndex === index ? 0 : -1}
                  onClick={() => { setFocusedIndex(index); handleProviderSelect(option.id); }}
                  onKeyDown={handleProviderKeyDown}
                  className={`rounded-xl border p-2.5 text-left transition-all sm:p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    selected
                      ? 'border-accent bg-accent/10 shadow-accent'
                      : 'border-subtle bg-secondary hover:border-[var(--color-text-secondary)]/50 hover:bg-tertiary'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:items-start sm:gap-3 sm:text-left">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-subtle bg-white sm:h-10 sm:w-10">
                      <ProviderLogo provider={option.id} />
                    </span>
                    <span className="min-w-0 space-y-0.5">
                      <span className="block text-xs font-medium text-[var(--color-text-primary)] sm:text-sm">
                        {option.label}
                      </span>
                      <span className="hidden text-xs text-dim sm:block">
                        {option.caption}
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-5 flex flex-1 flex-col rounded-xl border border-subtle bg-secondary p-3 sm:mt-6 sm:p-4">
          {provider !== 'terminal' && (
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-dim">
                Interface
              </div>
              <div className="inline-flex rounded-md border border-subtle bg-primary p-0.5">
                <button
                  type="button"
                  onClick={() => setSessionType('chat')}
                  className={`px-2 py-1 text-[11px] rounded ${sessionType === 'chat' ? 'bg-accent text-white' : 'text-dim hover:text-[var(--color-text-primary)]'}`}
                >
                  Chat UI
                </button>
                <button
                  type="button"
                  onClick={() => setSessionType('terminal')}
                  className={`px-2 py-1 text-[11px] rounded ${sessionType === 'terminal' ? 'bg-accent text-white' : 'text-dim hover:text-[var(--color-text-primary)]'}`}
                >
                  Terminal
                </button>
              </div>
            </div>
          )}

          {provider !== 'terminal' && (
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 text-sm font-medium">
                <ShieldOff size={15} className="text-accent" />
                Auto-Approve
              </div>
              <div className="inline-flex items-center gap-2">
                <span className="text-xs text-dim">Skip Permissions</span>
                <Toggle checked={autoApprove} onChange={setAutoApprove} />
              </div>
            </div>
          )}

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
          ) : (
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (!includePrompt) setIncludePrompt(true);
              }}
              onKeyDown={handlePromptKeyDown}
              rows={12}
              autoFocus={!isMobile}
              className={`block h-full w-full min-h-44 flex-1 resize-y rounded-lg border border-subtle bg-primary px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-text-secondary)] focus:outline-none sm:min-h-56 ${!includePrompt ? 'opacity-50' : ''}`}
              placeholder="Describe what the session should do..."
            />
          )}
        </section>

        <div className="sticky bottom-0 left-0 right-0 mt-6 -mx-4 border-t border-subtle bg-primary/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-center backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-2 sm:pb-6">
          <p className="mx-auto max-w-2xl text-xs text-dim">{description}</p>
          <div className="mt-4 flex items-center justify-center gap-3">
            {dismissible && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isPending}
                className="rounded-md border border-subtle bg-secondary px-5 py-2 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-tertiary disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-5 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-dim disabled:opacity-50"
            >
              <Play size={12} />
              {isPending ? 'Starting...' : 'Start Session'}
              <span className="inline-flex items-center gap-1 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px]">
                <CornerDownLeft size={10} />
                ⇧⏎
              </span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

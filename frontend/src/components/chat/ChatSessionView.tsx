import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Command, FileCode2, FolderTree, Loader2, RotateCcw, Send, Square, UserRound } from 'lucide-react';
import type { AgentSession } from '../../api/sessions';
import type { ChatMessage } from '../../api/chat';
import { createFilesApi, type FileEntry } from '../../api/workspace';
import { useChatSession } from '../../hooks/useChatSession';
import { MarkdownRenderer } from '../ui/MarkdownRenderer';
import { ToolCallCard } from './ToolCallCard';
import { useMobile } from '../../hooks/useMobile';
import { applySuggestionToText, findActiveToken, fuzzyScore, type InputSelection } from './chatAutocomplete';

interface ChatSessionViewProps {
  session: AgentSession;
  onResume?: () => Promise<unknown> | unknown;
}

interface ComposerSuggestion {
  key: string;
  type: 'slash' | 'file';
  label: string;
  detail?: string;
  value: string;
  addSpace: boolean;
  disabled?: boolean;
  icon: 'command' | 'file' | 'folder';
}

const MAX_SUGGESTIONS = 8;
const FILE_INDEX_DEPTH = 12;
const FALLBACK_SLASH_COMMANDS = ['context', 'review', 'security-review', 'cost', 'compact', 'debug', 'help'];

function canSend(status: AgentSession['status']): boolean {
  return status !== 'completed' && status !== 'error';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function extractSlashCommands(messages: ChatMessage[], provider: AgentSession['provider']): string[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.kind !== 'system') continue;
    const commands = asStringArray(message.data?.slash_commands ?? message.data?.slashCommands);
    if (commands.length > 0) {
      return Array.from(new Set(commands));
    }
  }
  if (provider === 'claude') {
    return FALLBACK_SLASH_COMMANDS;
  }
  return ['help', 'status', 'plan', 'review', 'test'];
}

function shouldRenderMessage(message: ChatMessage): boolean {
  if (message.kind === 'user-text' || message.kind === 'agent-text' || message.kind === 'tool-call') {
    return true;
  }

  if (message.kind === 'system') {
    const text = (message.text || '').trim().toLowerCase();
    const subtype = typeof message.data?.subtype === 'string' ? message.data.subtype : '';
    const msgType = typeof message.data?.type === 'string' ? message.data.type : '';
    if (subtype === 'init' || msgType === 'init' || text === 'init') return false;
    if (message.text === 'Turn started' || message.text === 'Turn complete') return false;
    if (msgType === 'error' || msgType === 'interrupt') return true;
    if (message.text === 'Interrupted' || message.text === 'Permission request') return true;
    return false;
  }

  if (message.kind === 'result') {
    if (message.text === 'Turn complete') return false;
    const isErrorValue = message.data?.is_error ?? message.data?.isError;
    if (isErrorValue === true || isErrorValue === 'true' || isErrorValue === 1) return true;
    const text = (message.text || '').toLowerCase();
    return text.includes('error') || text.includes('failed');
  }

  return false;
}

function computeVisibleMessages(messages: ChatMessage[]): ChatMessage[] {
  const visible: ChatMessage[] = [];
  let lastAgentText = '';

  for (const message of messages) {
    if (!shouldRenderMessage(message)) continue;

    if (message.kind === 'agent-text') {
      lastAgentText = (message.text || '').trim();
      visible.push(message);
      continue;
    }

    if (message.kind === 'result') {
      const resultText = (message.text || '').trim();
      if (resultText !== '' && lastAgentText !== '' && resultText === lastAgentText) {
        continue;
      }
    }

    visible.push(message);
  }

  return visible;
}

function MessageItem({ message }: { message: ChatMessage }) {
  if (message.kind === 'user-text') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md border border-accent/35 bg-accent/10 px-3 py-2 shadow-card">
          <div className="flex items-start gap-2">
            <UserRound size={13} className="text-accent mt-0.5 shrink-0" />
            <MarkdownRenderer className="prose-md text-[13px] [&>p]:text-[13px]">{message.text || ''}</MarkdownRenderer>
          </div>
        </div>
      </div>
    );
  }

  if (message.kind === 'agent-text') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-subtle bg-card px-3 py-2 shadow-card">
          <div className="flex items-start gap-2">
            <Bot size={13} className={`mt-0.5 shrink-0 ${message.isThinking ? 'text-amber-500' : 'text-accent'}`} />
            <MarkdownRenderer className="prose-md text-[13px] [&>p]:text-[13px]">{message.text || ''}</MarkdownRenderer>
          </div>
        </div>
      </div>
    );
  }

  if (message.kind === 'tool-call' && message.tool) {
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[95%]">
          <ToolCallCard tool={message.tool} />
        </div>
      </div>
    );
  }

  const isResult = message.kind === 'result';
  return (
    <div className="flex justify-center">
      <div className={`max-w-[94%] rounded-lg border px-2.5 py-1.5 text-[11px] ${
        isResult
          ? 'border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]'
          : 'border-subtle bg-secondary text-dim'
      }`}>
        {message.text || message.kind}
      </div>
    </div>
  );
}

function suggestionIcon(icon: ComposerSuggestion['icon']) {
  if (icon === 'command') {
    return <Command size={13} className="text-accent" />;
  }
  if (icon === 'folder') {
    return <FolderTree size={13} className="text-amber-500" />;
  }
  return <FileCode2 size={13} className="text-accent" />;
}

function findFirstEnabledSuggestionIndex(suggestions: ComposerSuggestion[]): number {
  const idx = suggestions.findIndex((suggestion) => !suggestion.disabled);
  return idx >= 0 ? idx : 0;
}

export function ChatSessionView({ session, onResume }: ChatSessionViewProps) {
  const isMobile = useMobile();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [selection, setSelection] = useState<InputSelection>({ start: 0, end: 0 });
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [dismissedTokenKey, setDismissedTokenKey] = useState<string | null>(null);
  const [fileIndex, setFileIndex] = useState<FileEntry[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const autoStickRef = useRef(true);

  const {
    messages,
    connected,
    connecting,
    error,
    sendMessage,
    interrupt,
  } = useChatSession(session.id, session.status);

  const taskFilesApi = useMemo(
    () => (session.taskId ? createFilesApi('task', session.taskId) : null),
    [session.taskId],
  );
  const projectFilesApi = useMemo(
    () => createFilesApi('project', session.projectId),
    [session.projectId],
  );

  const visibleMessages = useMemo(() => computeVisibleMessages(messages), [messages]);

  const slashCommands = useMemo(
    () => extractSlashCommands(messages, session.provider),
    [messages, session.provider],
  );

  const activeToken = useMemo(
    () => findActiveToken(input, selection, ['/', '@']),
    [input, selection],
  );

  const tokenKey = activeToken ? `${activeToken.start}:${activeToken.end}:${activeToken.token}` : null;

  const suggestions = useMemo<ComposerSuggestion[]>(() => {
    if (!activeToken) return [];

    if (activeToken.prefix === '/') {
      const q = activeToken.query.toLowerCase();
      return slashCommands
        .filter((command) => q === '' || command.toLowerCase().includes(q))
        .slice(0, MAX_SUGGESTIONS)
        .map((command) => ({
          key: `slash:${command}`,
          type: 'slash',
          label: `/${command}`,
          detail: session.provider === 'claude' ? 'Claude command' : 'Prompt shortcut',
          value: `/${command}`,
          addSpace: true,
          icon: 'command',
        }));
    }

    if (activeToken.prefix === '@') {
      if (filesLoading && (!fileIndex || fileIndex.length === 0)) {
        return [{
          key: 'files:loading',
          type: 'file',
          label: 'Indexing files...',
          detail: 'Preparing @file suggestions',
          value: '@',
          addSpace: false,
          disabled: true,
          icon: 'file',
        }];
      }
      const files = fileIndex ?? [];
      const q = activeToken.query.trim();
      const scored = files
        .map((entry) => {
          const score = q ? fuzzyScore(entry.path, q) : 1000 - entry.path.length;
          return { entry, score };
        })
        .filter((item) => item.score >= 0)
        .sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          if (a.entry.type !== b.entry.type) return a.entry.type === 'dir' ? -1 : 1;
          return a.entry.path.localeCompare(b.entry.path);
        })
        .slice(0, MAX_SUGGESTIONS);

      return scored.map(({ entry }) => {
        const pathValue = entry.type === 'dir' ? `${entry.path}/` : entry.path;
        return {
          key: `file:${entry.path}`,
          type: 'file' as const,
          label: `@${pathValue}`,
          detail: entry.type === 'dir' ? 'Directory' : 'File',
          value: `@${pathValue}`,
          addSpace: entry.type !== 'dir',
          icon: entry.type === 'dir' ? 'folder' : 'file',
        };
      });
    }

    return [];
  }, [activeToken, fileIndex, filesLoading, session.provider, slashCommands]);

  const visibleSuggestions = useMemo(() => {
    if (!tokenKey) return [];
    if (dismissedTokenKey === tokenKey) return [];
    return suggestions;
  }, [dismissedTokenKey, suggestions, tokenKey]);

  const statusLabel = useMemo(() => {
    if (connecting) return 'Connecting...';
    if (!connected) return 'Disconnected';
    if (session.status === 'running') return 'Running';
    if (session.status === 'waiting_input') return 'Ready';
    if (session.status === 'completed') return 'Completed';
    if (session.status === 'error') return 'Error';
    return 'Idle';
  }, [connected, connecting, session.status]);

  useEffect(() => {
    setFileIndex(null);
    setFilesLoading(false);
    setDismissedTokenKey(null);
    setSelectedSuggestionIndex(0);
  }, [session.id]);

  useEffect(() => {
    setSelectedSuggestionIndex(findFirstEnabledSuggestionIndex(visibleSuggestions));
  }, [tokenKey, visibleSuggestions]);

  const loadFileIndex = useCallback(async () => {
    if (filesLoading || fileIndex !== null) return;
    setFilesLoading(true);
    try {
      const primaryApi = taskFilesApi ?? projectFilesApi;
      const resp = await primaryApi.list(undefined, FILE_INDEX_DEPTH);
      setFileIndex(resp.entries || []);
    } catch {
      if (taskFilesApi) {
        try {
          const fallback = await projectFilesApi.list(undefined, FILE_INDEX_DEPTH);
          setFileIndex(fallback.entries || []);
        } catch {
          setFileIndex([]);
        }
      } else {
        setFileIndex([]);
      }
    } finally {
      setFilesLoading(false);
    }
  }, [fileIndex, filesLoading, projectFilesApi, taskFilesApi]);

  // Warm file index early so @ suggestions are usually instant when typing starts.
  useEffect(() => {
    if (fileIndex !== null || filesLoading) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      void loadFileIndex();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fileIndex, filesLoading, loadFileIndex]);

  useEffect(() => {
    if (!activeToken || activeToken.prefix !== '@') return;
    void loadFileIndex();
  }, [activeToken, loadFileIndex]);

  useEffect(() => {
    if (visibleSuggestions.length === 0) return;
    const node = suggestionRefs.current[selectedSuggestionIndex];
    if (!node) return;
    node.scrollIntoView({ block: 'nearest' });
  }, [selectedSuggestionIndex, visibleSuggestions.length]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    if (!autoStickRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [visibleMessages]);

  const handleScroll = () => {
    const node = listRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    autoStickRef.current = distanceFromBottom < 80;
  };

  const applyComposerSuggestion = (suggestion: ComposerSuggestion) => {
    if (suggestion.disabled) return;
    const next = applySuggestionToText(input, selection, suggestion.value, ['/', '@'], suggestion.addSpace);
    setInput(next.text);
    setDismissedTokenKey(null);

    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.cursor, next.cursor);
      setSelection({ start: next.cursor, end: next.cursor });
    });
  };

  const submit = async () => {
    const content = input.trim();
    if (!content || sending || !canSend(session.status)) return;
    setSending(true);
    try {
      await sendMessage(content);
      setInput('');
      setSelection({ start: 0, end: 0 });
      setDismissedTokenKey(null);
      autoStickRef.current = true;
    } finally {
      setSending(false);
    }
  };

  const suggestionList = visibleSuggestions;
  const canResume = session.status === 'completed' && typeof onResume === 'function';
  const handleResume = async () => {
    if (!onResume || resuming) return;
    setResuming(true);
    try {
      await onResume();
    } catch {
      // Resume errors are surfaced by the parent mutation state.
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary">
      <div className="px-3 py-1.5 border-b border-subtle bg-secondary flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          {connecting ? <Loader2 size={12} className="animate-spin text-accent" /> : <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'}`} />}
          <span className="text-dim">{statusLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {canResume && (
            <button
              type="button"
              onClick={() => { void handleResume(); }}
              disabled={resuming}
              className="inline-flex items-center gap-1 rounded-md border border-subtle bg-primary px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-60"
            >
              {resuming ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
              Resume
            </button>
          )}
          {error && <span className="text-[var(--color-error)] truncate max-w-[65%]">{error}</span>}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,var(--color-accent-glow),transparent_40%)] opacity-60" />
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="relative h-full overflow-y-auto px-3 py-3 space-y-2.5"
        >
          {visibleMessages.length === 0 ? (
            <div className="h-full grid place-items-center text-xs text-dim">
              Start by sending a message.
            </div>
          ) : (
            visibleMessages.map((message) => (
              <MessageItem key={message.id} message={message} />
            ))
          )}
        </div>
      </div>

      <div className="border-t border-subtle bg-secondary/95 backdrop-blur px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <div className="relative">
          {suggestionList.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-subtle bg-card shadow-lg">
              <div className="max-h-56 overflow-y-auto py-1">
                {suggestionList.map((suggestion, index) => {
                  const selected = index === selectedSuggestionIndex;
                  return (
                    <button
                      key={suggestion.key}
                      ref={(el) => { suggestionRefs.current[index] = el; }}
                      type="button"
                      disabled={Boolean(suggestion.disabled)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyComposerSuggestion(suggestion)}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
                        selected ? 'bg-accent/10' : 'hover:bg-secondary'
                      } ${suggestion.disabled ? 'opacity-70 cursor-default' : ''}`}
                    >
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-subtle bg-primary">
                        {suggestionIcon(suggestion.icon)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[var(--color-text-primary)]">{suggestion.label}</span>
                        {suggestion.detail && (
                          <span className="block truncate text-[10px] text-dim">{suggestion.detail}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setSelection({ start: e.target.selectionStart, end: e.target.selectionEnd });
                setDismissedTokenKey(null);
              }}
              onSelect={(e) => {
                const target = e.target as HTMLTextAreaElement;
                setSelection({ start: target.selectionStart, end: target.selectionEnd });
              }}
              onClick={(e) => {
                const target = e.target as HTMLTextAreaElement;
                setSelection({ start: target.selectionStart, end: target.selectionEnd });
              }}
              onKeyDown={(e) => {
                if (suggestionList.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    let next = selectedSuggestionIndex;
                    for (let i = 0; i < suggestionList.length; i += 1) {
                      next = (next + 1) % suggestionList.length;
                      if (!suggestionList[next].disabled) {
                        setSelectedSuggestionIndex(next);
                        break;
                      }
                    }
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    let next = selectedSuggestionIndex;
                    for (let i = 0; i < suggestionList.length; i += 1) {
                      next = (next - 1 + suggestionList.length) % suggestionList.length;
                      if (!suggestionList[next].disabled) {
                        setSelectedSuggestionIndex(next);
                        break;
                      }
                    }
                    return;
                  }
                  if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                    const suggestion = suggestionList[selectedSuggestionIndex] ?? suggestionList.find((item) => !item.disabled);
                    if (suggestion && !suggestion.disabled) {
                      e.preventDefault();
                      applyComposerSuggestion(suggestion);
                      return;
                    }
                    if (e.key === 'Tab') {
                      return;
                    }
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setDismissedTokenKey(tokenKey);
                    return;
                  }
                }

                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={isMobile ? 2 : 3}
              placeholder="Send a message to this session..."
              className="flex-1 resize-none rounded-lg border border-subtle bg-primary px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-accent"
              disabled={!canSend(session.status)}
            />

            <div className="flex items-center gap-1">
              {session.status === 'running' && (
                <button
                  type="button"
                  onClick={interrupt}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-subtle bg-primary text-dim hover:text-[var(--color-error)] hover:border-[var(--color-error)]/50 transition-colors"
                  title="Interrupt"
                  aria-label="Interrupt"
                >
                  <Square size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => { void submit(); }}
                disabled={sending || !input.trim() || !canSend(session.status)}
                className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-accent text-white hover:bg-accent-dim disabled:opacity-50 transition-colors"
                title="Send"
                aria-label="Send"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, AtSign, Command, FileCode2, FolderTree, Loader2, RotateCcw, Send, Slash, Square } from 'lucide-react';
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

interface MessageItemProps {
  message: ChatMessage;
  nextKind?: ChatMessage['kind'];
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

function providerDisplayName(provider: AgentSession['provider'] | string): string {
  if (provider === 'claude') return 'Claude';
  if (provider === 'codex') return 'Codex';
  if (provider === 'terminal') return 'Terminal';
  if (!provider) return 'Assistant';
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function formatTimeLabel(date?: string): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  if (message.kind === 'user-text' || message.kind === 'agent-text') {
    return true;
  }

  if (message.kind === 'tool-call') {
    if (message.data?.hidden === true) return false;
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

function subagentLabel(message: ChatMessage): string | null {
  const id = typeof message.data?.subagentId === 'string' ? message.data.subagentId.trim() : '';
  if (!id) return null;
  const title = typeof message.data?.subagentTitle === 'string' ? message.data.subagentTitle.trim() : '';
  return title || id;
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

function MessageItem({ message, nextKind }: MessageItemProps) {
  const subagent = subagentLabel(message);
  if (message.kind === 'user-text') {
    const showMeta = nextKind !== 'user-text';
    const time = formatTimeLabel(message.createdAt);
    return (
      <div className="flex justify-end">
        <div className="max-w-[min(90%,46rem)]">
          <div className="rounded-2xl rounded-br-md border border-[var(--color-border-accent)] bg-accent/10 px-3.5 py-2.5 shadow-card">
            <MarkdownRenderer className="text-[13px] leading-6 [&_p]:leading-6">{message.text || ''}</MarkdownRenderer>
          </div>
          {showMeta && (
            <div className="mt-1 px-1 text-right text-[10px] text-dim">
              You{time ? ` · ${time}` : ''}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (message.kind === 'agent-text') {
    const showMeta = nextKind !== 'agent-text';
    const time = formatTimeLabel(message.createdAt);

    return (
      <div className="min-w-0">
        {subagent && (
          <div className="mb-1 inline-flex items-center rounded-md border border-subtle bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-dim">
            Subagent: {subagent}
          </div>
        )}
        <MarkdownRenderer className="max-w-none text-[13px] leading-6 [&_p]:leading-6">{message.text || ''}</MarkdownRenderer>
        {showMeta && (
          <div className="mt-1 text-[10px] text-dim">{time}</div>
        )}
      </div>
    );
  }

  if (message.kind === 'tool-call' && message.tool) {
    return (
      <div>
        {subagent && (
          <div className="mb-1 inline-flex items-center rounded-md border border-subtle bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-dim">
            Subagent: {subagent}
          </div>
        )}
        <ToolCallCard tool={message.tool} />
      </div>
    );
  }

  const isErrorLike = message.kind === 'result' || message.kind === 'system';
  return (
    <div className="flex justify-center">
      <div className={`max-w-[92%] rounded-md border px-2 py-1 text-[11px] ${
        isErrorLike
          ? 'border-[var(--color-error)]/35 bg-[var(--color-error)]/10 text-[var(--color-error)]'
          : 'border-subtle bg-secondary text-dim'
      }`}>
        {message.text || message.kind}
      </div>
    </div>
  );
}

function PendingAssistantRow({ providerLabel }: { providerLabel: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-dim">
      <Loader2 size={13} className="animate-spin text-accent" />
      <span>{providerLabel} is working...</span>
      <span className="inline-flex items-center gap-1">
        <span className="h-1 w-1 rounded-full bg-accent/80 animate-pulse" />
        <span className="h-1 w-1 rounded-full bg-accent/65 animate-pulse [animation-delay:140ms]" />
        <span className="h-1 w-1 rounded-full bg-accent/50 animate-pulse [animation-delay:280ms]" />
      </span>
    </div>
  );
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
  const [inputFocused, setInputFocused] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

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
  const providerLabel = useMemo(() => providerDisplayName(session.provider), [session.provider]);

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

  useEffect(() => {
    setFileIndex(null);
    setFilesLoading(false);
    setDismissedTokenKey(null);
    setSelectedSuggestionIndex(0);
    setShowJumpToLatest(false);
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
    const node = textareaRef.current;
    if (!node) return;
    const minHeight = isMobile ? 72 : 84;
    const maxHeight = isMobile ? 170 : 220;
    if (!input.trim()) {
      node.style.height = `${minHeight}px`;
      return;
    }
    node.style.height = '0px';
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, node.scrollHeight));
    node.style.height = `${nextHeight}px`;
  }, [input, isMobile]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const node = listRef.current;
    if (!node) return;
    if (typeof node.scrollTo === 'function') {
      node.scrollTo({ top: node.scrollHeight, behavior });
    } else {
      node.scrollTop = node.scrollHeight;
    }
    setShowJumpToLatest(false);
  }, []);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    if (!autoStickRef.current) return;
    requestAnimationFrame(() => {
      scrollToBottom('auto');
    });
  }, [visibleMessages, scrollToBottom]);

  const handleScroll = () => {
    const node = listRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    autoStickRef.current = distanceFromBottom < 80;
    setShowJumpToLatest(distanceFromBottom > 220);
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

  const insertTrigger = (trigger: '/' | '@') => {
    const node = textareaRef.current;
    const start = node?.selectionStart ?? selection.start;
    const end = node?.selectionEnd ?? selection.end;
    const prev = start > 0 ? input[start - 1] : '';
    const needsLeadingSpace = prev !== '' && !/\s/.test(prev);
    const insertValue = `${needsLeadingSpace ? ' ' : ''}${trigger}`;
    const nextText = `${input.slice(0, start)}${insertValue}${input.slice(end)}`;
    const cursor = start + insertValue.length;

    setInput(nextText);
    setDismissedTokenKey(null);
    setSelection({ start: cursor, end: cursor });

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });

    if (trigger === '@') {
      void loadFileIndex();
    }
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
      requestAnimationFrame(() => scrollToBottom('smooth'));
    } finally {
      setSending(false);
    }
  };

  const suggestionList = visibleSuggestions;
  const canResume = session.status === 'completed' && typeof onResume === 'function';
  const showPendingAssistant = session.status === 'running';
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
      <div className="relative flex-1 min-h-0">
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-3 py-4 sm:px-4 sm:py-5 space-y-4"
        >
          {visibleMessages.length === 0 ? (
            <div className="grid h-full place-items-center text-center text-xs text-dim">
              <div>
                <p>Start by sending a message.</p>
                <p className="mt-1">Use <span className="font-mono text-[var(--color-text-secondary)]">/</span> for commands or <span className="font-mono text-[var(--color-text-secondary)]">@</span> for files.</p>
              </div>
            </div>
          ) : (
            visibleMessages.map((message, index) => (
              <MessageItem
                key={message.id}
                message={message}
                nextKind={visibleMessages[index + 1]?.kind}
              />
            ))
          )}
          {showPendingAssistant && <PendingAssistantRow providerLabel={providerLabel} />}
        </div>

        {showJumpToLatest && (
          <button
            type="button"
            onClick={() => {
              autoStickRef.current = true;
              scrollToBottom('smooth');
            }}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full border border-subtle bg-card px-2.5 py-1 text-[11px] text-dim shadow-card hover:text-[var(--color-text-primary)]"
            title="Jump to latest message"
          >
            <ArrowDown size={12} />
            Latest
          </button>
        )}
      </div>

      <div className="bg-primary px-3 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {(canResume || error || (!connected && !connecting)) && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-subtle bg-primary px-2.5 py-1.5">
            <div className="min-w-0 text-xs text-dim truncate">
              {canResume ? 'Session completed' : !connected && !connecting ? 'Disconnected' : error ?? ''}
            </div>
            {canResume && (
              <button
                type="button"
                onClick={() => { void handleResume(); }}
                disabled={resuming}
                className="inline-flex items-center gap-1 rounded-md border border-subtle bg-secondary px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-60"
              >
                {resuming ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                Resume
              </button>
            )}
          </div>
        )}
        <div className={`relative overflow-visible rounded-xl border bg-secondary shadow-card transition-colors ${inputFocused ? 'border-accent shadow-accent' : 'border-transparent'}`}>
          {suggestionList.length > 0 && (
            <div className="absolute bottom-full left-2 right-2 z-20 mb-2 overflow-hidden rounded-xl border border-subtle bg-card shadow-card">
              <div className="flex items-center justify-between border-b border-subtle px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-dim">
                <span>{activeToken?.prefix === '@' ? 'Workspace Files' : 'Slash Commands'}</span>
                {!isMobile && (
                  <span className="normal-case tracking-normal text-[10px] text-dim">
                    ↑↓ navigate · Enter apply · Esc dismiss
                  </span>
                )}
              </div>
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

          <div className="px-2 pt-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setSelection({ start: e.target.selectionStart, end: e.target.selectionEnd });
                setDismissedTokenKey(null);
              }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
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
                    if (e.key === 'Tab') return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setDismissedTokenKey(tokenKey);
                    return;
                  }
                }

                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  textareaRef.current?.blur();
                  return;
                }

                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={1}
              placeholder={canSend(session.status) ? 'Describe your next step...' : 'This session is completed'}
              className="min-h-[72px] max-h-[220px] w-full resize-none bg-transparent px-1 py-1.5 text-sm leading-6 text-[var(--color-text-primary)] focus:outline-none"
              disabled={!canSend(session.status)}
            />
          </div>

          <div className="flex items-center justify-between px-2 py-1.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => insertTrigger('/')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-dim hover:text-accent transition-colors"
                title="Insert slash command trigger"
                aria-label="Insert slash command trigger"
              >
                <Slash size={14} />
              </button>
              <button
                type="button"
                onClick={() => insertTrigger('@')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-dim hover:text-accent transition-colors"
                title="Insert file reference trigger"
                aria-label="Insert file reference trigger"
              >
                <AtSign size={13} />
              </button>
            </div>

            <div className="flex items-center gap-1">
              {session.status === 'running' && (
                <button
                  type="button"
                  onClick={interrupt}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-dim hover:text-[var(--color-error)] transition-colors"
                  title="Interrupt"
                  aria-label="Interrupt"
                >
                  <Square size={13} />
                </button>
              )}

              <button
                type="button"
                onClick={() => { void submit(); }}
                disabled={sending || !input.trim() || !canSend(session.status)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-accent hover:text-accent-dim disabled:opacity-35 transition-colors"
                title="Send"
                aria-label="Send"
              >
                {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

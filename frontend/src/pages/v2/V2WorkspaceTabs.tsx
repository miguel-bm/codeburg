import { useEffect, useState } from 'react';
import {
  Files,
  GitCommitHorizontal,
  MessageSquareText,
  Pencil,
  SquareTerminal,
  X,
} from 'lucide-react';
import type { Conversation, TerminalSession } from '../../api/types';
import { fileName } from '../../components/workspace/editorUtils';
import type { WorkspaceTab } from '../../stores/workspace';

type PreviewWorkspaceTab = Extract<WorkspaceTab, { type: 'editor' | 'diff' }>;

function tabSurface(active: boolean, tone: 'conversation' | 'terminal' | 'preview') {
  const toneClass = tone === 'conversation'
    ? 'data-[tone=conversation]:[--tab-accent:var(--color-accent)]'
    : tone === 'terminal'
      ? 'data-[tone=terminal]:[--tab-accent:var(--color-success)]'
      : 'data-[tone=preview]:[--tab-accent:var(--color-warning)]';

  return [
    toneClass,
    'group/tab relative isolate inline-flex h-[44px] max-w-[15rem] shrink-0 items-center overflow-hidden rounded-md text-sm transition-[background-color,box-shadow,color,transform] duration-150 ease-out-quart animate-tab-enter md:h-7 md:text-xs',
    'hover:-translate-y-px hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]',
    active
      ? 'bg-[var(--color-card)] text-[var(--color-text-primary)] shadow-[inset_0_0_0_1px_var(--color-card-border),0_1px_2px_oklch(0_0_0_/_0.08)] before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-[var(--tab-accent,var(--color-accent))]/75'
      : 'text-[var(--color-text-secondary)]',
  ].join(' ');
}

export function WorkspaceConversationTab({
  conversation,
  active = false,
  onSelect,
  onRename,
}: {
  conversation: Conversation;
  active?: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);

  useEffect(() => {
    setDraft(conversation.title);
  }, [conversation.title]);

  const save = () => {
    const title = draft.trim();
    setEditing(false);
    if (title && title !== conversation.title) onRename(title);
    else setDraft(conversation.title);
  };

  return (
    <div className={tabSurface(active, 'conversation')} data-tone="conversation">
      <MessageSquareText size={13} className="ml-2.5 shrink-0 text-[var(--tab-accent,var(--color-accent))] md:ml-2" />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
            if (event.key === 'Escape') {
              setEditing(false);
              setDraft(conversation.title);
            }
          }}
          className="h-full min-w-28 bg-transparent px-2 outline-none md:min-w-24"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className="flex h-full min-w-0 flex-1 items-center px-2 text-left"
          title={conversation.title}
        >
          <span className="truncate">{conversation.title}</span>
        </button>
      )}
      {!editing && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setEditing(true);
          }}
          className="mr-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-dim opacity-0 transition-opacity hover:bg-secondary hover:text-[var(--color-text-primary)] group-hover/tab:flex group-hover/tab:opacity-100 group-focus-within/tab:flex group-focus-within/tab:opacity-100"
          title="Rename conversation"
          aria-label="Rename conversation"
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  );
}

export function WorkspaceTerminalTab({
  terminal,
  active,
  pending = false,
  onSelect,
  onClose,
  onRename,
}: {
  terminal: TerminalSession;
  active: boolean;
  pending?: boolean;
  onSelect: () => void;
  onClose?: () => void;
  onRename?: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(terminal.title ?? '');

  useEffect(() => {
    setDraft(terminal.title ?? '');
  }, [terminal.title]);

  const save = () => {
    const title = draft.trim();
    setEditing(false);
    if (title && title !== terminal.title) onRename?.(title);
  };

  return (
    <div className={tabSurface(active, 'terminal')} data-tone="terminal">
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
            if (event.key === 'Escape') setEditing(false);
          }}
          className="h-full w-36 bg-transparent px-3 outline-none md:w-28 md:px-2"
        />
      ) : (
        <button type="button" onClick={onSelect} onDoubleClick={() => onRename && setEditing(true)} className="flex h-full min-w-0 items-center gap-1.5 px-2.5 md:px-2" title={terminal.title || 'Terminal'}>
          <SquareTerminal size={13} className="shrink-0 text-[var(--tab-accent,var(--color-success))]" />
          <span className="max-w-32 truncate">{terminal.title || 'Terminal'}</span>
        </button>
      )}
      {onClose && (
        <button type="button" disabled={pending} onClick={onClose} className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-dim transition-colors hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-40" aria-label="Close terminal">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export function WorkspacePreviewTab({
  tab,
  index,
  active,
  activeTabIndex,
  onSelect,
  onClose,
}: {
  tab: PreviewWorkspaceTab;
  index: number;
  active: boolean;
  activeTabIndex: number;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={tabSurface(active, 'preview')}
      data-tone="preview"
    >
      <span className="ml-2.5 shrink-0 text-[var(--tab-accent,var(--color-warning))] md:ml-2">
        {tab.type === 'editor' ? <Files size={13} /> : <GitCommitHorizontal size={13} />}
      </span>
      <span className="min-w-0 flex-1 truncate px-2">{workspacePreviewTabLabel(tab)}</span>
      {index === activeTabIndex && tab.ephemeral && <span className="hidden pr-1 text-[10px] text-dim md:inline">preview</span>}
      <span
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-dim transition-colors hover:bg-secondary hover:text-[var(--color-text-primary)]"
        aria-label="Close preview"
      >
        <X size={12} />
      </span>
    </button>
  );
}

export function workspacePreviewTabKey(tab: PreviewWorkspaceTab, index: number) {
  if (tab.type === 'editor') return `editor:${tab.path}:${index}`;
  return `diff:${tab.file ?? 'all'}:${tab.staged}:${tab.base}:${tab.commit ?? 'none'}:${index}`;
}

export function workspacePreviewTabLabel(tab: PreviewWorkspaceTab) {
  if (tab.type === 'editor') return fileName(tab.path);
  if (tab.file) return fileName(tab.file);
  if (tab.commit) return tab.commit.slice(0, 7);
  return 'All changes';
}

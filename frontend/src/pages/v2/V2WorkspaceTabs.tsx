import { useEffect, useState } from 'react';
import {
  Circle,
  CircleAlert,
  Files,
  GitCommitHorizontal,
  LoaderCircle,
  MessageSquareText,
  SquareTerminal,
  X,
} from 'lucide-react';
import type { Conversation, PiConversationSnapshot, TerminalSession } from '../../api/types';
import { workspacePreviewTabLabel, type PreviewWorkspaceTab } from './V2WorkspaceTabHelpers';

function tabSurface(active: boolean, tone: 'conversation' | 'terminal' | 'preview') {
  const toneClass = tone === 'conversation'
    ? 'data-[tone=conversation]:[--tab-accent:var(--color-accent)]'
    : tone === 'terminal'
      ? 'data-[tone=terminal]:[--tab-accent:var(--color-success)]'
      : 'data-[tone=preview]:[--tab-accent:var(--color-warning)]';

  return [
    toneClass,
    'group/tab relative isolate inline-flex h-[44px] max-w-[15rem] shrink-0 items-center overflow-hidden rounded-md text-sm transition-[background-color,box-shadow,color] duration-150 ease-out-quart animate-tab-enter md:h-7 md:text-xs',
    'hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]',
    active
      ? 'bg-[var(--color-card)] text-[var(--color-text-primary)] shadow-[inset_0_0_0_1px_var(--color-card-border),0_1px_2px_oklch(0_0_0_/_0.08)] before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-[var(--tab-accent,var(--color-accent))]/75'
      : 'text-[var(--color-text-secondary)]',
  ].join(' ');
}

function ShortcutHint({ index, show }: { index?: number; show?: boolean }) {
  if (!show || !index || index < 1 || index > 9) return null;

  return (
    <span className="pointer-events-none absolute left-1 top-1/2 z-20 inline-flex min-w-8 -translate-y-1/2 items-center justify-center rounded-md bg-[var(--color-bg-primary)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--color-text-primary)] shadow-[0_1px_4px_oklch(0_0_0_/_0.16)] ring-1 ring-[var(--color-card-border)]">
      ⌘{index}
    </span>
  );
}

export function WorkspaceConversationTab({
  conversation,
  snapshot,
  active = false,
  onSelect,
  onRename,
  shortcutIndex,
  showShortcutHint,
}: {
  conversation: Conversation;
  snapshot?: PiConversationSnapshot;
  active?: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  shortcutIndex?: number;
  showShortcutHint?: boolean;
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
      <ShortcutHint index={shortcutIndex} show={showShortcutHint} />
      <ConversationTabIndicator conversation={conversation} snapshot={snapshot} />
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
          onDoubleClick={() => setEditing(true)}
          className="flex h-full min-w-0 flex-1 items-center px-2 text-left"
          title={`${conversation.title}. Double-click to rename.`}
        >
          <span className="truncate">{conversation.title}</span>
        </button>
      )}
    </div>
  );
}

function ConversationTabIndicator({ conversation, snapshot }: { conversation: Conversation; snapshot?: PiConversationSnapshot }) {
  if (snapshot?.lastError) {
    return (
      <span className="ml-2.5 flex w-4 shrink-0 justify-center text-[var(--color-error)] md:ml-2" title={snapshot.lastError}>
        <CircleAlert size={13} />
      </span>
    );
  }

  if (snapshot?.streaming) {
    return (
      <span className="ml-2.5 flex w-4 shrink-0 justify-center text-accent md:ml-2" title="Pi is working">
        <LoaderCircle size={13} className="animate-spin" />
      </span>
    );
  }

  if (snapshot?.runtimeActive && conversation.unreadAt) {
    return (
      <span className="ml-2.5 flex w-4 shrink-0 justify-center text-[var(--color-status-in-review)] md:ml-2" title="Unread response">
        <Circle size={9} fill="currentColor" />
      </span>
    );
  }

  if (conversation.unreadAt) {
    return (
      <span className="ml-2.5 flex w-4 shrink-0 justify-center text-accent md:ml-2" title="Unread">
        <Circle size={9} fill="currentColor" />
      </span>
    );
  }

  return <MessageSquareText size={13} className="ml-2.5 w-4 shrink-0 text-[var(--tab-accent,var(--color-accent))] md:ml-2" />;
}

export function WorkspaceTerminalTab({
  terminal,
  active,
  pending = false,
  onSelect,
  onClose,
  onRename,
  shortcutIndex,
  showShortcutHint,
}: {
  terminal: TerminalSession;
  active: boolean;
  pending?: boolean;
  onSelect: () => void;
  onClose?: () => void;
  onRename?: (title: string) => void;
  shortcutIndex?: number;
  showShortcutHint?: boolean;
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
      <ShortcutHint index={shortcutIndex} show={showShortcutHint} />
      <SquareTerminal size={13} className="ml-2.5 shrink-0 text-[var(--tab-accent,var(--color-success))] md:ml-2" />
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
        <button type="button" onClick={onSelect} onDoubleClick={() => onRename && setEditing(true)} className="flex h-full min-w-0 items-center px-2.5 md:px-2" title={`${terminal.title || 'Terminal'}. Double-click to rename.`}>
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
  shortcutIndex,
  showShortcutHint,
}: {
  tab: PreviewWorkspaceTab;
  index: number;
  active: boolean;
  activeTabIndex: number;
  onSelect: () => void;
  onClose: () => void;
  shortcutIndex?: number;
  showShortcutHint?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={tabSurface(active, 'preview')}
      data-tone="preview"
    >
      <ShortcutHint index={shortcutIndex} show={showShortcutHint} />
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

import { useState, type ReactNode } from 'react';
import { MessageSquarePlus, PlusCircle, SquareTerminal } from 'lucide-react';
import { MAC_WORKSPACE_SHORTCUTS, type MacShortcutDefinition } from '../../hooks/useMacTabShortcuts';
import { ShortcutTooltip } from './V2ShortcutTooltip';

export function WorkspaceNewTabIconActions({
  onCreateConversation,
  onCreateTerminal,
  createConversationPending,
  createTerminalDisabled,
  createTerminalPending,
  showShortcutHints = false,
}: {
  onCreateConversation: () => void;
  onCreateTerminal: () => void;
  createConversationPending: boolean;
  createTerminalDisabled: boolean;
  createTerminalPending: boolean;
  showShortcutHints?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <ShortcutIconButton
        disabled={createConversationPending}
        onClick={onCreateConversation}
        title="New conversation in this workspace"
        shortcut={MAC_WORKSPACE_SHORTCUTS.newConversation}
        showShortcut={showShortcutHints}
      >
        <MessageSquarePlus size={15} />
      </ShortcutIconButton>
      <ShortcutIconButton
        disabled={createTerminalDisabled || createTerminalPending}
        onClick={onCreateTerminal}
        title="New terminal in this workspace"
        shortcut={MAC_WORKSPACE_SHORTCUTS.newTerminal}
        showShortcut={showShortcutHints}
      >
        <SquareTerminal size={15} />
      </ShortcutIconButton>
    </div>
  );
}

export function WorkspaceNewTabMenuButton({
  onCreateConversation,
  onCreateTerminal,
  createConversationPending,
  createTerminalDisabled,
  createTerminalPending,
}: {
  onCreateConversation: () => void;
  onCreateTerminal: () => void;
  createConversationPending: boolean;
  createTerminalDisabled: boolean;
  createTerminalPending: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        disabled={createTerminalDisabled && createConversationPending}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-[44px] w-[44px] cursor-pointer items-center justify-center rounded-md text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50"
        title="New tab"
        aria-label="New tab"
      >
        <PlusCircle size={15} />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close new tab menu" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]">
            <NewTabMenuItem icon={<MessageSquarePlus size={14} />} disabled={createConversationPending} onClick={() => { setOpen(false); onCreateConversation(); }}>Conversation</NewTabMenuItem>
            <NewTabMenuItem icon={<SquareTerminal size={14} />} disabled={createTerminalDisabled || createTerminalPending} onClick={() => { setOpen(false); onCreateTerminal(); }}>Terminal</NewTabMenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function ShortcutIconButton({ children, disabled, onClick, title, shortcut, showShortcut }: { children: ReactNode; disabled?: boolean; onClick: () => void; title: string; shortcut: MacShortcutDefinition; showShortcut: boolean }) {
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50"
        title={`${title} (${shortcut.shortcut})`}
        aria-label={title}
      >
        {children}
      </button>
      <ShortcutTooltip shortcut={shortcut.shortcut} label={shortcut.label} show={showShortcut && !disabled} />
    </span>
  );
}

function NewTabMenuItem({ icon, children, disabled, onClick }: { icon: ReactNode; children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50 md:min-h-0 md:text-xs"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

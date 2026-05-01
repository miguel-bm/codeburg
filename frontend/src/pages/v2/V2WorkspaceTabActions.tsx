import { useState, type ReactNode } from 'react';
import { MessageSquarePlus, PlusCircle, SquareTerminal } from 'lucide-react';

export function WorkspaceNewTabIconActions({
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
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        disabled={createConversationPending}
        onClick={onCreateConversation}
        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50"
        title="New conversation in this workspace"
        aria-label="New conversation in this workspace"
      >
        <MessageSquarePlus size={15} />
      </button>
      <button
        type="button"
        disabled={createTerminalDisabled || createTerminalPending}
        onClick={onCreateTerminal}
        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50"
        title="New terminal in this workspace"
        aria-label="New terminal in this workspace"
      >
        <SquareTerminal size={15} />
      </button>
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

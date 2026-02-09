import { useEffect } from 'react';

interface TerminalContextMenuProps {
  x: number;
  y: number;
  hasSelection: boolean;
  onClose: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onClear: () => void;
  onReset: () => void;
  onScrollToBottom: () => void;
}

export function TerminalContextMenu({
  x,
  y,
  hasSelection,
  onClose,
  onCopy,
  onPaste,
  onSelectAll,
  onClearSelection,
  onClear,
  onReset,
  onScrollToBottom,
}: TerminalContextMenuProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const menuStyle = {
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 240),
  };

  return (
    <>
      <div className="fixed inset-0 z-[120]" onClick={onClose} />
      <div
        className="fixed z-[120] bg-elevated border border-subtle rounded-lg shadow-lg min-w-[190px] py-1"
        style={menuStyle}
      >
        <button
          onClick={() => { onCopy(); onClose(); }}
          disabled={!hasSelection}
          className={`w-full px-3 py-2 text-left text-xs transition-colors ${
            hasSelection ? 'hover:bg-tertiary' : 'text-dim cursor-not-allowed'
          }`}
        >
          Copy Selection
        </button>
        <button
          onClick={() => { onPaste(); onClose(); }}
          className="w-full px-3 py-2 text-left text-xs hover:bg-tertiary transition-colors"
        >
          Paste
        </button>
        <button
          onClick={() => { onSelectAll(); onClose(); }}
          className="w-full px-3 py-2 text-left text-xs hover:bg-tertiary transition-colors"
        >
          Select All
        </button>
        <button
          onClick={() => { onClearSelection(); onClose(); }}
          disabled={!hasSelection}
          className={`w-full px-3 py-2 text-left text-xs transition-colors ${
            hasSelection ? 'hover:bg-tertiary' : 'text-dim cursor-not-allowed'
          }`}
        >
          Clear Selection
        </button>
        <div className="border-t border-subtle my-1" />
        <button
          onClick={() => { onScrollToBottom(); onClose(); }}
          className="w-full px-3 py-2 text-left text-xs hover:bg-tertiary transition-colors"
        >
          Scroll to Bottom
        </button>
        <button
          onClick={() => { onClear(); onClose(); }}
          className="w-full px-3 py-2 text-left text-xs hover:bg-tertiary transition-colors"
        >
          Clear Terminal
        </button>
        <button
          onClick={() => { onReset(); onClose(); }}
          className="w-full px-3 py-2 text-left text-xs hover:bg-tertiary transition-colors"
        >
          Reset Terminal
        </button>
      </div>
    </>
  );
}

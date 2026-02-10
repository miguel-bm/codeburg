import { useKeyboardNav } from '../../hooks/useKeyboardNav';

interface Props {
  page: 'dashboard' | 'taskDetail';
  onClose: () => void;
}

interface ShortcutEntry {
  key: string;
  action: string;
}

interface ShortcutSection {
  title: string;
  shortcuts: ShortcutEntry[];
}

const dashboardShortcuts: ShortcutSection[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { key: 'arrows / hjkl', action: 'move focus between cards' },
      { key: 'Enter', action: 'open focused task' },
      { key: 'Escape', action: 'clear focus' },
      { key: '1-4', action: 'jump to column' },
    ],
  },
  {
    title: 'Sidebar',
    shortcuts: [
      { key: '\u2190 at col 1', action: 'focus sidebar' },
      { key: '\u2191/\u2193 (k/j)', action: 'navigate items' },
      { key: 'Enter', action: 'select project / open task' },
      { key: '\u2192 / Escape', action: 'return to kanban' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { key: 'Shift+arrow (H/L)', action: 'move card to adjacent column' },
      { key: 'Shift+Up/Down (K/J)', action: 'reorder card within column' },
      { key: 'x', action: 'toggle pin on focused task' },
      { key: 'n', action: 'new task' },
      { key: 'p', action: 'new project' },
      { key: '?', action: 'toggle help' },
    ],
  },
];

const taskDetailShortcuts: ShortcutSection[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { key: 'Escape', action: 'back to dashboard' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { key: 's', action: 'start session' },
      { key: 'Ctrl+] / Ctrl+[', action: 'next / previous session tab (configurable)' },
      { key: 'Alt+Shift+→ / Alt+Shift+←', action: 'always available for tab switching' },
      { key: '?', action: 'toggle help' },
    ],
  },
];

const shortcutData: Record<string, ShortcutSection[]> = {
  dashboard: dashboardShortcuts,
  taskDetail: taskDetailShortcuts,
};

export function HelpOverlay({ page, onClose }: Props) {
  useKeyboardNav({
    keyMap: {
      Escape: onClose,
      '?': onClose,
    },
  });

  const sections = shortcutData[page];

  return (
    <div
      className="fixed inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-elevated border border-subtle rounded-xl shadow-lg w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-subtle">
          <h2 className="text-sm font-medium">Keyboard Shortcuts</h2>
        </div>
        <div className="p-4 space-y-4">
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-xs font-medium uppercase tracking-wider text-dim mb-2">{section.title}</h3>
              <div className="space-y-1">
                {section.shortcuts.map((s) => (
                  <div key={s.key} className="flex items-center justify-between text-sm">
                    <kbd className="text-accent text-xs px-1.5 py-0.5 border border-subtle bg-primary rounded-md min-w-[80px]">
                      {s.key}
                    </kbd>
                    <span className="text-dim text-xs">{s.action}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-subtle">
          <span className="text-xs text-dim">press ? or Esc to close</span>
        </div>
      </div>
    </div>
  );
}

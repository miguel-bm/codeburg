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
    title: 'navigation',
    shortcuts: [
      { key: 'arrows / hjkl', action: 'move focus between cards' },
      { key: 'Enter', action: 'open focused task' },
      { key: 'Escape', action: 'clear focus' },
      { key: '1-4', action: 'jump to column' },
    ],
  },
  {
    title: 'actions',
    shortcuts: [
      { key: 'Shift+arrow', action: 'move card to adjacent column' },
      { key: 'n', action: 'new task' },
      { key: 'p', action: 'new project' },
      { key: 'f', action: 'focus project filter' },
      { key: '?', action: 'toggle help' },
    ],
  },
];

const taskDetailShortcuts: ShortcutSection[] = [
  {
    title: 'navigation',
    shortcuts: [
      { key: 'Escape', action: 'back to dashboard' },
      { key: '1', action: 'agent panel' },
      { key: '2', action: 'justfile panel' },
      { key: '3', action: 'tunnel panel' },
    ],
  },
  {
    title: 'actions',
    shortcuts: [
      { key: 's', action: 'start session' },
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
      className="fixed inset-0 bg-[var(--color-bg-primary)]/90 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-secondary border border-subtle w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-subtle">
          <h2 className="text-sm text-accent">// keyboard_shortcuts</h2>
        </div>
        <div className="p-4 space-y-4">
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-xs text-dim mb-2">// {section.title}</h3>
              <div className="space-y-1">
                {section.shortcuts.map((s) => (
                  <div key={s.key} className="flex items-center justify-between text-sm">
                    <kbd className="text-accent text-xs px-1.5 py-0.5 border border-subtle bg-primary min-w-[80px]">
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

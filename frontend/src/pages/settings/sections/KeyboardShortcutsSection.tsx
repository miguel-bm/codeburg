import { Keyboard } from 'lucide-react';
import { workspaceShortcutDefinitions, type MacShortcutDefinition } from '../../../hooks/useMacTabShortcuts';
import { FieldLabel, FieldRow, SectionBody, SectionCard, SectionHeader } from '../../../components/ui/settings';
import {
  getLayoutDefaults,
  NEXT_SESSION_SHORTCUT_OPTIONS,
  PREV_SESSION_SHORTCUT_OPTIONS,
  resolveLayout,
  useSessionShortcutSettings,
} from '../../../stores/keyboard';

export function KeyboardShortcutsSection() {
  const shortcuts = useSessionShortcutSettings();
  const resolvedLayout = resolveLayout(shortcuts.layout);
  const recommended = getLayoutDefaults(shortcuts.layout);
  const workspaceShortcuts = workspaceShortcutDefinitions(9);

  const selectClass =
    'bg-primary border border-subtle rounded-md text-sm px-2.5 py-1.5 focus:outline-none focus:border-accent min-w-[220px]';

  return (
    <SectionCard>
      <SectionHeader
        title="Keyboard"
        description="Session tab switching shortcuts and layout defaults"
        icon={<Keyboard size={15} />}
        action={
          <button
            onClick={shortcuts.reset}
            className="text-xs text-dim hover:text-accent transition-colors whitespace-nowrap mt-0.5"
          >
            Reset defaults
          </button>
        }
      />
      <SectionBody bordered>
        <div className="mb-3 rounded-lg border border-[var(--color-card-border)] bg-secondary/45 px-3 py-2 text-xs leading-5 text-dim">
          Shortcut editing is only available for classic session tab cycling today. Workspace shortcuts are shown for reference and may become editable later.
        </div>
        <ShortcutReferenceSection title="Workspace tabs" availability="Mac desktop app only" shortcuts={workspaceShortcuts} />
      </SectionBody>

      <SectionBody bordered>
        <FieldRow>
          <FieldLabel label="Keyboard layout" description="Select defaults that fit your physical key layout" />
          <select
            value={shortcuts.layout}
            onChange={(e) => shortcuts.setLayout(e.target.value as 'auto' | 'intl' | 'es')}
            className={selectClass}
          >
            <option value="auto">Auto detect</option>
            <option value="intl">US / International</option>
            <option value="es">Spanish (ES)</option>
          </select>
        </FieldRow>
        <p className="text-xs text-dim mt-3">
          Active layout preset:{' '}
          <span className="text-[var(--color-text-primary)]">{resolvedLayout === 'es' ? 'Spanish (ES)' : 'US / International'}</span>
        </p>
      </SectionBody>

      <SectionBody bordered>
        <ShortcutReferenceSection
          title="Classic session tabs"
          availability="Web and desktop"
          shortcuts={[
            { id: 'classic.nextSession', label: 'Next session tab', shortcut: shortcutLabel(shortcuts.nextSession), key: shortcuts.nextSession },
            { id: 'classic.prevSession', label: 'Previous session tab', shortcut: shortcutLabel(shortcuts.prevSession), key: shortcuts.prevSession },
          ]}
        />
      </SectionBody>

      <SectionBody bordered>
        <FieldRow>
          <FieldLabel label="Next session tab" description="Cycle forward through session tabs" />
          <select
            value={shortcuts.nextSession}
            onChange={(e) => shortcuts.setShortcut('nextSession', e.target.value)}
            className={selectClass}
          >
            {NEXT_SESSION_SHORTCUT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldRow>
      </SectionBody>

      <SectionBody>
        <FieldRow>
          <FieldLabel label="Previous session tab" description="Cycle backward through session tabs" />
          <select
            value={shortcuts.prevSession}
            onChange={(e) => shortcuts.setShortcut('prevSession', e.target.value)}
            className={selectClass}
          >
            {PREV_SESSION_SHORTCUT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldRow>
        <p className="text-xs text-dim mt-3">
          Recommended for this layout:{' '}
          <span className="text-[var(--color-text-primary)]">{recommended.nextSession}</span> /{' '}
          <span className="text-[var(--color-text-primary)]">{recommended.prevSession}</span>
        </p>
      </SectionBody>
    </SectionCard>
  );
}

function ShortcutReferenceSection({ title, availability, shortcuts }: { title: string; availability: string; shortcuts: MacShortcutDefinition[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">{title}</h3>
        <span className="shrink-0 rounded-full bg-tertiary px-2 py-0.5 text-[10px] font-medium text-dim">{availability}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-[var(--color-card-border)]">
        {shortcuts.map((shortcut) => (
          <div key={shortcut.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-subtle px-3 py-2 last:border-b-0">
            <div className="min-w-0 text-sm text-[var(--color-text-primary)]">{shortcut.label}</div>
            <kbd className="rounded-md border border-subtle bg-primary px-2 py-1 font-mono text-xs text-accent shadow-sm">{shortcut.shortcut}</kbd>
          </div>
        ))}
      </div>
    </div>
  );
}

function shortcutLabel(value: string): string {
  return value
    .replace(/ArrowRight/g, '→')
    .replace(/ArrowLeft/g, '←')
    .replace(/\+/g, ' + ');
}

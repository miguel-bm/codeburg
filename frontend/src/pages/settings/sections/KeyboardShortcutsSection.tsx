import { Keyboard } from 'lucide-react';
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

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun, SunMoon } from 'lucide-react';
import { FieldLabel, FieldRow, SectionBody, SectionCard, SectionHeader } from '../../../components/ui/settings';
import { getResolvedTheme, getThemePreference, setThemePreference, subscribeToThemeChange } from '../../../lib/theme';
import type { ThemePreference } from '../../../lib/theme';

const THEME_OPTIONS = [
  { value: 'system', label: 'System', description: 'Follow your OS appearance setting', Icon: Monitor, activeIconClass: 'text-sky-500' },
  { value: 'dark', label: 'Dark', description: 'Always use dark mode', Icon: Moon, activeIconClass: 'text-indigo-400' },
  { value: 'light', label: 'Light', description: 'Always use light mode', Icon: Sun, activeIconClass: 'text-amber-500' },
] satisfies Array<{
  value: ThemePreference;
  label: string;
  description: string;
  Icon: typeof SunMoon;
  activeIconClass: string;
}>;

export function AppearanceSection() {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => getThemePreference());
  const resolvedTheme = getResolvedTheme(themePreference);
  const activeThemeOption = THEME_OPTIONS.find((option) => option.value === themePreference);
  const activeThemeIndex = Math.max(0, THEME_OPTIONS.findIndex((option) => option.value === themePreference));

  useEffect(
    () =>
      subscribeToThemeChange(({ preference }) => {
        setThemePreferenceState(preference);
      }),
    [],
  );

  const handleThemeChange = (value: ThemePreference) => {
    setThemePreferenceState(value);
    setThemePreference(value);
  };

  return (
    <SectionCard>
      <SectionHeader
        title="Appearance"
        description="Switch between dark and light themes"
        icon={<SunMoon size={15} />}
      />
      <SectionBody>
        <FieldRow>
          <FieldLabel label="Theme" description={`Current mode: ${resolvedTheme}`} />
          <div
            role="radiogroup"
            aria-label="Theme mode"
            className="relative inline-grid rounded-xl border border-subtle bg-primary p-1"
            style={{ gridTemplateColumns: `repeat(${THEME_OPTIONS.length}, minmax(0, 1fr))` }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-1 left-1 rounded-lg border border-accent/45 bg-accent/15 shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                width: `calc((100% - 0.5rem) / ${THEME_OPTIONS.length})`,
                transform: `translateX(${activeThemeIndex * 100}%)`,
              }}
            />
            {THEME_OPTIONS.map((option) => {
              const active = option.value === themePreference;
              const Icon = option.Icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => handleThemeChange(option.value)}
                  className={`relative z-10 flex min-w-[92px] items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                    active ? 'text-[var(--color-text-primary)]' : 'text-dim hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  <Icon
                    size={14}
                    className={`transition-all duration-300 ${active ? `scale-110 ${option.activeIconClass}` : 'scale-100 text-dim'}`}
                  />
                  <span className={`transition-all duration-300 ${active ? 'opacity-100' : 'opacity-90'}`}>{option.label}</span>
                </button>
              );
            })}
          </div>
        </FieldRow>
        <p className="text-xs text-dim mt-3">{activeThemeOption?.description}</p>
      </SectionBody>
    </SectionCard>
  );
}

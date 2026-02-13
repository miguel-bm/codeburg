import { Terminal } from 'lucide-react';
import { FieldLabel, FieldRow, SectionBody, SectionCard, SectionHeader, Toggle } from '../../../components/ui/settings';
import { useTerminalSettings } from '../../../stores/terminal';
import type { CursorStyle } from '../../../stores/terminal';

function TerminalCursor({ style, blink }: { style: CursorStyle; blink: boolean }) {
  const blinkClass = blink ? 'animate-blink' : '';

  if (style === 'block') {
    return (
      <span
        className={`inline-block w-[0.6em] h-[1.15em] align-text-bottom ${blinkClass}`}
        style={{ backgroundColor: 'var(--color-text-primary)' }}
      />
    );
  }
  if (style === 'underline') {
    return (
      <span
        className={`inline-block w-[0.6em] h-[2px] align-baseline ${blinkClass}`}
        style={{ backgroundColor: 'var(--color-text-primary)' }}
      />
    );
  }
  return (
    <span
      className={`inline-block w-[2px] h-[1.15em] align-text-bottom ${blinkClass}`}
      style={{ backgroundColor: 'var(--color-text-primary)' }}
    />
  );
}

function CursorPreview({ style, active, blink }: { style: CursorStyle; active: boolean; blink: boolean }) {
  const color = active ? 'var(--color-accent)' : 'var(--color-text-dim)';
  const blinkClass = blink && active ? 'animate-blink' : '';

  return (
    <div className="flex items-end h-6 font-mono text-base leading-none" aria-hidden>
      <span style={{ color }} className="opacity-70">
        A
      </span>
      {style === 'block' && (
        <span
          className={`inline-block w-[0.6em] h-[1.1em] -mb-px ${blinkClass}`}
          style={{ backgroundColor: color }}
        />
      )}
      {style === 'underline' && (
        <span
          className={`inline-block w-[0.6em] h-[2px] mb-0 ${blinkClass}`}
          style={{ backgroundColor: color }}
        />
      )}
      {style === 'bar' && (
        <span
          className={`inline-block w-[2px] h-[1.1em] -mb-px ${blinkClass}`}
          style={{ backgroundColor: color }}
        />
      )}
      <span style={{ color }} className="opacity-70">
        b
      </span>
    </div>
  );
}

const CURSOR_STYLES: { value: CursorStyle; label: string }[] = [
  { value: 'block', label: 'Block' },
  { value: 'underline', label: 'Underline' },
  { value: 'bar', label: 'Bar' },
];

export function TerminalSettingsSection() {
  const settings = useTerminalSettings();

  return (
    <SectionCard>
      <SectionHeader
        title="Terminal"
        description="Appearance and behavior for terminal sessions"
        icon={<Terminal size={15} />}
        action={
          <button
            onClick={settings.reset}
            className="text-xs text-dim hover:text-accent transition-colors whitespace-nowrap mt-0.5"
          >
            Reset defaults
          </button>
        }
      />

      <SectionBody bordered>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[var(--color-text-primary)]">Font size</span>
          <span className="text-sm font-mono text-accent tabular-nums">{settings.fontSize}px</span>
        </div>
        <input
          type="range"
          min={8}
          max={24}
          step={1}
          value={settings.fontSize}
          onChange={(e) => settings.set('fontSize', Number(e.target.value))}
          className="w-full accent-[var(--color-accent)]"
        />
      </SectionBody>

      <SectionBody bordered>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-primary)]">Cursor style</span>
          <div className="flex gap-1">
            {CURSOR_STYLES.map((style) => (
              <button
                key={style.value}
                onClick={() => settings.set('cursorStyle', style.value)}
                className={`flex flex-col items-center gap-1.5 px-3 py-2 text-xs rounded-md border transition-colors ${
                  settings.cursorStyle === style.value
                    ? 'bg-accent/15 border-accent text-accent'
                    : 'bg-primary border-subtle text-dim hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-dim)]'
                }`}
              >
                <CursorPreview style={style.value} active={settings.cursorStyle === style.value} blink={settings.cursorBlink} />
                <span>{style.label}</span>
              </button>
            ))}
          </div>
        </div>
      </SectionBody>

      <SectionBody bordered>
        <FieldRow>
          <FieldLabel label="Cursor blink" description="Animate the cursor on and off" />
          <Toggle checked={settings.cursorBlink} onChange={(v) => settings.set('cursorBlink', v)} />
        </FieldRow>
      </SectionBody>

      <SectionBody bordered>
        <div
          className="px-4 py-3 bg-primary border border-subtle rounded-md font-mono leading-relaxed"
          style={{ fontSize: `${settings.fontSize}px` }}
        >
          <div>
            <span className="text-[var(--color-success)]">~</span>
            <span className="text-dim mx-1.5">$</span>
            <span className="text-[var(--color-text-primary)]">claude &quot;fix the auth bug&quot;</span>
          </div>
          <div className="text-dim mt-0.5">
            {'// 3 files changed, '}
            <span className="text-[var(--color-success)]">+42</span>{' '}
            <span className="text-[var(--color-error)]">-15</span>
          </div>
          <div className="mt-1">
            <span className="text-[var(--color-success)]">~</span>
            <span className="text-dim mx-1.5">$</span>
            <TerminalCursor style={settings.cursorStyle} blink={settings.cursorBlink} />
          </div>
        </div>
      </SectionBody>

      <SectionBody bordered>
        <div className="flex items-center justify-between mb-3">
          <FieldLabel
            label="Scrollback lines"
            description="How many lines of output to keep in memory for scrolling back"
          />
          <span className="text-sm font-mono text-accent tabular-nums">{settings.scrollback.toLocaleString()}</span>
        </div>
        <input
          type="range"
          min={1000}
          max={50000}
          step={1000}
          value={settings.scrollback}
          onChange={(e) => settings.set('scrollback', Number(e.target.value))}
          className="w-full accent-[var(--color-accent)]"
        />
        <div className="flex justify-between text-xs text-dim mt-1">
          <span>1,000</span>
          <span>50,000</span>
        </div>
      </SectionBody>

      <SectionBody>
        <div className="space-y-0">
          <FieldRow>
            <FieldLabel label="Clickable links" description="URLs in terminal output become clickable" />
            <Toggle checked={settings.webLinks} onChange={(v) => settings.set('webLinks', v)} />
          </FieldRow>
          <FieldRow>
            <FieldLabel label="GPU rendering" description="WebGL acceleration for better performance" />
            <Toggle checked={settings.webgl} onChange={(v) => settings.set('webgl', v)} />
          </FieldRow>
        </div>
        <p className="text-xs text-dim mt-4">Changes apply to new terminal connections.</p>
      </SectionBody>
    </SectionCard>
  );
}

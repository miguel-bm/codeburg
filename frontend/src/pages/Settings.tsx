import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ChevronLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { authApi } from '../api';
import { useAuthStore } from '../stores/auth';
import { useTerminalSettings } from '../stores/terminal';
import type { CursorStyle } from '../stores/terminal';

export function Settings() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  return (
    <Layout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <header className="bg-secondary border-b border-subtle px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="text-dim hover:text-[var(--color-text-primary)] transition-colors text-sm inline-flex items-center gap-1"
            >
              <ChevronLeft size={16} />
              Back
            </button>
            <div className="w-px h-4 bg-[var(--color-border)]" />
            <h1 className="text-sm font-semibold tracking-wide">Settings</h1>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
            <TerminalSettingsSection />
            <PasswordSection />
            <DangerZone onLogout={logout} />
          </div>
        </div>
      </div>
    </Layout>
  );
}

/* ─── Shared Components ──────────────────────────────────────────────── */

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="border border-subtle rounded-md bg-secondary overflow-hidden">
      {children}
    </section>
  );
}

function SectionHeader({ title, description, action }: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4 border-b border-subtle flex items-start justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h2>
        {description && (
          <p className="text-xs text-dim mt-0.5">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

function SectionBody({ children, className = '', bordered = false }: { children: React.ReactNode; className?: string; bordered?: boolean }) {
  return (
    <div className={`px-5 py-4 ${bordered ? 'border-b border-subtle' : ''} ${className}`}>
      {children}
    </div>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-subtle last:border-b-0">
      {children}
    </div>
  );
}

function FieldLabel({ label, description }: { label: string; description?: string }) {
  return (
    <div className="min-w-0">
      <span className="text-sm text-[var(--color-text-primary)]">{label}</span>
      {description && (
        <span className="block text-xs text-dim mt-0.5">{description}</span>
      )}
    </div>
  );
}

/* ─── Toggle Switch ──────────────────────────────────────────────────── */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-[22px] border rounded-full transition-all duration-200 flex-shrink-0 ${
        checked
          ? 'bg-accent border-accent'
          : 'bg-tertiary border-subtle'
      }`}
    >
      <span
        className={`absolute top-[3px] w-3.5 h-3.5 rounded-full transition-all duration-200 ${
          checked
            ? 'left-[20px] bg-white'
            : 'left-[3px] bg-[var(--color-text-dim)]'
        }`}
      />
    </button>
  );
}

/* ─── Terminal Cursor (inline in preview) ─────────────────────────────── */

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
  // bar
  return (
    <span
      className={`inline-block w-[2px] h-[1.15em] align-text-bottom ${blinkClass}`}
      style={{ backgroundColor: 'var(--color-text-primary)' }}
    />
  );
}

/* ─── Cursor Preview (style selector buttons) ────────────────────────── */

function CursorPreview({ style, active, blink }: { style: CursorStyle; active: boolean; blink: boolean }) {
  const color = active ? 'var(--color-accent)' : 'var(--color-text-dim)';
  const blinkClass = blink && active ? 'animate-blink' : '';

  return (
    <div className="flex items-end h-6 font-mono text-base leading-none" aria-hidden>
      <span style={{ color }} className="opacity-70">A</span>
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
      <span style={{ color }} className="opacity-70">b</span>
    </div>
  );
}

/* ─── Terminal Settings ──────────────────────────────────────────────── */

const CURSOR_STYLES: { value: CursorStyle; label: string }[] = [
  { value: 'block', label: 'Block' },
  { value: 'underline', label: 'Underline' },
  { value: 'bar', label: 'Bar' },
];

function TerminalSettingsSection() {
  const settings = useTerminalSettings();

  return (
    <SectionCard>
      <SectionHeader
        title="Terminal"
        description="Appearance and behavior for terminal sessions"
        action={
          <button
            onClick={settings.reset}
            className="text-xs text-dim hover:text-accent transition-colors whitespace-nowrap mt-0.5"
          >
            Reset defaults
          </button>
        }
      />

      {/* Font Size + Terminal Preview */}
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
          className="w-full accent-[var(--color-accent)] mb-3"
        />
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
            <span className="text-[var(--color-success)]">+42</span>
            {' '}
            <span className="text-[var(--color-error)]">-15</span>
          </div>
          <div className="mt-1">
            <span className="text-[var(--color-success)]">~</span>
            <span className="text-dim mx-1.5">$</span>
            <TerminalCursor style={settings.cursorStyle} blink={settings.cursorBlink} />
          </div>
        </div>
      </SectionBody>

      {/* Scrollback */}
      <SectionBody bordered>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[var(--color-text-primary)]">Scrollback lines</span>
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

      {/* Cursor Style */}
      <SectionBody bordered>
        <span className="text-sm text-[var(--color-text-primary)]">Cursor style</span>
        <div className="flex gap-2 mt-3">
          {CURSOR_STYLES.map((s) => (
            <button
              key={s.value}
              onClick={() => settings.set('cursorStyle', s.value)}
              className={`flex-1 flex flex-col items-center gap-2 px-3 py-3 text-xs rounded-md border transition-colors ${
                settings.cursorStyle === s.value
                  ? 'bg-accent/15 border-accent text-accent'
                  : 'bg-primary border-subtle text-dim hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-dim)]'
              }`}
            >
              <CursorPreview style={s.value} active={settings.cursorStyle === s.value} blink={settings.cursorBlink} />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </SectionBody>

      {/* Toggles */}
      <SectionBody>
        <div className="space-y-0">
          <FieldRow>
            <FieldLabel label="Cursor blink" description="Animate the cursor on and off" />
            <Toggle checked={settings.cursorBlink} onChange={(v) => settings.set('cursorBlink', v)} />
          </FieldRow>
          <FieldRow>
            <FieldLabel label="Clickable links" description="URLs in terminal output become clickable" />
            <Toggle checked={settings.webLinks} onChange={(v) => settings.set('webLinks', v)} />
          </FieldRow>
          <FieldRow>
            <FieldLabel label="GPU rendering" description="WebGL acceleration for better performance" />
            <Toggle checked={settings.webgl} onChange={(v) => settings.set('webgl', v)} />
          </FieldRow>
        </div>
        <p className="text-xs text-dim mt-4">
          Changes apply to new terminal connections.
        </p>
      </SectionBody>
    </SectionCard>
  );
}

/* ─── Password Section ───────────────────────────────────────────────── */

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: () => authApi.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setTimeout(() => setSuccess(false), 3000);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to change password');
      setSuccess(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    mutation.mutate();
  };

  const inputClass =
    'block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md text-sm focus:outline-none focus:border-accent transition-colors';

  return (
    <SectionCard>
      <SectionHeader
        title="Security"
        description="Manage your account password"
      />
      <SectionBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-[var(--color-error)]/8 border border-[var(--color-error)]/30 text-sm text-[var(--color-error)]">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-[var(--color-success)]/8 border border-[var(--color-success)]/30 text-sm text-[var(--color-success)]">
              <CheckCircle2 size={16} className="flex-shrink-0" />
              Password changed successfully
            </div>
          )}

          <div>
            <label className="block text-sm text-dim mb-1.5">Current password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div className="h-px bg-[var(--color-border)] -mx-5" />

          <div>
            <label className="block text-sm text-dim mb-1.5">New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
              required
              minLength={8}
            />
            <p className="text-xs text-dim mt-1">Minimum 8 characters</p>
          </div>
          <div>
            <label className="block text-sm text-dim mb-1.5">Confirm new password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
              required
              minLength={8}
            />
          </div>

          <div className="pt-1">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-5 py-2 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              {mutation.isPending ? 'Changing...' : 'Update password'}
            </button>
          </div>
        </form>
      </SectionBody>
    </SectionCard>
  );
}

/* ─── Danger Zone ────────────────────────────────────────────────────── */

function DangerZone({ onLogout }: { onLogout: () => void }) {
  return (
    <section className="border border-[var(--color-error)]/25 rounded-md overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Log out</h2>
          <p className="text-xs text-dim mt-0.5">End your current session</p>
        </div>
        <button
          onClick={onLogout}
          className="px-4 py-1.5 border border-[var(--color-error)]/40 text-[var(--color-error)] rounded-md text-sm hover:bg-[var(--color-error)]/10 transition-colors"
        >
          Log out
        </button>
      </div>
    </section>
  );
}

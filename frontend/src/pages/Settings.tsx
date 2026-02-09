import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
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
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-dim hover:text-[var(--color-text-primary)] transition-colors"
            >
              &lt; back
            </button>
            <h1 className="text-lg font-medium">Settings</h1>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-md space-y-8">
            {/* Terminal Settings */}
            <TerminalSettingsForm />

            {/* Password Change */}
            <PasswordChangeForm />

            {/* Logout */}
            <div>
              <h2 className="text-xs font-medium uppercase tracking-wider text-dim mb-3">Session</h2>
              <button
                onClick={logout}
                className="px-4 py-2 bg-[var(--color-error)]/10 text-[var(--color-error)] rounded-md text-sm hover:bg-[var(--color-error)]/20 transition-colors"
              >
                logout
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

const CURSOR_STYLES: { value: CursorStyle; label: string }[] = [
  { value: 'block', label: 'block' },
  { value: 'underline', label: 'underline' },
  { value: 'bar', label: 'bar' },
];

function TerminalSettingsForm() {
  const settings = useTerminalSettings();

  const selectClass =
    'block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent appearance-none';

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-dim">Terminal</h2>
        <button
          onClick={settings.reset}
          className="text-xs text-dim hover:text-[var(--color-text-primary)] transition-colors"
        >
          reset defaults
        </button>
      </div>
      <div className="space-y-3">
        {/* Font Size */}
        <div>
          <label className="flex items-center justify-between text-sm text-dim mb-1">
            <span>font size</span>
            <span className="text-accent">{settings.fontSize}px</span>
          </label>
          <input
            type="range"
            min={8}
            max={24}
            step={1}
            value={settings.fontSize}
            onChange={(e) => settings.set('fontSize', Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
          />
          <div
            className="mt-2 px-3 py-2 bg-[#0a0a0a] border border-subtle rounded-md overflow-hidden"
            style={{ fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace', fontSize: `${settings.fontSize}px` }}
          >
            <span className="text-[#22c55e]">$</span>{' '}
            <span style={{ color: '#e0e0e0' }}>claude &quot;fix the auth bug&quot;</span>
            {'\n'}
            <span style={{ color: '#525252' }}>// 3 files changed, +42 -15</span>
          </div>
        </div>

        {/* Scrollback */}
        <div>
          <label className="flex items-center justify-between text-sm text-dim mb-1">
            <span>scrollback lines</span>
            <span className="text-accent">{settings.scrollback.toLocaleString()}</span>
          </label>
          <input
            type="range"
            min={1000}
            max={50000}
            step={1000}
            value={settings.scrollback}
            onChange={(e) => settings.set('scrollback', Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
          />
        </div>

        {/* Cursor Style */}
        <div>
          <label className="block text-sm text-dim mb-1">cursor style</label>
          <select
            value={settings.cursorStyle}
            onChange={(e) => settings.set('cursorStyle', e.target.value as CursorStyle)}
            className={selectClass}
          >
            {CURSOR_STYLES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Toggles */}
        <div className="space-y-2 pt-1">
          <ToggleRow
            label="cursor blink"
            checked={settings.cursorBlink}
            onChange={(v) => settings.set('cursorBlink', v)}
          />
          <ToggleRow
            label="clickable links"
            description="URLs in terminal output become clickable"
            checked={settings.webLinks}
            onChange={(v) => settings.set('webLinks', v)}
          />
          <ToggleRow
            label="GPU rendering"
            description="WebGL acceleration (faster, especially on mobile)"
            checked={settings.webgl}
            onChange={(v) => settings.set('webgl', v)}
          />
        </div>

        <p className="text-xs text-dim pt-1">
          changes apply to new terminal connections
        </p>
      </div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <div>
        <span className="text-sm text-dim group-hover:text-[var(--color-text-primary)] transition-colors">
          {label}
        </span>
        {description && (
          <span className="block text-xs text-dim opacity-60">{description}</span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 border rounded-full transition-colors ${
          checked
            ? 'bg-accent border-accent'
            : 'bg-[#1a1a1a] border-subtle'
        }`}
      >
        <span
          className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-[var(--color-bg-primary)] transition-transform ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  );
}

function PasswordChangeForm() {
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

  return (
    <div>
      <h2 className="text-xs font-medium uppercase tracking-wider text-dim mb-3">Change Password</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="border border-[var(--color-error)] rounded-md p-3 text-sm text-[var(--color-error)]">
            {error}
          </div>
        )}
        {success && (
          <div className="border border-[var(--color-success)] rounded-md p-3 text-sm text-[var(--color-success)]">
            password changed successfully
          </div>
        )}
        <div>
          <label className="block text-sm text-dim mb-1">current password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
            required
          />
        </div>
        <div>
          <label className="block text-sm text-dim mb-1">new password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
            required
            minLength={8}
          />
        </div>
        <div>
          <label className="block text-sm text-dim mb-1">confirm new password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
            required
            minLength={8}
          />
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="px-4 py-2 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
        >
          {mutation.isPending ? 'changing...' : 'change password'}
        </button>
      </form>
    </div>
  );
}

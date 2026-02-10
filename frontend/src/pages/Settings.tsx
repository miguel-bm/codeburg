import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { startRegistration } from '@simplewebauthn/browser';
import { ChevronLeft, AlertCircle, CheckCircle2, Fingerprint, Trash2, Pencil, Volume2, Bell, Terminal, Code2, Lock, Send, Keyboard } from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { authApi, preferencesApi } from '../api';
import type { EditorType } from '../api';
import { useAuthStore } from '../stores/auth';
import { useTerminalSettings } from '../stores/terminal';
import type { CursorStyle } from '../stores/terminal';
import {
  getLayoutDefaults,
  NEXT_SESSION_SHORTCUT_OPTIONS,
  PREV_SESSION_SHORTCUT_OPTIONS,
  resolveLayout,
  useSessionShortcutSettings,
} from '../stores/keyboard';
import { isNotificationSoundEnabled, setNotificationSoundEnabled, playNotificationSound } from '../lib/notificationSound';
import { SectionCard, SectionHeader, SectionBody, FieldRow, FieldLabel, Toggle } from '../components/ui/settings';

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
            <NotificationSection />
            <KeyboardShortcutsSection />
            <TerminalSettingsSection />
            <EditorSection />
            <PasskeySection />
            <TelegramSection />
            <PasswordSection />
            <DangerZone onLogout={logout} />
          </div>
        </div>
      </div>
    </Layout>
  );
}

/* ─── Terminal Cursor (inline in preview) ─────────────────────────────── */

function KeyboardShortcutsSection() {
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
          Active layout preset: <span className="text-[var(--color-text-primary)]">{resolvedLayout === 'es' ? 'Spanish (ES)' : 'US / International'}</span>
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
              <option key={option.value} value={option.value}>{option.label}</option>
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
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </FieldRow>
        <p className="text-xs text-dim mt-3">
          Recommended for this layout: <span className="text-[var(--color-text-primary)]">{recommended.nextSession}</span> / <span className="text-[var(--color-text-primary)]">{recommended.prevSession}</span>
        </p>
      </SectionBody>
    </SectionCard>
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

/* ─── Notification Settings ──────────────────────────────────────────── */

function NotificationSection() {
  const [soundEnabled, setSoundEnabled] = useState(isNotificationSoundEnabled);

  const handleToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    setNotificationSoundEnabled(enabled);
  };

  return (
    <SectionCard>
      <SectionHeader
        title="Notifications"
        description="Alerts when an agent needs attention"
        icon={<Bell size={15} />}
      />
      <SectionBody>
        <FieldRow>
          <FieldLabel label="Sound alerts" description="Play a sound when an agent needs attention" />
          <div className="flex items-center gap-3">
            <button
              onClick={() => playNotificationSound()}
              className="p-1.5 text-dim hover:text-accent transition-colors rounded"
              title="Test sound"
            >
              <Volume2 size={16} />
            </button>
            <Toggle checked={soundEnabled} onChange={handleToggle} />
          </div>
        </FieldRow>
      </SectionBody>
    </SectionCard>
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

      {/* Font size */}
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

      {/* Cursor style */}
      <SectionBody bordered>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-primary)]">Cursor style</span>
          <div className="flex gap-1">
            {CURSOR_STYLES.map((s) => (
              <button
                key={s.value}
                onClick={() => settings.set('cursorStyle', s.value)}
                className={`flex flex-col items-center gap-1.5 px-3 py-2 text-xs rounded-md border transition-colors ${
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
        </div>
      </SectionBody>

      {/* Cursor blink */}
      <SectionBody bordered>
        <FieldRow>
          <FieldLabel label="Cursor blink" description="Animate the cursor on and off" />
          <Toggle checked={settings.cursorBlink} onChange={(v) => settings.set('cursorBlink', v)} />
        </FieldRow>
      </SectionBody>

      {/* Terminal Preview */}
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
          <FieldLabel label="Scrollback lines" description="How many lines of output to keep in memory for scrolling back" />
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

      {/* Other toggles */}
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
        <p className="text-xs text-dim mt-4">
          Changes apply to new terminal connections.
        </p>
      </SectionBody>
    </SectionCard>
  );
}

/* ─── Editor Section ─────────────────────────────────────────────────── */

const EDITOR_OPTIONS: { value: EditorType; label: string }[] = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'cursor', label: 'Cursor' },
];

function EditorSection() {
  const [editor, setEditor] = useState<EditorType>('vscode');
  const [sshHost, setSshHost] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    preferencesApi.getEditorConfig().then((cfg) => {
      setEditor(cfg.editor);
      setSshHost(cfg.sshHost ?? 'codeburg-server');
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const saveMutation = useMutation({
    mutationFn: () => preferencesApi.setEditorConfig({
      editor,
      sshHost: sshHost.trim() || null,
    }),
    onSuccess: () => {
      localStorage.setItem('editor_configured', '1');
      setSaved(true);
      setError('');
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaved(false);
    },
  });

  if (!loaded) return null;

  const inputClass =
    'block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md text-sm focus:outline-none focus:border-accent transition-colors';

  return (
    <SectionCard>
      <SectionHeader
        title="Editor"
        description="Open task worktrees in your editor"
        icon={<Code2 size={15} />}
      />
      <SectionBody bordered>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-primary)]">Editor</span>
          <div className="flex gap-1">
            {EDITOR_OPTIONS.map((e) => (
              <button
                key={e.value}
                onClick={() => setEditor(e.value)}
                className={`px-3 py-2 text-xs rounded-md border transition-colors ${
                  editor === e.value
                    ? 'bg-accent/15 border-accent text-accent'
                    : 'bg-primary border-subtle text-dim hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-dim)]'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      </SectionBody>
      <SectionBody>
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-[var(--color-error)]/8 border border-[var(--color-error)]/30 text-sm text-[var(--color-error)] mb-3">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}
        {saved && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-[var(--color-success)]/8 border border-[var(--color-success)]/30 text-sm text-[var(--color-success)] mb-3">
            <CheckCircle2 size={16} className="flex-shrink-0" />
            Saved
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-dim mb-1.5">SSH Host</label>
            <input
              type="text"
              value={sshHost}
              onChange={(e) => setSshHost(e.target.value)}
              className={inputClass}
              placeholder="e.g. codeburg-server"
            />
            <p className="text-xs text-dim mt-1.5">
              Host alias from your local <code className="px-1 py-0.5 bg-primary rounded">~/.ssh/config</code>. Leave empty for local mode.
            </p>
          </div>

          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="px-5 py-2 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
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
        title="Password"
        description="Manage your account password"
        icon={<Lock size={15} />}
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

/* ─── Passkey Section ─────────────────────────────────────────────────── */

function PasskeySection() {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const { data: passkeys = [], isLoading } = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => authApi.listPasskeys(),
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const resp = await authApi.passkeyRegisterBegin();
      // go-webauthn wraps in { publicKey: {...} }, @simplewebauthn expects the inner object
      const optionsJSON = (resp as any).publicKey ?? resp;
      const credential = await startRegistration({ optionsJSON });
      return authApi.passkeyRegisterFinish(credential);
    },
    onSuccess: (result) => {
      setSuccess(`Passkey "${result.name}" registered`);
      setError('');
      queryClient.invalidateQueries({ queryKey: ['passkeys'] });
      setTimeout(() => setSuccess(''), 3000);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to register passkey');
      setSuccess('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => authApi.deletePasskey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['passkeys'] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      authApi.updatePasskey(id, { name }),
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ['passkeys'] });
    },
  });

  const handleRename = (id: string) => {
    if (editName.trim()) {
      renameMutation.mutate({ id, name: editName.trim() });
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <SectionCard>
      <SectionHeader
        title="Passkeys"
        description="Passwordless sign-in with biometrics or security keys"
        icon={<Fingerprint size={15} />}
        action={
          <button
            onClick={() => registerMutation.mutate()}
            disabled={registerMutation.isPending}
            className="text-xs text-accent hover:text-accent-dim transition-colors whitespace-nowrap mt-0.5 inline-flex items-center gap-1"
          >
            <Fingerprint size={14} />
            {registerMutation.isPending ? 'Registering...' : 'Add passkey'}
          </button>
        }
      />
      <SectionBody>
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-[var(--color-error)]/8 border border-[var(--color-error)]/30 text-sm text-[var(--color-error)] mb-3">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-[var(--color-success)]/8 border border-[var(--color-success)]/30 text-sm text-[var(--color-success)] mb-3">
            <CheckCircle2 size={16} className="flex-shrink-0" />
            {success}
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-dim">Loading...</p>
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-dim">No passkeys registered. Add one to enable passwordless login.</p>
        ) : (
          <div className="space-y-0">
            {passkeys.map((pk) => (
              <div key={pk.id} className="flex items-center justify-between gap-3 py-3 border-b border-subtle last:border-b-0">
                <div className="min-w-0 flex-1">
                  {editingId === pk.id ? (
                    <form
                      onSubmit={(e) => { e.preventDefault(); handleRename(pk.id); }}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="px-2 py-1 text-sm border border-subtle bg-primary text-[var(--color-text-primary)] rounded focus:outline-none focus:border-accent"
                        autoFocus
                        onBlur={() => setEditingId(null)}
                        onKeyDown={(e) => e.key === 'Escape' && setEditingId(null)}
                      />
                    </form>
                  ) : (
                    <>
                      <span className="text-sm text-[var(--color-text-primary)]">{pk.name}</span>
                      <span className="block text-xs text-dim mt-0.5">
                        Created {formatDate(pk.createdAt)}
                        {pk.lastUsedAt && ` \u00b7 Last used ${formatDate(pk.lastUsedAt)}`}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => { setEditingId(pk.id); setEditName(pk.name); }}
                    className="p-1.5 text-dim hover:text-[var(--color-text-primary)] transition-colors rounded"
                    title="Rename"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(pk.id)}
                    disabled={deleteMutation.isPending}
                    className="p-1.5 text-dim hover:text-[var(--color-error)] transition-colors rounded"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionBody>
    </SectionCard>
  );
}

/* ─── Telegram Section ────────────────────────────────────────────────── */

function TelegramSection() {
  const [botToken, setBotToken] = useState('');
  const [telegramId, setTelegramId] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Load current values
  useEffect(() => {
    preferencesApi.get<string>('telegram_bot_token')
      .then((val) => { if (val) setBotToken(String(val)); })
      .catch(() => { /* not set yet */ });
    preferencesApi.get<string>('telegram_user_id')
      .then((val) => { if (val) setTelegramId(String(val)); })
      .catch(() => { /* not set yet */ });
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Save or delete bot token
      if (botToken.trim()) {
        await preferencesApi.set('telegram_bot_token', botToken.trim());
      } else {
        await preferencesApi.delete('telegram_bot_token').catch(() => {});
      }
      // Save or delete user ID
      if (telegramId.trim()) {
        await preferencesApi.set('telegram_user_id', telegramId.trim());
      } else {
        await preferencesApi.delete('telegram_user_id').catch(() => {});
      }
      // Restart the bot with the new token
      await authApi.restartTelegramBot();
    },
    onSuccess: () => {
      setSaved(true);
      setError('');
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaved(false);
    },
  });

  const inputClass =
    'block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md text-sm focus:outline-none focus:border-accent transition-colors';

  return (
    <SectionCard>
      <SectionHeader
        title="Telegram"
        description="Auto-login when opening Codeburg from Telegram"
        icon={<Send size={15} />}
        action={
          <button
            onClick={() => setShowSetup((v) => !v)}
            className="text-xs text-accent hover:text-accent-dim transition-colors whitespace-nowrap mt-0.5"
          >
            {showSetup ? 'Hide setup guide' : 'Setup guide'}
          </button>
        }
      />

      {showSetup && (
        <SectionBody bordered>
          <ol className="text-xs text-dim space-y-2 list-decimal list-inside">
            <li>Open Telegram and search for <span className="text-[var(--color-text-primary)]">@BotFather</span></li>
            <li>Send <code className="px-1 py-0.5 bg-primary rounded text-[var(--color-text-primary)]">/newbot</code> and follow the prompts to create a bot</li>
            <li>Copy the <span className="text-[var(--color-text-primary)]">bot token</span> BotFather gives you</li>
            <li>To find your user ID, send <code className="px-1 py-0.5 bg-primary rounded text-[var(--color-text-primary)]">/start</code> to <span className="text-[var(--color-text-primary)]">@userinfobot</span></li>
            <li>Enter both values below and save</li>
          </ol>
        </SectionBody>
      )}

      <SectionBody>
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-[var(--color-error)]/8 border border-[var(--color-error)]/30 text-sm text-[var(--color-error)] mb-3">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}
        {saved && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-[var(--color-success)]/8 border border-[var(--color-success)]/30 text-sm text-[var(--color-success)] mb-3">
            <CheckCircle2 size={16} className="flex-shrink-0" />
            Saved
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-dim mb-1.5">Bot Token</label>
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              className={inputClass}
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v..."
              autoComplete="off"
            />
          </div>

          <div className="h-px bg-[var(--color-border)] -mx-5" />

          <div>
            <label className="block text-sm text-dim mb-1.5">Your Telegram User ID</label>
            <input
              type="text"
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
              className={inputClass}
              placeholder="123456789"
            />
            <p className="text-xs text-dim mt-1.5">
              Only this user will be able to log in via Telegram
            </p>
          </div>

          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="px-5 py-2 bg-accent text-white rounded-md font-medium text-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
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

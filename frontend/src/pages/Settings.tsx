import { useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Bell, Code2, Fingerprint, Keyboard, Lock, LogOut, Send, SunMoon, Terminal, X } from 'lucide-react';
import { Header, HeaderProvider, useSetHeader } from '../components/layout/Header';
import { Breadcrumb } from '../components/ui/Breadcrumb';
import { IconButton } from '../components/ui/IconButton';
import { SettingsShell } from '../components/ui/SettingsShell';
import { useAuthStore } from '../stores/auth';
import {
  AppearanceSection,
  ArchivesSection,
  DangerZone,
  EditorSection,
  KeyboardShortcutsSection,
  NotificationSection,
  PasskeySection,
  PasswordSection,
  TelegramSection,
  TerminalSettingsSection,
} from './settings/sections';

type SettingsGroupId = 'general' | 'integrations' | 'security' | 'account';

interface SettingsSection {
  id: string;
  group: SettingsGroupId;
  title: string;
  description: string;
  keywords: string[];
  icon: ReactNode;
  content: ReactNode;
}

const SETTINGS_GROUP_ORDER: SettingsGroupId[] = ['general', 'integrations', 'security', 'account'];

const SETTINGS_GROUP_LABELS: Record<SettingsGroupId, string> = {
  general: 'General',
  integrations: 'Integrations',
  security: 'Security',
  account: 'Account',
};

export function Settings() {
  return (
    <HeaderProvider>
      <SettingsInner />
    </HeaderProvider>
  );
}

function SettingsInner() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  const handleClose = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const modals = document.querySelectorAll('.fixed.inset-0');
      if (modals.length > 0) return;
      const tag = (event.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      handleClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  useSetHeader(
    <div className="flex items-center justify-between w-full">
      <Breadcrumb items={[{ label: 'Settings' }]} />
      <IconButton icon={<X size={14} />} onClick={handleClose} tooltip="Close settings" />
    </div>,
    'settings',
  );

  const sections = useMemo<SettingsSection[]>(
    () => [
      {
        id: 'appearance',
        group: 'general',
        title: 'Appearance',
        description: 'Switch between dark and light themes',
        keywords: ['theme', 'dark', 'light', 'appearance'],
        icon: <SunMoon size={15} />,
        content: <AppearanceSection />,
      },
      {
        id: 'notifications',
        group: 'general',
        title: 'Notifications',
        description: 'Alerts when an agent needs attention',
        keywords: ['sound', 'alerts', 'audio'],
        icon: <Bell size={15} />,
        content: <NotificationSection />,
      },
      {
        id: 'keyboard',
        group: 'general',
        title: 'Keyboard',
        description: 'Session tab switching shortcuts and layout defaults',
        keywords: ['shortcuts', 'layout', 'bindings'],
        icon: <Keyboard size={15} />,
        content: <KeyboardShortcutsSection />,
      },
      {
        id: 'terminal',
        group: 'general',
        title: 'Terminal',
        description: 'Appearance and behavior for terminal sessions',
        keywords: ['cursor', 'font', 'scrollback', 'webgl'],
        icon: <Terminal size={15} />,
        content: <TerminalSettingsSection />,
      },
      {
        id: 'editor',
        group: 'general',
        title: 'Editor',
        description: 'Open task worktrees in your editor',
        keywords: ['vscode', 'cursor', 'ssh'],
        icon: <Code2 size={15} />,
        content: <EditorSection />,
      },
      {
        id: 'archives',
        group: 'general',
        title: 'Archives',
        description: 'Restore or delete archived projects',
        keywords: ['archive', 'backup', 'restore', 'export'],
        icon: <Archive size={15} />,
        content: <ArchivesSection />,
      },
      {
        id: 'passkeys',
        group: 'security',
        title: 'Passkeys',
        description: 'Passwordless sign-in with biometrics or security keys',
        keywords: ['security', 'webauthn', 'biometrics'],
        icon: <Fingerprint size={15} />,
        content: <PasskeySection />,
      },
      {
        id: 'telegram',
        group: 'integrations',
        title: 'Telegram',
        description: 'Auto-login when opening Codeburg from Telegram',
        keywords: ['bot', 'token', 'notifications', 'chat'],
        icon: <Send size={15} />,
        content: <TelegramSection />,
      },
      {
        id: 'password',
        group: 'security',
        title: 'Password',
        description: 'Manage your account password',
        keywords: ['security', 'credentials', 'account'],
        icon: <Lock size={15} />,
        content: <PasswordSection />,
      },
      {
        id: 'danger',
        group: 'account',
        title: 'Log out',
        description: 'End your current session',
        keywords: ['logout', 'session', 'account'],
        icon: <LogOut size={15} />,
        content: <DangerZone onLogout={logout} />,
      },
    ],
    [logout],
  );

  return (
    <div className="flex flex-col h-full">
      <Header />
      <div className="flex-1 overflow-hidden">
        <SettingsShell
          sections={sections}
          groupOrder={SETTINGS_GROUP_ORDER}
          groupLabels={SETTINGS_GROUP_LABELS}
          initialSectionId="notifications"
          navTitle="All settings"
          searchPlaceholder="Search settings"
          emptyMessage="No settings sections match your search."
        />
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Bell, Send, Smartphone, Volume2 } from 'lucide-react';
import { notificationsApi, preferencesApi } from '../../../api';
import { FieldLabel, FieldRow, SectionBody, SectionCard, SectionHeader, Toggle } from '../../../components/ui/settings';
import { isNotificationSoundEnabled, playNotificationSound, setNotificationSoundEnabled } from '../../../lib/notificationSound';
import { disableWebPushNotifications, enableWebPushNotifications, hasLocalWebPushSubscription, isWebPushSupported } from '../../../lib/webPush';

export function NotificationSection() {
  const [soundEnabled, setSoundEnabled] = useState(isNotificationSoundEnabled);
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [webPushEnabled, setWebPushEnabled] = useState(true);
  const [webPushRegistered, setWebPushRegistered] = useState(false);
  const [suppressWhenActive, setSuppressWhenActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [pushBusy, setPushBusy] = useState(false);

  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    setNotificationSoundEnabled(enabled);
  };

  useEffect(() => {
    Promise.all([
      preferencesApi.get<boolean>('telegram_notifications_enabled').catch(() => true),
      preferencesApi.get<boolean>('web_push_notifications_enabled').catch(() => true),
      preferencesApi.get<boolean>('notifications_suppress_when_active')
        .catch(() => preferencesApi.get<boolean>('telegram_notifications_suppress_when_active').catch(() => true)),
      hasLocalWebPushSubscription().catch(() => false),
    ])
      .then(([telegram, webPush, suppress, registered]) => {
        setTelegramEnabled(telegram !== false);
        setWebPushEnabled(webPush !== false);
        setSuppressWhenActive(suppress !== false);
        setWebPushRegistered(registered);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleTelegramToggle = async (enabled: boolean) => {
    setTelegramEnabled(enabled);
    try {
      await preferencesApi.set('telegram_notifications_enabled', enabled);
    } catch {
      setTelegramEnabled((prev) => !prev);
    }
  };

  const handleWebPushToggle = async (enabled: boolean) => {
    setWebPushEnabled(enabled);
    try {
      await preferencesApi.set('web_push_notifications_enabled', enabled);
    } catch {
      setWebPushEnabled((prev) => !prev);
    }
  };

  const handleSuppressToggle = async (enabled: boolean) => {
    setSuppressWhenActive(enabled);
    try {
      await Promise.all([
        preferencesApi.set('notifications_suppress_when_active', enabled),
        preferencesApi.set('telegram_notifications_suppress_when_active', enabled),
      ]);
    } catch {
      setSuppressWhenActive((prev) => !prev);
    }
  };

  const handleRegisterPush = async () => {
    setPushBusy(true);
    try {
      const ok = await enableWebPushNotifications();
      setWebPushRegistered(ok);
      if (ok) {
        setWebPushEnabled(true);
        await preferencesApi.set('web_push_notifications_enabled', true).catch(() => undefined);
      }
    } finally {
      setPushBusy(false);
    }
  };

  const handleUnregisterPush = async () => {
    setPushBusy(true);
    try {
      await disableWebPushNotifications();
      setWebPushRegistered(false);
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <SectionCard>
      <SectionHeader
        title="Notifications"
        description="Alerts when an agent or Pi chat needs attention"
        icon={<Bell size={15} />}
      />
      <SectionBody>
        <FieldRow>
          <FieldLabel label="Telegram alerts" description="Send Telegram notifications for waiting sessions and Pi chats" />
          <Toggle checked={telegramEnabled} onChange={handleTelegramToggle} disabled={loading} />
        </FieldRow>
        <FieldRow>
          <FieldLabel label="Android/PWA push" description="Send Web Push notifications to installed PWAs, including Android" />
          <Toggle checked={webPushEnabled} onChange={handleWebPushToggle} disabled={loading} />
        </FieldRow>
        {isWebPushSupported() && (
          <FieldRow>
            <FieldLabel
              label="This browser/PWA"
              description={webPushRegistered ? 'This device is registered for background push notifications' : 'Register this browser or installed PWA for background notifications'}
            />
            <button
              onClick={webPushRegistered ? handleUnregisterPush : handleRegisterPush}
              disabled={pushBusy || !webPushEnabled}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-card hover:bg-card-hover text-sm text-[var(--color-text-primary)] disabled:opacity-50"
            >
              <Smartphone size={15} />
              {webPushRegistered ? 'Unregister' : 'Register'}
            </button>
          </FieldRow>
        )}
        <FieldRow>
          <FieldLabel label="Suppress while active" description="Skip external alerts when the same session or conversation is open and focused" />
          <Toggle checked={suppressWhenActive} onChange={handleSuppressToggle} disabled={loading} />
        </FieldRow>
        <FieldRow>
          <FieldLabel label="Sound alerts" description="Play a sound when something needs attention in the open app" />
          <div className="flex items-center gap-3">
            <button
              onClick={() => playNotificationSound()}
              className="p-1.5 text-dim hover:text-accent transition-colors rounded"
              title="Test sound"
            >
              <Volume2 size={16} />
            </button>
            <Toggle checked={soundEnabled} onChange={handleSoundToggle} />
          </div>
        </FieldRow>
        <FieldRow>
          <FieldLabel label="Test notification" description="Send a test through enabled notification channels" />
          <button
            onClick={() => { void notificationsApi.sendTest(); }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent text-white text-sm hover:opacity-90"
          >
            <Send size={15} />
            Send test
          </button>
        </FieldRow>
      </SectionBody>
    </SectionCard>
  );
}

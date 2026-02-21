import { useEffect, useState } from 'react';
import { Bell, Volume2 } from 'lucide-react';
import { preferencesApi } from '../../../api';
import { FieldLabel, FieldRow, SectionBody, SectionCard, SectionHeader, Toggle } from '../../../components/ui/settings';
import { isNotificationSoundEnabled, playNotificationSound, setNotificationSoundEnabled } from '../../../lib/notificationSound';

export function NotificationSection() {
  const [soundEnabled, setSoundEnabled] = useState(isNotificationSoundEnabled);
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [suppressWhenActive, setSuppressWhenActive] = useState(true);
  const [telegramLoading, setTelegramLoading] = useState(true);

  const handleToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    setNotificationSoundEnabled(enabled);
  };

  useEffect(() => {
    Promise.all([
      preferencesApi.get<boolean>('telegram_notifications_enabled').catch(() => true),
      preferencesApi.get<boolean>('telegram_notifications_suppress_when_active').catch(() => true),
    ])
      .then(([enabled, suppress]) => {
        setTelegramEnabled(enabled !== false);
        setSuppressWhenActive(suppress !== false);
      })
      .finally(() => {
        setTelegramLoading(false);
      });
  }, []);

  const handleTelegramToggle = async (enabled: boolean) => {
    setTelegramEnabled(enabled);
    try {
      await preferencesApi.set('telegram_notifications_enabled', enabled);
    } catch {
      setTelegramEnabled((prev) => !prev);
    }
  };

  const handleSuppressToggle = async (enabled: boolean) => {
    setSuppressWhenActive(enabled);
    try {
      await preferencesApi.set('telegram_notifications_suppress_when_active', enabled);
    } catch {
      setSuppressWhenActive((prev) => !prev);
    }
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
          <FieldLabel label="Telegram alerts" description="Send Telegram notifications when an agent needs attention" />
          <Toggle checked={telegramEnabled} onChange={handleTelegramToggle} disabled={telegramLoading} />
        </FieldRow>
        <FieldRow>
          <FieldLabel label="Suppress while active" description="Skip Telegram alerts when the same session tab is currently open and focused" />
          <Toggle checked={suppressWhenActive} onChange={handleSuppressToggle} disabled={telegramLoading || !telegramEnabled} />
        </FieldRow>
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

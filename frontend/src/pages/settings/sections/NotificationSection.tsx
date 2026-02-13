import { useState } from 'react';
import { Bell, Volume2 } from 'lucide-react';
import { FieldLabel, FieldRow, SectionBody, SectionCard, SectionHeader, Toggle } from '../../../components/ui/settings';
import { isNotificationSoundEnabled, playNotificationSound, setNotificationSoundEnabled } from '../../../lib/notificationSound';

export function NotificationSection() {
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

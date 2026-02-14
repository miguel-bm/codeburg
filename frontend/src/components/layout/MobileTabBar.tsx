import { LayoutDashboard, FolderOpen, Settings } from 'lucide-react';
import { haptic } from '../../lib/haptics';

type Tab = 'home' | 'projects' | 'settings';

interface MobileTabBarProps {
  activeTab: Tab;
  onHome: () => void;
  onProjects: () => void;
  onSettings: () => void;
  waitingCount: number;
}

const tabs: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'home', label: 'Home', icon: LayoutDashboard },
  { key: 'projects', label: 'Projects', icon: FolderOpen },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export function MobileTabBar({ activeTab, onHome, onProjects, onSettings, waitingCount }: MobileTabBarProps) {
  const handlers: Record<Tab, () => void> = {
    home: onHome,
    projects: onProjects,
    settings: onSettings,
  };

  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 bg-canvas border-t border-subtle pb-[env(safe-area-inset-bottom)]">
      <div className="flex h-12">
        {tabs.map(({ key, label, icon: Icon }) => {
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => { haptic(); handlers[key](); }}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isActive ? 'text-accent' : 'text-dim'
              }`}
            >
              <span className="relative">
                <Icon size={20} />
                {key === 'projects' && waitingCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 text-[10px] font-medium rounded-full flex items-center justify-center bg-[var(--color-warning)]/15 text-[var(--color-warning)] animate-pulse">
                    {waitingCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] leading-tight">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

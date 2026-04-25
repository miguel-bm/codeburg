import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, PlugZap, Settings2, TerminalSquare } from 'lucide-react';
import { v2Api } from '../../api/v2';
import { V2Screen } from './v2-ui';

export function V2SettingsPage() {
  const { data: piStatus } = useQuery({
    queryKey: ['pi-status'],
    queryFn: () => v2Api.getPiStatus(),
  });

  return (
    <V2Screen>
      <div className="flex h-12 shrink-0 items-center gap-2 bg-canvas px-6 text-sm">
        <Settings2 size={15} className="text-dim" />
        <span className="font-semibold">Settings</span>
      </div>
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="max-w-4xl space-y-10">
          <section className="border-t border-[var(--color-card-border)] pt-5 first:border-t-0 first:pt-0">
            <div className="mb-4 flex items-start gap-3">
              <PlugZap size={15} className="mt-0.5 text-dim" />
              <div>
                <h2 className="text-sm font-semibold">Pi runtime</h2>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-dim">Global pi installation and auth state. Project-specific package overrides live in each project settings page.</p>
              </div>
            </div>
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <SettingLine label="Installed" value={piStatus?.installed ? 'Yes' : 'No'} ok={!!piStatus?.installed} />
              <SettingLine label="Auth" value={piStatus?.authConfigured ? 'Configured' : 'Needs terminal login'} ok={!!piStatus?.authConfigured} />
              <SettingLine label="Version" value={piStatus?.version ?? 'Unavailable'} />
              <SettingLine label="Agent dir" value={piStatus?.agentDir ?? '~/.pi/agent'} mono />
            </div>
            <div className="mt-5 flex items-center gap-2 text-xs text-dim">
              <TerminalSquare size={14} />
              Log in from any workspace terminal with `pi`, then `/login`.
            </div>
          </section>

          <section className="border-t border-[var(--color-card-border)] pt-5">
            <div className="mb-4 flex items-start gap-3">
              <Settings2 size={15} className="mt-0.5 text-dim" />
              <div>
                <h2 className="text-sm font-semibold">V2 preferences</h2>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-dim">Global V2-only settings will live here. Project lifecycle, skills, quick actions, and project pi overrides live under each project menu.</p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </V2Screen>
  );
}

function SettingLine({ label, value, ok, mono = false }: { label: string; value: string; ok?: boolean; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 py-2">
      <span className="text-dim">{label}</span>
      <span className={`flex min-w-0 items-center gap-1.5 truncate ${mono ? 'font-mono text-xs' : ''}`}>
        {ok !== undefined && <CheckCircle2 size={13} className={ok ? 'text-[var(--color-success)]' : 'text-dim'} />}
        {value}
      </span>
    </div>
  );
}

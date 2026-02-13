import { Button } from '../../../components/ui/Button';

interface DangerZoneProps {
  onLogout: () => void;
}

export function DangerZone({ onLogout }: DangerZoneProps) {
  return (
    <section className="card-surface overflow-hidden border-[var(--color-error)]/25">
      <div className="px-5 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Log out</h2>
          <p className="text-xs text-dim mt-0.5">End your current session</p>
        </div>
        <Button variant="danger" size="md" onClick={onLogout}>
          Log out
        </Button>
      </div>
    </section>
  );
}

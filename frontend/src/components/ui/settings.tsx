/* Shared settings page layout components */

export function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="card-surface overflow-hidden">
      {children}
    </section>
  );
}

export function SectionHeader({ title, description, action, icon }: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-subtle flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
          {icon && <span className="text-dim">{icon}</span>}
          {title}
        </h2>
        {description && (
          <p className="text-xs text-dim mt-0.5">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function SectionBody({ children, className = '', bordered = false }: { children: React.ReactNode; className?: string; bordered?: boolean }) {
  return (
    <div className={`px-4 sm:px-5 py-3.5 sm:py-4 ${bordered ? 'border-b border-subtle' : ''} ${className}`}>
      {children}
    </div>
  );
}

export function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2.5 py-3 border-b border-subtle last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      {children}
    </div>
  );
}

export function FieldLabel({ label, description }: { label: string; description?: string }) {
  return (
    <div className="min-w-0">
      <span className="text-sm text-[var(--color-text-primary)]">{label}</span>
      {description && (
        <span className="block text-xs text-dim mt-0.5">{description}</span>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
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

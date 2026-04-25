import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export function V2Screen({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden bg-canvas text-[var(--color-text-primary)] ${className}`}>
      {children}
    </div>
  );
}

export function V2Header({
  backTo,
  backLabel = 'Back',
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  backTo?: string;
  backLabel?: string;
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="shrink-0 bg-canvas px-5 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {backTo && (
            <Link
              to={backTo}
              className="mb-3 inline-flex items-center gap-1.5 text-xs text-dim transition-colors hover:text-[var(--color-text-primary)]"
            >
              <ArrowLeft size={14} />
              {backLabel}
            </Link>
          )}
          {eyebrow && <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-dim">{eyebrow}</div>}
          <h1 className="mt-1 truncate text-lg font-semibold tracking-[-0.03em]">{title}</h1>
          {subtitle && <div className="mt-1 max-w-3xl text-sm leading-5 text-dim">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function V2Content({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <main className={`min-h-0 flex-1 overflow-auto px-5 py-5 ${className}`}>{children}</main>;
}

export function V2Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl bg-card shadow-[var(--shadow-card)] ${className}`}>
      {children}
    </section>
  );
}

export function V2PanelHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-xs text-dim">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function V2Row({
  children,
  active = false,
  className = '',
}: {
  children: ReactNode;
  active?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg px-3 py-2 transition-colors ${
        active ? 'bg-[var(--color-card-hover)]' : 'hover:bg-[var(--color-card-hover)]'
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function V2Empty({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[12rem] items-center justify-center p-6 text-center">
      <div className="max-w-sm">
        {icon && <div className="mx-auto mb-3 flex justify-center text-dim">{icon}</div>}
        <div className="text-sm font-medium">{title}</div>
        {body && <div className="mt-2 text-xs leading-5 text-dim">{body}</div>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function V2Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-8 rounded-md border border-[var(--color-card-border)] bg-primary px-2.5 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)] ${props.className ?? ''}`}
    />
  );
}

export function V2Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-8 rounded-md border border-[var(--color-card-border)] bg-primary px-2.5 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)] ${props.className ?? ''}`}
    />
  );
}

export function V2Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`rounded-md border border-[var(--color-card-border)] bg-primary px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)] ${props.className ?? ''}`}
    />
  );
}

export function V2ToolbarButton({
  active,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...props}
      className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors disabled:opacity-50 ${
        active
          ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]'
          : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
      } ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export { Button };

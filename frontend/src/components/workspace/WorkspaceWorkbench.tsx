import type { ButtonHTMLAttributes, FormHTMLAttributes, ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';

export function WorkbenchFrame({
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

export function WorkbenchToolbar({
  children,
  className = '',
  ...props
}: FormHTMLAttributes<HTMLFormElement> & {
  children: ReactNode;
  className?: string;
}) {
  return (
    <form {...props} className={`shrink-0 px-2 py-2 ${className}`}>
      {children}
    </form>
  );
}

export function WorkbenchSearchInput({
  icon,
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  icon: ReactNode;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim">
        {icon}
      </span>
      <input
        {...props}
        className={`h-10 w-full rounded-md bg-[var(--color-card)] px-3 pl-8 text-sm text-[var(--color-text-primary)] outline-none transition-[background-color,box-shadow] placeholder:text-dim focus:bg-primary focus:shadow-[inset_0_0_0_1px_var(--color-accent)] md:h-8 md:text-xs ${className}`}
      />
    </div>
  );
}

export function WorkbenchIconButton({
  active,
  danger,
  label,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  danger?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...props}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-dim transition-[background-color,color,opacity] disabled:cursor-default disabled:opacity-40 md:h-8 md:w-8 ${
        active
          ? danger
            ? 'bg-[var(--color-error)]/12 text-[var(--color-error)]'
            : 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]'
          : danger
            ? 'hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]'
            : 'hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function WorkbenchButton({
  variant = 'default',
  icon,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger';
  icon?: ReactNode;
  children: ReactNode;
}) {
  const variantClass = variant === 'primary'
    ? 'bg-accent text-[var(--color-bg-primary)] hover:bg-accent-dim disabled:hover:bg-accent'
    : variant === 'danger'
      ? 'text-[var(--color-error)] hover:bg-[var(--color-error)]/10'
      : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]';

  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-[background-color,color,opacity] disabled:cursor-default disabled:opacity-40 md:h-8 md:px-2.5 md:text-xs ${variantClass} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

export function WorkbenchSection({
  title,
  count,
  expanded,
  onToggle,
  actions,
  children,
}: {
  title: ReactNode;
  count?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="py-1">
      <div className="flex min-h-8 items-center justify-between gap-2 px-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs font-medium text-dim transition-colors hover:text-[var(--color-text-primary)]"
        >
          <ChevronRight size={13} className={`shrink-0 transition-transform duration-150 ease-out-quart ${expanded ? 'rotate-90' : ''}`} />
          <span className="truncate">{title}</span>
          {count !== undefined && (
            <span className="rounded-full bg-[var(--color-card)] px-1.5 py-px text-[10px] font-medium text-dim">
              {count}
            </span>
          )}
        </button>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="section-body"
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.16, ease: [0.25, 1, 0.5, 1] }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function WorkbenchRow({
  active,
  children,
  className = '',
  onClick,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      {...props}
      role={onClick ? 'button' : props.role}
      tabIndex={onClick ? 0 : props.tabIndex}
      onClick={onClick}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (!onClick || event.defaultPrevented) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      className={`mx-1.5 flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none transition-[background-color,color,opacity] ${
        active
          ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]'
          : onClick
            ? 'cursor-pointer hover:bg-[var(--color-card)] focus-visible:bg-[var(--color-card)]'
            : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function WorkbenchEmpty({
  icon,
  title,
  body,
  compact,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center justify-center px-6 text-center ${compact ? 'min-h-16 py-4' : 'min-h-40 py-8'}`}>
      <div className="max-w-[18rem]">
        {icon && <div className="mb-3 flex justify-center text-dim">{icon}</div>}
        <div className="text-sm font-medium">{title}</div>
        {body && <div className="mt-1.5 text-xs leading-5 text-dim">{body}</div>}
      </div>
    </div>
  );
}

export function WorkbenchMeta({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-card)] px-2 py-0.5 text-[10px] font-medium text-dim ${className}`}>
      {children}
    </span>
  );
}

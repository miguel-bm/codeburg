import type { ReactNode } from 'react';

interface CardProps {
  variant?: 'default' | 'inset' | 'elevated';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
  className?: string;
  children: ReactNode;
}

const paddingMap = {
  none: 'p-0',
  sm: 'p-2',
  md: 'p-4',
  lg: 'p-6',
} as const;

export function Card({
  variant = 'default',
  padding = 'md',
  hover = false,
  className = '',
  children,
}: CardProps) {
  const base = paddingMap[padding];

  if (variant === 'inset') {
    return (
      <div className={`bg-inset rounded-lg border border-subtle ${base} ${className}`}>
        {children}
      </div>
    );
  }

  if (variant === 'elevated') {
    return (
      <div
        className={`bg-card rounded-xl border border-subtle ${base} ${className}`}
        style={{ boxShadow: 'var(--shadow-card-hover)' }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={`bg-card rounded-xl border border-[var(--color-card-border)] ${base} ${hover ? 'card-hover-lift' : ''} ${className}`}
      style={{
        boxShadow: 'var(--shadow-card)',
      }}
      onMouseEnter={hover ? (e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-card-hover)'; } : undefined}
      onMouseLeave={hover ? (e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-card)'; } : undefined}
    >
      {children}
    </div>
  );
}

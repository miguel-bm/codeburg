import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  variant?: 'ghost' | 'subtle';
  size?: 'xs' | 'sm';
  tooltip?: string;
  active?: boolean;
}

const variantStyles = {
  ghost: 'bg-transparent hover:bg-[var(--color-card)] text-dim hover:text-[var(--color-text-primary)]',
  subtle: 'bg-[var(--color-card)] hover:bg-[var(--color-card-hover)] text-dim hover:text-[var(--color-text-primary)] border border-subtle',
} as const;

const sizeStyles = {
  xs: 'h-5 w-5 rounded',
  sm: 'h-7 w-7 rounded-md',
} as const;

export function IconButton({
  icon,
  variant = 'ghost',
  size = 'sm',
  tooltip,
  active = false,
  className = '',
  ...rest
}: IconButtonProps) {
  return (
    <button
      title={tooltip}
      className={`flex items-center justify-center transition-colors disabled:opacity-50 ${variantStyles[variant]} ${sizeStyles[size]} ${active ? 'text-accent bg-accent/10' : ''} ${className}`}
      {...rest}
    >
      {icon}
    </button>
  );
}

import type { ReactNode } from 'react';

type TaskStatus = 'backlog' | 'in_progress' | 'in_review' | 'done';
type LabelColor = 'blue' | 'purple' | 'green' | 'red' | 'yellow' | 'gray';

interface BadgeStatusProps {
  variant: 'status';
  status: TaskStatus;
  children: ReactNode;
  className?: string;
  color?: never;
}

interface BadgeLabelProps {
  variant?: 'label';
  color?: LabelColor;
  children: ReactNode;
  className?: string;
  status?: never;
}

interface BadgeCountProps {
  variant: 'count';
  children: ReactNode;
  className?: string;
  status?: never;
  color?: never;
}

type BadgeProps = BadgeStatusProps | BadgeLabelProps | BadgeCountProps;

const statusColorMap: Record<TaskStatus, string> = {
  backlog: 'var(--color-status-backlog)',
  in_progress: 'var(--color-status-in-progress)',
  in_review: 'var(--color-status-in-review)',
  done: 'var(--color-status-done)',
};

const labelColorMap: Record<LabelColor, { bg: string; text: string }> = {
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-400' },
  green: { bg: 'bg-green-500/10', text: 'text-green-400' },
  red: { bg: 'bg-red-500/10', text: 'text-red-400' },
  yellow: { bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
  gray: { bg: 'bg-gray-500/10', text: 'text-gray-400' },
};

export function Badge(props: BadgeProps) {
  const { variant = 'label', children, className = '' } = props;

  if (variant === 'status') {
    const { status } = props as BadgeStatusProps;
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${className}`}>
        <span
          className="h-1.5 w-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: statusColorMap[status] }}
        />
        <span style={{ color: statusColorMap[status] }}>{children}</span>
      </span>
    );
  }

  if (variant === 'count') {
    return (
      <span className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-[var(--color-card)] text-dim text-xs font-medium ${className}`}>
        {children}
      </span>
    );
  }

  const color = (props as BadgeLabelProps).color ?? 'gray';
  const colors = labelColorMap[color];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text} ${className}`}>
      {children}
    </span>
  );
}

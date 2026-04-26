interface CodeburgIconProps {
  size?: number;
  className?: string;
}

/** Compact logo mark (icon only) */
export function CodeburgIcon({ size = 24, className = '' }: CodeburgIconProps) {
  return (
    <img
      src="/codeburg-logo.svg"
      alt="Codeburg"
      width={size}
      height={size}
      className={className}
    />
  );
}

interface CodeburgWordmarkProps {
  height?: number;
  className?: string;
}

/** Full wordmark (icon + "Codeburg" text), theme-aware */
export function CodeburgWordmark({ height = 24, className = '' }: CodeburgWordmarkProps) {
  const iconSize = Math.max(18, Math.round(height * 0.9));
  const fontSize = Math.max(14, Math.round(height * 0.7));

  return (
    <span
      className={`inline-flex items-center gap-2 overflow-visible whitespace-nowrap text-[var(--color-text-primary)] ${className}`}
      style={{ height }}
      aria-label="Codeburg"
    >
      <CodeburgIcon size={iconSize} className="shrink-0" />
      <span className="font-semibold leading-none" style={{ fontSize }}>
        Codeburg
      </span>
    </span>
  );
}

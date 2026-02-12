import { useResolvedTheme } from '../../hooks/useResolvedTheme';

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
  const theme = useResolvedTheme();
  const src = theme === 'dark' ? '/codeburg-dark.svg' : '/codeburg-light.svg';

  return (
    <img
      src={src}
      alt="Codeburg"
      height={height}
      style={{ height, width: 'auto' }}
      className={className}
    />
  );
}

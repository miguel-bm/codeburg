interface StyledPathProps {
  path: string;
  className?: string;
}

/** Renders a file path with dim directories and brighter filename. */
export function StyledPath({ path, className = '' }: StyledPathProps) {
  const lastSlash = path.lastIndexOf('/');
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : '';
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;

  return (
    <span className={`text-xs font-mono truncate ${className}`}>
      {dir && <span className="text-dim">{dir}</span>}
      <span className="text-[var(--color-text-secondary)]">{name}</span>
    </span>
  );
}

interface CodeburgIconProps {
  size?: number;
  className?: string;
}

export function CodeburgIcon({ size = 24, className = '' }: CodeburgIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Castle outline with 3 battlements, single path */}
      <path
        d="M6 29H26Q28 29 28 27V4H22V10H19V4H13V10H10V4H4V27Q4 29 6 29Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      {/* Code bracket < */}
      <path
        d="M15 15L10.5 19.5L15 24"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Code bracket > */}
      <path
        d="M17 15L21.5 19.5L17 24"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

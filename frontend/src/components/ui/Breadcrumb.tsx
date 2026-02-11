import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className = '' }: BreadcrumbProps) {
  return (
    <nav className={`flex items-center gap-1 min-w-0 text-sm ${className}`}>
      <Link to="/" className="text-dim hover:text-[var(--color-text-secondary)] transition-colors shrink-0">
        <Home size={14} />
      </Link>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;

        return (
          <span key={i} className="flex items-center gap-1 min-w-0">
            <ChevronRight size={12} className="text-dim shrink-0" />
            {isLast ? (
              <span
                className={`truncate ${item.className || 'text-[var(--color-text-primary)]'}`}
                style={item.style}
                title={item.label}
              >
                {item.icon}{item.icon ? ' ' : ''}{item.label}
              </span>
            ) : item.href ? (
              <Link
                to={item.href}
                className={`truncate text-dim hover:text-[var(--color-text-secondary)] transition-colors ${item.className || ''}`}
                style={item.style}
                title={item.label}
              >
                {item.icon}{item.icon ? ' ' : ''}{item.label}
              </Link>
            ) : (
              <span
                className={`truncate text-dim ${item.className || ''}`}
                style={item.style}
                title={item.label}
              >
                {item.icon}{item.icon ? ' ' : ''}{item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

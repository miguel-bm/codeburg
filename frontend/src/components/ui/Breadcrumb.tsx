import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: ReactNode;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className = '' }: BreadcrumbProps) {
  return (
    <nav className={`flex items-center gap-1 text-sm ${className}`}>
      <span className="inline-flex items-center gap-1">
        <Link to="/" className="text-dim hover:text-[var(--color-text-secondary)] transition-colors">
          <Home size={14} />
        </Link>
      </span>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const content = (
          <span className="inline-flex items-center gap-1">
            {item.icon}
            {item.label}
          </span>
        );

        return (
          <span key={i} className="inline-flex items-center gap-1">
            <ChevronRight size={12} className="text-dim flex-shrink-0" />
            {isLast ? (
              <span className="text-[var(--color-text-primary)]">{content}</span>
            ) : item.href ? (
              <Link to={item.href} className="text-dim hover:text-[var(--color-text-secondary)] transition-colors">
                {content}
              </Link>
            ) : (
              <span className="text-dim">{content}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

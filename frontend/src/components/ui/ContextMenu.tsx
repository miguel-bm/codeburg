import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

export interface ContextMenuItem {
  label: string;
  description?: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScroll = () => onClose();

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    if (rect.right > window.innerWidth) {
      menu.style.left = `${position.x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${position.y - rect.height}px`;
    }
  }, [position]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[160px] py-1 bg-card rounded-lg border border-[var(--color-card-border)] shadow-[var(--shadow-card)]"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={i} className="border-b border-subtle my-1" />;
        }
        const Icon = item.icon;
        return (
          <button
            key={i}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
              item.disabled
                ? 'text-dim cursor-not-allowed'
                : item.danger
                  ? 'text-[var(--color-error)] hover:bg-[var(--color-error)]/10'
                  : 'text-primary hover:bg-tertiary'
            }`}
          >
            {Icon && <Icon size={14} className="shrink-0" />}
            <span>
              {item.label}
              {item.description && (
                <span className="block text-[10px] text-dim font-normal">{item.description}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

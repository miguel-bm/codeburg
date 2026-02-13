import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';

/**
 * Shared hook for positioned dropdown menus (filter menus, etc.).
 * Handles: open/close state, outside-click dismiss, escape key, reposition on scroll/resize,
 * search query state, and auto-focus on the search input.
 */

interface UseDropdownMenuOptions {
  /** Preferred width of the dropdown menu. Default: 280 */
  menuWidth?: number;
  /** Whether to show the search input. Default: false */
  searchable?: boolean;
  /** Threshold item count above which search is auto-enabled. Default: 8 */
  searchThreshold?: number;
}

function buildMenuStyle(trigger: HTMLButtonElement | null, preferredWidth = 280): CSSProperties | null {
  if (!trigger) return null;
  const rect = trigger.getBoundingClientRect();
  const viewportPadding = 8;
  const menuWidth = Math.min(preferredWidth, window.innerWidth - viewportPadding * 2);
  const left = Math.min(
    Math.max(rect.left, viewportPadding),
    window.innerWidth - menuWidth - viewportPadding,
  );
  const availableBelow = window.innerHeight - rect.bottom - 10;
  const availableAbove = rect.top - 10;
  const openAbove = availableBelow < 240 && availableAbove > availableBelow;
  const maxHeight = Math.max(180, Math.min(360, openAbove ? availableAbove : availableBelow));
  const top = openAbove ? Math.max(viewportPadding, rect.top - maxHeight - 8) : rect.bottom + 8;
  return {
    position: 'fixed',
    top,
    left,
    width: menuWidth,
    maxHeight,
    zIndex: 1200,
  };
}

export function useDropdownMenu({
  menuWidth = 280,
  searchable = false,
  searchThreshold = 8,
}: UseDropdownMenuOptions = {}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const reposition = useCallback(() => {
    setMenuStyle(buildMenuStyle(triggerRef.current, menuWidth));
  }, [menuWidth]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const toggle = useCallback(() => {
    setOpen((current) => {
      if (current) {
        setQuery('');
      }
      return !current;
    });
  }, []);

  // Open/close side effects: reposition, escape, outside-click
  useEffect(() => {
    if (!open) return;
    reposition();
    const onEscape = (ev: KeyboardEvent) => { if (ev.key === 'Escape') close(); };
    const onOutside = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('keydown', onEscape);
    document.addEventListener('mousedown', onOutside);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('keydown', onEscape);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [close, open, reposition]);

  // Auto-focus search input when opened
  useEffect(() => {
    if (!open || !searchable) return;
    const id = window.setTimeout(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, searchable]);

  return {
    open,
    toggle,
    close,
    query,
    setQuery,
    menuStyle,
    triggerRef,
    menuRef,
    searchRef,
    /** Whether to show the search input (explicit prop or auto from item count) */
    searchable,
    searchThreshold,
  };
}

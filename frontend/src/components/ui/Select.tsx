import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
}

interface SelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  className?: string;
}

export function Select<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className = '',
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties | null>(null);

  const selectedOption = options.find((o) => o.value === value);
  const selectedIndex = options.findIndex((o) => o.value === value);

  const updateDropdownPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 6;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const availableAbove = rect.top - viewportPadding - gap;
    const openAbove = availableBelow < 180 && availableAbove > availableBelow;

    const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(rect.left, viewportPadding),
      window.innerWidth - width - viewportPadding,
    );

    const maxHeight = Math.max(
      140,
      Math.min(320, openAbove ? availableAbove : availableBelow),
    );
    const top = openAbove
      ? Math.max(viewportPadding, rect.top - gap - maxHeight)
      : Math.min(window.innerHeight - viewportPadding - maxHeight, rect.bottom + gap);

    setDropdownStyle({
      position: 'fixed',
      top,
      left,
      width,
      maxHeight,
      zIndex: 1000,
    });
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || listRef.current?.contains(target)) {
        return;
      }
      if (containerRef.current) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Keep portal dropdown aligned with trigger while open
  useEffect(() => {
    if (!open) return;

    updateDropdownPosition();
    const handleReposition = () => updateDropdownPosition();

    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [open, updateDropdownPosition]);

  // Scroll focused item into view
  useEffect(() => {
    if (!open || focusedIndex < 0 || !listRef.current) return;
    const items = listRef.current.children;
    if (items[focusedIndex]) {
      (items[focusedIndex] as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex, open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
          setOpen(true);
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          setOpen(false);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((i) => Math.min(i + 1, options.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < options.length) {
            onChange(options[focusedIndex].value);
            setOpen(false);
          }
          break;
      }
    },
    [open, focusedIndex, options, onChange, selectedIndex],
  );

  const handleSelect = (opt: SelectOption<T>) => {
    onChange(opt.value);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => {
          const next = !current;
          if (next) {
            setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
          }
          return next;
        })}
        onKeyDown={handleKeyDown}
        className={`
          w-full flex items-center justify-between gap-2
          px-3 py-2 text-sm rounded-md border transition-colors
          bg-primary text-[var(--color-text-primary)]
          ${open
            ? 'border-accent ring-1 ring-accent/20'
            : 'border-subtle hover:border-[var(--color-text-dim)]'
          }
          focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20
        `}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selectedOption ? '' : 'text-dim'}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown
          size={14}
          className={`text-dim flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown */}
      {open && dropdownStyle && createPortal(
        <div
          ref={listRef}
          role="listbox"
          aria-activedescendant={focusedIndex >= 0 ? `select-opt-${focusedIndex}` : undefined}
          className="
            z-[1000]
            rounded-md border border-subtle bg-elevated
            shadow-lg shadow-black/30
            py-1 max-h-60 overflow-y-auto
          "
          style={dropdownStyle}
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            const isFocused = i === focusedIndex;

            return (
              <button
                key={opt.value}
                id={`select-opt-${i}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(opt)}
                onMouseEnter={() => setFocusedIndex(i)}
                className={`
                  w-full text-left px-3 py-2 text-sm flex items-start gap-3
                  transition-colors duration-75
                  ${isFocused ? 'bg-accent/10' : ''}
                  ${isSelected ? 'text-accent' : 'text-[var(--color-text-primary)]'}
                `}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={isSelected ? 'font-medium' : ''}>{opt.label}</span>
                  </div>
                  {opt.description && (
                    <p className="text-xs text-dim mt-0.5">{opt.description}</p>
                  )}
                </div>
                {isSelected && (
                  <Check size={14} className="text-accent flex-shrink-0 mt-0.5" />
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

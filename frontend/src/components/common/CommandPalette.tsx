import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { sidebarApi, projectsApi } from '../../api';
import type { SidebarProject, SidebarTask, SidebarSession } from '../../api';

interface CommandItem {
  id: string;
  type: 'project' | 'task' | 'session' | 'action';
  label: string;
  detail?: string;
  icon: string;
  onSelect: () => void;
}

interface CommandPaletteProps {
  onClose: () => void;
}

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: sidebar } = useQuery({
    queryKey: ['sidebar'],
    queryFn: sidebarApi.get,
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });

  // Build flat list of all items
  const allItems = useMemo((): CommandItem[] => {
    const items: CommandItem[] = [];

    // Actions
    items.push({
      id: 'action-home',
      type: 'action',
      label: 'Go to Dashboard',
      icon: '>',
      onSelect: () => { navigate('/'); onClose(); },
    });
    items.push({
      id: 'action-settings',
      type: 'action',
      label: 'Settings',
      icon: '*',
      onSelect: () => { navigate('/settings'); onClose(); },
    });

    // Projects
    for (const p of projects ?? []) {
      items.push({
        id: `project-${p.id}`,
        type: 'project',
        label: p.name,
        detail: p.path,
        icon: '/',
        onSelect: () => { navigate(`/?project=${p.id}`); onClose(); },
      });
    }

    // Tasks + sessions from sidebar
    if (sidebar?.projects) {
      for (const p of sidebar.projects) {
        for (const t of p.tasks) {
          items.push({
            id: `task-${t.id}`,
            type: 'task',
            label: t.title,
            detail: `${p.name} · ${t.status.replace('_', ' ')}`,
            icon: t.status === 'in_review' ? '!' : '#',
            onSelect: () => { navigate(`/tasks/${t.id}`); onClose(); },
          });

          for (const s of t.sessions) {
            items.push({
              id: `session-${s.id}`,
              type: 'session',
              label: `${s.provider} #${s.number}`,
              detail: `${t.title} · ${s.status.replace('_', ' ')}`,
              icon: s.status === 'waiting_input' ? '?' : '~',
              onSelect: () => { navigate(`/tasks/${t.id}?session=${s.id}`); onClose(); },
            });
          }
        }
      }
    }

    return items;
  }, [sidebar, projects, navigate, onClose]);

  // Filter items
  const filtered = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase();
    return allItems.filter((item) =>
      item.label.toLowerCase().includes(q) ||
      item.detail?.toLowerCase().includes(q)
    );
  }, [allItems, query]);

  // Clamp selection
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].onSelect();
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [filtered, selectedIndex, onClose]);

  const typeLabel = (type: string) => {
    switch (type) {
      case 'project': return 'project';
      case 'task': return 'task';
      case 'session': return 'session';
      case 'action': return 'action';
      default: return '';
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[var(--color-bg-primary)]/80" onClick={onClose} />

      {/* Palette */}
      <div className="relative w-full max-w-lg bg-secondary border border-accent shadow-lg">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-subtle">
          <span className="text-accent text-sm">&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="jump to..."
            className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] focus:outline-none placeholder:text-dim"
          />
          <span className="text-[10px] text-dim">esc</span>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-sm text-dim text-center">
              no results
            </div>
          ) : (
            filtered.map((item, i) => (
              <div
                key={item.id}
                onClick={item.onSelect}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                  i === selectedIndex
                    ? 'bg-tertiary text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-tertiary'
                }`}
              >
                <span className="w-4 text-center text-xs text-accent flex-shrink-0">
                  {item.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{item.label}</div>
                  {item.detail && (
                    <div className="text-[10px] text-dim truncate">{item.detail}</div>
                  )}
                </div>
                <span className="text-[10px] text-dim flex-shrink-0">
                  {typeLabel(item.type)}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-subtle flex gap-4 text-[10px] text-dim">
          <span>arrows navigate</span>
          <span>enter select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Hook to manage Cmd+K keybinding
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return { open, setOpen };
}

import { useState, useEffect, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import type { Label, Project } from '../../../api/types';
import { PRIORITY_OPTIONS } from './taskCreateOptions';
import type { PriorityValue, TaskTypeOption, TaskTypeValue } from './taskCreateOptions';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-dim mb-1.5">{label}</p>
      {children}
    </div>
  );
}

export function ProjectSearchSelect({
  projects,
  value,
  onChange,
  disabled,
}: {
  projects: Project[];
  value: string;
  onChange: (projectId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const selected = projects.find((project) => project.id === value);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) => project.name.toLowerCase().includes(normalized) || project.path.toLowerCase().includes(normalized));
  }, [projects, query]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          setOpen((current) => {
            const next = !current;
            if (!next) setQuery('');
            return next;
          })
        }
        className={`w-full px-3 py-2 rounded-md border bg-primary flex items-center justify-between gap-2 text-left ${
          open ? 'border-accent ring-1 ring-accent/20' : 'border-subtle hover:border-[var(--color-text-dim)]'
        } disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        <div className="min-w-0">
          <div className="text-sm text-[var(--color-text-primary)] truncate">{selected?.name ?? 'Select project'}</div>
          {selected?.path && <div className="text-[11px] text-dim truncate">{selected.path}</div>}
        </div>
        <ChevronDown size={14} className={`text-dim shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full rounded-lg border border-subtle bg-elevated shadow-lg shadow-black/25 overflow-hidden">
          <div className="p-2 border-b border-subtle">
            <label className="relative block">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects..."
                className="w-full h-8 rounded-md border border-subtle bg-primary pl-7 pr-2 text-xs text-[var(--color-text-primary)] placeholder:text-dim focus:outline-none focus:border-accent"
              />
            </label>
          </div>
          <div className="max-h-60 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <div className="px-2 py-3 text-xs text-dim text-center">No matching projects.</div>
            ) : (
              filtered.map((project) => {
                const active = project.id === value;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      onChange(project.id);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={`w-full text-left px-2 py-2 rounded-md transition-colors ${
                      active ? 'bg-accent/10 text-accent' : 'hover:bg-tertiary text-[var(--color-text-primary)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm truncate">{project.name}</span>
                      {active && <Check size={12} className="shrink-0" />}
                    </div>
                    <div className="text-[11px] text-dim truncate mt-0.5">{project.path}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TaskTypeToggle({
  value,
  options,
  onChange,
}: {
  value: TaskTypeValue;
  options: TaskTypeOption[];
  onChange: (value: TaskTypeValue) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors ${
              active
                ? 'border-accent bg-accent/12 text-[var(--color-text-primary)]'
                : 'border-subtle bg-primary text-[var(--color-text-secondary)] hover:border-[var(--color-text-dim)]'
            }`}
          >
            <Icon size={14} className={active ? 'text-accent' : 'text-dim'} />
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PriorityToggle({
  value,
  onChange,
}: {
  value: PriorityValue;
  onChange: (value: PriorityValue) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
      {PRIORITY_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-md border px-2 py-2 text-xs sm:text-[11px] font-medium transition-colors ${
              active ? 'border-accent bg-accent/12' : 'border-subtle bg-primary hover:border-[var(--color-text-dim)]'
            }`}
            style={option.color ? { color: option.color } : undefined}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function LabelPicker({
  labels,
  selected,
  onToggle,
  onCreate,
  createPending,
  disabled,
}: {
  labels: Label[];
  selected: Label[];
  onToggle: (label: Label) => void;
  onCreate: (name: string) => void;
  createPending: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const selectedIds = useMemo(() => new Set(selected.map((label) => label.id)), [selected]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const sorted = [...labels].sort((a, b) => a.name.localeCompare(b.name));
    if (!normalized) return sorted;
    return sorted.filter((label) => label.name.toLowerCase().includes(normalized));
  }, [labels, query]);

  const canCreate =
    query.trim().length > 0 && !labels.some((label) => label.name.toLowerCase() === query.trim().toLowerCase());

  const handleCreate = () => {
    const name = query.trim();
    if (!name || createPending) return;
    onCreate(name);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="space-y-2">
      <div className="border border-subtle rounded-lg bg-primary px-2.5 py-2 space-y-2">
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {selected.map((label) => (
              <span
                key={label.id}
                className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium inline-flex items-center gap-1"
                style={{ backgroundColor: label.color }}
              >
                {label.name}
                <button type="button" onClick={() => onToggle(label)} className="hover:opacity-70">
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        )}

        <label className="relative block">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (canCreate) {
                  handleCreate();
                } else if (filtered.length > 0) {
                  onToggle(filtered[0]);
                }
              }
            }}
            placeholder={disabled ? 'Select a project first' : 'Search labels or create new...'}
            className="w-full h-8 rounded-md border border-subtle bg-primary pl-7 pr-2 text-xs text-[var(--color-text-primary)] placeholder:text-dim focus:outline-none focus:border-accent disabled:opacity-60"
          />
        </label>
      </div>

      {open && !disabled && (
        <div className="rounded-lg border border-subtle bg-elevated overflow-hidden">
          <div className="max-h-52 overflow-y-auto p-1.5 space-y-1">
            {filtered.map((label) => {
              const active = selectedIds.has(label.id);
              return (
                <button
                  key={label.id}
                  type="button"
                  onClick={() => onToggle(label)}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                    active ? 'bg-accent/10 text-accent' : 'hover:bg-tertiary text-[var(--color-text-primary)]'
                  }`}
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                    <span className="text-xs truncate">{label.name}</span>
                  </span>
                  {active && <Check size={12} className="shrink-0" />}
                </button>
              );
            })}
            {filtered.length === 0 && !canCreate && (
              <div className="px-2 py-3 text-xs text-dim text-center">No matching labels.</div>
            )}
            {canCreate && (
              <button
                type="button"
                onClick={handleCreate}
                disabled={createPending}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-xs text-accent hover:bg-accent/10 disabled:opacity-60"
              >
                <Plus size={12} />
                Create "{query.trim()}"
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProviderPill({
  label,
  logo,
  selected,
  onClick,
}: {
  label: string;
  logo: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs font-medium transition-all ${
        selected
          ? 'border-accent bg-accent/10 text-[var(--color-text-primary)]'
          : 'border-subtle bg-secondary text-[var(--color-text-secondary)] hover:bg-tertiary hover:border-[var(--color-text-secondary)]/50'
      }`}
    >
      <span className="inline-flex h-4 w-4 items-center justify-center shrink-0">{logo}</span>
      <span>{label}</span>
    </button>
  );
}

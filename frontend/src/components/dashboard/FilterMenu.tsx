import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check, Crosshair, SlidersHorizontal } from 'lucide-react';
import { useDropdownMenu } from '../../hooks/useDropdownMenu';

export const DASHBOARD_STATUS_PARAM = 'status';
export const DASHBOARD_PRIORITY_PARAM = 'priority';
export const DASHBOARD_TYPE_PARAM = 'type';
export const DASHBOARD_LABEL_PARAM = 'label';

export interface FilterOptionItem {
  value: string;
  label: string;
  description?: string;
  toneClass?: string;
  toneColor?: string;
}

type FilterMenuProps = {
  label: string;
  items: FilterOptionItem[];
  emptyMessage: string;
  searchable?: boolean;
  menuWidth?: number;
} & (
  | {
      mode: 'single';
      selectedValue?: string;
      selectedLabel: string;
      allLabel: string;
      onSelect: (value: string) => void;
      onClear: () => void;
    }
  | {
      mode: 'multi';
      selected: Set<string>;
      onToggle: (value: string) => void;
      onOnly: (value: string) => void;
      onReset: () => void;
    }
);

export function FilterMenu(props: FilterMenuProps) {
  const { label, items, emptyMessage, searchable = false, menuWidth = 300 } = props;
  const {
    open,
    toggle,
    close,
    query,
    setQuery,
    menuStyle,
    triggerRef,
    menuRef,
    searchRef,
    searchThreshold,
  } = useDropdownMenu({ menuWidth, searchable, searchThreshold: 8 });
  const canSearch = searchable || items.length > searchThreshold;

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const normalized = query.trim().toLowerCase();
    return items.filter((item) =>
      item.label.toLowerCase().includes(normalized)
      || (item.description ?? '').toLowerCase().includes(normalized),
    );
  }, [items, query]);

  const isActive = props.mode === 'single' ? !!props.selectedValue : props.selected.size > 0;
  const triggerLabel = props.mode === 'single'
    ? (props.selectedValue ? props.selectedLabel : props.allLabel)
    : (props.selected.size > 0 ? `${props.selected.size} selected` : 'All');

  const handleReset = () => {
    if (props.mode === 'single') {
      props.onClear();
    } else {
      props.onReset();
    }
    setTimeout(() => close(), 0);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] transition-colors ${
          isActive
            ? 'bg-accent/10 text-accent'
            : 'bg-transparent text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary'
        }`}
      >
        <span className="font-medium">{label}</span>
        <span className={`${props.mode === 'single' ? 'max-w-[180px] truncate ' : ''}${isActive ? 'text-accent' : 'text-dim'}`}>
          {triggerLabel}
        </span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && menuStyle && createPortal(
        <>
          <div
            className="fixed inset-0 z-[1190] animate-fadeIn"
            onMouseDown={(e) => { e.preventDefault(); close(); }}
          />
          <div
            ref={menuRef}
            style={menuStyle}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl bg-elevated shadow-lg shadow-black/35 overflow-hidden flex flex-col animate-scaleIn"
          >
            <div className="px-3 py-2.5 bg-[var(--color-bg-secondary)]/45 flex items-center justify-between">
              <div className="text-xs font-medium">{label}</div>
              <button
                type="button"
                onClick={handleReset}
                className="text-[10px] text-dim hover:text-[var(--color-text-primary)] transition-colors"
              >
                Reset
              </button>
            </div>

            {canSearch && (
              <div className="px-3 pb-2">
                <label className="relative block">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(ev) => setQuery(ev.target.value)}
                    placeholder={`Search ${label.toLowerCase()}...`}
                    className="w-full h-7 rounded-md border border-subtle/30 bg-[var(--color-bg-secondary)]/60 pl-7 pr-2 text-[11px] text-[var(--color-text-primary)] placeholder:text-dim focus:outline-none focus:border-accent/55"
                  />
                </label>
              </div>
            )}

            <div className="overflow-y-auto p-1.5">
              {filteredItems.length === 0 ? (
                <div className="px-3 py-4 text-xs text-dim text-center">{emptyMessage}</div>
              ) : (
                filteredItems.map((item) => {
                  const active = props.mode === 'single'
                    ? item.value === props.selectedValue
                    : props.selected.has(item.value);
                  return (
                    <div key={item.value} className="flex items-center gap-1 rounded-md hover:bg-tertiary px-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (props.mode === 'single') {
                            if (active) props.onClear();
                            else props.onSelect(item.value);
                          } else {
                            props.onToggle(item.value);
                          }
                        }}
                        className={`flex-1 text-left px-1.5 py-2 text-xs rounded-md transition-colors ${
                          active ? 'text-accent' : 'text-[var(--color-text-primary)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`truncate ${item.toneClass ?? ''}`}
                            style={item.toneColor ? { color: item.toneColor } : undefined}
                          >
                            {item.label}
                          </span>
                          {active && <Check size={12} className="text-accent shrink-0" />}
                        </div>
                        {item.description && (
                          <div className="text-[10px] text-dim mt-0.5 truncate">{item.description}</div>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (props.mode === 'single') {
                            props.onSelect(item.value);
                          } else {
                            props.onOnly(item.value);
                          }
                          setTimeout(() => close(), 0);
                        }}
                        className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-dim hover:text-[var(--color-text-primary)] transition-colors"
                      >
                        <Crosshair size={10} />
                        only
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

interface CompactFilterPanelProps {
  selectedProjectId?: string;
  projectFilterItems: FilterOptionItem[];
  showStatusFilter: boolean;
  statusFilter: Set<string>;
  statusFilterItems: FilterOptionItem[];
  statusFilterOrder: string[];
  priorityFilter: Set<string>;
  priorityFilterItems: FilterOptionItem[];
  priorityFilterOrder: string[];
  typeFilter: Set<string>;
  typeFilterItems: FilterOptionItem[];
  typeFilterOrder: string[];
  labelFilter: Set<string>;
  labelFilterItems: FilterOptionItem[];
  labelFilterOrder: string[];
  activeFilterCount: number;
  onSelectProject: (projectId: string) => void;
  onClearProject: () => void;
  onToggleMultiFilter: (param: string, value: string, current: Set<string>, orderedValues: string[]) => void;
  onResetAll: () => void;
}

export function CompactFilterPanel({
  selectedProjectId,
  projectFilterItems,
  showStatusFilter,
  statusFilter,
  statusFilterItems,
  statusFilterOrder,
  priorityFilter,
  priorityFilterItems,
  priorityFilterOrder,
  typeFilter,
  typeFilterItems,
  typeFilterOrder,
  labelFilter,
  labelFilterItems,
  labelFilterOrder,
  activeFilterCount,
  onSelectProject,
  onClearProject,
  onToggleMultiFilter,
  onResetAll,
}: CompactFilterPanelProps) {
  const {
    open,
    toggle,
    close,
    menuStyle,
    triggerRef,
    menuRef,
  } = useDropdownMenu({ menuWidth: 320 });

  const sections: {
    key: string;
    label: string;
    mode: 'single' | 'multi';
    items: FilterOptionItem[];
    selected: Set<string>;
    param: string;
    order: string[];
  }[] = [
    { key: 'project', label: 'PROJECT', mode: 'single', items: projectFilterItems, selected: new Set(selectedProjectId ? [selectedProjectId] : []), param: 'project', order: [] },
    ...(showStatusFilter && statusFilterItems.length > 0 ? [{ key: 'status', label: 'STATUS', mode: 'multi' as const, items: statusFilterItems, selected: statusFilter, param: DASHBOARD_STATUS_PARAM, order: statusFilterOrder }] : []),
    ...(priorityFilterItems.length > 0 ? [{ key: 'priority', label: 'PRIORITY', mode: 'multi' as const, items: priorityFilterItems, selected: priorityFilter, param: DASHBOARD_PRIORITY_PARAM, order: priorityFilterOrder }] : []),
    ...(typeFilterItems.length > 0 ? [{ key: 'type', label: 'TYPE', mode: 'multi' as const, items: typeFilterItems, selected: typeFilter, param: DASHBOARD_TYPE_PARAM, order: typeFilterOrder }] : []),
    ...(labelFilterItems.length > 0 ? [{ key: 'label', label: 'LABEL', mode: 'multi' as const, items: labelFilterItems, selected: labelFilter, param: DASHBOARD_LABEL_PARAM, order: labelFilterOrder }] : []),
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] transition-colors ${
          activeFilterCount > 0
            ? 'bg-accent/10 text-accent'
            : 'bg-transparent text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary'
        }`}
      >
        <SlidersHorizontal size={12} />
        <span className="font-medium">Filters</span>
        {activeFilterCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-accent/20 text-accent text-[10px] font-medium px-1">
            {activeFilterCount}
          </span>
        )}
      </button>

      {open && menuStyle && createPortal(
        <>
          <div
            className="fixed inset-0 z-[1190] animate-fadeIn"
            onMouseDown={(e) => { e.preventDefault(); close(); }}
          />
          <div
            ref={menuRef}
            style={menuStyle}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl bg-elevated shadow-lg shadow-black/35 overflow-hidden flex flex-col animate-scaleIn"
          >
            <div className="px-3 py-2.5 bg-[var(--color-bg-secondary)]/45 flex items-center justify-between">
              <div className="text-xs font-medium">Filters</div>
              <button
                type="button"
                onClick={() => {
                  onResetAll();
                  setTimeout(() => close(), 0);
                }}
                className="text-[10px] text-dim hover:text-[var(--color-text-primary)] transition-colors"
              >
                Reset all
              </button>
            </div>

            <div className="overflow-y-auto p-1.5 space-y-3">
              {sections.map((section) => (
                <div key={section.key}>
                  <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-dim">
                    {section.label}
                  </div>
                  {section.mode === 'single' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onClearProject();
                          setTimeout(() => close(), 0);
                        }}
                        className={`w-full text-left px-2 py-1.5 text-xs rounded-md transition-colors ${
                          !selectedProjectId ? 'text-accent' : 'text-[var(--color-text-primary)] hover:bg-tertiary'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">All projects</span>
                          {!selectedProjectId && <Check size={12} className="text-accent shrink-0" />}
                        </div>
                      </button>
                      {section.items.map((item) => {
                        const active = item.value === selectedProjectId;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => {
                              onSelectProject(item.value);
                              setTimeout(() => close(), 0);
                            }}
                            className={`w-full text-left px-2 py-1.5 text-xs rounded-md transition-colors ${
                              active ? 'text-accent' : 'text-[var(--color-text-primary)] hover:bg-tertiary'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate">{item.label}</span>
                              {active && <Check size={12} className="text-accent shrink-0" />}
                            </div>
                          </button>
                        );
                      })}
                    </>
                  ) : (
                    section.items.map((item) => {
                      const active = section.selected.has(item.value);
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => onToggleMultiFilter(section.param, item.value, section.selected, section.order)}
                          className={`w-full text-left px-2 py-1.5 text-xs rounded-md transition-colors hover:bg-tertiary ${
                            active ? 'text-accent' : 'text-[var(--color-text-primary)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`truncate ${item.toneClass ?? ''}`}
                              style={item.toneColor ? { color: item.toneColor } : undefined}
                            >
                              {item.label}
                            </span>
                            {active && <Check size={12} className="text-accent shrink-0" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

import { motion } from 'motion/react';
import { Archive, LayoutGrid, List as ListIcon, Search, X } from 'lucide-react';
import { Button } from '../ui/Button';
import {
  CompactFilterPanel,
  DASHBOARD_LABEL_PARAM,
  DASHBOARD_PRIORITY_PARAM,
  DASHBOARD_TYPE_PARAM,
  FilterMenu,
} from './FilterMenu';
import type { FilterOptionItem } from './FilterMenu';

type DashboardView = 'kanban' | 'list';

interface DashboardHeaderControlsProps {
  setHeaderHost: (element: HTMLDivElement | null) => void;
  view: DashboardView;
  onSetView: (nextView: DashboardView) => void;
  isCompact: boolean;

  selectedProjectId?: string;
  activeProjectName: string;

  projectFilterItems: FilterOptionItem[];
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
  onSetOnlyMultiFilterValue: (param: string, value: string) => void;
  onResetFilterParam: (param: string) => void;
  onClearDashboardFilters: () => void;

  searchExpanded: boolean;
  searchQuery: string;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onSetSearchExpanded: (expanded: boolean) => void;
  onSetSearchQuery: (query: string) => void;
  onClearSearch: () => void;

  showArchived: boolean;
  onToggleShowArchived: () => void;
}

export function DashboardHeaderControls({
  setHeaderHost,
  view,
  onSetView,
  isCompact,
  selectedProjectId,
  activeProjectName,
  projectFilterItems,
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
  onSetOnlyMultiFilterValue,
  onResetFilterParam,
  onClearDashboardFilters,
  searchExpanded,
  searchQuery,
  searchInputRef,
  onSetSearchExpanded,
  onSetSearchQuery,
  onClearSearch,
  showArchived,
  onToggleShowArchived,
}: DashboardHeaderControlsProps) {
  return (
    <div ref={setHeaderHost} className="flex items-center gap-2 w-full">
      <div className="relative isolate inline-flex items-center rounded-md bg-tertiary p-0.5 shrink-0">
        {([
          { key: 'kanban' as DashboardView, icon: LayoutGrid },
          { key: 'list' as DashboardView, icon: ListIcon },
        ] as const).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onSetView(opt.key)}
            className={`relative inline-flex items-center justify-center w-7 h-6 rounded-[5px] transition-colors ${
              view === opt.key ? 'text-accent' : 'text-dim hover:text-[var(--color-text-primary)]'
            }`}
            title={`${opt.key === 'kanban' ? 'Kanban' : 'List'} view`}
          >
            {view === opt.key && (
              <motion.div
                layoutId="view-indicator"
                className="absolute inset-0 rounded-[5px] bg-accent/15"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <opt.icon size={12} className="relative z-[1]" />
          </button>
        ))}
      </div>

      {isCompact ? (
        <CompactFilterPanel
          selectedProjectId={selectedProjectId}
          projectFilterItems={projectFilterItems}
          showStatusFilter={false}
          statusFilter={statusFilter}
          statusFilterItems={statusFilterItems}
          statusFilterOrder={statusFilterOrder}
          priorityFilter={priorityFilter}
          priorityFilterItems={priorityFilterItems}
          priorityFilterOrder={priorityFilterOrder}
          typeFilter={typeFilter}
          typeFilterItems={typeFilterItems}
          typeFilterOrder={typeFilterOrder}
          labelFilter={labelFilter}
          labelFilterItems={labelFilterItems}
          labelFilterOrder={labelFilterOrder}
          activeFilterCount={activeFilterCount}
          onSelectProject={onSelectProject}
          onClearProject={onClearProject}
          onToggleMultiFilter={onToggleMultiFilter}
          onResetAll={onClearDashboardFilters}
        />
      ) : (
        <div className="flex items-center gap-1.5 min-w-0">
          <FilterMenu
            mode="single"
            label="Project"
            selectedValue={selectedProjectId}
            selectedLabel={activeProjectName}
            items={projectFilterItems}
            allLabel="All projects"
            emptyMessage="No projects found."
            onSelect={onSelectProject}
            onClear={onClearProject}
            menuWidth={460}
            searchable
          />

          <FilterMenu
            mode="multi"
            label="Priority"
            selected={priorityFilter}
            items={priorityFilterItems}
            emptyMessage="No priorities found."
            onToggle={(value) =>
              onToggleMultiFilter(DASHBOARD_PRIORITY_PARAM, value, priorityFilter, priorityFilterOrder)
            }
            onOnly={(value) => onSetOnlyMultiFilterValue(DASHBOARD_PRIORITY_PARAM, value)}
            onReset={() => onResetFilterParam(DASHBOARD_PRIORITY_PARAM)}
          />

          <FilterMenu
            mode="multi"
            label="Type"
            selected={typeFilter}
            items={typeFilterItems}
            emptyMessage="No task types found."
            onToggle={(value) => onToggleMultiFilter(DASHBOARD_TYPE_PARAM, value, typeFilter, typeFilterOrder)}
            onOnly={(value) => onSetOnlyMultiFilterValue(DASHBOARD_TYPE_PARAM, value)}
            onReset={() => onResetFilterParam(DASHBOARD_TYPE_PARAM)}
            searchable
          />

          <FilterMenu
            mode="multi"
            label="Label"
            selected={labelFilter}
            items={labelFilterItems}
            emptyMessage="No labels found."
            onToggle={(value) => onToggleMultiFilter(DASHBOARD_LABEL_PARAM, value, labelFilter, labelFilterOrder)}
            onOnly={(value) => onSetOnlyMultiFilterValue(DASHBOARD_LABEL_PARAM, value)}
            onReset={() => onResetFilterParam(DASHBOARD_LABEL_PARAM)}
            searchable
          />
        </div>
      )}

      <div
        className={`inline-flex h-7 items-center rounded-lg shrink-0 overflow-hidden transition-all duration-200 ease-out ${
          searchQuery ? 'bg-accent/10' : searchExpanded ? 'bg-tertiary' : ''
        }`}
        style={{ width: searchExpanded ? 200 : 28 }}
      >
        <button
          type="button"
          onClick={() => {
            if (!searchExpanded) onSetSearchExpanded(true);
          }}
          className={`shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg transition-colors ${
            searchQuery
              ? 'text-accent'
              : searchExpanded
                ? 'text-dim'
                : 'text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary'
          }`}
        >
          <Search size={12} />
        </button>
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => onSetSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClearSearch();
          }}
          placeholder="Search..."
          className={`flex-1 min-w-0 h-7 bg-transparent text-[11px] focus:outline-none ${
            searchQuery ? 'text-accent placeholder:text-accent/50' : 'text-[var(--color-text-primary)] placeholder:text-dim'
          }`}
          tabIndex={searchExpanded ? 0 : -1}
        />
        <button
          type="button"
          onClick={onClearSearch}
          className={`shrink-0 w-6 h-7 inline-flex items-center justify-center transition-colors ${
            searchQuery ? 'text-accent/60 hover:text-accent' : 'text-dim hover:text-[var(--color-text-primary)]'
          }`}
          tabIndex={searchExpanded ? 0 : -1}
        >
          <X size={12} />
        </button>
      </div>

      <button
        type="button"
        onClick={onToggleShowArchived}
        className={`shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg transition-colors ${
          showArchived ? 'text-accent bg-accent/10' : 'text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary'
        }`}
        title={showArchived ? 'Hide archived tasks' : 'Show archived tasks'}
      >
        <Archive size={12} />
      </button>

      {activeFilterCount > 0 && (
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] text-dim">{activeFilterCount}</span>
          <Button
            variant="ghost"
            size="xs"
            icon={<X size={12} />}
            onClick={onClearDashboardFilters}
            title="Clear all filters"
          >
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}

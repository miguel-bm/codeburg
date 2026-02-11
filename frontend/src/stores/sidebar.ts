import { create } from 'zustand';

export type SidebarMode =
  | 'expanded-pinned'
  | 'expanded-hover'
  | 'collapsed-pinned'
  | 'collapsed-hover';

interface SidebarPersisted {
  mode: SidebarMode;
  width: number;
}

interface SidebarState extends SidebarPersisted {
  hoverVisible: boolean;
  setMode: (mode: SidebarMode) => void;
  setWidth: (width: number) => void;
  setHoverVisible: (visible: boolean) => void;
  togglePin: () => void;
  toggleExpanded: () => void;
}

const STORAGE_KEY = 'codeburg:sidebar';

const DEFAULTS: SidebarPersisted = {
  mode: 'expanded-pinned',
  width: 288,
};

function load(): SidebarPersisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULTS };
}

function save(persisted: SidebarPersisted) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function clampWidth(width: number): number {
  return Math.min(480, Math.max(200, width));
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  ...load(),
  hoverVisible: false,

  setMode: (mode) => {
    set({ mode });
    const { mode: m, width } = get();
    save({ mode: m, width });
  },

  setWidth: (width) => {
    const clamped = clampWidth(width);
    set({ width: clamped });
    const { mode } = get();
    save({ mode, width: clamped });
  },

  setHoverVisible: (hoverVisible) => {
    set({ hoverVisible });
  },

  togglePin: () => {
    const { mode, width } = get();
    const isPinned = mode.endsWith('pinned');
    const prefix = mode.startsWith('expanded') ? 'expanded' : 'collapsed';
    const newMode: SidebarMode = `${prefix}-${isPinned ? 'hover' : 'pinned'}`;
    set({ mode: newMode });
    save({ mode: newMode, width });
  },

  toggleExpanded: () => {
    const { mode, width } = get();
    const isExpanded = mode.startsWith('expanded');
    const suffix = mode.endsWith('pinned') ? 'pinned' : 'hover';
    const newMode: SidebarMode = `${isExpanded ? 'collapsed' : 'expanded'}-${suffix}`;
    set({ mode: newMode });
    save({ mode: newMode, width });
  },
}));

// Derived selectors
export const selectIsExpanded = (state: SidebarState) => state.mode.startsWith('expanded');
export const selectIsPinned = (state: SidebarState) => state.mode.endsWith('pinned');

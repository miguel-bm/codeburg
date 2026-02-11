import { create } from 'zustand';

export type SidebarMode = 'expanded' | 'collapsed';

interface SidebarPersisted {
  mode: SidebarMode;
  width: number;
}

interface SidebarState extends SidebarPersisted {
  setMode: (mode: SidebarMode) => void;
  setWidth: (width: number) => void;
  toggleExpanded: () => void;
}

const STORAGE_KEY = 'codeburg:sidebar';

const DEFAULTS: SidebarPersisted = {
  mode: 'expanded',
  width: 288,
};

function normalizeMode(mode: unknown): SidebarMode {
  if (typeof mode !== 'string') return DEFAULTS.mode;
  if (mode.startsWith('expanded')) return 'expanded';
  if (mode.startsWith('collapsed')) return 'collapsed';
  return DEFAULTS.mode;
}

function load(): SidebarPersisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { mode?: unknown; width?: unknown };
      const mode = normalizeMode(parsed.mode);
      const width = typeof parsed.width === 'number'
        ? clampWidth(parsed.width)
        : DEFAULTS.width;
      return { mode, width };
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

  setMode: (mode) => {
    set({ mode });
    const { width } = get();
    save({ mode, width });
  },

  setWidth: (width) => {
    const clamped = clampWidth(width);
    set({ width: clamped });
    const { mode } = get();
    save({ mode, width: clamped });
  },

  toggleExpanded: () => {
    const { mode, width } = get();
    const newMode: SidebarMode = mode === 'expanded' ? 'collapsed' : 'expanded';
    set({ mode: newMode });
    save({ mode: newMode, width });
  },
}));

export const selectIsExpanded = (state: SidebarState) => state.mode === 'expanded';

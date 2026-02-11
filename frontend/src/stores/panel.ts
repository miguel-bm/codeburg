import { create } from 'zustand';

export type PanelSize = 'half' | 'full';

interface PanelState {
  size: PanelSize;
  setSize: (size: PanelSize) => void;
  toggleSize: () => void;
}

const STORAGE_KEY = 'codeburg:panel-size';

function load(): PanelSize {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'half' || raw === 'full') {
      return raw;
    }
  } catch {
    // ignore
  }
  return 'half';
}

function save(size: PanelSize) {
  localStorage.setItem(STORAGE_KEY, size);
}

export const usePanelStore = create<PanelState>((set, get) => ({
  size: load(),

  setSize: (size) => {
    set({ size });
    save(size);
  },

  toggleSize: () => {
    const next = get().size === 'half' ? 'full' : 'half';
    set({ size: next });
    save(next);
  },
}));

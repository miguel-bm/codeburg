import { create } from 'zustand';

export type PanelSize = 'half' | 'full';

export const PANEL_WIDTH_MIN = 360;
export const PANEL_WIDTH_MAX = 1200;
export const PANEL_WIDTH_DEFAULT = 640;

interface PanelState {
  size: PanelSize;
  width: number;
  setSize: (size: PanelSize) => void;
  toggleSize: () => void;
  setWidth: (width: number) => void;
}

const SIZE_STORAGE_KEY = 'codeburg:panel-size';
const WIDTH_STORAGE_KEY = 'codeburg:panel-width';

function loadSize(): PanelSize {
  try {
    const raw = localStorage.getItem(SIZE_STORAGE_KEY);
    if (raw === 'half' || raw === 'full') return raw;
  } catch {
    // ignore
  }
  return 'half';
}

function loadWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (raw) {
      const num = parseInt(raw, 10);
      if (num >= PANEL_WIDTH_MIN && num <= PANEL_WIDTH_MAX) return num;
    }
  } catch {
    // ignore
  }
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  return Math.round(Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, vw * 0.45)));
}

function saveSize(size: PanelSize) {
  localStorage.setItem(SIZE_STORAGE_KEY, size);
}

function saveWidth(width: number) {
  localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
}

export const usePanelStore = create<PanelState>((set, get) => ({
  size: loadSize(),
  width: loadWidth(),

  setSize: (size) => {
    set({ size });
    saveSize(size);
  },

  toggleSize: () => {
    const next = get().size === 'half' ? 'full' : 'half';
    set({ size: next });
    saveSize(next);
  },

  setWidth: (width) => {
    const clamped = Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, width));
    set({ width: clamped });
    saveWidth(clamped);
  },
}));

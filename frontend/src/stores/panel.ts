import { create } from 'zustand';

export const PANEL_WIDTH_MIN = 360;
export const PANEL_WIDTH_MAX = 1200;
export const PANEL_WIDTH_DEFAULT = 640;

interface PanelState {
  width: number;
  setWidth: (width: number) => void;
}

const WIDTH_STORAGE_KEY = 'codeburg:panel-width';

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

function saveWidth(width: number) {
  localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
}

export const usePanelStore = create<PanelState>((set) => ({
  width: loadWidth(),

  setWidth: (width) => {
    const clamped = Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, width));
    set({ width: clamped });
    saveWidth(clamped);
  },
}));

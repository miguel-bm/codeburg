import { create } from 'zustand';

export type CursorStyle = 'block' | 'underline' | 'bar';

interface TerminalSettings {
  fontSize: number;
  scrollback: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  webLinks: boolean;
  webgl: boolean;
}

interface TerminalSettingsState extends TerminalSettings {
  set: <K extends keyof TerminalSettings>(key: K, value: TerminalSettings[K]) => void;
  reset: () => void;
}

const STORAGE_KEY = 'codeburg:terminal-settings';

const DEFAULTS: TerminalSettings = {
  fontSize: 12,
  scrollback: 5000,
  cursorStyle: 'block',
  cursorBlink: true,
  webLinks: true,
  webgl: true,
};

function loadSettings(): TerminalSettings {
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

function saveSettings(settings: TerminalSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const useTerminalSettings = create<TerminalSettingsState>((set, get) => ({
  ...loadSettings(),

  set: (key, value) => {
    set({ [key]: value });
    const state = get();
    saveSettings({
      fontSize: state.fontSize,
      scrollback: state.scrollback,
      cursorStyle: state.cursorStyle,
      cursorBlink: state.cursorBlink,
      webLinks: state.webLinks,
      webgl: state.webgl,
    });
  },

  reset: () => {
    set({ ...DEFAULTS });
    saveSettings(DEFAULTS);
  },
}));

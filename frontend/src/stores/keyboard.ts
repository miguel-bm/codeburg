import { create } from 'zustand';

export type SessionShortcutLayout = 'auto' | 'intl' | 'es';

interface SessionShortcutSettings {
  layout: SessionShortcutLayout;
  nextSession: string;
  prevSession: string;
}

interface SessionShortcutState extends SessionShortcutSettings {
  setLayout: (layout: SessionShortcutLayout) => void;
  setShortcut: (action: 'nextSession' | 'prevSession', value: string) => void;
  reset: () => void;
}

interface ShortcutOption {
  value: string;
  label: string;
}

const STORAGE_KEY = 'codeburg:session-shortcut-settings';

export const NEXT_SESSION_SHORTCUT_OPTIONS: ShortcutOption[] = [
  { value: 'Ctrl+]', label: 'Ctrl + ]' },
  { value: 'Ctrl+.', label: 'Ctrl + .' },
  { value: 'Alt+Shift+ArrowRight', label: 'Alt + Shift + Right Arrow' },
  { value: 'Ctrl+Shift+ArrowRight', label: 'Ctrl + Shift + Right Arrow' },
];

export const PREV_SESSION_SHORTCUT_OPTIONS: ShortcutOption[] = [
  { value: 'Ctrl+[', label: 'Ctrl + [' },
  { value: 'Ctrl+,', label: 'Ctrl + ,' },
  { value: 'Alt+Shift+ArrowLeft', label: 'Alt + Shift + Left Arrow' },
  { value: 'Ctrl+Shift+ArrowLeft', label: 'Ctrl + Shift + Left Arrow' },
];

function detectLayout(): Exclude<SessionShortcutLayout, 'auto'> {
  if (typeof navigator === 'undefined') return 'intl';

  const locales = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const locale of locales) {
    if (locale?.toLowerCase().startsWith('es')) {
      return 'es';
    }
  }
  return 'intl';
}

export function resolveLayout(layout: SessionShortcutLayout): Exclude<SessionShortcutLayout, 'auto'> {
  return layout === 'auto' ? detectLayout() : layout;
}

export function getLayoutDefaults(layout: SessionShortcutLayout): Pick<SessionShortcutSettings, 'nextSession' | 'prevSession'> {
  const resolved = resolveLayout(layout);
  if (resolved === 'es') {
    return {
      nextSession: 'Ctrl+.',
      prevSession: 'Ctrl+,',
    };
  }
  return {
    nextSession: 'Ctrl+]',
    prevSession: 'Ctrl+[',
  };
}

const DEFAULTS: SessionShortcutSettings = {
  layout: 'auto',
  ...getLayoutDefaults('auto'),
};

function isKnownOption(value: string, options: ShortcutOption[]): boolean {
  return options.some((option) => option.value === value);
}

function loadSettings(): SessionShortcutSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };

    const parsed = JSON.parse(raw) as Partial<SessionShortcutSettings>;
    const layout: SessionShortcutLayout =
      parsed.layout === 'auto' || parsed.layout === 'intl' || parsed.layout === 'es'
        ? parsed.layout
        : DEFAULTS.layout;

    const fallback = getLayoutDefaults(layout);
    return {
      layout,
      nextSession:
        typeof parsed.nextSession === 'string' && isKnownOption(parsed.nextSession, NEXT_SESSION_SHORTCUT_OPTIONS)
          ? parsed.nextSession
          : fallback.nextSession,
      prevSession:
        typeof parsed.prevSession === 'string' && isKnownOption(parsed.prevSession, PREV_SESSION_SHORTCUT_OPTIONS)
          ? parsed.prevSession
          : fallback.prevSession,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings: SessionShortcutSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function persistState(settings: SessionShortcutState) {
  const { layout, nextSession, prevSession } = settings;
  saveSettings({ layout, nextSession, prevSession });
}

export const useSessionShortcutSettings = create<SessionShortcutState>((set, get) => ({
  ...loadSettings(),

  setLayout: (layout) => {
    const updated = { layout, ...getLayoutDefaults(layout) };
    set(updated);
    persistState(get());
  },

  setShortcut: (action, value) => {
    set({ [action]: value } as Pick<SessionShortcutState, 'nextSession' | 'prevSession'>);
    persistState(get());
  },

  reset: () => {
    set({ ...DEFAULTS });
    saveSettings(DEFAULTS);
  },
}));

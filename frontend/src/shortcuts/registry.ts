export type ShortcutPlatform = 'mac-desktop' | 'web' | 'all';
export type ShortcutScope = 'global' | 'workspace' | 'classic-session';
export type ShortcutKey = 'Meta' | 'Control' | 'Alt' | 'Shift' | string;

export interface ShortcutDefinition {
  id: string;
  label: string;
  keys: ShortcutKey[];
  platform: ShortcutPlatform;
  scope: ShortcutScope;
  code?: string;
  disabledInEditable?: boolean;
}

export type MacShortcutDefinition = ShortcutDefinition;

export function defineShortcut(input: ShortcutDefinition): ShortcutDefinition {
  return input;
}

export function shortcutDisplay(shortcut: ShortcutDefinition): string {
  return shortcut.keys.map(displayKey).join('');
}

export function displayKey(key: ShortcutKey): string {
  if (key === 'Meta') return '⌘';
  if (key === 'Control') return '⌃';
  if (key === 'Alt') return '⌥';
  if (key === 'Shift') return '⇧';
  return key.toUpperCase();
}

export function shortcutPrimaryKey(shortcut: ShortcutDefinition): string {
  for (let i = shortcut.keys.length - 1; i >= 0; i -= 1) {
    const key = shortcut.keys[i];
    if (key !== 'Meta' && key !== 'Control' && key !== 'Alt' && key !== 'Shift') return key;
  }
  return '';
}

export function shortcutHasKey(shortcut: ShortcutDefinition, key: ShortcutKey): boolean {
  return shortcut.keys.includes(key);
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  const tagName = element?.tagName.toLowerCase();
  return Boolean(
    element?.isContentEditable
      || tagName === 'input'
      || tagName === 'textarea'
      || tagName === 'select'
      || element?.closest('.cm-editor'),
  );
}

export function matchesShortcut(event: KeyboardEvent, shortcut: ShortcutDefinition): boolean {
  const wantsMeta = shortcutHasKey(shortcut, 'Meta');
  const wantsCtrl = shortcutHasKey(shortcut, 'Control');
  const wantsAlt = shortcutHasKey(shortcut, 'Alt');
  const wantsShift = shortcutHasKey(shortcut, 'Shift');
  const primaryKey = shortcutPrimaryKey(shortcut);

  return event.metaKey === wantsMeta
    && event.ctrlKey === wantsCtrl
    && event.altKey === wantsAlt
    && event.shiftKey === wantsShift
    && (shortcut.code ? event.code === shortcut.code : event.key.toLowerCase() === primaryKey.toLowerCase());
}

export const WORKSPACE_SHORTCUTS = {
  newConversation: defineShortcut({
    id: 'workspace.newConversation',
    label: 'New conversation tab',
    keys: ['Meta', 'T'],
    platform: 'mac-desktop',
    scope: 'workspace',
  }),
  newTerminal: defineShortcut({
    id: 'workspace.newTerminal',
    label: 'New terminal tab',
    keys: ['Meta', 'Shift', 'T'],
    platform: 'mac-desktop',
    scope: 'workspace',
  }),
  toggleFiles: defineShortcut({
    id: 'workspace.toggleFiles',
    label: 'Toggle files panel',
    keys: ['Meta', 'Shift', 'A'],
    platform: 'mac-desktop',
    scope: 'workspace',
  }),
  toggleSearch: defineShortcut({
    id: 'workspace.toggleSearch',
    label: 'Toggle search panel',
    keys: ['Meta', 'Shift', 'F'],
    platform: 'mac-desktop',
    scope: 'workspace',
  }),
  toggleChanges: defineShortcut({
    id: 'workspace.toggleChanges',
    label: 'Toggle changes panel',
    keys: ['Meta', 'Shift', 'G'],
    platform: 'mac-desktop',
    scope: 'workspace',
  }),
  togglePreview: defineShortcut({
    id: 'workspace.togglePreview',
    label: 'Toggle preview panel',
    keys: ['Meta', 'Shift', 'P'],
    platform: 'mac-desktop',
    scope: 'workspace',
  }),
  selectTab: (index: number): ShortcutDefinition => defineShortcut({
    id: `workspace.selectTab.${index}`,
    label: `Switch to tab ${index}`,
    keys: ['Meta', String(index)],
    platform: 'mac-desktop',
    scope: 'workspace',
    code: `Digit${index}`,
  }),
} as const;

export const GLOBAL_SHORTCUTS = {
  commandPalette: defineShortcut({
    id: 'global.commandPalette',
    label: 'Open command palette',
    keys: ['Meta', 'K'],
    platform: 'mac-desktop',
    scope: 'global',
  }),
} as const;

export function workspaceShortcutDefinitions(tabCount = 9): ShortcutDefinition[] {
  return [
    ...Array.from({ length: Math.min(Math.max(tabCount, 0), 9) }, (_, index) => WORKSPACE_SHORTCUTS.selectTab(index + 1)),
    WORKSPACE_SHORTCUTS.newConversation,
    WORKSPACE_SHORTCUTS.newTerminal,
    WORKSPACE_SHORTCUTS.toggleFiles,
    WORKSPACE_SHORTCUTS.toggleSearch,
    WORKSPACE_SHORTCUTS.toggleChanges,
    WORKSPACE_SHORTCUTS.togglePreview,
  ];
}

export function allShortcutDefinitions(): ShortcutDefinition[] {
  return [
    GLOBAL_SHORTCUTS.commandPalette,
    ...workspaceShortcutDefinitions(9),
  ];
}

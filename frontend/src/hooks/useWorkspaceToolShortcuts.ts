import { useEffect } from 'react';
import { isDesktopShell } from '../platform/runtimeConfig';
import {
  MAC_WORKSPACE_SHORTCUTS,
  matchesMacShortcut,
  type MacShortcutDefinition,
} from './useMacTabShortcuts';

export type WorkspaceToolShortcutTab = 'files' | 'search' | 'git' | 'preview';

const WORKSPACE_TOOL_SHORTCUTS: Array<[WorkspaceToolShortcutTab, MacShortcutDefinition]> = [
  ['files', MAC_WORKSPACE_SHORTCUTS.toggleFiles],
  ['search', MAC_WORKSPACE_SHORTCUTS.toggleSearch],
  ['git', MAC_WORKSPACE_SHORTCUTS.toggleChanges],
  ['preview', MAC_WORKSPACE_SHORTCUTS.togglePreview],
];

export function useWorkspaceToolShortcuts({
  enabled = true,
  onToggleTool,
}: {
  enabled?: boolean;
  onToggleTool: (tab: WorkspaceToolShortcutTab) => void;
}) {
  useEffect(() => {
    if (!isDesktopShell() || !enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const match = WORKSPACE_TOOL_SHORTCUTS.find(([, shortcut]) => matchesMacShortcut(event, shortcut));
      if (!match) return;
      event.preventDefault();
      event.stopPropagation();
      onToggleTool(match[0]);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [enabled, onToggleTool]);
}

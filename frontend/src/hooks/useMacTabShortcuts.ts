import { useEffect, useState } from 'react';
import { isDesktopShell } from '../platform/runtimeConfig';
import {
  WORKSPACE_SHORTCUTS,
  isEditableShortcutTarget,
  matchesShortcut,
  shortcutDisplay,
  workspaceShortcutDefinitions,
  type MacShortcutDefinition,
  type ShortcutDefinition,
  type ShortcutPlatform,
  type ShortcutScope,
} from '../shortcuts/registry';

export type { MacShortcutDefinition, ShortcutDefinition, ShortcutPlatform, ShortcutScope };
export { WORKSPACE_SHORTCUTS as MAC_WORKSPACE_SHORTCUTS, isEditableShortcutTarget, matchesShortcut as matchesMacShortcut, shortcutDisplay, workspaceShortcutDefinitions };

export interface MacTabShortcutItem {
  id: string;
  action: () => void;
  disabled?: boolean;
}

export const MAC_NEW_CONVERSATION_TAB_EVENT = 'codeburg:mac-new-conversation-tab';
export const MAC_NEW_TERMINAL_TAB_EVENT = 'codeburg:mac-new-terminal-tab';

export interface MacNewTabShortcutOptions {
  onNewConversation: () => void;
  onNewTerminal: () => void;
  conversationDisabled?: boolean;
  terminalDisabled?: boolean;
}

function shortcutIndex(event: KeyboardEvent): number {
  const digit = event.code.startsWith('Digit') || event.code.startsWith('Numpad')
    ? Number(event.code.slice(-1))
    : Number(event.key);

  if (!Number.isInteger(digit) || digit < 1 || digit > 9) return -1;
  return digit - 1;
}

export function useMacNewTabShortcuts({
  onNewConversation,
  onNewTerminal,
  conversationDisabled = false,
  terminalDisabled = false,
}: MacNewTabShortcutOptions, enabled = true): void {
  const desktopShell = isDesktopShell();

  useEffect(() => {
    if (!desktopShell || !enabled) return;

    const runConversation = () => {
      if (conversationDisabled) return;
      onNewConversation();
    };

    const runTerminal = () => {
      if (terminalDisabled) return;
      onNewTerminal();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (matchesShortcut(event, WORKSPACE_SHORTCUTS.newTerminal)) {
        event.preventDefault();
        runTerminal();
        return;
      }
      if (matchesShortcut(event, WORKSPACE_SHORTCUTS.newConversation)) {
        event.preventDefault();
        runConversation();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(MAC_NEW_CONVERSATION_TAB_EVENT, runConversation);
    window.addEventListener(MAC_NEW_TERMINAL_TAB_EVENT, runTerminal);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(MAC_NEW_CONVERSATION_TAB_EVENT, runConversation);
      window.removeEventListener(MAC_NEW_TERMINAL_TAB_EVENT, runTerminal);
    };
  }, [conversationDisabled, desktopShell, enabled, onNewConversation, onNewTerminal, terminalDisabled]);
}

export function useMacTabShortcuts(items: MacTabShortcutItem[], enabled = true): boolean {
  const desktopShell = isDesktopShell();
  const [showHints, setShowHints] = useState(false);

  useEffect(() => {
    if (!desktopShell || !enabled) {
      setShowHints(false);
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Meta') {
        setShowHints(true);
      }

      if (event.defaultPrevented || event.isComposing) return;
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;

      const index = shortcutIndex(event);
      if (index < 0) return;

      const item = items[index];
      if (!item || item.disabled) return;

      event.preventDefault();
      item.action();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Meta' || !event.metaKey) {
        setShowHints(false);
      }
    };

    const onBlur = () => setShowHints(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [desktopShell, enabled, items]);

  return desktopShell && enabled && showHints;
}

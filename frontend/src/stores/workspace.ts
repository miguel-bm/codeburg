import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ActivityPanel = 'files' | 'search' | 'git' | 'tools';

export type WorkspaceTab =
  | { type: 'session'; sessionId: string }
  | { type: 'new_session' }
  | { type: 'editor'; path: string; dirty: boolean; line?: number; ephemeral?: boolean }
  | { type: 'diff'; file?: string; staged?: boolean; base?: boolean; commit?: string; ephemeral?: boolean };

interface OpenTabOptions {
  ephemeral?: boolean;
  forceNew?: boolean;
}

interface WorkspaceState {
  activePanel: ActivityPanel | null;
  activityPanelWidth: number;
  tabs: WorkspaceTab[];
  activeTabIndex: number;

  // Actions
  togglePanel: (panel: ActivityPanel) => void;
  setActivePanel: (panel: ActivityPanel | null) => void;
  setActivityPanelWidth: (width: number) => void;
  openFile: (path: string, line?: number, options?: OpenTabOptions) => void;
  openDiff: (file?: string, staged?: boolean, base?: boolean, commit?: string, options?: OpenTabOptions) => void;
  openNewSession: () => void;
  openSession: (sessionId: string) => void;
  replaceSessionTab: (oldSessionId: string, newSessionId: string) => void;
  closeTab: (index: number) => void;
  closeOtherTabs: (index: number) => void;
  closeTabsToRight: (index: number) => void;
  setActiveTab: (index: number) => void;
  pinTab: (index: number) => void;
  moveTab: (from: number, to: number) => void;
  markDirty: (path: string, dirty: boolean) => void;
  resetTabs: () => void;
}

function isEphemeralTab(tab: WorkspaceTab | undefined): tab is Extract<WorkspaceTab, { type: 'editor' | 'diff' }> {
  return !!tab && (tab.type === 'editor' || tab.type === 'diff') && tab.ephemeral === true;
}

function closePreviousEphemeralIfSwitching(
  tabs: WorkspaceTab[],
  activeTabIndex: number,
  nextActiveTabIndex: number,
): { tabs: WorkspaceTab[]; activeTabIndex: number } {
  if (nextActiveTabIndex === activeTabIndex) {
    return { tabs, activeTabIndex: nextActiveTabIndex };
  }
  if (!isEphemeralTab(tabs[activeTabIndex])) {
    return { tabs, activeTabIndex: nextActiveTabIndex };
  }

  const nextTabs = tabs.filter((_, i) => i !== activeTabIndex);
  const adjustedActive = nextActiveTabIndex > activeTabIndex ? nextActiveTabIndex - 1 : nextActiveTabIndex;
  return { tabs: nextTabs, activeTabIndex: Math.max(0, Math.min(adjustedActive, nextTabs.length - 1)) };
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      activePanel: 'files',
      activityPanelWidth: 260,
      tabs: [],
      activeTabIndex: 0,

      togglePanel: (panel) =>
        set((s) => ({
          activePanel: s.activePanel === panel ? null : panel,
        })),

      setActivePanel: (panel) => set({ activePanel: panel }),

      setActivityPanelWidth: (width) =>
        set({ activityPanelWidth: Math.max(180, Math.min(480, width)) }),

      openFile: (path, line, options) => {
        const { tabs, activeTabIndex } = get();
        const { ephemeral = true, forceNew = false } = options ?? {};
        const existing = tabs.findIndex(
          (t) => t.type === 'editor' && t.path === path,
        );
        if (existing >= 0 && !forceNew) {
          const adjustedTabs = [...tabs];
          if (line !== undefined) {
            adjustedTabs[existing] = { ...adjustedTabs[existing], line } as WorkspaceTab;
          }
          if (!ephemeral && adjustedTabs[existing]?.type === 'editor' && adjustedTabs[existing].ephemeral) {
            adjustedTabs[existing] = { ...adjustedTabs[existing], ephemeral: false } as WorkspaceTab;
          }
          const next = closePreviousEphemeralIfSwitching(adjustedTabs, activeTabIndex, existing);
          set(next);
          return;
        }

        const created = { type: 'editor' as const, path, dirty: false, line, ephemeral };
        const nextTabs = [...tabs, created];
        const next = closePreviousEphemeralIfSwitching(nextTabs, activeTabIndex, nextTabs.length - 1);
        set(next);
      },

      openDiff: (file, staged, base, commit, options) => {
        const { tabs, activeTabIndex } = get();
        const { ephemeral = true, forceNew = false } = options ?? {};
        const existing = tabs.findIndex(
          (t) =>
            t.type === 'diff' &&
            t.file === file &&
            t.staged === staged &&
            t.base === base &&
            t.commit === commit,
        );
        if (existing >= 0 && !forceNew) {
          const adjustedTabs = [...tabs];
          if (!ephemeral && adjustedTabs[existing]?.type === 'diff' && adjustedTabs[existing].ephemeral) {
            adjustedTabs[existing] = { ...adjustedTabs[existing], ephemeral: false } as WorkspaceTab;
          }
          const next = closePreviousEphemeralIfSwitching(adjustedTabs, activeTabIndex, existing);
          set(next);
          return;
        }

        const created = { type: 'diff' as const, file, staged, base, commit, ephemeral };
        const nextTabs = [...tabs, created];
        const next = closePreviousEphemeralIfSwitching(nextTabs, activeTabIndex, nextTabs.length - 1);
        set(next);
      },

      openNewSession: () => {
        const { tabs, activeTabIndex } = get();
        const existing = tabs.findIndex((t) => t.type === 'new_session');
        if (existing >= 0) {
          const next = closePreviousEphemeralIfSwitching(tabs, activeTabIndex, existing);
          set(next);
          return;
        }
        const nextTabs = [...tabs, { type: 'new_session' as const }];
        const next = closePreviousEphemeralIfSwitching(nextTabs, activeTabIndex, nextTabs.length - 1);
        set(next);
      },

      openSession: (sessionId) => {
        const { tabs, activeTabIndex } = get();
        const existing = tabs.findIndex(
          (t) => t.type === 'session' && t.sessionId === sessionId,
        );
        if (existing >= 0) {
          const next = closePreviousEphemeralIfSwitching(tabs, activeTabIndex, existing);
          set(next);
          return;
        }

        const newSessionIdx = tabs.findIndex((t) => t.type === 'new_session');
        if (newSessionIdx >= 0) {
          const nextTabs = [...tabs];
          nextTabs[newSessionIdx] = { type: 'session', sessionId };
          const next = closePreviousEphemeralIfSwitching(nextTabs, activeTabIndex, newSessionIdx);
          set(next);
          return;
        }
        const nextTabs = [...tabs, { type: 'session' as const, sessionId }];
        const next = closePreviousEphemeralIfSwitching(nextTabs, activeTabIndex, nextTabs.length - 1);
        set(next);
      },

      replaceSessionTab: (oldSessionId, newSessionId) => {
        if (!oldSessionId || !newSessionId || oldSessionId === newSessionId) {
          if (newSessionId) get().openSession(newSessionId);
          return;
        }

        const { tabs, activeTabIndex } = get();
        const oldIdx = tabs.findIndex(
          (t) => t.type === 'session' && t.sessionId === oldSessionId,
        );
        if (oldIdx < 0) {
          get().openSession(newSessionId);
          return;
        }

        const existingNewIdx = tabs.findIndex(
          (t) => t.type === 'session' && t.sessionId === newSessionId,
        );

        if (existingNewIdx >= 0) {
          const filtered = tabs.filter((_t, idx) => idx !== oldIdx);
          const existingAfterRemoval = existingNewIdx - (oldIdx < existingNewIdx ? 1 : 0);

          let nextActive = activeTabIndex;
          if (activeTabIndex === oldIdx) {
            nextActive = existingAfterRemoval;
          } else if (activeTabIndex > oldIdx) {
            nextActive = activeTabIndex - 1;
          }
          set({ tabs: filtered, activeTabIndex: Math.max(0, nextActive) });
          return;
        }

        const nextTabs = [...tabs];
        nextTabs[oldIdx] = { type: 'session', sessionId: newSessionId };
        set({ tabs: nextTabs, activeTabIndex: oldIdx });
      },

      closeTab: (index) => {
        const { tabs, activeTabIndex } = get();
        if (index < 0 || index >= tabs.length) return;
        const newTabs = tabs.filter((_, i) => i !== index);
        let newActive = activeTabIndex;
        if (activeTabIndex >= newTabs.length) {
          newActive = Math.max(0, newTabs.length - 1);
        } else if (activeTabIndex > index) {
          newActive = activeTabIndex - 1;
        }
        set({ tabs: newTabs, activeTabIndex: newActive });
      },

      closeOtherTabs: (index) => {
        const { tabs } = get();
        if (index < 0 || index >= tabs.length) return;
        set({ tabs: [tabs[index]], activeTabIndex: 0 });
      },

      closeTabsToRight: (index) => {
        const { tabs, activeTabIndex } = get();
        if (index < 0 || index >= tabs.length - 1) return;
        const newTabs = tabs.slice(0, index + 1);
        set({ tabs: newTabs, activeTabIndex: Math.min(activeTabIndex, newTabs.length - 1) });
      },

      setActiveTab: (index) => {
        const { tabs, activeTabIndex } = get();
        if (index < 0 || index >= tabs.length) return;
        const next = closePreviousEphemeralIfSwitching(tabs, activeTabIndex, index);
        set(next);
      },

      pinTab: (index) => set((s) => {
        const tab = s.tabs[index];
        if (!isEphemeralTab(tab)) return s;
        const nextTabs = [...s.tabs];
        nextTabs[index] = { ...tab, ephemeral: false };
        return { tabs: nextTabs };
      }),

      moveTab: (from, to) => {
        const { tabs, activeTabIndex } = get();
        if (from === to || from < 0 || from >= tabs.length || to < 0 || to >= tabs.length) return;
        const newTabs = [...tabs];
        const [moved] = newTabs.splice(from, 1);
        newTabs.splice(to, 0, moved);
        let newActive = activeTabIndex;
        if (activeTabIndex === from) {
          newActive = to;
        } else if (from < to) {
          if (activeTabIndex > from && activeTabIndex <= to) newActive = activeTabIndex - 1;
        } else {
          if (activeTabIndex >= to && activeTabIndex < from) newActive = activeTabIndex + 1;
        }
        set({ tabs: newTabs, activeTabIndex: newActive });
      },

      markDirty: (path, dirty) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.type === 'editor' && t.path === path ? { ...t, dirty } : t,
          ),
        })),

      resetTabs: () => set({ tabs: [], activeTabIndex: 0 }),
    }),
    {
      name: 'codeburg-workspace',
      partialize: (state) => ({
        activePanel: state.activePanel,
        activityPanelWidth: state.activityPanelWidth,
      }),
    },
  ),
);

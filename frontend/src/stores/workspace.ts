import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ActivityPanel = 'files' | 'search' | 'git' | 'tools';

export type WorkspaceTab =
  | { type: 'session'; sessionId: string }
  | { type: 'new_session' }
  | { type: 'editor'; path: string; dirty: boolean; line?: number }
  | { type: 'diff'; file?: string; staged?: boolean; base?: boolean; commit?: string };

interface WorkspaceState {
  activePanel: ActivityPanel | null;
  activityPanelWidth: number;
  tabs: WorkspaceTab[];
  activeTabIndex: number;

  // Actions
  togglePanel: (panel: ActivityPanel) => void;
  setActivityPanelWidth: (width: number) => void;
  openFile: (path: string, line?: number) => void;
  openDiff: (file?: string, staged?: boolean, base?: boolean, commit?: string) => void;
  openNewSession: () => void;
  openSession: (sessionId: string) => void;
  replaceSessionTab: (oldSessionId: string, newSessionId: string) => void;
  closeTab: (index: number) => void;
  closeOtherTabs: (index: number) => void;
  closeTabsToRight: (index: number) => void;
  setActiveTab: (index: number) => void;
  moveTab: (from: number, to: number) => void;
  markDirty: (path: string, dirty: boolean) => void;
  resetTabs: () => void;
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

      setActivityPanelWidth: (width) =>
        set({ activityPanelWidth: Math.max(180, Math.min(480, width)) }),

      openFile: (path, line) => {
        const { tabs } = get();
        const existing = tabs.findIndex(
          (t) => t.type === 'editor' && t.path === path,
        );
        if (existing >= 0) {
          if (line !== undefined) {
            const newTabs = [...tabs];
            newTabs[existing] = { ...newTabs[existing], line } as WorkspaceTab;
            set({ tabs: newTabs, activeTabIndex: existing });
          } else {
            set({ activeTabIndex: existing });
          }
          return;
        }
        const newTabs = [...tabs, { type: 'editor' as const, path, dirty: false, line }];
        set({ tabs: newTabs, activeTabIndex: newTabs.length - 1 });
      },

      openDiff: (file, staged, base, commit) => {
        const { tabs } = get();
        const existing = tabs.findIndex(
          (t) =>
            t.type === 'diff' &&
            t.file === file &&
            t.staged === staged &&
            t.base === base &&
            t.commit === commit,
        );
        if (existing >= 0) {
          set({ activeTabIndex: existing });
          return;
        }
        const newTabs = [...tabs, { type: 'diff' as const, file, staged, base, commit }];
        set({ tabs: newTabs, activeTabIndex: newTabs.length - 1 });
      },

      openNewSession: () => {
        const { tabs } = get();
        const existing = tabs.findIndex((t) => t.type === 'new_session');
        if (existing >= 0) {
          set({ activeTabIndex: existing });
          return;
        }
        const newTabs = [...tabs, { type: 'new_session' as const }];
        set({ tabs: newTabs, activeTabIndex: newTabs.length - 1 });
      },

      openSession: (sessionId) => {
        const { tabs } = get();
        const existing = tabs.findIndex(
          (t) => t.type === 'session' && t.sessionId === sessionId,
        );
        if (existing >= 0) {
          set({ activeTabIndex: existing });
          return;
        }
        // Replace new_session tab if it exists
        const newSessionIdx = tabs.findIndex((t) => t.type === 'new_session');
        if (newSessionIdx >= 0) {
          const newTabs = [...tabs];
          newTabs[newSessionIdx] = { type: 'session', sessionId };
          set({ tabs: newTabs, activeTabIndex: newSessionIdx });
          return;
        }
        const newTabs = [...tabs, { type: 'session' as const, sessionId }];
        set({ tabs: newTabs, activeTabIndex: newTabs.length - 1 });
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

      setActiveTab: (index) => set({ activeTabIndex: index }),

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

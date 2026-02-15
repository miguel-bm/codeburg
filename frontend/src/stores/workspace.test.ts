import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspace';

describe('workspace store ephemeral tabs', () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceStore.setState({
      activePanel: 'files',
      activityPanelWidth: 260,
      tabs: [],
      activeTabIndex: 0,
    });
  });

  it('opens editor tabs as ephemeral by default', () => {
    useWorkspaceStore.getState().openFile('README.md');

    const tab = useWorkspaceStore.getState().tabs[0];
    expect(tab?.type).toBe('editor');
    if (tab?.type === 'editor') {
      expect(tab.ephemeral).toBe(true);
    }
  });

  it('closes active ephemeral tab when opening a different tab', () => {
    useWorkspaceStore.getState().openFile('README.md');
    useWorkspaceStore.getState().openFile('docs/spec.md');

    const state = useWorkspaceStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabIndex).toBe(0);
    expect(state.tabs[0]).toMatchObject({ type: 'editor', path: 'docs/spec.md', ephemeral: true });
  });

  it('pins ephemeral tab and keeps it when switching', () => {
    const store = useWorkspaceStore.getState();
    store.openFile('README.md');
    store.pinTab(0);
    store.openSession('session-1');

    const state = useWorkspaceStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[0]).toMatchObject({ type: 'editor', path: 'README.md', ephemeral: false });
    expect(state.tabs[1]).toMatchObject({ type: 'session', sessionId: 'session-1' });
  });

  it('setActiveTab closes active ephemeral tab when changing selection', () => {
    const store = useWorkspaceStore.getState();
    store.openSession('session-1');
    store.openFile('README.md');

    useWorkspaceStore.getState().setActiveTab(0);

    const state = useWorkspaceStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabIndex).toBe(0);
    expect(state.tabs[0]).toMatchObject({ type: 'session', sessionId: 'session-1' });
  });

  it('reopening an ephemeral tab with ephemeral=false pins existing tab', () => {
    const store = useWorkspaceStore.getState();
    store.openFile('README.md');
    store.openFile('README.md', undefined, { ephemeral: false });

    const state = useWorkspaceStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ type: 'editor', path: 'README.md', ephemeral: false });
  });
});

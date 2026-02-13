import { useCallback, useRef } from 'react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useWorkspaceSessions } from '../../hooks/useWorkspaceSessions';
import { useWorkspaceSessionSync } from '../../hooks/useWorkspaceSessionSync';
import { useMobile } from '../../hooks/useMobile';
import { useWorkspace } from './WorkspaceContext';
import { ActivityBar, ActivityPanelContent } from './ActivityPanel';
import { TabBar } from './TabBar';
import { EditorTab } from './EditorTab';
import { DiffTab } from './DiffTab';
import { SessionView } from '../session/SessionView';
import { NewSessionComposer } from '../session/NewSessionComposer';

function TabContent() {
  const { tabs, activeTabIndex, openSession } = useWorkspaceStore();
  const { scope, task } = useWorkspace();
  const { sessions, startSession, isStarting, startError } = useWorkspaceSessions();

  const activeTab = tabs[activeTabIndex];

  if (!activeTab) {
    if (sessions.length === 0) {
      const title = task?.title ?? scope.project.name;
      const description = task?.description;
      return (
        <NewSessionComposer
          taskTitle={title}
          taskDescription={description}
          onStart={async (provider, prompt) => {
            const session = await startSession({ provider, prompt: prompt || undefined });
            openSession(session.id);
          }}
          onCancel={() => {}}
          isPending={isStarting}
          error={startError}
          dismissible={false}
        />
      );
    }
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-dim">
        Open a file or start a session
      </div>
    );
  }

  switch (activeTab.type) {
    case 'session': {
      const session = sessions.find((s) => s.id === activeTab.sessionId);
      if (!session) {
        return <div className="flex-1 flex items-center justify-center text-xs text-dim">Session not found</div>;
      }
      return <SessionView session={session} showOpenInNewTab={scope.type === 'task'} />;
    }

    case 'new_session': {
      const title = task?.title ?? scope.project.name;
      const description = task?.description;
      return (
        <NewSessionComposer
          taskTitle={title}
          taskDescription={description}
          onStart={async (provider, prompt) => {
            const session = await startSession({ provider, prompt: prompt || undefined });
            openSession(session.id);
          }}
          onCancel={() => {
            const idx = tabs.findIndex((t) => t.type === 'new_session');
            if (idx >= 0) useWorkspaceStore.getState().closeTab(idx);
          }}
          isPending={isStarting}
          error={startError}
        />
      );
    }

    case 'editor':
      return <EditorTab path={activeTab.path} line={activeTab.line} />;

    case 'diff':
      return <DiffTab file={activeTab.file} staged={activeTab.staged} base={activeTab.base} commit={activeTab.commit} />;
  }
}

export function Workspace() {
  useWorkspaceSessionSync();
  const { activePanel, activityPanelWidth, setActivityPanelWidth } = useWorkspaceStore();
  const isMobile = useMobile();
  const dividerRef = useRef<HTMLDivElement>(null);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = activityPanelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setActivityPanelWidth(startWidth + delta);
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [activityPanelWidth, setActivityPanelWidth]);

  return (
    <div className="flex flex-1 h-full overflow-hidden bg-canvas">
      {/* Activity bar — always visible icon strip */}
      <ActivityBar />

      {isMobile && activePanel ? (
        /* Mobile: activity panel takes full width */
        <ActivityPanelContent panel={activePanel} style={{ width: '100%' }} />
      ) : (
        <>
          {/* Activity panel content (toggleable) */}
          {activePanel && (
            <>
              <ActivityPanelContent panel={activePanel} style={{ width: activityPanelWidth }} />
              <div
                ref={dividerRef}
                className="w-1.5 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors shrink-0"
                onMouseDown={handleDividerMouseDown}
              />
            </>
          )}

          {/* Main area */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-primary">
            <TabBar />
            <div className="flex-1 overflow-hidden">
              <TabContent />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

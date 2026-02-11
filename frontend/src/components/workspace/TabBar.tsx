import { FileText, Plus, X } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import type { WorkspaceTab } from '../../stores/workspace';
import { useWorkspaceSessions } from '../../hooks/useWorkspaceSessions';
import { getSessionStatusMeta } from '../../lib/sessionStatus';
import { fileName } from './editorUtils';
import claudeLogo from '../../assets/claude-logo.svg';
import openaiLogo from '../../assets/openai-logo.svg';

function SessionTabLabel({ tab }: { tab: Extract<WorkspaceTab, { type: 'session' }> }) {
  const { sessions } = useWorkspaceSessions();
  const session = sessions.find((s) => s.id === tab.sessionId);

  if (!session) {
    return <span className="truncate text-dim">Session</span>;
  }

  const { dotClass } = getSessionStatusMeta(session.status);

  return (
    <div className="flex items-center gap-1.5">
      {session.provider === 'claude' && (
        <img src={claudeLogo} alt="" className="h-3.5 w-3.5" />
      )}
      {session.provider === 'codex' && (
        <img src={openaiLogo} alt="" className="h-3.5 w-3.5" />
      )}
      {session.provider === 'terminal' && (
        <span className="font-mono text-[10px] text-dim">{'>'}</span>
      )}
      <div className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      <span className="truncate">#{session.id.slice(0, 6)}</span>
    </div>
  );
}

function TabLabel({ tab }: { tab: WorkspaceTab }) {
  switch (tab.type) {
    case 'session':
      return <SessionTabLabel tab={tab} />;
    case 'new_session':
      return (
        <div className="flex items-center gap-1.5">
          <Plus size={12} />
          <span>New Session</span>
        </div>
      );
    case 'editor':
      return (
        <div className="flex items-center gap-1.5">
          <FileText size={12} className="text-dim shrink-0" />
          <span className="truncate">{fileName(tab.path)}</span>
          {tab.dirty && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
        </div>
      );
    case 'diff':
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-yellow-500">D</span>
          <span className="truncate">{tab.file ? fileName(tab.file) : 'All Changes'}</span>
          {tab.staged && <span className="text-[9px] text-green-500">staged</span>}
          {tab.base && <span className="text-[9px] text-dim">base</span>}
        </div>
      );
  }
}

export function TabBar() {
  const { tabs, activeTabIndex, setActiveTab, closeTab, openNewSession } = useWorkspaceStore();

  if (tabs.length === 0) {
    return (
      <div className="flex items-center h-9 px-2 bg-secondary border-b border-subtle">
        <button
          onClick={openNewSession}
          className="flex items-center gap-1 text-xs text-dim hover:text-accent px-1.5 py-0.5 rounded hover:bg-tertiary"
        >
          <Plus size={12} />
          <span>New Session</span>
        </button>
      </div>
    );
  }

  // Split tabs into session tabs and other tabs
  const sessionTabs: { tab: WorkspaceTab; index: number }[] = [];
  const otherTabs: { tab: WorkspaceTab; index: number }[] = [];

  tabs.forEach((tab, index) => {
    if (tab.type === 'session' || tab.type === 'new_session') {
      sessionTabs.push({ tab, index });
    } else {
      otherTabs.push({ tab, index });
    }
  });

  return (
    <div className="flex items-center h-9 bg-secondary border-b border-subtle overflow-x-auto">
      {/* Session tabs */}
      {sessionTabs.map(({ tab, index }) => (
        <Tab
          key={tab.type === 'session' ? tab.sessionId : 'new_session'}
          tab={tab}
          isActive={activeTabIndex === index}
          onClick={() => setActiveTab(index)}
          onClose={() => closeTab(index)}
        />
      ))}

      {/* Separator between groups */}
      {sessionTabs.length > 0 && otherTabs.length > 0 && (
        <div className="w-px h-5 bg-subtle mx-0.5 shrink-0" />
      )}

      {/* Editor/diff tabs */}
      {otherTabs.map(({ tab, index }) => (
        <Tab
          key={tab.type === 'editor' ? `editor:${tab.path}` : tab.type === 'diff' ? `diff:${tab.file}:${tab.staged}:${tab.base}` : `tab:${index}`}
          tab={tab}
          isActive={activeTabIndex === index}
          onClick={() => setActiveTab(index)}
          onClose={() => closeTab(index)}
        />
      ))}

      {/* New session button */}
      <button
        onClick={openNewSession}
        className="flex items-center justify-center w-7 h-7 mx-0.5 text-dim hover:text-accent hover:bg-tertiary rounded shrink-0"
        title="New Session"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

function Tab({
  tab,
  isActive,
  onClick,
  onClose,
}: {
  tab: WorkspaceTab;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-1 px-2.5 h-full text-xs cursor-pointer shrink-0 border-b-2 transition-colors group max-w-44 ${
        isActive
          ? 'border-accent text-[var(--color-text-primary)] bg-primary'
          : 'border-transparent text-dim hover:text-[var(--color-text-primary)] hover:bg-tertiary'
      }`}
    >
      <TabLabel tab={tab} />
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="p-0.5 text-dim hover:text-[var(--color-error)] opacity-0 group-hover:opacity-100 ml-1 shrink-0"
      >
        <X size={11} />
      </button>
    </div>
  );
}

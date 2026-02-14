import { useState, useCallback, useRef, useEffect } from 'react';
import { FileText, Plus, RotateCcw, X, XCircle, ArrowRightToLine, ChevronDown } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import type { WorkspaceTab } from '../../stores/workspace';
import { useWorkspaceSessions } from '../../hooks/useWorkspaceSessions';
import { useTabActions } from '../../hooks/useTabActions';
import { useMobile } from '../../hooks/useMobile';
import { getSessionStatusMeta } from '../../lib/sessionStatus';
import { haptic } from '../../lib/haptics';
import { fileName } from './editorUtils';
import { ProviderIcon } from '../session/ProviderIcon';
import { useLongPress } from '../../hooks/useLongPress';
import { ContextMenu } from '../ui/ContextMenu';
import type { ContextMenuItem } from '../ui/ContextMenu';
import type { AgentSession } from '../../api/sessions';

function SessionTabLabel({ tab }: { tab: Extract<WorkspaceTab, { type: 'session' }> }) {
  const { sessions } = useWorkspaceSessions();
  const session = sessions.find((s) => s.id === tab.sessionId);

  if (!session) {
    return <span className="truncate text-dim">Session</span>;
  }

  const { dotClass } = getSessionStatusMeta(session.status);

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <ProviderIcon provider={session.provider} />
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
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
        <div className="flex items-center gap-1.5 min-w-0">
          <FileText size={12} className="text-dim shrink-0" />
          <span className="truncate">{fileName(tab.path)}</span>
          {tab.dirty && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
        </div>
      );
    case 'diff':
      return (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-mono text-yellow-500 shrink-0">D</span>
          <span className="truncate">{tab.file ? fileName(tab.file) : tab.commit ? `${tab.commit.slice(0, 7)}` : 'All Changes'}</span>
          {tab.staged && <span className="text-[9px] text-green-500 shrink-0">staged</span>}
          {tab.base && <span className="text-[9px] text-dim shrink-0">base</span>}
          {tab.commit && <span className="text-[9px] text-accent shrink-0">commit</span>}
        </div>
      );
  }
}

export function TabBar() {
  const isMobile = useMobile();

  if (isMobile) {
    return <MobileTabBar />;
  }

  return <DesktopTabBar />;
}

function MobileTabBar() {
  const { tabs, activeTabIndex, setActiveTab, openNewSession } = useWorkspaceStore();
  const { closeTab } = useTabActions();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick as EventListener);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick as EventListener);
    };
  }, [dropdownOpen]);

  const activeTab = tabs[activeTabIndex];

  if (tabs.length === 0) {
    return (
      <div className="flex items-center h-9 px-2 bg-canvas border-b border-subtle">
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

  return (
    <div className="relative flex items-center h-9 bg-canvas border-b border-subtle px-1" ref={dropdownRef}>
      {/* Active tab indicator + dropdown trigger */}
      <button
        onClick={() => { haptic(); setDropdownOpen((prev) => !prev); }}
        className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-accent/15 text-accent min-w-0 max-w-[70%]"
      >
        <div className="min-w-0 overflow-hidden">
          {activeTab ? <TabLabel tab={activeTab} /> : <span className="text-dim">No tab</span>}
        </div>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Tab count badge */}
      {tabs.length > 1 && (
        <span className="ml-1.5 text-[10px] text-dim tabular-nums">{tabs.length}</span>
      )}

      <div className="flex-1" />

      {/* New session button */}
      <button
        onClick={openNewSession}
        className="flex items-center justify-center w-7 h-7 text-dim hover:text-accent hover:bg-tertiary rounded shrink-0"
        title="New Session"
      >
        <Plus size={13} />
      </button>

      {/* Dropdown */}
      {dropdownOpen && (
        <div className="absolute top-full left-0 right-0 z-30 mt-0.5 mx-1 rounded-lg border border-subtle bg-card shadow-card overflow-hidden">
          <div className="max-h-64 overflow-y-auto py-1">
            {tabs.map((tab, index) => {
              const isActive = index === activeTabIndex;
              return (
                <div
                  key={tab.type === 'session' ? tab.sessionId : tab.type === 'editor' ? `editor:${tab.path}` : tab.type === 'diff' ? `diff:${tab.file}:${tab.staged}:${tab.commit}` : `tab:${index}`}
                  className={`flex items-center gap-2 px-3 py-2 text-xs ${
                    isActive ? 'bg-accent/10 text-accent' : 'text-[var(--color-text-primary)]'
                  }`}
                >
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => { haptic(); setActiveTab(index); setDropdownOpen(false); }}
                  >
                    <TabLabel tab={tab} />
                  </button>
                  <button
                    onClick={() => { closeTab(index); if (tabs.length <= 1) setDropdownOpen(false); }}
                    className="p-1 text-dim hover:text-[var(--color-error)] shrink-0 rounded"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DesktopTabBar() {
  const { tabs, activeTabIndex, setActiveTab, openNewSession, openSession, replaceSessionTab, moveTab } = useWorkspaceStore();
  const { sessions, startSession, deleteSession, isStarting } = useWorkspaceSessions();
  const { closeTab, closeOtherTabs, closeTabsToRight } = useTabActions();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ index: number; position: { x: number; y: number } } | null>(null);

  const handleDrop = useCallback((targetIndex: number) => {
    if (dragFrom !== null && dragFrom !== targetIndex) {
      moveTab(dragFrom, targetIndex);
    }
    setDragFrom(null);
    setDragOver(null);
  }, [dragFrom, moveTab]);

  const handleDragEnd = useCallback(() => {
    setDragFrom(null);
    setDragOver(null);
  }, []);

  const handleResumeSession = useCallback(async (session: AgentSession) => {
    if (session.sessionType !== 'chat') return;
    setResumingSessionId(session.id);
    try {
      const resumed = await startSession({
        provider: session.provider,
        sessionType: session.sessionType,
        resumeSessionId: session.id,
      });
      replaceSessionTab(session.id, resumed.id);
      openSession(resumed.id);
      try {
        await deleteSession(session.id);
      } catch {
        // Best-effort cleanup; resumed session is already active.
      }
    } finally {
      setResumingSessionId(null);
    }
  }, [deleteSession, openSession, replaceSessionTab, startSession]);

  if (tabs.length === 0) {
    return (
      <div className="flex items-center h-9 px-2 bg-canvas border-b border-subtle">
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
    <div className="flex items-center h-9 bg-canvas border-b border-subtle overflow-x-scroll scrollbar-none py-1 gap-0.5 px-1">
      {/* Session tabs */}
      {sessionTabs.map(({ tab, index }) => {
        const session = tab.type === 'session'
          ? sessions.find((s) => s.id === tab.sessionId)
          : undefined;
        const canResume = !!session && session.sessionType === 'chat' && session.status === 'completed';
        const resumePending = !!session && isStarting && resumingSessionId === session.id;
        return (
          <Tab
            key={tab.type === 'session' ? tab.sessionId : 'new_session'}
            tab={tab}
            storeIndex={index}
            isActive={activeTabIndex === index}
            isDragging={dragFrom === index}
            isDragOver={dragOver === index && dragFrom !== null && dragFrom !== index}
            onClick={() => setActiveTab(index)}
            onClose={() => closeTab(index)}
            onContextMenu={(pos) => setContextMenu({ index, position: pos })}
            onDragStart={() => setDragFrom(index)}
            onDragOver={() => setDragOver(index)}
            onDrop={() => handleDrop(index)}
            onDragEnd={handleDragEnd}
            canResume={canResume}
            resumePending={resumePending}
            onResume={session ? () => { void handleResumeSession(session); } : undefined}
          />
        );
      })}

      {/* Separator between groups */}
      {sessionTabs.length > 0 && otherTabs.length > 0 && (
        <div className="w-px h-5 bg-subtle mx-0.5 shrink-0" />
      )}

      {/* Editor/diff tabs */}
      {otherTabs.map(({ tab, index }) => (
        <Tab
          key={tab.type === 'editor' ? `editor:${tab.path}` : tab.type === 'diff' ? `diff:${tab.file}:${tab.staged}:${tab.base}:${tab.commit}` : `tab:${index}`}
          tab={tab}
          storeIndex={index}
          isActive={activeTabIndex === index}
          isDragging={dragFrom === index}
          isDragOver={dragOver === index && dragFrom !== null && dragFrom !== index}
          onClick={() => setActiveTab(index)}
          onClose={() => closeTab(index)}
          onContextMenu={(pos) => setContextMenu({ index, position: pos })}
          onDragStart={() => setDragFrom(index)}
          onDragOver={() => setDragOver(index)}
          onDrop={() => handleDrop(index)}
          onDragEnd={handleDragEnd}
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

      {/* Tab context menu (long-press on mobile, right-click on desktop) */}
      {contextMenu && (
        <ContextMenu
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          items={buildTabContextMenuItems(contextMenu.index, tabs.length, closeTab, closeOtherTabs, closeTabsToRight)}
        />
      )}
    </div>
  );
}

function Tab({
  tab,
  storeIndex,
  isActive,
  isDragging,
  isDragOver,
  onClick,
  onClose,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  canResume,
  onResume,
  resumePending,
}: {
  tab: WorkspaceTab;
  storeIndex: number;
  isActive: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onClick: () => void;
  onClose: () => void;
  onContextMenu: (position: { x: number; y: number }) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  canResume?: boolean;
  onResume?: () => void;
  resumePending?: boolean;
}) {
  const longPress = useLongPress({
    onLongPress: () => {
      // Use a reasonable position — center of where the finger is
      // We can't get touch coords from useLongPress directly, so we track them
      onContextMenu(lastTouchPos.current);
    },
    onClick,
  });

  // Track touch position for long-press menu placement
  const lastTouchPos = useRef({ x: 0, y: 0 });

  return (
    <div
      draggable
      {...longPress}
      onTouchStart={(e) => {
        const touch = e.touches[0];
        lastTouchPos.current = { x: touch.clientX, y: touch.clientY };
        longPress.onTouchStart();
      }}
      onMouseDown={(e) => {
        if (e.button === 1) { e.preventDefault(); onClose(); return; }
        longPress.onMouseDown();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu({ x: e.clientX, y: e.clientY });
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(storeIndex));
        onDragStart();
      }}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={onDragEnd}
      className={`relative flex items-center gap-1 px-2.5 py-1 text-xs cursor-pointer shrink-0 rounded-md transition-colors group max-w-44 ${
        isDragging ? 'opacity-30' : ''
      } ${
        isActive
          ? 'bg-accent/15 text-accent'
          : 'bg-secondary text-dim hover:text-[var(--color-text-secondary)] hover:bg-tertiary'
      }`}
    >
      {isDragOver && (
        <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full" />
      )}
      <div className="min-w-0 overflow-hidden">
        <TabLabel tab={tab} />
      </div>
      {canResume && onResume && (
        <button
          onClick={(e) => { e.stopPropagation(); onResume(); }}
          className="p-0.5 text-dim hover:text-accent opacity-0 group-hover:opacity-100 shrink-0"
          title={resumePending ? 'Resuming...' : 'Resume from this session'}
          disabled={resumePending}
        >
          <RotateCcw size={11} className={resumePending ? 'animate-spin' : undefined} />
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="p-0.5 text-dim hover:text-[var(--color-error)] opacity-0 group-hover:opacity-100 shrink-0"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function buildTabContextMenuItems(
  index: number,
  tabCount: number,
  closeTab: (i: number) => void,
  closeOtherTabs: (i: number) => void,
  closeTabsToRight: (i: number) => void,
): ContextMenuItem[] {
  return [
    {
      label: 'Close',
      icon: X,
      onClick: () => closeTab(index),
    },
    {
      label: 'Close Others',
      icon: XCircle,
      onClick: () => closeOtherTabs(index),
      disabled: tabCount <= 1,
    },
    {
      label: 'Close to the Right',
      icon: ArrowRightToLine,
      onClick: () => closeTabsToRight(index),
      disabled: index >= tabCount - 1,
    },
  ];
}

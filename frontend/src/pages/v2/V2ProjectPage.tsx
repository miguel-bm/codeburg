import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CircleSlash,
  Files,
  GitBranch,
  GitCommitHorizontal,
  MessageSquarePlus,
  MessageSquareText,
  PanelRightOpen,
  PlusCircle,
  RefreshCw,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { Conversation, TerminalSession, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';
import { TerminalView } from '../../components/session/TerminalView';
import { Badge } from '../../components/ui/Badge';
import { DiffTab } from '../../components/workspace/DiffTab';
import { EditorTab } from '../../components/workspace/EditorTab';
import { WorkspaceProvider } from '../../components/workspace/WorkspaceContext';
import { fileName } from '../../components/workspace/editorUtils';
import { useWorkspaceStore, type WorkspaceTab } from '../../stores/workspace';
import type { ReactNode } from 'react';
import {
  Button,
  V2Empty,
  V2Input,
  V2Screen,
} from './v2-ui';
import { V2QuickActionsMenu } from './V2QuickActionsMenu';
import { V2WorkspaceTools, type V2HelperTab } from './V2WorkspaceTools';

type MainSurface = { type: 'terminal'; terminalId: string } | { type: 'workspaceTab'; index: number } | null;

export function V2ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const resetWorkspaceTabs = useWorkspaceStore((state) => state.resetTabs);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabIndex = useWorkspaceStore((state) => state.activeTabIndex);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);

  const [helperTab, setHelperTab] = useState<V2HelperTab>('files');
  const [toolsOpen, setToolsOpen] = useState(true);
  const [toolsWidth, setToolsWidth] = useState(360);
  const [composerMode, setComposerMode] = useState<'create' | 'fork' | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceBaseBranch, setWorkspaceBaseBranch] = useState('');
  const [mainSurface, setMainSurface] = useState<MainSurface>(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);

  const requestedWorkspaceId = searchParams.get('workspace');
  const requestedTerminalId = searchParams.get('terminal');
  const requestedNewWorkspace = searchParams.get('newWorkspace') === '1';
  const workspacesQueryKey = ['v2-workspaces', id] as const;

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  const { data: workspaces } = useQuery({
    queryKey: workspacesQueryKey,
    queryFn: () => v2Api.listWorkspaces(id!),
    enabled: !!id,
  });

  const sortedWorkspaces = useMemo(() => [...(workspaces ?? [])].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'main' ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  }), [workspaces]);
  const defaultWorkspace = sortedWorkspaces.find((workspace) => workspace.kind === 'main') ?? sortedWorkspaces[0] ?? null;
  const activeWorkspace = sortedWorkspaces.find((workspace) => workspace.id === requestedWorkspaceId) ?? defaultWorkspace;
  const activeWorkspaceId = activeWorkspace?.id ?? null;

  const { data: terminals } = useQuery({
    queryKey: ['v2-terminals', activeWorkspaceId],
    queryFn: () => v2Api.listTerminals(activeWorkspaceId!),
    enabled: !!activeWorkspaceId,
    refetchInterval: 5000,
  });
  const { data: workspaceConversations = [] } = useQuery({
    queryKey: ['v2-workspace-conversations', activeWorkspaceId],
    queryFn: async () => {
      if (!project || !activeWorkspaceId) return [];
      const conversations = await v2Api.listProjectConversations(project.id, { provider: 'pi', status: 'active' });
      return conversations.filter((conversation) => conversation.currentWorkspaceId === activeWorkspaceId);
    },
    enabled: !!project && !!activeWorkspaceId,
  });

  const sortedTerminals = useMemo(() => [...(terminals ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [terminals]);
  const activeTerminal = mainSurface?.type === 'terminal'
    ? sortedTerminals.find((terminal) => terminal.id === mainSurface.terminalId) ?? null
    : requestedTerminalId
      ? sortedTerminals.find((terminal) => terminal.id === requestedTerminalId) ?? null
      : null;
  const activeWorkspaceTab = mainSurface?.type === 'workspaceTab' ? tabs[mainSurface.index] : null;

  useEffect(() => {
    resetWorkspaceTabs();
    setMainSurface(null);
  }, [activeWorkspaceId, resetWorkspaceTabs]);

  useEffect(() => {
    if (!requestedTerminalId || !sortedTerminals.some((terminal) => terminal.id === requestedTerminalId)) return;
    setMainSurface((current) => {
      if (current?.type === 'terminal' && current.terminalId === requestedTerminalId) return current;
      return { type: 'terminal', terminalId: requestedTerminalId };
    });
  }, [requestedTerminalId, sortedTerminals]);

  useEffect(() => {
    if (tabs.length === 0) return;
    const activeTab = tabs[activeTabIndex];
    if (activeTab?.type === 'editor' || activeTab?.type === 'diff') {
      setMainSurface({ type: 'workspaceTab', index: activeTabIndex });
    }
  }, [tabs, activeTabIndex]);

  const invalidateTerminals = async () => {
    await queryClient.invalidateQueries({ queryKey: ['v2-terminals', activeWorkspaceId] });
  };

  const createTerminal = useMutation({
    mutationFn: (input?: { title?: string; initialCommand?: string }) => v2Api.createTerminal(activeWorkspaceId!, {
      title: input?.title ?? `Terminal #${sortedTerminals.length + 1}`,
      initialCommand: input?.initialCommand,
    }),
    onSuccess: async (terminal) => {
      setMainSurface({ type: 'terminal', terminalId: terminal.id });
      navigate(`/v2/projects/${id}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`, { replace: true });
      await invalidateTerminals();
    },
  });
  const createConversation = useMutation({
    mutationFn: () => v2Api.createConversation(id!, {
      title: `New ${activeWorkspace?.name ?? project?.name ?? 'workspace'} conversation`,
      currentWorkspaceId: activeWorkspaceId ?? undefined,
    }),
    onSuccess: async (conversation) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', id, 'sidebar'] }),
      ]);
      navigate(`/v2/conversations/${conversation.id}`);
    },
  });

  const renameTerminal = useMutation({
    mutationFn: ({ terminalId, title }: { terminalId: string; title: string }) =>
      v2Api.updateTerminal(terminalId, { title }),
    onSuccess: invalidateTerminals,
  });

  const closeTerminal = useMutation({
    mutationFn: (terminalId: string) => v2Api.deleteTerminal(terminalId),
    onSuccess: async (_, terminalId) => {
      if (mainSurface?.type === 'terminal' && mainSurface.terminalId === terminalId) {
        setMainSurface(null);
      }
      await invalidateTerminals();
    },
  });

  const createWorkspace = useMutation({
    mutationFn: (input: { name: string; baseBranch?: string }) => v2Api.createWorkspace(id!, input),
    onSuccess: async (response) => {
      clearComposer();
      navigate(`/v2/projects/${id}?workspace=${response.workspace.id}`);
      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
    },
  });

  const forkWorkspace = useMutation({
    mutationFn: (input: { name: string; baseBranch?: string }) =>
      v2Api.forkWorkspace(activeWorkspaceId!, input),
    onSuccess: async (response) => {
      clearComposer();
      navigate(`/v2/projects/${id}?workspace=${response.workspace.id}`);
      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
    },
  });

  const deleteWorkspace = useMutation({
    mutationFn: (workspaceId: string) => v2Api.deleteWorkspace(workspaceId),
    onSuccess: async () => {
      navigate(`/v2/projects/${id}`);
      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
    },
  });

  const mutateWorkspaceStatus = useMutation({
    mutationFn: async ({ workspaceId, action }: { workspaceId: string; action: 'activate' | 'merge' | 'abandon' | 'archive' }) => {
      if (action === 'activate') return v2Api.activateWorkspace(workspaceId);
      if (action === 'merge') return v2Api.mergeWorkspace(workspaceId);
      if (action === 'abandon') return v2Api.abandonWorkspace(workspaceId);
      return v2Api.archiveWorkspace(workspaceId);
    },
    onSuccess: async (workspace) => {
      if (workspace.status !== 'active') setMainSurface(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspacesQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['v2-terminals', workspace.id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', id] }),
      ]);
    },
  });

  const syncWorkspace = useMutation({
    mutationFn: (workspaceId: string) => v2Api.syncWorkspace(workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
    },
  });

  useEffect(() => {
    if (composerMode === 'create') {
      setWorkspaceBaseBranch(project?.defaultBranch ?? activeWorkspace?.branchName ?? 'main');
      setWorkspaceName('');
    }
    if (composerMode === 'fork') {
      setWorkspaceBaseBranch(activeWorkspace?.branchName ?? project?.defaultBranch ?? 'main');
      setWorkspaceName(activeWorkspace ? `${activeWorkspace.name} fork` : '');
    }
  }, [composerMode, activeWorkspace, project]);

  useEffect(() => {
    if (requestedNewWorkspace && !composerMode) setComposerMode('create');
  }, [requestedNewWorkspace, composerMode]);

  const workspacePending =
    createWorkspace.isPending ||
    forkWorkspace.isPending ||
    deleteWorkspace.isPending ||
    mutateWorkspaceStatus.isPending ||
    syncWorkspace.isPending;
  const workspaceError =
    createWorkspace.error ?? forkWorkspace.error ?? deleteWorkspace.error ?? mutateWorkspaceStatus.error ?? syncWorkspace.error;
  const terminalDisabled = !activeWorkspaceId || activeWorkspace?.status !== 'active' || createTerminal.isPending;

  const clearComposer = () => {
    setComposerMode(null);
    setWorkspaceName('');
    setWorkspaceBaseBranch('');
  };

  const submitWorkspaceComposer = () => {
    const payload = { name: workspaceName.trim(), baseBranch: workspaceBaseBranch.trim() || undefined };
    if (!payload.name) return;
    if (composerMode === 'fork') forkWorkspace.mutate(payload);
    else createWorkspace.mutate(payload);
  };

  const beginResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    resizeStart.current = { x: event.clientX, width: toolsWidth };
    const onMove = (moveEvent: MouseEvent) => {
      if (!resizeStart.current) return;
      const delta = resizeStart.current.x - moveEvent.clientX;
      setToolsWidth(Math.max(280, Math.min(640, resizeStart.current.width + delta)));
    };
    const onUp = () => {
      resizeStart.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [toolsWidth]);

  const content = (
    <V2Screen>
      {composerMode && (
        <div className="bg-card px-5 py-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-56">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-dim">
                {composerMode === 'fork' ? 'Fork name' : 'Workspace name'}
              </div>
              <V2Input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="feat/runtime-polish" />
            </label>
            <label className="min-w-44">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-dim">Base branch</div>
              <V2Input value={workspaceBaseBranch} onChange={(event) => setWorkspaceBaseBranch(event.target.value)} placeholder={project?.defaultBranch ?? 'main'} />
            </label>
            <Button size="sm" variant="primary" loading={workspacePending} disabled={!workspaceName.trim()} onClick={submitWorkspaceComposer}>
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={clearComposer}>Cancel</Button>
            {workspaceError instanceof Error && <span className="text-xs text-[var(--color-error)]">{workspaceError.message}</span>}
          </div>
        </div>
      )}

      {activeWorkspace && (
        <div className="flex h-10 shrink-0 items-center justify-between bg-canvas px-4">
          <div className="flex min-w-0 items-center gap-2 text-xs text-dim">
            <GitBranch size={14} />
            <span className="truncate font-medium text-[var(--color-text-primary)]">{activeWorkspace.name}</span>
            {activeWorkspace.branchName !== activeWorkspace.name && <span className="truncate">{activeWorkspace.branchName}</span>}
            <Badge variant="label" color={statusColor(activeWorkspace.status)}>{activeWorkspace.status}</Badge>
          </div>
          <div className="flex items-center gap-1">
            {project && (
              <V2QuickActionsMenu projectId={project.id} workspaceId={activeWorkspace.id} disabled={terminalDisabled} />
            )}
            <WorkspaceActions
              workspace={activeWorkspace}
              pending={workspacePending}
              onSync={() => syncWorkspace.mutate(activeWorkspace.id)}
              onMerge={() => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'merge' })}
              onAbandon={() => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'abandon' })}
              onReactivate={() => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'activate' })}
              onArchive={() => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'archive' })}
              onDelete={() => deleteWorkspace.mutate(activeWorkspace.id)}
            />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col bg-primary">
          <MainTabBar
            terminals={sortedTerminals}
            terminalPending={closeTerminal.isPending || renameTerminal.isPending}
            activeSurface={mainSurface}
            tabs={tabs}
            activeTabIndex={activeTabIndex}
            onSelectTerminal={(terminal) => {
              setMainSurface({ type: 'terminal', terminalId: terminal.id });
              navigate(`/v2/projects/${id}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`, { replace: true });
            }}
            onCloseTerminal={(terminal) => closeTerminal.mutate(terminal.id)}
            onRenameTerminal={(terminal, title) => renameTerminal.mutate({ terminalId: terminal.id, title })}
            conversations={workspaceConversations}
            onSelectConversation={(conversation) => navigate(`/v2/conversations/${conversation.id}`)}
            onCreateConversation={() => createConversation.mutate()}
            onSelectWorkspaceTab={(index) => {
              setActiveTab(index);
              setMainSurface({ type: 'workspaceTab', index });
            }}
            onCloseWorkspaceTab={(index) => {
              closeTab(index);
              setMainSurface(null);
            }}
            onCreateTerminal={() => createTerminal.mutate(undefined)}
            createTerminalDisabled={terminalDisabled}
            createTerminalPending={createTerminal.isPending}
            createConversationPending={createConversation.isPending}
          />

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeTerminal ? (
              <TerminalView sessionId={activeTerminal.id} targetType="terminal" />
            ) : activeWorkspaceTab?.type === 'editor' ? (
              <EditorTab path={activeWorkspaceTab.path} line={activeWorkspaceTab.line} />
            ) : activeWorkspaceTab?.type === 'diff' ? (
              <DiffTab file={activeWorkspaceTab.file} staged={activeWorkspaceTab.staged} base={activeWorkspaceTab.base} commit={activeWorkspaceTab.commit} />
            ) : (
              <V2Empty
                icon={<SquareTerminal size={32} />}
                title="Choose a terminal, file, or diff"
            body={activeWorkspace?.status !== 'active'
              ? `This workspace is ${activeWorkspace?.status}. Reactivate it before starting terminals.`
              : 'Open a conversation, terminal, file, or diff from the workspace controls.'}
                action={
                  <div className="flex items-center justify-center gap-2">
                    <Button size="sm" variant="primary" icon={<MessageSquarePlus size={14} />} disabled={!activeWorkspaceId || activeWorkspace?.status !== 'active'} loading={createConversation.isPending} onClick={() => createConversation.mutate()}>New conversation</Button>
                    <Button size="sm" variant="secondary" icon={<SquareTerminal size={14} />} disabled={terminalDisabled} loading={createTerminal.isPending} onClick={() => createTerminal.mutate(undefined)}>New terminal</Button>
                  </div>
                }
              />
            )}
          </div>
        </section>

        {toolsOpen && (
          <>
            <div className="w-1.5 shrink-0 cursor-col-resize bg-canvas hover:bg-accent/30" onMouseDown={beginResize} />
            <aside className="min-h-0 shrink-0 border-l border-[var(--color-card-border)] bg-canvas" style={{ width: toolsWidth }}>
              {project && activeWorkspace ? (
                <V2WorkspaceTools
                  helperTab={helperTab}
                  onSelectHelperTab={setHelperTab}
                  onClose={() => setToolsOpen(false)}
                />
              ) : (
                <V2Empty
                  icon={<Files size={24} />}
                  title="Loading workspace tools"
                  body="Files, search, and git actions will appear once the project workspace is ready."
                />
              )}
            </aside>
          </>
        )}

        {!toolsOpen && (
          <button
            type="button"
            onClick={() => setToolsOpen(true)}
            className="flex w-9 shrink-0 items-center justify-center border-l border-[var(--color-card-border)] bg-canvas text-dim hover:text-[var(--color-text-primary)]"
            title="Open tools"
          >
            <PanelRightOpen size={16} />
          </button>
        )}
      </div>
    </V2Screen>
  );

  if (!project || !activeWorkspace) return content;

  return (
    <WorkspaceProvider scope={{ type: 'workspace', workspaceId: activeWorkspace.id, workspace: activeWorkspace, project }}>
      {content}
    </WorkspaceProvider>
  );
}

function WorkspaceActions({
  workspace,
  pending,
  onSync,
  onMerge,
  onAbandon,
  onReactivate,
  onArchive,
  onDelete,
}: {
  workspace: Workspace;
  pending: boolean;
  onSync: () => void;
  onMerge: () => void;
  onAbandon: () => void;
  onReactivate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  if (workspace.kind === 'main') {
    return (
      <Button size="xs" variant="secondary" icon={<RefreshCw size={13} />} disabled={pending || workspace.status !== 'active'} onClick={onSync}>
        <span title="Fetch the default branch and fast-forward this main workspace branch when possible.">Sync branch</span>
      </Button>
    );
  }
  if (workspace.status !== 'active') {
    return (
      <div className="flex items-center gap-1">
        <Button size="xs" variant="secondary" icon={<RefreshCw size={13} />} disabled={pending} onClick={onReactivate}>Reactivate</Button>
        {workspace.status !== 'archived' && <Button size="xs" variant="ghost" icon={<Archive size={13} />} disabled={pending} onClick={onArchive}>Archive</Button>}
        <Button size="xs" variant="danger" icon={<Trash2 size={13} />} disabled={pending} onClick={onDelete}>Delete</Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Button size="xs" variant="secondary" icon={<RefreshCw size={13} />} disabled={pending} onClick={onSync}>Sync</Button>
      <Button size="xs" variant="secondary" icon={<GitCommitHorizontal size={13} />} disabled={pending} onClick={onMerge}>Merge</Button>
      <Button size="xs" variant="ghost" icon={<CircleSlash size={13} />} disabled={pending} onClick={onAbandon}>Abandon</Button>
      <Button size="xs" variant="danger" icon={<Trash2 size={13} />} disabled={pending} onClick={onDelete}>Delete</Button>
    </div>
  );
}

function MainTabBar({
  terminals,
  terminalPending,
  activeSurface,
  tabs,
  activeTabIndex,
  onSelectTerminal,
  onCloseTerminal,
  onRenameTerminal,
  conversations,
  onSelectConversation,
  onCreateConversation,
  onSelectWorkspaceTab,
  onCloseWorkspaceTab,
  onCreateTerminal,
  createTerminalDisabled,
  createTerminalPending,
  createConversationPending,
}: {
  terminals: TerminalSession[];
  terminalPending: boolean;
  activeSurface: MainSurface;
  tabs: WorkspaceTab[];
  activeTabIndex: number;
  onSelectTerminal: (terminal: TerminalSession) => void;
  onCloseTerminal: (terminal: TerminalSession) => void;
  onRenameTerminal: (terminal: TerminalSession, title: string) => void;
  conversations: Conversation[];
  onSelectConversation: (conversation: Conversation) => void;
  onCreateConversation: () => void;
  onSelectWorkspaceTab: (index: number) => void;
  onCloseWorkspaceTab: (index: number) => void;
  onCreateTerminal: () => void;
  createTerminalDisabled: boolean;
  createTerminalPending: boolean;
  createConversationPending: boolean;
}) {
  const [newTabOpen, setNewTabOpen] = useState(false);
  const workspaceTabs = tabs
    .map((tab, index) => ({ tab, index }))
    .filter((entry): entry is { tab: Extract<WorkspaceTab, { type: 'editor' | 'diff' }>; index: number } => entry.tab.type === 'editor' || entry.tab.type === 'diff');

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto bg-canvas px-2 scrollbar-none">
      <div className="relative shrink-0">
        <button
          type="button"
          disabled={createTerminalDisabled && createConversationPending}
          onClick={() => setNewTabOpen((value) => !value)}
          className="inline-flex h-7 cursor-pointer items-center justify-center rounded-md px-2 text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50"
          title="New tab"
        >
          <PlusCircle size={15} />
        </button>
        {newTabOpen && (
          <>
            <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close new tab menu" onClick={() => setNewTabOpen(false)} />
            <div className="absolute left-0 top-8 z-50 w-44 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]">
              <NewTabMenuItem icon={<MessageSquarePlus size={14} />} disabled={createConversationPending} onClick={() => { setNewTabOpen(false); onCreateConversation(); }}>Conversation</NewTabMenuItem>
              <NewTabMenuItem icon={<SquareTerminal size={14} />} disabled={createTerminalDisabled || createTerminalPending} onClick={() => { setNewTabOpen(false); onCreateTerminal(); }}>Terminal</NewTabMenuItem>
            </div>
          </>
        )}
      </div>
      {conversations.map((conversation) => (
        <button
          key={conversation.id}
          type="button"
          onClick={() => onSelectConversation(conversation)}
          className="inline-flex h-7 max-w-[15rem] items-center gap-1.5 rounded-md px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]"
        >
          <MessageSquareText size={13} />
          <span className="truncate">{conversation.title}</span>
        </button>
      ))}
      {terminals.map((terminal) => (
        <TerminalTab
          key={terminal.id}
          terminal={terminal}
          active={activeSurface?.type === 'terminal' && activeSurface.terminalId === terminal.id}
          pending={terminalPending}
          onSelect={() => onSelectTerminal(terminal)}
          onClose={() => onCloseTerminal(terminal)}
          onRename={(title) => onRenameTerminal(terminal, title)}
        />
      ))}
      {workspaceTabs.map(({ tab, index }) => (
        <button
          key={previewTabKey(tab, index)}
          type="button"
          onClick={() => onSelectWorkspaceTab(index)}
          className={`inline-flex h-7 max-w-[15rem] items-center gap-1.5 rounded-md px-2 text-xs ${
            activeSurface?.type === 'workspaceTab' && activeSurface.index === index
              ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]'
              : 'bg-[var(--color-card)] text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)]'
          }`}
        >
          {tab.type === 'editor' ? <Files size={13} /> : <GitCommitHorizontal size={13} />}
          <span className="truncate">{previewTabLabel(tab)}</span>
          {index === activeTabIndex && tab.ephemeral && <span className="text-dim">preview</span>}
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onCloseWorkspaceTab(index);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onCloseWorkspaceTab(index);
              }
            }}
            className="text-dim hover:text-[var(--color-text-primary)]"
          >
            <X size={12} />
          </span>
        </button>
      ))}
    </div>
  );
}

function NewTabMenuItem({ icon, children, disabled, onClick }: { icon: ReactNode; children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function TerminalTab({
  terminal,
  active,
  pending,
  onSelect,
  onClose,
  onRename,
}: {
  terminal: TerminalSession;
  active: boolean;
  pending: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(terminal.title ?? '');

  useEffect(() => {
    setDraft(terminal.title ?? '');
  }, [terminal.title]);

  const save = () => {
    const title = draft.trim();
    setEditing(false);
    if (title && title !== terminal.title) onRename(title);
  };

  return (
    <div className={`inline-flex h-7 items-center overflow-hidden rounded-md text-xs ${active ? 'bg-[var(--color-card-hover)]' : 'bg-[var(--color-card)]'}`}>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
            if (event.key === 'Escape') setEditing(false);
          }}
          className="h-7 w-28 bg-transparent px-2 outline-none"
        />
      ) : (
        <button type="button" onClick={onSelect} onDoubleClick={() => setEditing(true)} className="flex h-full items-center gap-1.5 px-2">
          <SquareTerminal size={13} />
          <span className="max-w-32 truncate">{terminal.title || 'Terminal'}</span>
        </button>
      )}
      <button type="button" disabled={pending} onClick={onClose} className="px-1.5 text-dim hover:text-[var(--color-text-primary)]" aria-label="Close terminal">
        <X size={12} />
      </button>
    </div>
  );
}

function previewTabKey(tab: Extract<WorkspaceTab, { type: 'editor' | 'diff' }>, index: number) {
  if (tab.type === 'editor') return `editor:${tab.path}:${index}`;
  return `diff:${tab.file ?? 'all'}:${tab.staged}:${tab.base}:${tab.commit ?? 'none'}:${index}`;
}

function previewTabLabel(tab: Extract<WorkspaceTab, { type: 'editor' | 'diff' }>) {
  if (tab.type === 'editor') return fileName(tab.path);
  if (tab.file) return fileName(tab.file);
  if (tab.commit) return tab.commit.slice(0, 7);
  return 'All changes';
}

function statusColor(status: Workspace['status']): 'blue' | 'green' | 'yellow' | 'gray' {
  if (status === 'active') return 'blue';
  if (status === 'merged') return 'green';
  if (status === 'abandoned') return 'yellow';
  return 'gray';
}

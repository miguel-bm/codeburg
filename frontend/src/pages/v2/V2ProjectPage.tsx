import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Files,
  MessageSquarePlus,
  PlusCircle,
  SquareTerminal,
  X,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { Conversation, TerminalSession, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';
import { TerminalView } from '../../components/session/TerminalView';
import { DiffTab } from '../../components/workspace/DiffTab';
import { EditorTab } from '../../components/workspace/EditorTab';
import { WorkspaceProvider } from '../../components/workspace/WorkspaceContext';
import { useMobile } from '../../hooks/useMobile';
import { useWorkspaceStore, type WorkspaceTab } from '../../stores/workspace';
import type { ReactNode } from 'react';
import {
  Button,
  V2Empty,
  V2Input,
  V2Screen,
} from './v2-ui';
import { V2WorkspaceActionHeader } from './V2WorkspaceActionHeader';
import { V2WorkspaceToolTabs, V2WorkspaceTools, V2WorkspaceToolsSurface, type V2HelperTab } from './V2WorkspaceTools';
import { WorkspaceConversationTab, WorkspacePreviewTab, WorkspaceTerminalTab } from './V2WorkspaceTabs';
import { workspacePreviewTabKey, workspacePreviewTabLabel } from './V2WorkspaceTabHelpers';

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
  const isMobile = useMobile();

  const [helperTab, setHelperTab] = useState<V2HelperTab>('files');
  const [toolsOpen, setToolsOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  const [toolsWidth, setToolsWidth] = useState(360);
  const [toolsResizing, setToolsResizing] = useState(false);
  const [composerMode, setComposerMode] = useState<'create' | 'fork' | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceBaseBranch, setWorkspaceBaseBranch] = useState('');
  const [mainSurface, setMainSurface] = useState<MainSurface>(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const suppressNewWorkspaceRouteOpen = useRef(false);

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

  const safeWorkspaces = useMemo(() => Array.isArray(workspaces) ? workspaces : [], [workspaces]);
  const sortedWorkspaces = useMemo(() => [...safeWorkspaces].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'main' ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  }), [safeWorkspaces]);
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

  const safeTerminals = useMemo(() => Array.isArray(terminals) ? terminals : [], [terminals]);
  const safeWorkspaceConversations = Array.isArray(workspaceConversations) ? workspaceConversations : [];
  const sortedTerminals = useMemo(() => [...safeTerminals].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [safeTerminals]);
  const activeTerminal = mainSurface?.type === 'terminal'
    ? sortedTerminals.find((terminal) => terminal.id === mainSurface.terminalId) ?? null
    : requestedTerminalId
      ? sortedTerminals.find((terminal) => terminal.id === requestedTerminalId) ?? null
      : null;
  const activeWorkspaceTab = mainSurface?.type === 'workspaceTab' ? tabs[mainSurface.index] : null;
  const activePreviewTab = activeWorkspaceTab?.type === 'editor' || activeWorkspaceTab?.type === 'diff'
    ? activeWorkspaceTab
    : null;
  const workspaceContextReady = !!project && !!activeWorkspace;

  useEffect(() => {
    resetWorkspaceTabs();
    setMainSurface(null);
  }, [activeWorkspaceId, resetWorkspaceTabs]);

  useEffect(() => {
    setToolsOpen(!isMobile);
  }, [isMobile]);

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

  useEffect(() => {
    if (isMobile && activePreviewTab && toolsOpen) {
      setToolsOpen(false);
    }
  }, [activePreviewTab, isMobile, toolsOpen]);

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
      navigate(`/projects/${id}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`, { replace: true });
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
      navigate(`/conversations/${conversation.id}`);
    },
  });
  const renameConversation = useMutation({
    mutationFn: ({ conversationId, title }: { conversationId: string; title: string }) =>
      v2Api.updateConversation(conversationId, { title }),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId, 'sidebar'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversation', updated.id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
      ]);
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
      closeComposer(response.workspace.id);
      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
    },
  });

  const forkWorkspace = useMutation({
    mutationFn: (input: { name: string; baseBranch?: string }) =>
      v2Api.forkWorkspace(activeWorkspaceId!, input),
    onSuccess: async (response) => {
      closeComposer(response.workspace.id);
      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
    },
  });

  const deleteWorkspace = useMutation({
    mutationFn: (workspaceId: string) => v2Api.deleteWorkspace(workspaceId),
    onSuccess: async () => {
      navigate(`/projects/${id}`);
      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
    },
  });

  const mutateWorkspaceStatus = useMutation({
    mutationFn: async ({ workspaceId, action, mergeInput }: { workspaceId: string; action: 'activate' | 'merge' | 'abandon' | 'archive'; mergeInput?: Parameters<typeof v2Api.mergeWorkspace>[1] }) => {
      if (action === 'activate') return v2Api.activateWorkspace(workspaceId);
      if (action === 'merge') return v2Api.mergeWorkspace(workspaceId, mergeInput ?? { cleanupWorktree: true });
      if (action === 'abandon') return v2Api.abandonWorkspace(workspaceId, { cleanupWorktree: true });
      return v2Api.archiveWorkspace(workspaceId, { cleanupWorktree: true });
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

  const resolveConflictWithAgent = useMutation({
    mutationFn: async (workspaceId: string) => {
      const context = await v2Api.getWorkspaceConflictContext(workspaceId);
      const conversation = await v2Api.createConversation(id!, {
        title: `Resolve ${activeWorkspace?.name ?? 'workspace'} conflicts`,
        currentWorkspaceId: workspaceId,
      });
      await v2Api.promptConversation(conversation.id, { message: context.prompt });
      return conversation;
    },
    onSuccess: async (conversation) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', conversation.currentWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', conversation.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', conversation.projectId, 'sidebar'] }),
      ]);
      navigate(`/conversations/${conversation.id}`);
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
    if (!requestedNewWorkspace) {
      suppressNewWorkspaceRouteOpen.current = false;
      return;
    }
    if (suppressNewWorkspaceRouteOpen.current) return;
    if (!composerMode) setComposerMode('create');
  }, [requestedNewWorkspace, composerMode]);

  const workspacePending =
    createWorkspace.isPending ||
    forkWorkspace.isPending ||
    deleteWorkspace.isPending ||
    mutateWorkspaceStatus.isPending ||
    syncWorkspace.isPending ||
    resolveConflictWithAgent.isPending;
  const workspaceError =
    createWorkspace.error ?? forkWorkspace.error ?? deleteWorkspace.error ?? mutateWorkspaceStatus.error ?? syncWorkspace.error ?? resolveConflictWithAgent.error;
  const terminalDisabled = !activeWorkspaceId || activeWorkspace?.status !== 'active' || createTerminal.isPending;

  const closeComposer = (targetWorkspaceId?: string) => {
    suppressNewWorkspaceRouteOpen.current = true;
    const target = targetWorkspaceId ?? requestedWorkspaceId ?? activeWorkspaceId ?? undefined;
    const next = new URLSearchParams(searchParams);
    next.delete('newWorkspace');
    next.delete('terminal');
    if (target) next.set('workspace', target);
    else next.delete('workspace');
    navigate(`/projects/${id}${next.toString() ? `?${next.toString()}` : ''}`, { replace: true });
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

  const closeWorkspaceSurface = useCallback(() => {
    if (mainSurface?.type === 'workspaceTab') closeTab(mainSurface.index);
    setMainSurface(null);
  }, [closeTab, mainSurface]);

  const toggleHelperTab = useCallback((tab: V2HelperTab) => {
    if (toolsOpen && helperTab === tab) {
      setToolsOpen(false);
      return;
    }
    setHelperTab(tab);
    setToolsOpen(true);
  }, [helperTab, toolsOpen]);

  const beginResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setToolsResizing(true);
    resizeStart.current = { x: event.clientX, width: toolsWidth };
    const onMove = (moveEvent: MouseEvent) => {
      if (!resizeStart.current) return;
      const delta = resizeStart.current.x - moveEvent.clientX;
      setToolsWidth(Math.max(280, Math.min(640, resizeStart.current.width + delta)));
    };
    const onUp = () => {
      resizeStart.current = null;
      setToolsResizing(false);
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
        <WorkspaceComposerModal
          mode={composerMode}
          projectName={project?.name}
          defaultBranch={project?.defaultBranch ?? 'main'}
          activeWorkspace={activeWorkspace}
          name={workspaceName}
          baseBranch={workspaceBaseBranch}
          pending={workspacePending}
          error={workspaceError instanceof Error ? workspaceError.message : undefined}
          onNameChange={setWorkspaceName}
          onBaseBranchChange={setWorkspaceBaseBranch}
          onSubmit={submitWorkspaceComposer}
          onCancel={() => closeComposer()}
        />
      )}

      {project && activeWorkspace && (
        <V2WorkspaceActionHeader
          project={project}
          workspace={activeWorkspace}
          pending={workspacePending}
          onUpdateFromBase={() => syncWorkspace.mutate(activeWorkspace.id)}
          onMerge={(mergeInput) => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'merge', mergeInput })}
          onCloseWithoutMerging={() => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'abandon' })}
          onReactivate={() => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'activate' })}
          onArchive={() => {
            if (confirmWorkspaceCleanupAction(activeWorkspace, 'Archive and clean up')) {
              mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'archive' });
            }
          }}
          onDelete={() => {
            if (confirmWorkspaceDelete(activeWorkspace)) deleteWorkspace.mutate(activeWorkspace.id);
          }}
          onOpenGitPanel={() => {
            setHelperTab('git');
            setToolsOpen(true);
          }}
          onResolveConflicts={() => resolveConflictWithAgent.mutate(activeWorkspace.id)}
        />
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col bg-primary">
          {!activePreviewTab && (
            <MainTabBar
              terminals={sortedTerminals}
              terminalPending={closeTerminal.isPending || renameTerminal.isPending}
              activeSurface={mainSurface}
              tabs={tabs}
              activeTabIndex={activeTabIndex}
              onSelectTerminal={(terminal) => {
                setMainSurface({ type: 'terminal', terminalId: terminal.id });
                navigate(`/projects/${id}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`, { replace: true });
              }}
              onCloseTerminal={(terminal) => closeTerminal.mutate(terminal.id)}
              onRenameTerminal={(terminal, title) => renameTerminal.mutate({ terminalId: terminal.id, title })}
              conversations={safeWorkspaceConversations}
              onSelectConversation={(conversation) => navigate(`/conversations/${conversation.id}`)}
              onRenameConversation={(conversation, title) => renameConversation.mutate({ conversationId: conversation.id, title })}
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
              helperTab={helperTab}
              toolsOpen={toolsOpen}
              toolsDisabled={!project || !activeWorkspace}
              onToggleHelperTab={toggleHelperTab}
            />
          )}

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeTerminal ? (
              <TerminalView sessionId={activeTerminal.id} targetType="terminal" />
            ) : activeWorkspaceTab?.type === 'editor' && workspaceContextReady ? (
              <EditorTab path={activeWorkspaceTab.path} line={activeWorkspaceTab.line} onClose={closeWorkspaceSurface} />
            ) : activeWorkspaceTab?.type === 'diff' && workspaceContextReady ? (
              <DiffTab file={activeWorkspaceTab.file} staged={activeWorkspaceTab.staged} base={activeWorkspaceTab.base} commit={activeWorkspaceTab.commit} onClose={closeWorkspaceSurface} />
            ) : (
              <V2Empty
                icon={<SquareTerminal size={32} />}
                title="Choose a terminal, file, or diff"
            body={activeWorkspace?.status !== 'active'
              ? `This workspace is ${activeWorkspace?.status}. Reactivate it before starting terminals.`
              : 'Open a conversation, terminal, file, or diff from the workspace controls.'}
                action={
                  <div className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
                    <Button size="sm" variant="primary" icon={<MessageSquarePlus size={14} />} disabled={!activeWorkspaceId || activeWorkspace?.status !== 'active'} loading={createConversation.isPending} onClick={() => createConversation.mutate()}>New conversation</Button>
                    <Button size="sm" variant="secondary" icon={<SquareTerminal size={14} />} disabled={terminalDisabled} loading={createTerminal.isPending} onClick={() => createTerminal.mutate(undefined)}>New terminal</Button>
                  </div>
                }
              />
            )}
          </div>
        </section>

        <V2WorkspaceToolsSurface
          open={toolsOpen}
          width={toolsWidth}
          resizing={toolsResizing}
          helperTab={helperTab}
          disabled={!project || !activeWorkspace}
          onToggleHelperTab={toggleHelperTab}
          onResizeStart={beginResize}
        >
          {project && activeWorkspace ? (
            <V2WorkspaceTools helperTab={helperTab} />
          ) : (
            <V2Empty
              icon={<Files size={24} />}
              title="Loading workspace tools"
              body="Files, search, and git actions will appear once the project workspace is ready."
            />
          )}
        </V2WorkspaceToolsSurface>
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

function WorkspaceComposerModal({
  mode,
  projectName,
  defaultBranch,
  activeWorkspace,
  name,
  baseBranch,
  pending,
  error,
  onNameChange,
  onBaseBranchChange,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'fork';
  projectName?: string;
  defaultBranch: string;
  activeWorkspace: Workspace | null;
  name: string;
  baseBranch: string;
  pending: boolean;
  error?: string;
  onNameChange: (value: string) => void;
  onBaseBranchChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const title = mode === 'fork' ? 'Fork workspace' : 'New workspace';
  const context = mode === 'fork' && activeWorkspace
    ? `Forking ${activeWorkspace.name} in ${projectName ?? 'this project'}`
    : `Creating in ${projectName ?? 'this project'}`;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, pending]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-[var(--color-bg-primary)]/55 p-3 backdrop-blur-sm md:items-center md:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <form
        className="w-full max-w-lg rounded-xl bg-card shadow-[var(--shadow-card)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-composer-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-card-border)] px-4 py-4 md:px-5">
          <div className="min-w-0">
            <h2 id="workspace-composer-title" className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
            <p className="mt-1 truncate text-sm text-dim">{context}</p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50 md:h-8 md:w-8"
            aria-label="Cancel workspace creation"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4 md:px-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">Workspace name</span>
            <V2Input
              autoFocus
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="feat/runtime-polish"
              className="w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">Base branch</span>
            <V2Input
              value={baseBranch}
              onChange={(event) => onBaseBranchChange(event.target.value)}
              placeholder={defaultBranch}
              className="w-full"
            />
          </label>
          {error && (
            <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-xs leading-5 text-[var(--color-error)]">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-card-border)] px-4 py-3 md:px-5">
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
          <Button type="submit" size="sm" variant="primary" loading={pending} disabled={!name.trim()}>
            {mode === 'fork' ? 'Create fork' : 'Create workspace'}
          </Button>
        </div>
      </form>
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
  onRenameConversation,
  onCreateConversation,
  onSelectWorkspaceTab,
  onCloseWorkspaceTab,
  onCreateTerminal,
  createTerminalDisabled,
  createTerminalPending,
  createConversationPending,
  helperTab,
  toolsOpen,
  toolsDisabled,
  onToggleHelperTab,
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
  onRenameConversation: (conversation: Conversation, title: string) => void;
  onCreateConversation: () => void;
  onSelectWorkspaceTab: (index: number) => void;
  onCloseWorkspaceTab: (index: number) => void;
  onCreateTerminal: () => void;
  createTerminalDisabled: boolean;
  createTerminalPending: boolean;
  createConversationPending: boolean;
  helperTab: V2HelperTab;
  toolsOpen: boolean;
  toolsDisabled?: boolean;
  onToggleHelperTab: (tab: V2HelperTab) => void;
}) {
  const [newTabOpen, setNewTabOpen] = useState(false);
  const workspaceTabs = tabs
    .map((tab, index) => ({ tab, index }))
    .filter((entry): entry is { tab: Extract<WorkspaceTab, { type: 'editor' | 'diff' }>; index: number } => entry.tab.type === 'editor' || entry.tab.type === 'diff');
  const isMobile = useMobile();

  if (isMobile) {
    const activeValue = activeSurface?.type === 'terminal'
      ? `terminal:${activeSurface.terminalId}`
      : activeSurface?.type === 'workspaceTab'
        ? `workspaceTab:${activeSurface.index}`
        : '';

    return (
      <div className="flex h-12 shrink-0 items-center gap-1 bg-canvas px-2">
        <select
          value={activeValue}
          onChange={(event) => {
            const [type, id] = event.target.value.split(':');
            if (type === 'conversation') {
              const conversation = conversations.find((candidate) => candidate.id === id);
              if (conversation) onSelectConversation(conversation);
            }
            if (type === 'terminal') {
              const terminal = terminals.find((candidate) => candidate.id === id);
              if (terminal) onSelectTerminal(terminal);
            }
            if (type === 'workspaceTab') {
              const index = Number(id);
              if (Number.isInteger(index)) onSelectWorkspaceTab(index);
            }
          }}
          className="h-[44px] min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm text-[var(--color-text-primary)] outline-none hover:bg-[var(--color-card)]"
          aria-label="Select conversation, terminal, file, or diff"
        >
          <option value="">Choose focus</option>
          {conversations.map((conversation) => (
            <option key={conversation.id} value={`conversation:${conversation.id}`}>{conversation.title}</option>
          ))}
          {terminals.map((terminal) => (
            <option key={terminal.id} value={`terminal:${terminal.id}`}>{terminal.title || 'Terminal'}</option>
          ))}
          {workspaceTabs.map(({ tab, index }) => (
          <option key={workspacePreviewTabKey(tab, index)} value={`workspaceTab:${index}`}>{workspacePreviewTabLabel(tab)}</option>
          ))}
        </select>
        <div className="relative shrink-0">
          <button
            type="button"
            disabled={createTerminalDisabled && createConversationPending}
            onClick={() => setNewTabOpen((value) => !value)}
            className="inline-flex h-[44px] w-[44px] cursor-pointer items-center justify-center rounded-md text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50"
            title="New tab"
            aria-label="New tab"
          >
            <PlusCircle size={15} />
          </button>
          {newTabOpen && (
            <>
              <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close new tab menu" onClick={() => setNewTabOpen(false)} />
              <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]">
                <NewTabMenuItem icon={<MessageSquarePlus size={14} />} disabled={createConversationPending} onClick={() => { setNewTabOpen(false); onCreateConversation(); }}>Conversation</NewTabMenuItem>
                <NewTabMenuItem icon={<SquareTerminal size={14} />} disabled={createTerminalDisabled || createTerminalPending} onClick={() => { setNewTabOpen(false); onCreateTerminal(); }}>Terminal</NewTabMenuItem>
              </div>
            </>
          )}
        </div>
        <V2WorkspaceToolTabs
          helperTab={helperTab}
          toolsOpen={toolsOpen}
          disabled={toolsDisabled}
          onToggleHelperTab={onToggleHelperTab}
        />
      </div>
    );
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 bg-canvas px-2 md:h-9">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
        {conversations.map((conversation) => (
          <WorkspaceConversationTab
            key={conversation.id}
            conversation={conversation}
            active={false}
            onSelect={() => onSelectConversation(conversation)}
            onRename={(title) => onRenameConversation(conversation, title)}
          />
        ))}
        {terminals.map((terminal) => (
          <WorkspaceTerminalTab
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
          <WorkspacePreviewTab
            key={workspacePreviewTabKey(tab, index)}
            tab={tab}
            index={index}
            active={activeSurface?.type === 'workspaceTab' && activeSurface.index === index}
            activeTabIndex={activeTabIndex}
            onSelect={() => onSelectWorkspaceTab(index)}
            onClose={() => onCloseWorkspaceTab(index)}
          />
        ))}
      </div>
      <div className="relative shrink-0">
        <button
          type="button"
          disabled={createTerminalDisabled && createConversationPending}
          onClick={() => setNewTabOpen((value) => !value)}
          className="inline-flex h-[44px] cursor-pointer items-center justify-center rounded-md px-3 text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50 md:h-7 md:px-2"
          title="New tab"
        >
          <PlusCircle size={15} />
        </button>
        {newTabOpen && (
          <>
            <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close new tab menu" onClick={() => setNewTabOpen(false)} />
            <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-1 shadow-[var(--shadow-card)] md:absolute md:inset-auto md:left-0 md:top-8 md:w-44">
              <NewTabMenuItem icon={<MessageSquarePlus size={14} />} disabled={createConversationPending} onClick={() => { setNewTabOpen(false); onCreateConversation(); }}>Conversation</NewTabMenuItem>
              <NewTabMenuItem icon={<SquareTerminal size={14} />} disabled={createTerminalDisabled || createTerminalPending} onClick={() => { setNewTabOpen(false); onCreateTerminal(); }}>Terminal</NewTabMenuItem>
            </div>
          </>
        )}
      </div>
      {!toolsOpen && (
        <V2WorkspaceToolTabs
          helperTab={helperTab}
          toolsOpen={toolsOpen}
          disabled={toolsDisabled}
          onToggleHelperTab={onToggleHelperTab}
        />
      )}
    </div>
  );
}

function NewTabMenuItem({ icon, children, disabled, onClick }: { icon: ReactNode; children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50 md:min-h-0 md:text-xs"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function confirmWorkspaceCleanupAction(workspace: Workspace, action: string) {
  const worktree = workspace.worktreePath ? `\n\nWorktree: ${workspace.worktreePath}` : '';
  return window.confirm(
    `${action} "${workspace.name}"?\n\nThis will stop terminals, detach active conversations, and remove the local worktree directory. The branch is kept so the workspace can be reactivated later.${worktree}`,
  );
}

function confirmWorkspaceDelete(workspace: Workspace) {
  const worktree = workspace.worktreePath ? `\n\nWorktree: ${workspace.worktreePath}` : '';
  return window.confirm(
    `Delete workspace "${workspace.name}"?\n\nThis removes the workspace record and cleans up local workspace files where possible. This is harder to undo than archiving.${worktree}`,
  );
}

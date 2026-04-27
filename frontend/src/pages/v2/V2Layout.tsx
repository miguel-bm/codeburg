import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowDownUp,
  BookPlus,
  Circle,
  CircleAlert,
  CircleDot,
  Copy,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitFork,
  GitMerge,
  Hammer,
  LoaderCircle,
  Maximize2,
  MessageSquarePlus,
  MessageSquareText,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  SquareStack,
  SquareTerminal,
  Trash2,
} from 'lucide-react';
import { preferencesApi, projectsApi } from '../../api';
import type { Conversation, PiConversationSnapshot, Project, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';
import { CreateProjectModal } from '../../components/common/CreateProjectModal';
import { CodeburgIcon, CodeburgWordmark } from '../../components/ui/CodeburgIcon';
import { useMobile } from '../../hooks/useMobile';
import { getDesktopTitleBarInsetTop, isDesktopShell } from '../../platform/runtimeConfig';
import { selectIsExpanded, useSidebarStore } from '../../stores/sidebar';
import { useSharedWebSocket } from '../../hooks/useSharedWebSocket';
import type { QueryClient } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router-dom';

type ProjectTreeMode = 'project' | 'chronological' | 'chats';
type ProjectTreeSort = 'created' | 'updated';
type ProjectTreeShow = 'all' | 'relevant';
type ProjectExpansionCommand = { id: number; expanded: boolean };
type SidebarContextMenu =
  | { type: 'project'; id: string }
  | { type: 'workspace'; id: string }
  | { type: 'conversation'; id: string };

export function V2Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useMobile();
  const isMobileHome = isMobile && location.pathname === '/v2';
  const projectTreeScrollRef = useRef<HTMLDivElement>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [projectTreeMenuOpen, setProjectTreeMenuOpen] = useState(false);
  const [projectTreeMode, setProjectTreeMode] = useState<ProjectTreeMode>('project');
  const [projectTreeSort, setProjectTreeSort] = useState<ProjectTreeSort>('updated');
  const [projectTreeShow, setProjectTreeShow] = useState<ProjectTreeShow>('relevant');
  const [projectExpansionCommand, setProjectExpansionCommand] = useState<ProjectExpansionCommand | null>(null);
  const [sidebarContextMenu, setSidebarContextMenu] = useState<SidebarContextMenu | null>(null);
  const sidebarExpanded = useSidebarStore(selectIsExpanded);
  const toggleSidebarExpanded = useSidebarStore((state) => state.toggleExpanded);
  const shouldLoadSidebarTree = !isMobile || isMobileHome;
  const { data: sidebar, isLoading } = useQuery({
    queryKey: ['v2-sidebar-summary'],
    queryFn: () => v2Api.getSidebar(),
    enabled: shouldLoadSidebarTree,
    staleTime: 20_000,
    refetchInterval: shouldLoadSidebarTree ? 30_000 : false,
  });
  const { data: pinnedConversationIds = [] } = useQuery({
    queryKey: ['v2-pinned-conversations'],
    queryFn: getPinnedConversationIds,
  });

  useSharedWebSocket({
    onMessage: useCallback((data: unknown) => {
      const msg = data as { type?: string };
      if (msg.type === 'sidebar_update') {
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] });
      }
    }, [queryClient]),
  });

  const sidebarProjects = Array.isArray(sidebar?.projects) ? sidebar.projects : [];
  const safeProjects = sidebarProjects.map((entry) => entry.project);
  const safePinnedProjectIds = sidebarProjects.filter((entry) => entry.pinned).map((entry) => entry.project.id);
  const safePinnedConversationIds = Array.isArray(pinnedConversationIds) ? pinnedConversationIds : [];
  const baseVisibleProjects = orderProjectsForTree(
    safeProjects.filter((project) => !project.hidden),
    safePinnedProjectIds,
    'project',
    'updated',
    () => [],
  );

  const workspacesByProject = new Map<string, Workspace[]>();
  const conversationsByProject = new Map<string, Conversation[]>();
  const conversationStateById = new Map<string, PiConversationSnapshot>();
  sidebarProjects.forEach((entry) => {
    workspacesByProject.set(entry.project.id, entry.workspaces ?? []);
    conversationsByProject.set(entry.project.id, entry.conversations ?? []);
    for (const state of entry.states ?? []) {
      conversationStateById.set(state.conversationId, state);
    }
  });
  const visibleProjects = orderProjectsForTree(
    baseVisibleProjects,
    safePinnedProjectIds,
    projectTreeMode,
    projectTreeSort,
    (projectId) => conversationsByProject.get(projectId) ?? [],
  );
  const createConversation = useMutation({
    mutationFn: ({ project, workspace }: { project: Project; workspace?: Workspace }) =>
      v2Api.createConversation(project.id, {
        title: `New ${project.name} conversation`,
        currentWorkspaceId: workspace?.id,
      }),
    onSuccess: async (conversation) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', conversation.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', conversation.projectId, 'sidebar'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
      ]);
      navigate(`/v2/conversations/${conversation.id}`);
    },
  });
  const archiveOrDeleteConversation = useMutation({
    mutationFn: async (conversation: Conversation) => {
      const snapshot = await v2Api.getConversationState(conversation.id).catch(() => null);
      if (!snapshot || snapshot.messages.length === 0) {
        await v2Api.deleteConversation(conversation.id);
        return { conversationId: conversation.id, projectId: conversation.projectId, workspaceId: conversation.currentWorkspaceId ?? null };
      }
      const archived = await v2Api.archiveConversation(conversation.id);
      return { conversationId: archived.id, projectId: archived.projectId, workspaceId: archived.currentWorkspaceId ?? null };
    },
    onSuccess: async ({ conversationId, projectId, workspaceId }) => {
      if (workspaceId) {
        queryClient.setQueryData<Conversation[]>(['v2-workspace-conversations', workspaceId], (current = []) => (
          current.filter((candidate) => candidate.id !== conversationId)
        ));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversation', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', projectId, 'sidebar'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
      ]);
      if (location.pathname === `/v2/conversations/${conversationId}`) {
        const params = new URLSearchParams();
        if (workspaceId) params.set('workspace', workspaceId);
        const query = params.toString();
        navigate(`/v2/projects/${projectId}${query ? `?${query}` : ''}`, { replace: true });
      }
    },
  });
  const renameConversation = useMutation({
    mutationFn: ({ conversation, title }: { conversation: Conversation; title: string }) =>
      v2Api.updateConversation(conversation.id, { title }),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversation', updated.id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId, 'sidebar'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
      ]);
    },
  });
  const markConversationReadState = useMutation({
    mutationFn: ({ conversation, unread }: { conversation: Conversation; unread: boolean }) =>
      unread ? v2Api.markConversationUnread(conversation.id) : v2Api.markConversationRead(conversation.id),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversation', updated.id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId, 'sidebar'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
      ]);
    },
  });
  const switchConversationWorkspace = useMutation({
    mutationFn: ({ conversation, workspaceId }: { conversation: Conversation; workspaceId?: string }) =>
      v2Api.switchConversationWorkspace(conversation.id, {
        currentWorkspaceId: workspaceId,
        reason: 'sidebar menu',
      }),
    onSuccess: async (updated) => {
      await invalidateConversationLists(queryClient, updated.projectId, updated.id);
    },
  });
  const createWorkspaceTerminal = useMutation({
    mutationFn: ({ workspace }: { project: Project; workspace: Workspace }) =>
      v2Api.createTerminal(workspace.id, { title: `${workspace.name} terminal` }),
    onSuccess: async (terminal, { project }) => {
      await queryClient.invalidateQueries({ queryKey: ['v2-terminals', terminal.workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] });
      navigate(`/v2/projects/${project.id}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`);
    },
  });
  const syncWorkspace = useMutation({
    mutationFn: (workspace: Workspace) => v2Api.syncWorkspace(workspace.id),
    onSuccess: async (_result, workspace) => {
      await queryClient.invalidateQueries({ queryKey: ['v2-workspaces', workspace.projectId] });
      await queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] });
    },
  });
  const forkWorkspace = useMutation({
    mutationFn: ({ workspace, name }: { workspace: Workspace; name: string }) =>
      v2Api.forkWorkspace(workspace.id, { name, baseBranch: workspace.branchName || undefined }),
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ['v2-workspaces', response.workspace.projectId] });
      await queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] });
      navigate(`/v2/projects/${response.workspace.projectId}?workspace=${response.workspace.id}`);
    },
  });
  const mutateWorkspaceStatus = useMutation({
    mutationFn: ({ workspace, action }: { workspace: Workspace; action: 'activate' | 'merge' | 'abandon' | 'archive' | 'cleanup' }) => {
      if (action === 'activate') return v2Api.activateWorkspace(workspace.id);
      if (action === 'merge') return v2Api.mergeWorkspace(workspace.id, { cleanupWorktree: true });
      if (action === 'abandon') return v2Api.abandonWorkspace(workspace.id, { cleanupWorktree: true });
      if (action === 'archive') return v2Api.archiveWorkspace(workspace.id, { cleanupWorktree: true });
      return v2Api.cleanupWorkspace(workspace.id);
    },
    onSuccess: async (updated, { action }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-workspaces', updated.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-terminals', updated.id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
      ]);
      if (
        action !== 'activate' &&
        location.pathname === `/v2/projects/${updated.projectId}` &&
        new URLSearchParams(location.search).get('workspace') === updated.id
      ) {
        navigate(`/v2/projects/${updated.projectId}`);
      }
    },
  });
  const workspaceActionPending =
    createWorkspaceTerminal.isPending ||
    syncWorkspace.isPending ||
    forkWorkspace.isPending ||
    mutateWorkspaceStatus.isPending;
  const conversationActionPending =
    archiveOrDeleteConversation.isPending ||
    markConversationReadState.isPending ||
    switchConversationWorkspace.isPending;
  const forkWorkspaceFromMenu = (workspace: Workspace) => {
    const name = window.prompt('Fork workspace', defaultWorkspaceForkName(workspace))?.trim();
    if (!name) return;
    forkWorkspace.mutate({ workspace, name });
  };
  const togglePinnedConversationFromMenu = (conversation: Conversation) => {
    void togglePinnedConversation(conversation.id, queryClient);
  };
  const switchConversationWorkspaceFromMenu = (conversation: Conversation) => {
    const workspaces = workspacesByProject.get(conversation.projectId) ?? [];
    const workspaceId = chooseConversationWorkspace(conversation, workspaces);
    if (workspaceId === undefined) return;
    switchConversationWorkspace.mutate({ conversation, workspaceId });
  };

  const desktopTopInset = isDesktopShell() ? getDesktopTitleBarInsetTop() : 0;
  const openSidebarContextMenu = (menu: SidebarContextMenu) => {
    setProjectTreeMenuOpen(false);
    setSidebarContextMenu(menu);
  };

  useEffect(() => {
    if (!sidebarContextMenu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-sidebar-context-menu-root]')) return;
      if (target.closest('[data-sidebar-context-menu-trigger]')) return;
      setSidebarContextMenu(null);
    };
    const closeOnOutsideContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-sidebar-context-menu-root]')) return;
      if (target.closest('[data-sidebar-context-menu-trigger]')) return;
      setSidebarContextMenu(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('contextmenu', closeOnOutsideContextMenu);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('contextmenu', closeOnOutsideContextMenu);
    };
  }, [sidebarContextMenu]);

  const sidebarBody = (
    <>
      <div className="px-3 pb-3">
        <div className="flex h-10 items-center gap-2 rounded-lg bg-[var(--color-card)] px-3 text-sm text-dim md:h-8 md:px-2.5 md:text-xs">
          <Search size={14} />
          <span className="truncate">Search soon: projects, threads, files</span>
        </div>
      </div>

      <nav className="space-y-1 px-2">
        <SidebarAction icon={<PlugZap size={15} />} label="Harness" onClick={() => navigate('/v2/harness')} />
        <SidebarAction icon={<MessageSquareText size={15} />} label="All conversations" onClick={() => navigate('/v2/conversations')} />
      </nav>

      <ProjectsTreeHeader
        count={visibleProjects.length}
        menuOpen={projectTreeMenuOpen}
        mode={projectTreeMode}
        sort={projectTreeSort}
        show={projectTreeShow}
        mobile={isMobile}
        onExpandAll={() => setProjectExpansionCommand({ id: Date.now(), expanded: true })}
        onCollapseAll={() => setProjectExpansionCommand({ id: Date.now(), expanded: false })}
        onToggleMenu={() => setProjectTreeMenuOpen((value) => !value)}
        onCloseMenu={() => setProjectTreeMenuOpen(false)}
        onModeChange={setProjectTreeMode}
        onSortChange={setProjectTreeSort}
        onShowChange={setProjectTreeShow}
        onNewProject={() => setShowCreateProject(true)}
      />

      <div ref={projectTreeScrollRef} className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {isLoading && (
          <div className="space-y-2 px-2 py-1">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-16 rounded-lg bg-[var(--color-card)] opacity-60" />
            ))}
          </div>
        )}

        {visibleProjects.map((project) => (
          <ProjectTree
            key={project.id}
            project={project}
            pinned={safePinnedProjectIds.includes(project.id)}
            workspaces={workspacesByProject.get(project.id) ?? []}
            conversations={conversationsByProject.get(project.id) ?? []}
            pathname={location.pathname}
            search={location.search}
            creating={createConversation.isPending}
            archivingConversation={conversationActionPending}
            workspaceActionPending={workspaceActionPending}
            conversationStateById={conversationStateById}
            pinnedConversationIds={safePinnedConversationIds}
            expansionCommand={projectExpansionCommand}
            showAllConversations={projectTreeShow === 'all'}
            contextMenu={sidebarContextMenu}
            mobile={isMobile}
            onOpenContextMenu={openSidebarContextMenu}
            onCloseContextMenu={() => setSidebarContextMenu(null)}
            onNewConversation={(workspace) => createConversation.mutate({ project, workspace })}
            onArchiveConversation={(conversation) => archiveOrDeleteConversation.mutate(conversation)}
            onRenameConversation={(conversation, title) => renameConversation.mutate({ conversation, title })}
            onMarkConversationRead={(conversation) => markConversationReadState.mutate({ conversation, unread: false })}
            onMarkConversationUnread={(conversation) => markConversationReadState.mutate({ conversation, unread: true })}
            onTogglePinnedConversation={togglePinnedConversationFromMenu}
            onSwitchConversationWorkspace={switchConversationWorkspaceFromMenu}
            onNewWorkspaceTerminal={(workspace) => createWorkspaceTerminal.mutate({ project, workspace })}
            onSyncWorkspace={(workspace) => syncWorkspace.mutate(workspace)}
            onForkWorkspace={forkWorkspaceFromMenu}
            onActivateWorkspace={(workspace) => mutateWorkspaceStatus.mutate({ workspace, action: 'activate' })}
            onMergeWorkspace={(workspace) => mutateWorkspaceStatus.mutate({ workspace, action: 'merge' })}
            onAbandonWorkspace={(workspace) => mutateWorkspaceStatus.mutate({ workspace, action: 'abandon' })}
            onArchiveWorkspace={(workspace) => mutateWorkspaceStatus.mutate({ workspace, action: 'archive' })}
            onCleanupWorkspace={(workspace) => mutateWorkspaceStatus.mutate({ workspace, action: 'cleanup' })}
            onCopyWorkspaceBranch={(workspace) => copyToClipboard(workspace.branchName, 'branch name')}
            onCopyWorkspacePath={(workspace) => copyToClipboard(workspace.worktreePath || project.path, workspace.kind === 'main' ? 'project path' : 'worktree path')}
            onCopyProjectPath={() => copyToClipboard(project.path, 'repo path')}
            onCopyProjectRemote={() => copyToClipboard(project.gitOrigin, 'repo remote')}
          />
        ))}
      </div>

      <div className="border-t border-[var(--color-card-border)] p-2">
        <Link
          to="/v2/harness"
          className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] md:min-h-0 md:py-2"
        >
          <PlugZap size={15} />
          Harness
        </Link>
      </div>

      {showCreateProject && (
        <CreateProjectModal
          onClose={() => {
            setShowCreateProject(false);
            void queryClient.invalidateQueries({ queryKey: ['v2-projects'] });
            void queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] });
          }}
        />
      )}
    </>
  );

  if (isMobile) {
    return (
      <div className="relative h-[100dvh] overflow-hidden bg-canvas text-[var(--color-text-primary)]">
        <main className="h-full min-w-0 overflow-hidden pb-[calc(64px+env(safe-area-inset-bottom))]">
          {isMobileHome ? (
            <section className="flex h-full min-h-0 flex-col bg-canvas">
              <header className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.8rem)]">
                <Link to="/v2" className="flex min-w-0 items-center overflow-visible py-0.5">
                  <CodeburgWordmark height={30} className="overflow-visible" />
                </Link>
                <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-[var(--color-card)] px-2.5 text-sm font-semibold text-dim">
                  {visibleProjects.length}
                </span>
              </header>
              <div className="flex min-h-0 flex-1 flex-col">
                {sidebarBody}
              </div>
            </section>
          ) : (
            <Outlet />
          )}
        </main>

        <V2MobileBottomNav
          pathname={location.pathname}
          onHome={() => navigate('/v2')}
          onConversations={() => navigate('/v2/conversations')}
          onSettings={() => navigate('/v2/harness')}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-[var(--color-text-primary)]">
      <aside
        className={`flex shrink-0 flex-col border-r border-[var(--color-card-border)] bg-canvas transition-[width] duration-200 ${sidebarExpanded ? 'w-[19.5rem]' : 'w-[3.25rem]'}`}
        style={desktopTopInset > 0 ? { paddingTop: `${desktopTopInset}px` } : undefined}
      >
        <div className={`flex h-12 items-center ${sidebarExpanded ? 'justify-between px-3' : 'justify-center px-1'}`}>
          <Link to="/v2" className={`flex min-w-0 items-center rounded-md hover:bg-[var(--color-card)] ${sidebarExpanded ? 'px-2 py-1.5' : 'p-1.5'}`}>
            {sidebarExpanded ? <CodeburgWordmark className="text-[var(--color-text-primary)]" /> : <CodeburgIcon size={22} />}
          </Link>
          {sidebarExpanded && (
            <button
              type="button"
              onClick={toggleSidebarExpanded}
              className="rounded-md p-1.5 text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]"
              title="Collapse sidebar"
            >
              <PanelLeftClose size={15} />
            </button>
          )}
        </div>

        {!sidebarExpanded && (
          <div className="flex flex-col items-center gap-2 px-1 py-2">
            <button
              type="button"
              onClick={toggleSidebarExpanded}
              className="rounded-md p-2 text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]"
              title="Expand sidebar"
            >
              <PanelLeftOpen size={16} />
            </button>
          </div>
        )}

        {sidebarExpanded && (
          sidebarBody
        )}
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

function V2MobileBottomNav({
  pathname,
  onHome,
  onConversations,
  onSettings,
}: {
  pathname: string;
  onHome: () => void;
  onConversations: () => void;
  onSettings: () => void;
}) {
  const conversationsActive = pathname.startsWith('/v2/conversations');
  const settingsActive = pathname.startsWith('/v2/settings') || pathname.startsWith('/v2/harness');
  const homeActive = !conversationsActive && !settingsActive;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-[70] border-t border-[var(--color-card-border)] bg-canvas/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-14px_32px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="grid h-[64px] grid-cols-3">
        <V2MobileNavButton active={homeActive} icon={<Folder size={18} />} label="Home" onClick={onHome} />
        <V2MobileNavButton active={conversationsActive} icon={<MessageSquareText size={18} />} label="Chat" onClick={onConversations} />
        <V2MobileNavButton active={settingsActive} icon={<PlugZap size={18} />} label="Harness" onClick={onSettings} />
      </div>
    </nav>
  );
}

function V2MobileNavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors focus-visible:outline-none ${
        active
          ? 'text-[var(--color-text-primary)]'
          : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {active && <span className="absolute top-0 h-0.5 w-9 rounded-full bg-accent" />}
      <span className={active ? 'text-accent' : ''}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function ProjectsTreeHeader({
  count,
  menuOpen,
  mode,
  sort,
  show,
  mobile,
  onExpandAll,
  onCollapseAll,
  onToggleMenu,
  onCloseMenu,
  onModeChange,
  onSortChange,
  onShowChange,
  onNewProject,
}: {
  count: number;
  menuOpen: boolean;
  mode: ProjectTreeMode;
  sort: ProjectTreeSort;
  show: ProjectTreeShow;
  mobile: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onModeChange: (mode: ProjectTreeMode) => void;
  onSortChange: (sort: ProjectTreeSort) => void;
  onShowChange: (show: ProjectTreeShow) => void;
  onNewProject: () => void;
}) {
  return (
    <div className="relative mt-5">
      <div className="flex items-center justify-between px-4 text-[11px] font-medium uppercase text-dim">
        <span>Projects</span>
        <div className="flex items-center gap-1">
          <span className="mr-1">{count}</span>
          <HeaderIconButton icon={<Maximize2 size={13} />} label="Expand all projects" onClick={onExpandAll} />
          <HeaderIconButton icon={<Minimize2 size={13} />} label="Collapse all projects" onClick={onCollapseAll} />
          <HeaderIconButton icon={<ArrowDownUp size={13} />} label="Organize projects" onClick={onToggleMenu} active={menuOpen} />
          <HeaderIconButton icon={<BookPlus size={13} />} label="New project" onClick={onNewProject} />
        </div>
      </div>
      {menuOpen && (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close projects menu" onClick={onCloseMenu} />
          <div className={mobile
            ? 'fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'
            : 'absolute right-3 top-7 z-50 w-64 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'}
          >
            <ProjectMenuLabel>Organize</ProjectMenuLabel>
            <ProjectMenuItem icon={<Folder size={14} />} selected={mode === 'project'} onClick={() => { onModeChange('project'); onCloseMenu(); }}>
              By project
            </ProjectMenuItem>
            <ProjectMenuItem icon={<Circle size={14} />} selected={mode === 'chronological'} onClick={() => { onModeChange('chronological'); onCloseMenu(); }}>
              Chronological list
            </ProjectMenuItem>
            <ProjectMenuItem icon={<MessageSquareText size={14} />} selected={mode === 'chats'} onClick={() => { onModeChange('chats'); onCloseMenu(); }}>
              Chats first
            </ProjectMenuItem>
            <ProjectMenuDivider />
            <ProjectMenuLabel>Sort by</ProjectMenuLabel>
            <ProjectMenuItem icon={<CircleDot size={14} />} selected={sort === 'created'} onClick={() => { onSortChange('created'); onCloseMenu(); }}>
              Created
            </ProjectMenuItem>
            <ProjectMenuItem icon={<RefreshCw size={14} />} selected={sort === 'updated'} onClick={() => { onSortChange('updated'); onCloseMenu(); }}>
              Updated
            </ProjectMenuItem>
            <ProjectMenuDivider />
            <ProjectMenuLabel>Show</ProjectMenuLabel>
            <ProjectMenuItem icon={<MessageSquareText size={14} />} selected={show === 'all'} onClick={() => { onShowChange('all'); onCloseMenu(); }}>
              All chats
            </ProjectMenuItem>
            <ProjectMenuItem icon={<Pin size={14} />} selected={show === 'relevant'} onClick={() => { onShowChange('relevant'); onCloseMenu(); }}>
              Relevant
            </ProjectMenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function HeaderIconButton({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-[var(--color-card)] text-[var(--color-text-primary)]'
          : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
      }`}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
}

function ProjectTree({
  project,
  pinned,
  workspaces,
  conversations,
  pathname,
  search,
  creating,
  archivingConversation,
  workspaceActionPending,
  conversationStateById,
  pinnedConversationIds,
  expansionCommand,
  showAllConversations,
  contextMenu,
  mobile = false,
  onOpenContextMenu,
  onCloseContextMenu,
  onNewConversation,
  onArchiveConversation,
  onRenameConversation,
  onMarkConversationRead,
  onMarkConversationUnread,
  onTogglePinnedConversation,
  onSwitchConversationWorkspace,
  onNewWorkspaceTerminal,
  onSyncWorkspace,
  onForkWorkspace,
  onActivateWorkspace,
  onMergeWorkspace,
  onAbandonWorkspace,
  onArchiveWorkspace,
  onCleanupWorkspace,
  onCopyWorkspaceBranch,
  onCopyWorkspacePath,
  onCopyProjectPath,
  onCopyProjectRemote,
}: {
  project: Project;
  pinned: boolean;
  workspaces: Workspace[];
  conversations: Conversation[];
  pathname: string;
  search: string;
  creating: boolean;
  archivingConversation: boolean;
  workspaceActionPending: boolean;
  conversationStateById: Map<string, PiConversationSnapshot>;
  pinnedConversationIds: string[];
  expansionCommand: ProjectExpansionCommand | null;
  showAllConversations: boolean;
  contextMenu: SidebarContextMenu | null;
  mobile?: boolean;
  onOpenContextMenu: (menu: SidebarContextMenu) => void;
  onCloseContextMenu: () => void;
  onNewConversation: (workspace?: Workspace) => void;
  onArchiveConversation: (conversation: Conversation) => void;
  onRenameConversation: (conversation: Conversation, title: string) => void;
  onMarkConversationRead: (conversation: Conversation) => void;
  onMarkConversationUnread: (conversation: Conversation) => void;
  onTogglePinnedConversation: (conversation: Conversation) => void;
  onSwitchConversationWorkspace: (conversation: Conversation) => void;
  onNewWorkspaceTerminal: (workspace: Workspace) => void;
  onSyncWorkspace: (workspace: Workspace) => void;
  onForkWorkspace: (workspace: Workspace) => void;
  onActivateWorkspace: (workspace: Workspace) => void;
  onMergeWorkspace: (workspace: Workspace) => void;
  onAbandonWorkspace: (workspace: Workspace) => void;
  onArchiveWorkspace: (workspace: Workspace) => void;
  onCleanupWorkspace: (workspace: Workspace) => void;
  onCopyWorkspaceBranch: (workspace: Workspace) => void;
  onCopyWorkspacePath: (workspace: Workspace) => void;
  onCopyProjectPath: () => void;
  onCopyProjectRemote: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);
  const projectRouteActive = pathname === `/v2/projects/${project.id}`;
  const projectDescendantActive = pathname.startsWith(`/v2/projects/${project.id}/`);
  const activeConversationId = pathname.match(/^\/v2\/conversations\/([^/]+)/)?.[1];
  const conversationActive = conversations.some((conversation) => conversation.id === activeConversationId);
  const projectInPath = projectRouteActive || projectDescendantActive || conversationActive;
  const [expanded, setExpanded] = useState(mobile || projectInPath);
  const [userToggled, setUserToggled] = useState(false);
  const treeOpen = expanded;
  const selectedWorkspaceId = new URLSearchParams(search).get('workspace');
  const safeWorkspaces = Array.isArray(workspaces) ? workspaces : [];
  const safeConversations = Array.isArray(conversations) ? conversations : [];
  const orderedWorkspaces = [...safeWorkspaces].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'main' ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const recentProjectConversations = [...safeConversations]
    .filter((conversation) => !conversation.currentWorkspaceId && conversation.status === 'active')
    .sort((a, b) => comparePinnedThenActivity(a, b, pinnedConversationIds))
    .slice(0, showAllConversations ? undefined : 3);
  const projectMenuOpen = contextMenu?.type === 'project' && contextMenu.id === project.id;
  const workspaceMenuId = contextMenu?.type === 'workspace' ? contextMenu.id : null;
  const projectIsSelectedLeaf = projectRouteActive && orderedWorkspaces.length === 0 && !selectedWorkspaceId;
  const projectActionVisibility = mobile || projectMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100';
  const runProjectAction = (action: () => void) => {
    onCloseContextMenu();
    action();
  };
  const startLongPress = (action: () => void) => {
    if (!mobile) return;
    longPressTriggered.current = false;
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true;
      action();
    }, 520);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  useEffect(() => {
    if ((mobile || projectInPath) && !userToggled) setExpanded(true);
  }, [mobile, projectInPath, userToggled]);

  useEffect(() => {
    if (!expansionCommand) return;
    setUserToggled(true);
    setExpanded(expansionCommand.expanded);
  }, [expansionCommand]);

  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
  }, []);

  return (
    <div className={`relative ${mobile ? 'mb-1' : 'mb-3'}`}>
      <div
        className={`group flex cursor-pointer items-center gap-1 rounded-lg px-2 transition-colors ${mobile ? 'py-0.5' : 'py-1.5'} ${
          projectMenuOpen || projectIsSelectedLeaf
            ? 'bg-[var(--color-card)] text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
        }`}
        data-sidebar-context-menu-trigger
        onClick={() => {
          if (longPressTriggered.current) {
            longPressTriggered.current = false;
            return;
          }
          onCloseContextMenu();
          navigate(`/v2/projects/${project.id}`);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenContextMenu({ type: 'project', id: project.id });
        }}
        onPointerDown={() => startLongPress(() => onOpenContextMenu({ type: 'project', id: project.id }))}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
      >
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (longPressTriggered.current) {
              longPressTriggered.current = false;
              return;
            }
            setUserToggled(true);
            setExpanded((value) => !value);
          }}
          className={`flex w-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-left hover:bg-accent/10 hover:text-accent ${mobile ? 'min-h-[34px] py-0' : 'py-0.5'}`}
          title={treeOpen ? 'Collapse project' : 'Expand project'}
        >
          <span className="flex w-5 shrink-0 justify-center">
            {treeOpen ? <FolderOpen size={15} className={projectInPath ? 'text-accent' : 'text-dim'} /> : <Folder size={15} className={projectInPath ? 'text-accent' : 'text-dim'} />}
          </span>
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span>
        {pinned && <Pin size={12} className="text-accent" />}
        <button
          type="button"
          className={`inline-flex cursor-pointer items-center justify-center rounded text-dim transition-opacity hover:bg-accent/10 hover:text-accent disabled:opacity-50 ${mobile ? 'h-9 w-9' : 'p-1'} ${projectActionVisibility}`}
          title="New workspace"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onCloseContextMenu();
            navigate(`/v2/projects/${project.id}?newWorkspace=1`);
          }}
        >
          <FolderPlus size={13} />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (projectMenuOpen) onCloseContextMenu();
            else onOpenContextMenu({ type: 'project', id: project.id });
          }}
          className={`inline-flex cursor-pointer items-center justify-center rounded text-dim transition-opacity hover:bg-accent/10 hover:text-accent ${mobile ? 'h-9 w-9' : 'p-1'} ${projectActionVisibility}`}
          title="Project actions"
        >
          <Ellipsis size={13} />
        </button>
      </div>
      {projectMenuOpen && (
        <>
          <div className={mobile
            ? 'fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'
            : 'absolute right-1 top-8 z-50 w-52 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'}
            data-sidebar-context-menu-root
          >
            <ProjectMenuItem icon={<FolderOpen size={14} />} onClick={() => runProjectAction(() => navigate(`/v2/projects/${project.id}`))}>Open project</ProjectMenuItem>
            <ProjectMenuItem
              icon={treeOpen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              onClick={() => runProjectAction(() => {
                setUserToggled(true);
                setExpanded((value) => !value);
              })}
            >
              {treeOpen ? 'Collapse project' : 'Expand project'}
            </ProjectMenuItem>
            <ProjectMenuItem icon={<FolderPlus size={14} />} onClick={() => runProjectAction(() => navigate(`/v2/projects/${project.id}?newWorkspace=1`))}>New workspace</ProjectMenuItem>
            <ProjectMenuItem icon={pinned ? <PinOff size={14} /> : <Pin size={14} />} onClick={() => runProjectAction(() => void togglePinnedProject(project.id, queryClient))}>
              {pinned ? 'Unpin project' : 'Pin project'}
            </ProjectMenuItem>
            <ProjectMenuItem icon={<Hammer size={14} />} onClick={() => runProjectAction(() => navigate(`/v2/projects/${project.id}/skills`))}>Skills</ProjectMenuItem>
            <ProjectMenuItem icon={<Pencil size={14} />} onClick={() => runProjectAction(() => void renameProject(project, queryClient))}>Rename project</ProjectMenuItem>
            <ProjectMenuItem icon={<Settings size={14} />} onClick={() => runProjectAction(() => navigate(`/v2/projects/${project.id}/settings`))}>Settings</ProjectMenuItem>
            <ProjectMenuDivider />
            <ProjectMenuItem icon={<Copy size={14} />} onClick={() => runProjectAction(onCopyProjectPath)}>Copy repo path</ProjectMenuItem>
            <ProjectMenuItem icon={<Copy size={14} />} disabled={!project.gitOrigin} onClick={() => runProjectAction(onCopyProjectRemote)}>Copy repo remote</ProjectMenuItem>
            <ProjectMenuItem icon={<Archive size={14} />} danger onClick={() => runProjectAction(() => void archiveProject(project, queryClient, navigate))}>Archive project</ProjectMenuItem>
          </div>
        </>
      )}

      <div
        aria-hidden={!treeOpen}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          treeOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
        style={{ pointerEvents: treeOpen ? undefined : 'none' }}
      >
        <div className={`min-h-0 ${treeOpen ? 'overflow-visible' : 'overflow-hidden'}`}>
          <div className={`${mobile ? 'mt-0.5 space-y-0' : 'mt-1 space-y-0.5'} pr-1`}>
          {orderedWorkspaces.map((workspace) => {
            const active = !conversationActive && (selectedWorkspaceId
              ? selectedWorkspaceId === workspace.id
              : projectRouteActive && workspace.kind === 'main');
            const workspaceConversations = safeConversations
              .filter((conversation) => conversation.currentWorkspaceId === workspace.id && conversation.status === 'active')
              .sort((a, b) => comparePinnedThenActivity(a, b, pinnedConversationIds))
              .slice(0, showAllConversations ? undefined : 3);
            const workspaceMenuOpen = workspaceMenuId === workspace.id;
            const workspaceActionVisibility = mobile || workspaceMenuOpen ? 'opacity-100' : 'opacity-0 group-hover/workspace:opacity-100';
            const runWorkspaceAction = (action: () => void) => {
              onCloseContextMenu();
              action();
            };
            return (
              <div key={workspace.id} className="relative">
                <div
                  className={`group/workspace flex cursor-pointer items-center gap-1 rounded-md px-2 transition-colors ${mobile ? 'py-0.5' : 'py-1.5'} ${
                    workspaceMenuOpen || active
                      ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]'
                      : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-secondary)]'
                  }`}
                  data-sidebar-context-menu-trigger
                  onClick={() => {
                    if (longPressTriggered.current) {
                      longPressTriggered.current = false;
                      return;
                    }
                    onCloseContextMenu();
                    navigate(`/v2/projects/${project.id}?workspace=${workspace.id}`);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onOpenContextMenu({ type: 'workspace', id: workspace.id });
                  }}
                  onPointerDown={() => startLongPress(() => onOpenContextMenu({ type: 'workspace', id: workspace.id }))}
                  onPointerUp={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                >
                  <div
                    className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 ${mobile ? 'min-h-[34px]' : ''}`}
                  >
                    <span className="flex w-5 shrink-0 justify-center">
                      {workspace.kind === 'worktree' ? <GitBranch size={13} /> : <SquareStack size={13} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{workspace.name}</span>
                  </div>
                  <button
                    type="button"
                    disabled={creating}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onCloseContextMenu();
                      onNewConversation(workspace);
                    }}
                    className={`inline-flex cursor-pointer items-center justify-center rounded text-dim hover:bg-accent/10 hover:text-accent disabled:opacity-50 ${mobile ? 'h-9 w-9 opacity-100' : 'p-0.5 opacity-0 group-hover/workspace:opacity-100'}`}
                    title="New conversation in this workspace"
                  >
                    <MessageSquarePlus size={12} />
                  </button>
                  <button
                    type="button"
                    disabled={workspaceActionPending}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (workspaceMenuOpen) onCloseContextMenu();
                      else onOpenContextMenu({ type: 'workspace', id: workspace.id });
                    }}
                    className={`inline-flex cursor-pointer items-center justify-center rounded text-dim transition-opacity hover:bg-accent/10 hover:text-accent disabled:opacity-50 ${mobile ? 'h-9 w-9' : 'p-0.5'} ${workspaceActionVisibility}`}
                    title="Workspace actions"
                    aria-label="Workspace actions"
                  >
                    <Ellipsis size={12} />
                  </button>
                </div>
                {workspaceMenuOpen && (
                  <>
                    <div className={mobile
                      ? 'fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'
                      : 'absolute right-1 top-8 z-50 w-56 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'}
                      data-sidebar-context-menu-root
                    >
                      <ProjectMenuItem
                        icon={<SquareStack size={14} />}
                        onClick={() => runWorkspaceAction(() => navigate(`/v2/projects/${project.id}?workspace=${workspace.id}`))}
                      >
                        Open workspace
                      </ProjectMenuItem>
                      <ProjectMenuItem
                        icon={<SquareTerminal size={14} />}
                        disabled={workspaceActionPending || workspace.status !== 'active'}
                        onClick={() => runWorkspaceAction(() => onNewWorkspaceTerminal(workspace))}
                      >
                        New terminal
                      </ProjectMenuItem>
                      <ProjectMenuItem
                        icon={<RefreshCw size={14} />}
                        disabled={workspaceActionPending || workspace.status !== 'active'}
                        onClick={() => runWorkspaceAction(() => onSyncWorkspace(workspace))}
                      >
                        Sync branch
                      </ProjectMenuItem>
                      <ProjectMenuItem
                        icon={<GitFork size={14} />}
                        disabled={workspaceActionPending || workspace.status !== 'active'}
                        onClick={() => runWorkspaceAction(() => onForkWorkspace(workspace))}
                      >
                        Fork workspace
                      </ProjectMenuItem>
                      {workspace.kind === 'worktree' && workspace.status === 'active' && (
                        <>
                          <ProjectMenuItem
                            icon={<GitMerge size={14} />}
                            disabled={workspaceActionPending}
                            onClick={() => runWorkspaceAction(() => onMergeWorkspace(workspace))}
                          >
                            Merge and clean up
                          </ProjectMenuItem>
                          <ProjectMenuItem
                            icon={<RotateCcw size={14} />}
                            disabled={workspaceActionPending}
                            onClick={() => runWorkspaceAction(() => onAbandonWorkspace(workspace))}
                          >
                            Abandon and clean up
                          </ProjectMenuItem>
                          <ProjectMenuItem
                            icon={<Archive size={14} />}
                            disabled={workspaceActionPending}
                            danger
                            onClick={() => runWorkspaceAction(() => onArchiveWorkspace(workspace))}
                          >
                            Archive and clean up
                          </ProjectMenuItem>
                        </>
                      )}
                      {workspace.status !== 'active' && workspace.status !== 'archived' && (
                        <>
                          <ProjectMenuItem
                            icon={<RotateCcw size={14} />}
                            disabled={workspaceActionPending}
                            onClick={() => runWorkspaceAction(() => onActivateWorkspace(workspace))}
                          >
                            Reactivate workspace
                          </ProjectMenuItem>
                          <ProjectMenuItem
                            icon={<Archive size={14} />}
                            disabled={workspaceActionPending}
                            danger
                            onClick={() => runWorkspaceAction(() => onArchiveWorkspace(workspace))}
                          >
                            Archive and clean up
                          </ProjectMenuItem>
                        </>
                      )}
                      {workspace.kind === 'worktree' && workspace.status !== 'active' && workspace.worktreePath && (
                        <ProjectMenuItem
                          icon={<Trash2 size={14} />}
                          disabled={workspaceActionPending}
                          danger
                          onClick={() => runWorkspaceAction(() => onCleanupWorkspace(workspace))}
                        >
                          Clean up worktree
                        </ProjectMenuItem>
                      )}
                      <ProjectMenuItem
                        icon={<Copy size={14} />}
                        disabled={!workspace.branchName}
                        onClick={() => runWorkspaceAction(() => onCopyWorkspaceBranch(workspace))}
                      >
                        Copy branch name
                      </ProjectMenuItem>
                      <ProjectMenuItem
                        icon={<Copy size={14} />}
                        onClick={() => runWorkspaceAction(() => onCopyWorkspacePath(workspace))}
                      >
                        {workspace.kind === 'main' ? 'Copy project path' : 'Copy worktree path'}
                      </ProjectMenuItem>
                    </div>
                  </>
                )}
                {workspaceConversations.length > 0 && (
                  <div className={mobile ? 'space-y-0' : 'mt-0.5 space-y-0.5'}>
                    {workspaceConversations.map((conversation) => (
                      <ConversationSidebarRow
                        key={conversation.id}
                        conversation={conversation}
                        active={conversation.id === activeConversationId}
                        pending={archivingConversation}
                        snapshot={conversationStateById.get(conversation.id)}
                        mobile={mobile}
                        pinned={pinnedConversationIds.includes(conversation.id)}
                        menuOpen={contextMenu?.type === 'conversation' && contextMenu.id === conversation.id}
                        onOpenMenu={() => onOpenContextMenu({ type: 'conversation', id: conversation.id })}
                        onCloseMenu={onCloseContextMenu}
                        onArchive={() => onArchiveConversation(conversation)}
                        onRename={(title) => onRenameConversation(conversation, title)}
                        onMarkRead={() => onMarkConversationRead(conversation)}
                        onMarkUnread={() => onMarkConversationUnread(conversation)}
                        onTogglePin={() => onTogglePinnedConversation(conversation)}
                        onSwitchWorkspace={() => onSwitchConversationWorkspace(conversation)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {recentProjectConversations.map((conversation) => (
            <ConversationSidebarRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeConversationId}
              pending={archivingConversation}
              snapshot={conversationStateById.get(conversation.id)}
              mobile={mobile}
              pinned={pinnedConversationIds.includes(conversation.id)}
              menuOpen={contextMenu?.type === 'conversation' && contextMenu.id === conversation.id}
              onOpenMenu={() => onOpenContextMenu({ type: 'conversation', id: conversation.id })}
              onCloseMenu={onCloseContextMenu}
              onArchive={() => onArchiveConversation(conversation)}
              onRename={(title) => onRenameConversation(conversation, title)}
              onMarkRead={() => onMarkConversationRead(conversation)}
              onMarkUnread={() => onMarkConversationUnread(conversation)}
              onTogglePin={() => onTogglePinnedConversation(conversation)}
              onSwitchWorkspace={() => onSwitchConversationWorkspace(conversation)}
            />
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConversationSidebarRow({
  conversation,
  active,
  pending,
  snapshot,
  pinned,
  menuOpen,
  mobile = false,
  onOpenMenu,
  onCloseMenu,
  onArchive,
  onRename,
  onMarkRead,
  onMarkUnread,
  onTogglePin,
  onSwitchWorkspace,
  className = '',
}: {
  conversation: Conversation;
  active: boolean;
  pending: boolean;
  snapshot?: PiConversationSnapshot;
  pinned: boolean;
  menuOpen: boolean;
  mobile?: boolean;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onArchive: () => void;
  onRename: (title: string) => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onTogglePin: () => void;
  onSwitchWorkspace: () => void;
  className?: string;
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);

  useEffect(() => {
    setDraft(conversation.title);
  }, [conversation.title]);

  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
  }, []);

  const save = () => {
    const title = draft.trim();
    setEditing(false);
    if (title && title !== conversation.title) onRename(title);
    else setDraft(conversation.title);
  };

  const openMenu = onOpenMenu;
  const closeMenu = onCloseMenu;
  const startLongPress = () => {
    if (!mobile || editing) return;
    longPressTriggered.current = false;
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true;
      openMenu();
    }, 520);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const runAction = (action: () => void) => {
    closeMenu();
    action();
  };

  return (
    <div
      className={`group/conversation relative flex cursor-pointer items-center rounded-md ${
      active ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]' : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
    } ${menuOpen ? 'bg-[var(--color-card)] text-[var(--color-text-primary)]' : ''} ${className}`}
      data-sidebar-context-menu-trigger
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu();
      }}
      onClick={() => {
        if (longPressTriggered.current) {
          longPressTriggered.current = false;
          return;
        }
        if (!editing) {
          closeMenu();
          navigate(`/v2/conversations/${conversation.id}`);
        }
      }}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerLeave={cancelLongPress}
    >
      <div className={`flex min-w-0 flex-1 items-center gap-2 px-2 text-xs ${mobile ? 'py-0.5' : 'py-1'}`}>
        <button
          type="button"
          className="shrink-0"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
            navigate(`/v2/conversations/${conversation.id}`);
          }}
          title="Open conversation"
        >
          <ConversationStateIndicator conversation={conversation} snapshot={snapshot} />
        </button>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
              if (event.key === 'Escape') {
                setEditing(false);
                setDraft(conversation.title);
              }
            }}
            className="h-5 min-w-0 flex-1 bg-transparent outline-none"
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <button
            type="button"
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setEditing(true);
            }}
            className={`min-w-0 flex-1 cursor-pointer truncate text-left font-normal ${mobile ? 'flex min-h-[34px] items-center' : ''}`}
            title="Double-click to rename"
          >
            <span className="inline-flex min-w-0 items-center gap-1">
              {pinned && <Pin size={10} className="shrink-0 text-accent" />}
              <span className="truncate">{conversation.title}</span>
            </span>
          </button>
        )}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenu();
        }}
        className={`mr-1 inline-flex cursor-pointer items-center justify-center rounded text-dim hover:bg-accent/10 hover:text-accent disabled:opacity-50 ${mobile ? 'h-9 w-9' : 'p-1 opacity-0 group-hover/conversation:opacity-100'}`}
        title="Conversation actions"
        aria-label="Conversation actions"
      >
        <Ellipsis size={13} />
      </button>
      {menuOpen && (
        <>
          <div className={mobile
            ? 'fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'
            : 'absolute right-1 top-7 z-50 w-48 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'}
            data-sidebar-context-menu-root
          >
            <ProjectMenuItem icon={<MessageSquareText size={14} />} onClick={() => runAction(() => navigate(`/v2/conversations/${conversation.id}`))}>
              Open conversation
            </ProjectMenuItem>
            <ProjectMenuItem
              icon={<CircleDot size={14} />}
              onClick={() => runAction(conversation.unreadAt ? onMarkRead : onMarkUnread)}
            >
              {conversation.unreadAt ? 'Mark read' : 'Mark unread'}
            </ProjectMenuItem>
            <ProjectMenuItem icon={pinned ? <PinOff size={14} /> : <Pin size={14} />} onClick={() => runAction(onTogglePin)}>
              {pinned ? 'Unpin conversation' : 'Pin conversation'}
            </ProjectMenuItem>
            <ProjectMenuItem icon={<SquareStack size={14} />} onClick={() => runAction(onSwitchWorkspace)}>
              Switch workspace
            </ProjectMenuItem>
            <ProjectMenuItem icon={<Pencil size={14} />} onClick={() => runAction(() => setEditing(true))}>
              Rename
            </ProjectMenuItem>
            <ProjectMenuItem icon={<Archive size={14} />} danger onClick={() => runAction(onArchive)}>
              Archive
            </ProjectMenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function ConversationStateIndicator({ conversation, snapshot }: { conversation: Conversation; snapshot?: PiConversationSnapshot }) {
  if (snapshot?.lastError) {
    return (
      <span className="flex w-5 shrink-0 justify-center text-[var(--color-error)]" title={snapshot.lastError}>
        <CircleAlert size={12} />
      </span>
    );
  }

  if (snapshot?.streaming) {
    return (
      <span className="flex w-5 shrink-0 justify-center text-accent" title="Pi is working">
        <LoaderCircle size={12} className="animate-spin" />
      </span>
    );
  }

  if (snapshot?.runtimeActive) {
    if (conversation.unreadAt) {
      return (
        <span className="flex w-5 shrink-0 justify-center text-[var(--color-status-in-review)]" title="Unread response">
          <Circle size={9} fill="currentColor" />
        </span>
      );
    }
    return <span className="flex w-5 shrink-0 justify-center" aria-hidden="true" />;
  }

  if (conversation.unreadAt) {
    return (
      <span className="flex w-5 shrink-0 justify-center text-accent" title="Unread">
        <Circle size={9} fill="currentColor" />
      </span>
    );
  }

  return <span className="flex w-5 shrink-0 justify-center" aria-hidden="true" />;
}

function ProjectMenuItem({
  icon,
  children,
  onClick,
  danger = false,
  disabled = false,
  selected = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm md:min-h-0 md:text-xs ${
        disabled
          ? 'cursor-not-allowed text-dim opacity-50'
          : danger
            ? 'text-[var(--color-error)] hover:bg-[var(--color-error)]/10'
            : selected
              ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      {selected && <span className="text-[var(--color-text-primary)]">✓</span>}
    </button>
  );
}

function ProjectMenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-3 text-xs font-medium text-dim first:pt-1">{children}</div>;
}

function ProjectMenuDivider() {
  return <div className="my-1 h-px bg-[var(--color-card-border)]" />;
}

function SidebarAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] focus-visible:outline-none md:h-8"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function defaultWorkspaceForkName(workspace: Workspace) {
  const base = workspace.name.trim() || workspace.branchName.trim() || 'workspace';
  const suffix = new Date().toISOString().slice(5, 10).replace('-', '');
  return `${base}-fork-${suffix}`;
}

function orderProjectsForTree(
  projects: Project[],
  pinnedProjectIds: string[],
  mode: ProjectTreeMode,
  sort: ProjectTreeSort,
  conversationsForProject: (projectId: string) => Conversation[],
) {
  return [...projects].sort((a, b) => {
    const pinnedA = pinnedProjectIds.includes(a.id);
    const pinnedB = pinnedProjectIds.includes(b.id);
    if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;

    if (mode === 'chats') {
      const aHasChats = conversationsForProject(a.id).some((conversation) => conversation.status === 'active');
      const bHasChats = conversationsForProject(b.id).some((conversation) => conversation.status === 'active');
      if (aHasChats !== bHasChats) return aHasChats ? -1 : 1;
    }

    if (mode === 'chronological' || mode === 'chats') {
      const aDate = sort === 'created' ? a.createdAt : a.updatedAt;
      const bDate = sort === 'created' ? b.createdAt : b.updatedAt;
      const dateCompare = bDate.localeCompare(aDate);
      if (dateCompare !== 0) return dateCompare;
    }

    return a.name.localeCompare(b.name);
  });
}

function comparePinnedThenActivity(a: Conversation, b: Conversation, pinnedConversationIds: string[]) {
  const pinnedA = pinnedConversationIds.includes(a.id);
  const pinnedB = pinnedConversationIds.includes(b.id);
  if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;
  return b.lastActivityAt.localeCompare(a.lastActivityAt);
}

function copyToClipboard(value: string | undefined, label: string) {
  if (!value) return;
  const write = navigator.clipboard?.writeText(value);
  if (!write) {
    window.prompt(`Copy ${label}`, value);
    return;
  }
  void write.catch(() => {
    window.prompt(`Copy ${label}`, value);
  });
}

async function getPinnedConversationIds() {
  const pinned = await preferencesApi.get<string[]>('v2_pinned_conversations').catch(() => []);
  return Array.isArray(pinned) ? pinned : [];
}

async function togglePinnedConversation(conversationId: string, queryClient: QueryClient) {
  const pinned = await getPinnedConversationIds();
  const next = pinned.includes(conversationId)
    ? pinned.filter((id) => id !== conversationId)
    : [...pinned, conversationId];
  await preferencesApi.set('v2_pinned_conversations', next);
  await queryClient.invalidateQueries({ queryKey: ['v2-pinned-conversations'] });
}

function chooseConversationWorkspace(conversation: Conversation, workspaces: Workspace[]) {
  const activeWorkspaces = workspaces.filter((workspace) => workspace.status === 'active');
  const options = [
    { label: 'Project default', value: undefined },
    ...activeWorkspaces.map((workspace) => ({
      label: `${workspace.name}${workspace.branchName ? ` (${workspace.branchName})` : ''}`,
      value: workspace.id,
    })),
  ];
  const currentIndex = options.findIndex((option) => option.value === conversation.currentWorkspaceId);
  const promptText = options
    .map((option, index) => `${index + 1}. ${option.label}${index === currentIndex ? ' current' : ''}`)
    .join('\n');
  const answer = window.prompt(`Switch "${conversation.title}" to workspace:\n${promptText}`, String(Math.max(1, currentIndex + 1)));
  if (answer === null) return undefined;
  const index = Number(answer.trim()) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= options.length) return undefined;
  return options[index].value ?? '';
}

async function invalidateConversationLists(queryClient: QueryClient, projectId: string, conversationId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
    queryClient.invalidateQueries({ queryKey: ['v2-conversation', conversationId] }),
    queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations'] }),
    queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', projectId, 'sidebar'] }),
    queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
  ]);
}

async function togglePinnedProject(projectId: string, queryClient: QueryClient) {
  const pinnedValue = await preferencesApi.getPinnedProjects();
  const pinned: string[] = Array.isArray(pinnedValue) ? pinnedValue : [];
  const next = pinned.includes(projectId)
    ? pinned.filter((id) => id !== projectId)
    : [...pinned, projectId];
  await preferencesApi.setPinnedProjects(next);
  await queryClient.invalidateQueries({ queryKey: ['pinned-projects'] });
  await queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] });
}

async function renameProject(project: Project, queryClient: QueryClient) {
  const nextName = window.prompt('Rename project', project.name)?.trim();
  if (!nextName || nextName === project.name) return;
  await projectsApi.update(project.id, { name: nextName });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['v2-projects'] }),
    queryClient.invalidateQueries({ queryKey: ['project', project.id] }),
    queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
  ]);
}

async function archiveProject(project: Project, queryClient: QueryClient, navigate: NavigateFunction) {
  if (!window.confirm(`Archive ${project.name}? It will be hidden from the active project list.`)) return;
  await projectsApi.update(project.id, { hidden: true });
  await queryClient.invalidateQueries({ queryKey: ['v2-projects'] });
  await queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] });
  navigate('/v2');
}

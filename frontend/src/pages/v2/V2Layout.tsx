import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
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
  MessageSquarePlus,
  MessageSquareText,
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
} from 'lucide-react';
import { preferencesApi, projectsApi } from '../../api';
import type { Conversation, PiConversationSnapshot, Project, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';
import { CodeburgIcon, CodeburgWordmark } from '../../components/ui/CodeburgIcon';
import { useMobile } from '../../hooks/useMobile';
import { getDesktopTitleBarInsetTop, isDesktopShell } from '../../platform/runtimeConfig';
import { selectIsExpanded, useSidebarStore } from '../../stores/sidebar';
import type { QueryClient } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router-dom';

export function V2Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useMobile();
  const isMobileHome = isMobile && location.pathname === '/v2';
  const projectTreeScrollRef = useRef<HTMLDivElement>(null);
  const sidebarExpanded = useSidebarStore(selectIsExpanded);
  const toggleSidebarExpanded = useSidebarStore((state) => state.toggleExpanded);
  const { data: projects, isLoading } = useQuery({
    queryKey: ['v2-projects'],
    queryFn: () => projectsApi.list(),
  });
  const { data: pinnedProjectIds = [] } = useQuery({
    queryKey: ['pinned-projects'],
    queryFn: () => preferencesApi.getPinnedProjects(),
  });

  const safeProjects = Array.isArray(projects) ? projects : [];
  const safePinnedProjectIds = Array.isArray(pinnedProjectIds) ? pinnedProjectIds : [];
  const visibleProjects = safeProjects
    .filter((project) => !project.hidden)
    .sort((a, b) => {
      const pinnedA = safePinnedProjectIds.includes(a.id);
      const pinnedB = safePinnedProjectIds.includes(b.id);
      if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  const shouldLoadSidebarTree = !isMobile || isMobileHome;
  const workspaceQueries = useQueries({
    queries: visibleProjects.map((project) => ({
      queryKey: ['v2-workspaces', project.id],
      queryFn: () => v2Api.listWorkspaces(project.id),
      enabled: shouldLoadSidebarTree && !!project.id,
      staleTime: 30_000,
    })),
  });
  const conversationQueries = useQueries({
    queries: visibleProjects.map((project) => ({
      queryKey: ['v2-project-conversations', project.id, 'sidebar'],
      queryFn: () => v2Api.listProjectConversations(project.id, { provider: 'pi', status: 'active' }),
      enabled: shouldLoadSidebarTree && !!project.id,
      staleTime: 20_000,
      refetchInterval: shouldLoadSidebarTree ? 5_000 : false,
    })),
  });

  const workspacesByProject = new Map<string, Workspace[]>();
  const conversationsByProject = new Map<string, Conversation[]>();
  visibleProjects.forEach((project, index) => {
    workspacesByProject.set(project.id, workspaceQueries[index]?.data ?? []);
    conversationsByProject.set(project.id, conversationQueries[index]?.data ?? []);
  });
  const visibleConversations = shouldLoadSidebarTree
    ? Array.from(conversationsByProject.values())
      .flat()
      .filter((conversation) => conversation.status === 'active')
      .slice(0, 60)
    : [];
  const conversationStateQueries = useQueries({
    queries: visibleConversations.map((conversation) => ({
      queryKey: ['v2-conversation-state', conversation.id, 'sidebar'],
      queryFn: () => v2Api.getConversationState(conversation.id),
      enabled: shouldLoadSidebarTree && conversation.provider === 'pi',
      staleTime: 5_000,
      refetchInterval: shouldLoadSidebarTree ? 5_000 : false,
    })),
  });
  const conversationStateById = new Map<string, PiConversationSnapshot>();
  visibleConversations.forEach((conversation, index) => {
    const snapshot = conversationStateQueries[index]?.data;
    if (snapshot) conversationStateById.set(conversation.id, snapshot);
  });
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
      ]);
      navigate(`/v2/conversations/${conversation.id}`);
    },
  });
  const archiveOrDeleteConversation = useMutation({
    mutationFn: async (conversation: Conversation) => {
      const snapshot = await v2Api.getConversationState(conversation.id).catch(() => null);
      if (!snapshot || snapshot.messages.length === 0) {
        await v2Api.deleteConversation(conversation.id);
        return { projectId: conversation.projectId };
      }
      const archived = await v2Api.archiveConversation(conversation.id);
      return { projectId: archived.projectId };
    },
    onSuccess: async ({ projectId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', projectId, 'sidebar'] }),
      ]);
      if (location.pathname.match(/^\/v2\/conversations\/[^/]+/)) navigate('/v2');
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
      ]);
    },
  });
  const createWorkspaceTerminal = useMutation({
    mutationFn: ({ workspace }: { project: Project; workspace: Workspace }) =>
      v2Api.createTerminal(workspace.id, { title: `${workspace.name} terminal` }),
    onSuccess: async (terminal, { project }) => {
      await queryClient.invalidateQueries({ queryKey: ['v2-terminals', terminal.workspaceId] });
      navigate(`/v2/projects/${project.id}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`);
    },
  });
  const syncWorkspace = useMutation({
    mutationFn: (workspace: Workspace) => v2Api.syncWorkspace(workspace.id),
    onSuccess: async (_result, workspace) => {
      await queryClient.invalidateQueries({ queryKey: ['v2-workspaces', workspace.projectId] });
    },
  });
  const forkWorkspace = useMutation({
    mutationFn: ({ workspace, name }: { workspace: Workspace; name: string }) =>
      v2Api.forkWorkspace(workspace.id, { name, baseBranch: workspace.branchName || undefined }),
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ['v2-workspaces', response.workspace.projectId] });
      navigate(`/v2/projects/${response.workspace.projectId}?workspace=${response.workspace.id}`);
    },
  });
  const mutateWorkspaceStatus = useMutation({
    mutationFn: ({ workspace, action }: { workspace: Workspace; action: 'activate' | 'merge' | 'abandon' | 'archive' }) => {
      if (action === 'activate') return v2Api.activateWorkspace(workspace.id);
      if (action === 'merge') return v2Api.mergeWorkspace(workspace.id);
      if (action === 'abandon') return v2Api.abandonWorkspace(workspace.id);
      return v2Api.archiveWorkspace(workspace.id);
    },
    onSuccess: async (updated, { action }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-workspaces', updated.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-terminals', updated.id] }),
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
  const forkWorkspaceFromMenu = (workspace: Workspace) => {
    const name = window.prompt('Fork workspace', defaultWorkspaceForkName(workspace))?.trim();
    if (!name) return;
    forkWorkspace.mutate({ workspace, name });
  };

  const desktopTopInset = isDesktopShell() ? getDesktopTitleBarInsetTop() : 0;

  const sidebarBody = (
    <>
      <div className="px-3 pb-3">
        <div className="flex h-10 items-center gap-2 rounded-lg bg-[var(--color-card)] px-3 text-sm text-dim md:h-8 md:px-2.5 md:text-xs">
          <Search size={14} />
          <span className="truncate">Search soon: projects, threads, files</span>
        </div>
      </div>

      <nav className="space-y-1 px-2">
        {isMobile ? (
          <SidebarAction
            icon={<Folder size={15} />}
            label="Projects"
            onClick={() => projectTreeScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          />
        ) : (
          <V2NavLink
            to="/v2"
            active={location.pathname === '/v2'}
            icon={<Folder size={15} />}
            label="Projects"
          />
        )}
        <SidebarAction icon={<PlugZap size={15} />} label="Pi setup" onClick={() => navigate('/v2/settings')} />
        <SidebarAction icon={<MessageSquareText size={15} />} label="All conversations" onClick={() => navigate('/v2/conversations')} />
      </nav>

      <div className="mt-5 flex items-center justify-between px-4 text-[11px] font-medium uppercase text-dim">
        <span>Projects</span>
        <span>{visibleProjects.length}</span>
      </div>

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
            archivingConversation={archiveOrDeleteConversation.isPending}
            workspaceActionPending={workspaceActionPending}
            conversationStateById={conversationStateById}
            mobile={isMobile}
            onNewConversation={(workspace) => createConversation.mutate({ project, workspace })}
            onArchiveConversation={(conversation) => archiveOrDeleteConversation.mutate(conversation)}
            onRenameConversation={(conversation, title) => renameConversation.mutate({ conversation, title })}
            onMarkConversationRead={(conversation) => markConversationReadState.mutate({ conversation, unread: false })}
            onMarkConversationUnread={(conversation) => markConversationReadState.mutate({ conversation, unread: true })}
            onNewWorkspaceTerminal={(workspace) => createWorkspaceTerminal.mutate({ project, workspace })}
            onSyncWorkspace={(workspace) => syncWorkspace.mutate(workspace)}
            onForkWorkspace={forkWorkspaceFromMenu}
            onActivateWorkspace={(workspace) => mutateWorkspaceStatus.mutate({ workspace, action: 'activate' })}
            onMergeWorkspace={(workspace) => mutateWorkspaceStatus.mutate({ workspace, action: 'merge' })}
            onAbandonWorkspace={(workspace) => mutateWorkspaceStatus.mutate({ workspace, action: 'abandon' })}
            onArchiveWorkspace={(workspace) => mutateWorkspaceStatus.mutate({ workspace, action: 'archive' })}
            onCopyWorkspaceBranch={(workspace) => copyToClipboard(workspace.branchName, 'branch name')}
            onCopyWorkspacePath={(workspace) => copyToClipboard(workspace.worktreePath || project.path, workspace.kind === 'main' ? 'project path' : 'worktree path')}
          />
        ))}
      </div>

      <div className="border-t border-[var(--color-card-border)] p-2">
        <Link
          to="/v2/settings"
          className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] md:min-h-0 md:py-2"
        >
          <Settings size={15} />
          Settings
        </Link>
      </div>
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
          onSettings={() => navigate('/v2/settings')}
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
  const settingsActive = pathname.startsWith('/v2/settings');
  const homeActive = !conversationsActive && !settingsActive;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-[70] border-t border-[var(--color-card-border)] bg-canvas/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-14px_32px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="grid h-[64px] grid-cols-3">
        <V2MobileNavButton active={homeActive} icon={<Folder size={18} />} label="Home" onClick={onHome} />
        <V2MobileNavButton active={conversationsActive} icon={<MessageSquareText size={18} />} label="Chat" onClick={onConversations} />
        <V2MobileNavButton active={settingsActive} icon={<Settings size={18} />} label="Settings" onClick={onSettings} />
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
  mobile = false,
  onNewConversation,
  onArchiveConversation,
  onRenameConversation,
  onMarkConversationRead,
  onMarkConversationUnread,
  onNewWorkspaceTerminal,
  onSyncWorkspace,
  onForkWorkspace,
  onActivateWorkspace,
  onMergeWorkspace,
  onAbandonWorkspace,
  onArchiveWorkspace,
  onCopyWorkspaceBranch,
  onCopyWorkspacePath,
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
  mobile?: boolean;
  onNewConversation: (workspace?: Workspace) => void;
  onArchiveConversation: (conversation: Conversation) => void;
  onRenameConversation: (conversation: Conversation, title: string) => void;
  onMarkConversationRead: (conversation: Conversation) => void;
  onMarkConversationUnread: (conversation: Conversation) => void;
  onNewWorkspaceTerminal: (workspace: Workspace) => void;
  onSyncWorkspace: (workspace: Workspace) => void;
  onForkWorkspace: (workspace: Workspace) => void;
  onActivateWorkspace: (workspace: Workspace) => void;
  onMergeWorkspace: (workspace: Workspace) => void;
  onAbandonWorkspace: (workspace: Workspace) => void;
  onArchiveWorkspace: (workspace: Workspace) => void;
  onCopyWorkspaceBranch: (workspace: Workspace) => void;
  onCopyWorkspacePath: (workspace: Workspace) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [workspaceMenuId, setWorkspaceMenuId] = useState<string | null>(null);
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
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, 3);
  const projectIsSelectedLeaf = projectRouteActive && orderedWorkspaces.length === 0 && !selectedWorkspaceId;
  const projectActionVisibility = mobile || projectMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100';
  const runProjectAction = (action: () => void) => {
    setProjectMenuOpen(false);
    action();
  };

  useEffect(() => {
    if ((mobile || projectInPath) && !userToggled) setExpanded(true);
  }, [mobile, projectInPath, userToggled]);

  return (
    <div className={`relative ${mobile ? 'mb-1' : 'mb-3'}`}>
      <div
        className={`group flex items-center gap-1 rounded-lg px-2 transition-colors ${mobile ? 'py-0.5' : 'py-1.5'} ${
          projectMenuOpen || projectIsSelectedLeaf
            ? 'bg-[var(--color-card)] text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setUserToggled(true);
            setExpanded((value) => !value);
          }}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md text-left ${mobile ? 'min-h-[34px] py-0' : 'py-0.5'}`}
          title={treeOpen ? 'Collapse project' : 'Expand project'}
        >
          <span className="flex w-5 shrink-0 justify-center">
            {treeOpen ? <FolderOpen size={15} className={projectInPath ? 'text-accent' : 'text-dim'} /> : <Folder size={15} className={projectInPath ? 'text-accent' : 'text-dim'} />}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span>
        </button>
        {pinned && <Pin size={12} className="text-accent" />}
        <button
          type="button"
          onClick={() => navigate(`/v2/projects/${project.id}?newWorkspace=1`)}
          className={`inline-flex items-center justify-center rounded text-dim transition-opacity hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50 ${mobile ? 'h-9 w-9' : 'p-1'} ${projectActionVisibility}`}
          title="New workspace"
        >
          <FolderPlus size={13} />
        </button>
        <button
          type="button"
          onClick={() => setProjectMenuOpen((value) => !value)}
          className={`inline-flex items-center justify-center rounded text-dim transition-opacity hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] ${mobile ? 'h-9 w-9' : 'p-1'} ${projectActionVisibility}`}
          title="Project actions"
        >
          <Ellipsis size={13} />
        </button>
      </div>
      {projectMenuOpen && (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close project menu" onClick={() => setProjectMenuOpen(false)} />
          <div className={mobile
            ? 'fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'
            : 'absolute right-1 top-8 z-50 w-52 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'}
          >
            <ProjectMenuItem icon={<FolderPlus size={14} />} onClick={() => runProjectAction(() => navigate(`/v2/projects/${project.id}?newWorkspace=1`))}>New workspace</ProjectMenuItem>
            <ProjectMenuItem icon={pinned ? <PinOff size={14} /> : <Pin size={14} />} onClick={() => runProjectAction(() => void togglePinnedProject(project.id, queryClient))}>
              {pinned ? 'Unpin project' : 'Pin project'}
            </ProjectMenuItem>
            <ProjectMenuItem icon={<Hammer size={14} />} onClick={() => runProjectAction(() => navigate(`/v2/projects/${project.id}/skills`))}>Skills</ProjectMenuItem>
            <ProjectMenuItem icon={<Pencil size={14} />} onClick={() => runProjectAction(() => void renameProject(project, queryClient))}>Rename project</ProjectMenuItem>
            <ProjectMenuItem icon={<Settings size={14} />} onClick={() => runProjectAction(() => navigate(`/v2/projects/${project.id}/settings`))}>Settings</ProjectMenuItem>
            <ProjectMenuItem icon={<Archive size={14} />} danger onClick={() => runProjectAction(() => void archiveProject(project, queryClient, navigate))}>Archive project</ProjectMenuItem>
          </div>
        </>
      )}

      {treeOpen && (
        <div className={`${mobile ? 'mt-0.5 space-y-0' : 'mt-1 space-y-0.5'} pr-1`}>
          {orderedWorkspaces.map((workspace) => {
            const active = !conversationActive && (selectedWorkspaceId
              ? selectedWorkspaceId === workspace.id
              : projectRouteActive && workspace.kind === 'main');
            const workspaceConversations = safeConversations
              .filter((conversation) => conversation.currentWorkspaceId === workspace.id && conversation.status === 'active')
              .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
              .slice(0, 3);
            const workspaceMenuOpen = workspaceMenuId === workspace.id;
            const workspaceActionVisibility = mobile || workspaceMenuOpen ? 'opacity-100' : 'opacity-0 group-hover/workspace:opacity-100';
            const runWorkspaceAction = (action: () => void) => {
              setWorkspaceMenuId(null);
              action();
            };
            return (
              <div key={workspace.id} className="relative">
                <div
                  className={`group/workspace flex items-center gap-1 rounded-md px-2 transition-colors ${mobile ? 'py-0.5' : 'py-1.5'} ${
                    workspaceMenuOpen || active
                      ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]'
                      : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  <Link to={`/v2/projects/${project.id}?workspace=${workspace.id}`} className={`flex min-w-0 flex-1 items-center gap-2 ${mobile ? 'min-h-[34px]' : ''}`}>
                    <span className="flex w-5 shrink-0 justify-center">
                      {workspace.kind === 'worktree' ? <GitBranch size={13} /> : <SquareStack size={13} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{workspace.name}</span>
                  </Link>
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => onNewConversation(workspace)}
                    className={`inline-flex items-center justify-center rounded text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:opacity-50 ${mobile ? 'h-9 w-9 opacity-100' : 'p-0.5 opacity-0 group-hover/workspace:opacity-100'}`}
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
                      setWorkspaceMenuId((value) => (value === workspace.id ? null : workspace.id));
                    }}
                    className={`inline-flex items-center justify-center rounded text-dim transition-opacity hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:opacity-50 ${mobile ? 'h-9 w-9' : 'p-0.5'} ${workspaceActionVisibility}`}
                    title="Workspace actions"
                    aria-label="Workspace actions"
                  >
                    <Ellipsis size={12} />
                  </button>
                </div>
                {workspaceMenuOpen && (
                  <>
                    <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close workspace menu" onClick={() => setWorkspaceMenuId(null)} />
                    <div className={mobile
                      ? 'fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'
                      : 'absolute right-1 top-8 z-50 w-56 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'}
                    >
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
                            Merge workspace
                          </ProjectMenuItem>
                          <ProjectMenuItem
                            icon={<RotateCcw size={14} />}
                            disabled={workspaceActionPending}
                            onClick={() => runWorkspaceAction(() => onAbandonWorkspace(workspace))}
                          >
                            Abandon workspace
                          </ProjectMenuItem>
                          <ProjectMenuItem
                            icon={<Archive size={14} />}
                            disabled={workspaceActionPending}
                            danger
                            onClick={() => runWorkspaceAction(() => onArchiveWorkspace(workspace))}
                          >
                            Archive workspace
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
                            Archive workspace
                          </ProjectMenuItem>
                        </>
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
                        onArchive={() => onArchiveConversation(conversation)}
                        onRename={(title) => onRenameConversation(conversation, title)}
                        onMarkRead={() => onMarkConversationRead(conversation)}
                        onMarkUnread={() => onMarkConversationUnread(conversation)}
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
              onArchive={() => onArchiveConversation(conversation)}
              onRename={(title) => onRenameConversation(conversation, title)}
              onMarkRead={() => onMarkConversationRead(conversation)}
              onMarkUnread={() => onMarkConversationUnread(conversation)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConversationSidebarRow({
  conversation,
  active,
  pending,
  snapshot,
  mobile = false,
  onArchive,
  onRename,
  onMarkRead,
  onMarkUnread,
  className = '',
}: {
  conversation: Conversation;
  active: boolean;
  pending: boolean;
  snapshot?: PiConversationSnapshot;
  mobile?: boolean;
  onArchive: () => void;
  onRename: (title: string) => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const [menuOpen, setMenuOpen] = useState(false);
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

  const openMenu = () => setMenuOpen(true);
  const closeMenu = () => setMenuOpen(false);
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
      className={`group/conversation relative flex items-center rounded-md ${
      active ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]' : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
    } ${menuOpen ? 'bg-[var(--color-card)] text-[var(--color-text-primary)]' : ''} ${className}`}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu();
      }}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerLeave={cancelLongPress}
    >
      <div className={`flex min-w-0 flex-1 items-center gap-2 px-2 text-xs ${mobile ? 'py-0.5' : 'py-1'}`}>
        <Link
          to={`/v2/conversations/${conversation.id}`}
          className="shrink-0"
          onClick={(event) => {
            if (longPressTriggered.current) {
              event.preventDefault();
              longPressTriggered.current = false;
            }
          }}
        >
          <ConversationStateIndicator conversation={conversation} snapshot={snapshot} />
        </Link>
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
          />
        ) : (
          <Link
            to={`/v2/conversations/${conversation.id}`}
            onClick={(event) => {
              if (longPressTriggered.current) {
                event.preventDefault();
                longPressTriggered.current = false;
              }
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              setEditing(true);
            }}
            className={`min-w-0 flex-1 truncate font-normal ${mobile ? 'flex min-h-[34px] items-center' : ''}`}
            title="Double-click to rename"
          >
            {conversation.title}
          </Link>
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
        className={`mr-1 inline-flex items-center justify-center rounded text-dim hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50 ${mobile ? 'h-9 w-9' : 'p-1 opacity-70 group-hover/conversation:opacity-100'}`}
        title="Conversation actions"
        aria-label="Conversation actions"
      >
        <Ellipsis size={13} />
      </button>
      {menuOpen && (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close conversation menu" onClick={closeMenu} />
          <div className={mobile
            ? 'fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'
            : 'absolute right-1 top-7 z-50 w-48 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'}
          >
            <ProjectMenuItem
              icon={<CircleDot size={14} />}
              onClick={() => runAction(conversation.unreadAt ? onMarkRead : onMarkUnread)}
            >
              {conversation.unreadAt ? 'Mark read' : 'Mark unread'}
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
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm md:min-h-0 md:text-xs ${
        disabled
          ? 'cursor-not-allowed text-dim opacity-50'
          : danger
            ? 'text-[var(--color-error)] hover:bg-[var(--color-error)]/10'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
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

function V2NavLink({
  to,
  active,
  icon,
  label,
}: {
  to: string;
  active: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className={`flex h-10 items-center gap-2 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none md:h-8 ${
        active
          ? 'bg-[var(--color-card)] text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

function defaultWorkspaceForkName(workspace: Workspace) {
  const base = workspace.name.trim() || workspace.branchName.trim() || 'workspace';
  const suffix = new Date().toISOString().slice(5, 10).replace('-', '');
  return `${base}-fork-${suffix}`;
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

async function togglePinnedProject(projectId: string, queryClient: QueryClient) {
  const pinnedValue = await preferencesApi.getPinnedProjects();
  const pinned: string[] = Array.isArray(pinnedValue) ? pinnedValue : [];
  const next = pinned.includes(projectId)
    ? pinned.filter((id) => id !== projectId)
    : [...pinned, projectId];
  await preferencesApi.setPinnedProjects(next);
  await queryClient.invalidateQueries({ queryKey: ['pinned-projects'] });
}

async function renameProject(project: Project, queryClient: QueryClient) {
  const nextName = window.prompt('Rename project', project.name)?.trim();
  if (!nextName || nextName === project.name) return;
  await projectsApi.update(project.id, { name: nextName });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['v2-projects'] }),
    queryClient.invalidateQueries({ queryKey: ['project', project.id] }),
  ]);
}

async function archiveProject(project: Project, queryClient: QueryClient, navigate: NavigateFunction) {
  if (!window.confirm(`Archive ${project.name}? It will be hidden from the active project list.`)) return;
  await projectsApi.update(project.id, { hidden: true });
  await queryClient.invalidateQueries({ queryKey: ['v2-projects'] });
  navigate('/v2');
}

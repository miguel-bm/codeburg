import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Circle,
  CircleAlert,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  LoaderCircle,
  MessageSquarePlus,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  PlugZap,
  Search,
  Settings,
  SquareStack,
} from 'lucide-react';
import { preferencesApi, projectsApi } from '../../api';
import type { Conversation, PiConversationSnapshot, Project, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';
import { CodeburgIcon, CodeburgWordmark } from '../../components/ui/CodeburgIcon';
import { getDesktopTitleBarInsetTop, isDesktopShell } from '../../platform/runtimeConfig';
import { selectIsExpanded, useSidebarStore } from '../../stores/sidebar';
import type { QueryClient } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router-dom';

export function V2Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const workspaceQueries = useQueries({
    queries: visibleProjects.map((project) => ({
      queryKey: ['v2-workspaces', project.id],
      queryFn: () => v2Api.listWorkspaces(project.id),
      enabled: !!project.id,
      staleTime: 30_000,
    })),
  });
  const conversationQueries = useQueries({
    queries: visibleProjects.map((project) => ({
      queryKey: ['v2-project-conversations', project.id, 'sidebar'],
      queryFn: () => v2Api.listProjectConversations(project.id, { provider: 'pi', status: 'active' }),
      enabled: !!project.id,
      staleTime: 20_000,
    })),
  });

  const workspacesByProject = new Map<string, Workspace[]>();
  const conversationsByProject = new Map<string, Conversation[]>();
  visibleProjects.forEach((project, index) => {
    workspacesByProject.set(project.id, workspaceQueries[index]?.data ?? []);
    conversationsByProject.set(project.id, conversationQueries[index]?.data ?? []);
  });
  const visibleConversations = Array.from(conversationsByProject.values())
    .flat()
    .filter((conversation) => conversation.status === 'active')
    .slice(0, 60);
  const conversationStateQueries = useQueries({
    queries: visibleConversations.map((conversation) => ({
      queryKey: ['v2-conversation-state', conversation.id, 'sidebar'],
      queryFn: () => v2Api.getConversationState(conversation.id),
      enabled: conversation.provider === 'pi',
      staleTime: 5_000,
      refetchInterval: 5_000,
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

  const desktopTopInset = isDesktopShell() ? getDesktopTitleBarInsetTop() : 0;

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
          <>

        <div className="px-3 pb-3">
          <div className="flex h-8 items-center gap-2 rounded-lg bg-[var(--color-card)] px-2.5 text-xs text-dim">
            <Search size={14} />
            <span className="truncate">Search soon: projects, threads, files</span>
          </div>
        </div>

        <nav className="space-y-1 px-2">
          <V2NavLink
            to="/v2"
            active={location.pathname === '/v2'}
            icon={<Folder size={15} />}
            label="Projects"
          />
          <SidebarAction icon={<PlugZap size={15} />} label="Pi setup" onClick={() => navigate('/v2/settings')} />
          <SidebarAction icon={<MessageSquareText size={15} />} label="All conversations" onClick={() => navigate('/v2/conversations')} />
        </nav>

        <div className="mt-5 flex items-center justify-between px-4 text-[11px] font-medium uppercase tracking-wide text-dim">
          <span>Projects</span>
          <span>{visibleProjects.length}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
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
              conversationStateById={conversationStateById}
              onNewConversation={(workspace) => createConversation.mutate({ project, workspace })}
              onArchiveConversation={(conversation) => archiveOrDeleteConversation.mutate(conversation)}
            />
          ))}
        </div>

        <div className="border-t border-[var(--color-card-border)] p-2">
          <Link
            to="/v2/settings"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]"
          >
            <Settings size={15} />
            Settings
          </Link>
        </div>
          </>
        )}
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
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
  conversationStateById,
  onNewConversation,
  onArchiveConversation,
}: {
  project: Project;
  pinned: boolean;
  workspaces: Workspace[];
  conversations: Conversation[];
  pathname: string;
  search: string;
  creating: boolean;
  archivingConversation: boolean;
  conversationStateById: Map<string, PiConversationSnapshot>;
  onNewConversation: (workspace?: Workspace) => void;
  onArchiveConversation: (conversation: Conversation) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectRouteActive = pathname === `/v2/projects/${project.id}`;
  const projectDescendantActive = pathname.startsWith(`/v2/projects/${project.id}/`);
  const activeConversationId = pathname.match(/^\/v2\/conversations\/([^/]+)/)?.[1];
  const conversationActive = conversations.some((conversation) => conversation.id === activeConversationId);
  const projectInPath = projectRouteActive || projectDescendantActive || conversationActive;
  const [expanded, setExpanded] = useState(projectInPath);
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

  useEffect(() => {
    if (projectInPath && !userToggled) setExpanded(true);
  }, [projectInPath, userToggled]);

  return (
    <div className="relative mb-1">
      <div
        className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors ${
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
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left"
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
          className={`rounded p-1 text-dim transition-opacity hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50 ${projectMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          title="New workspace"
        >
          <FolderPlus size={13} />
        </button>
        <button
          type="button"
          onClick={() => setProjectMenuOpen((value) => !value)}
          className={`rounded p-1 text-dim transition-opacity hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] ${projectMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          title="Project actions"
        >
          <Ellipsis size={13} />
        </button>
      </div>
      {projectMenuOpen && (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close project menu" onClick={() => setProjectMenuOpen(false)} />
          <div className="absolute right-1 top-8 z-50 w-52 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]">
            <ProjectMenuItem icon={<FolderPlus size={14} />} onClick={() => navigate(`/v2/projects/${project.id}?newWorkspace=1`)}>New workspace</ProjectMenuItem>
            <ProjectMenuItem icon={pinned ? <PinOff size={14} /> : <Pin size={14} />} onClick={() => void togglePinnedProject(project.id, queryClient)}>
              {pinned ? 'Unpin project' : 'Pin project'}
            </ProjectMenuItem>
            <ProjectMenuItem icon={<Pencil size={14} />} onClick={() => void renameProject(project, queryClient)}>Rename project</ProjectMenuItem>
            <ProjectMenuItem icon={<Settings size={14} />} onClick={() => navigate(`/v2/projects/${project.id}/settings`)}>Settings</ProjectMenuItem>
            <ProjectMenuItem icon={<Archive size={14} />} danger onClick={() => void archiveProject(project, queryClient, navigate)}>Archive project</ProjectMenuItem>
          </div>
        </>
      )}

      {treeOpen && (
        <div className="mt-1 space-y-0.5 pr-1">
          {orderedWorkspaces.map((workspace) => {
            const active = !conversationActive && (selectedWorkspaceId
              ? selectedWorkspaceId === workspace.id
              : projectRouteActive && workspace.kind === 'main');
            const workspaceConversations = safeConversations
              .filter((conversation) => conversation.currentWorkspaceId === workspace.id && conversation.status === 'active')
              .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
              .slice(0, 3);
            return (
              <div key={workspace.id}>
                <div
                  className={`group/workspace flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors ${
                    active
                      ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]'
                      : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  <Link to={`/v2/projects/${project.id}?workspace=${workspace.id}`} className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex w-5 shrink-0 justify-center">
                      {workspace.kind === 'worktree' ? <GitBranch size={13} /> : <SquareStack size={13} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{workspace.name}</span>
                  </Link>
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => onNewConversation(workspace)}
                    className="rounded p-0.5 opacity-0 hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:opacity-50 group-hover/workspace:opacity-100"
                    title="New conversation in this workspace"
                  >
                    <MessageSquarePlus size={12} />
                  </button>
                </div>
                {workspaceConversations.length > 0 && (
                  <div className="mt-0.5 space-y-0.5">
                    {workspaceConversations.map((conversation) => (
                      <ConversationSidebarRow
                        key={conversation.id}
                        conversation={conversation}
                        active={conversation.id === activeConversationId}
                        pending={archivingConversation}
                        snapshot={conversationStateById.get(conversation.id)}
                        onArchive={() => onArchiveConversation(conversation)}
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
              onArchive={() => onArchiveConversation(conversation)}
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
  onArchive,
  className = '',
}: {
  conversation: Conversation;
  active: boolean;
  pending: boolean;
  snapshot?: PiConversationSnapshot;
  onArchive: () => void;
  className?: string;
}) {
  return (
    <div className={`group/conversation flex items-center rounded-md ${
      active ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]' : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
    } ${className}`}>
      <Link to={`/v2/conversations/${conversation.id}`} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-xs">
        <ConversationStateIndicator conversation={conversation} snapshot={snapshot} />
        <span className="min-w-0 flex-1 truncate font-normal">{conversation.title}</span>
      </Link>
      <button
        type="button"
        disabled={pending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onArchive();
        }}
        className="mr-1 rounded p-0.5 text-dim opacity-0 hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50 group-hover/conversation:opacity-100"
        title="Archive conversation"
      >
        <Archive size={12} />
      </button>
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
    return (
      <span className="flex w-5 shrink-0 justify-center text-[var(--color-status-in-review)]" title="Waiting for input">
        <Circle size={9} fill="currentColor" />
      </span>
    );
  }

  if (conversation.status === 'active') {
    return (
      <span className="flex w-5 shrink-0 justify-center text-dim" title="Ready">
        <Circle size={8} />
      </span>
    );
  }

  return (
    <span className="flex w-5 shrink-0 justify-center text-dim" title={conversation.status}>
      <Circle size={8} />
    </span>
  );
}

function ProjectMenuItem({ icon, children, onClick, danger = false }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
        danger ? 'text-[var(--color-error)] hover:bg-[var(--color-error)]/10' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]'
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
      className="flex h-8 w-full items-center gap-2 rounded-lg px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]"
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
      className={`flex h-8 items-center gap-2 rounded-lg px-3 text-sm transition-colors ${
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

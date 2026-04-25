import { useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Ellipsis,
  FolderGit2,
  FolderPlus,
  GitBranch,
  MessageSquarePlus,
  MessageSquareText,
  Pencil,
  Pin,
  Search,
  Settings,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';
import { preferencesApi, projectsApi } from '../../api';
import type { Conversation, Project, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Badge } from '../../components/ui/Badge';
import { CodeburgIcon, CodeburgWordmark } from '../../components/ui/CodeburgIcon';
import { getDesktopTitleBarInsetTop, isDesktopShell } from '../../platform/runtimeConfig';
import type { QueryClient } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router-dom';

export function V2Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useQuery({
    queryKey: ['v2-projects'],
    queryFn: () => projectsApi.list(),
  });

  const visibleProjects = (projects ?? []).filter((project) => !project.hidden);
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
        className="flex w-[19.5rem] shrink-0 flex-col border-r border-[var(--color-card-border)] bg-canvas"
        style={desktopTopInset > 0 ? { paddingTop: `${desktopTopInset}px` } : undefined}
      >
        <div className="flex h-12 items-center justify-between px-3">
          <Link to="/v2" className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--color-card)]">
            <CodeburgIcon size={22} />
            <CodeburgWordmark className="text-[var(--color-text-primary)]" />
          </Link>
          <Badge variant="count">V2</Badge>
        </div>

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
            icon={<FolderGit2 size={15} />}
            label="Projects"
          />
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
              workspaces={workspacesByProject.get(project.id) ?? []}
              conversations={conversationsByProject.get(project.id) ?? []}
              pathname={location.pathname}
              search={location.search}
              creating={createConversation.isPending}
              archivingConversation={archiveOrDeleteConversation.isPending}
              onNewConversation={(workspace) => createConversation.mutate({ project, workspace })}
              onArchiveConversation={(conversation) => archiveOrDeleteConversation.mutate(conversation)}
            />
          ))}
        </div>

        <div className="border-t border-[var(--color-card-border)] p-2">
          <Link
            to="/settings"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]"
          >
            <Settings size={15} />
            Settings
          </Link>
          <div className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-dim">
            <Sparkles size={14} />
            Workspace-first V2
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

function ProjectTree({
  project,
  workspaces,
  conversations,
  pathname,
  search,
  creating,
  archivingConversation,
  onNewConversation,
  onArchiveConversation,
}: {
  project: Project;
  workspaces: Workspace[];
  conversations: Conversation[];
  pathname: string;
  search: string;
  creating: boolean;
  archivingConversation: boolean;
  onNewConversation: (workspace?: Workspace) => void;
  onArchiveConversation: (conversation: Conversation) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectActive = pathname.startsWith(`/v2/projects/${project.id}`);
  const activeConversationId = pathname.match(/^\/v2\/conversations\/([^/]+)/)?.[1];
  const conversationActive = conversations.some((conversation) => conversation.id === activeConversationId);
  const treeOpen = projectActive || conversationActive;
  const selectedWorkspaceId = new URLSearchParams(search).get('workspace');
  const orderedWorkspaces = [...workspaces].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'main' ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const recentProjectConversations = [...conversations]
    .filter((conversation) => !conversation.currentWorkspaceId && conversation.status === 'active')
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, 3);

  return (
    <div className="relative mb-1">
      <div
        className={`group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
          treeOpen
            ? 'bg-[var(--color-card)] text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <Link to={`/v2/projects/${project.id}`} className="flex min-w-0 flex-1 items-center gap-2">
          <FolderGit2 size={15} className={treeOpen ? 'text-accent' : 'text-dim'} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span>
        </Link>
        <button
          type="button"
          onClick={() => navigate(`/v2/projects/${project.id}?newWorkspace=1`)}
          className="rounded p-1 text-dim opacity-0 transition-opacity hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50 group-hover:opacity-100"
          title="New workspace"
        >
          <FolderPlus size={13} />
        </button>
        <button
          type="button"
          onClick={() => setProjectMenuOpen((value) => !value)}
          className="rounded p-1 text-dim opacity-0 transition-opacity hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] group-hover:opacity-100"
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
            <ProjectMenuItem icon={<Pin size={14} />} onClick={() => void togglePinnedProject(project.id, queryClient)}>Pin project</ProjectMenuItem>
            <ProjectMenuItem icon={<Pencil size={14} />} onClick={() => void renameProject(project, queryClient)}>Rename project</ProjectMenuItem>
            <ProjectMenuItem icon={<Settings size={14} />} onClick={() => navigate(`/v2/projects/${project.id}/settings`)}>Settings</ProjectMenuItem>
            <ProjectMenuItem icon={<Archive size={14} />} danger onClick={() => void archiveProject(project, queryClient, navigate)}>Archive project</ProjectMenuItem>
          </div>
        </>
      )}

      {treeOpen && (
        <div className="mt-1 space-y-1 pl-5 pr-1">
          {orderedWorkspaces.map((workspace) => {
            const active = selectedWorkspaceId
              ? selectedWorkspaceId === workspace.id
              : workspace.kind === 'main';
            const workspaceConversations = conversations
              .filter((conversation) => conversation.currentWorkspaceId === workspace.id && conversation.status === 'active')
              .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
              .slice(0, 3);
            return (
              <div key={workspace.id}>
                <div
                  className={`group/workspace flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                    active
                      ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]'
                      : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  <Link to={`/v2/projects/${project.id}?workspace=${workspace.id}`} className="flex min-w-0 flex-1 items-center gap-2">
                    {workspace.kind === 'main' ? <TerminalSquare size={13} /> : <GitBranch size={13} />}
                    <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
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
                  <div className="ml-5 mt-0.5 space-y-0.5">
                    {workspaceConversations.map((conversation) => (
                      <ConversationSidebarRow
                        key={conversation.id}
                        conversation={conversation}
                        active={conversation.id === activeConversationId}
                        pending={archivingConversation}
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
              onArchive={() => onArchiveConversation(conversation)}
              className="ml-5"
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
  onArchive,
  className = '',
}: {
  conversation: Conversation;
  active: boolean;
  pending: boolean;
  onArchive: () => void;
  className?: string;
}) {
  return (
    <div className={`group/conversation flex items-center rounded-md ${
      active ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]' : 'text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]'
    } ${className}`}>
      <Link to={`/v2/conversations/${conversation.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-xs">
        <MessageSquareText size={12} />
        <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
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
  const pinned: string[] = await preferencesApi.getPinnedProjects();
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

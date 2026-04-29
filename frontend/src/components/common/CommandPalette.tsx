import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bolt,
  Command as CommandIcon,
  FolderGit2,
  GitBranch,
  Hammer,
  Home,
  LoaderCircle,
  MessagesSquare,
  PlugZap,
  Search,
  Settings,
  Sparkles,
  SquareStack,
  Wrench,
} from 'lucide-react';
import type { Project, V2SidebarData, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';

const COMMAND_PALETTE_OPEN_EVENT = 'codeburg:open-command-palette';
const DEFAULT_WORKSPACE_LIMIT = 8;

interface CommandPaletteProps {
  initialSearch?: string;
  onClose: () => void;
}

interface PaletteProject {
  entry: V2SidebarData['projects'][number];
  project: Project;
}

interface PaletteWorkspace {
  workspace: Workspace;
  project: Project;
}

function TypeBadge({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-md bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px] font-medium text-dim">
      {children}
    </span>
  );
}

function CommandMeta({ children }: { children: ReactNode }) {
  return <div className="truncate text-[11px] text-dim">{children}</div>;
}

function formatStatus(value: string) {
  return value.replace(/_/g, ' ');
}

function sortByActivity<T extends { workspace?: Workspace; project?: Project }>(a: T, b: T) {
  const left = a.workspace?.updatedAt ?? a.project?.updatedAt ?? '';
  const right = b.workspace?.updatedAt ?? b.project?.updatedAt ?? '';
  return right.localeCompare(left);
}

function buildWorkspaceMeta(workspace: Workspace, project: Project) {
  const parts = [project.name, formatStatus(workspace.status)];
  if (workspace.branchName) parts.push(workspace.branchName);
  return parts.join(' · ');
}

function createSearchValue(parts: Array<string | undefined | null>) {
  return parts.filter(Boolean).join(' ');
}

function keywordList(parts: Array<string | undefined | null>) {
  return parts.filter((part): part is string => typeof part === 'string');
}

export function CommandPalette({ initialSearch = '', onClose }: CommandPaletteProps) {
  const [search, setSearch] = useState(initialSearch);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const normalizedSearch = search.trim().toLowerCase();
  const searchActive = normalizedSearch.length > 0;

  const { data: sidebar, isLoading } = useQuery({
    queryKey: ['v2-command-palette-summary'],
    queryFn: () => v2Api.getSidebar({ includeConversations: false, includeStates: false }),
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);

  const { projects, workspaces } = useMemo(() => {
    const projectEntries: PaletteProject[] = [];
    const workspaceEntries: PaletteWorkspace[] = [];

    for (const entry of sidebar?.projects ?? []) {
      if (!entry?.project || entry.project.hidden) continue;
      projectEntries.push({ entry, project: entry.project });

      const projectWorkspaces = (entry.workspaces ?? []).filter((workspace) => workspace.status !== 'archived');

      for (const workspace of projectWorkspaces) {
        workspaceEntries.push({ workspace, project: entry.project });
      }
    }

    projectEntries.sort((a, b) => {
      if (a.entry.pinned !== b.entry.pinned) return a.entry.pinned ? -1 : 1;
      return a.project.name.localeCompare(b.project.name);
    });
    workspaceEntries.sort((a, b) => sortByActivity({ workspace: a.workspace }, { workspace: b.workspace }));

    return {
      projects: projectEntries,
      workspaces: workspaceEntries,
    };
  }, [sidebar]);

  const defaultWorkspaceRows = searchActive ? workspaces : workspaces.slice(0, DEFAULT_WORKSPACE_LIMIT);
  const conversationSearchHref = searchActive
    ? `/conversations?q=${encodeURIComponent(search.trim())}`
    : '/conversations';

  const select = useCallback((fn: () => void) => {
    fn();
    onClose();
  }, [onClose]);

  const handleBackdropClick = useCallback((event: React.MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
      onClose();
    }
  }, [onClose]);

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-start justify-center px-3 pt-[12vh]" onClick={handleBackdropClick}>
        <motion.div
          className="absolute inset-0 bg-[var(--color-bg-primary)]/55 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        />

        <motion.div
          ref={containerRef}
          className="relative w-full max-w-2xl"
          initial={{ opacity: 0, y: -8, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.985 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <Command
            loop
            className="overflow-hidden rounded-2xl bg-[var(--color-card)] shadow-[0_24px_80px_rgba(15,23,42,0.20)] ring-1 ring-[var(--color-card-border)]"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
          >
            <div className="flex items-center gap-2 px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-dim" />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search projects, workspaces, conversations, routes"
                className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--color-text-primary)] outline-none placeholder:text-dim"
                autoFocus
              />
              {isLoading ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin text-dim" />
              ) : (
                <kbd className="rounded-md bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px] font-medium text-dim">esc</kbd>
              )}
            </div>

            <Command.List className="cmdk-list max-h-[58vh] overflow-y-auto px-2 pb-2">
              <Command.Empty className="px-4 py-9 text-center text-sm text-dim">
                No V2 routes, projects, workspaces, or conversations matched.
              </Command.Empty>

              <Command.Group heading="Go to" className="cmdk-group">
                <Command.Item
                  value="home projects repositories repos"
                  onSelect={() => select(() => navigate('/'))}
                  className="cmdk-item"
                >
                  <Home className="h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">Projects</div>
                    <CommandMeta>V2 home</CommandMeta>
                  </div>
                  <TypeBadge>route</TypeBadge>
                </Command.Item>
                <Command.Item
                  value="all conversations chats threads inbox pi"
                  keywords={['chat', 'pi', 'threads', 'inbox']}
                  onSelect={() => select(() => navigate('/conversations'))}
                  className="cmdk-item"
                >
                  <MessagesSquare className="h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">All conversations</div>
                    <CommandMeta>Chat inbox</CommandMeta>
                  </div>
                  <TypeBadge>route</TypeBadge>
                </Command.Item>
                <Command.Item
                  value={createSearchValue(['search conversations chats threads summaries content', search])}
                  keywords={keywordList(['conversation search', searchActive ? search : null, 'pi', 'inbox'])}
                  onSelect={() => select(() => navigate(conversationSearchHref))}
                  className="cmdk-item"
                >
                  <Search className="h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      {searchActive ? `Search conversations for "${search.trim()}"` : 'Search conversations'}
                    </div>
                    <CommandMeta>Open the conversation inbox search</CommandMeta>
                  </div>
                  <TypeBadge>search</TypeBadge>
                </Command.Item>
                <Command.Item
                  value="skills library global"
                  onSelect={() => select(() => navigate('/skills'))}
                  className="cmdk-item"
                >
                  <Hammer className="h-4 w-4 shrink-0 text-dim" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">Skills library</div>
                    <CommandMeta>Global skills</CommandMeta>
                  </div>
                  <TypeBadge>route</TypeBadge>
                </Command.Item>
                <Command.Item
                  value="discover skills catalog install"
                  onSelect={() => select(() => navigate('/skills/discover'))}
                  className="cmdk-item"
                >
                  <Sparkles className="h-4 w-4 shrink-0 text-dim" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">Discover skills</div>
                    <CommandMeta>Catalog and local installs</CommandMeta>
                  </div>
                  <TypeBadge>route</TypeBadge>
                </Command.Item>
                <Command.Item
                  value="harness runtime pi codex claude tools auth"
                  onSelect={() => select(() => navigate('/harness'))}
                  className="cmdk-item"
                >
                  <PlugZap className="h-4 w-4 shrink-0 text-dim" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">Harness</div>
                    <CommandMeta>Runtime and auth tools</CommandMeta>
                  </div>
                  <TypeBadge>route</TypeBadge>
                </Command.Item>
                <Command.Item
                  value="settings preferences general"
                  onSelect={() => select(() => navigate('/settings'))}
                  className="cmdk-item"
                >
                  <Settings className="h-4 w-4 shrink-0 text-dim" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">Settings</div>
                    <CommandMeta>General preferences</CommandMeta>
                  </div>
                  <TypeBadge>route</TypeBadge>
                </Command.Item>
              </Command.Group>

              {projects.length > 0 && (
                <Command.Group heading="Projects" className="cmdk-group">
                  {projects.map(({ entry, project }) => (
                    <Command.Item
                      key={`project-${project.id}`}
                      value={createSearchValue(['project repo repository', project.name, project.path, project.gitOrigin, project.defaultBranch])}
                      keywords={keywordList([project.path, project.gitOrigin, project.defaultBranch, entry.pinned ? 'pinned' : null])}
                      onSelect={() => select(() => navigate(`/projects/${project.id}`))}
                      className="cmdk-item"
                    >
                      <FolderGit2 className="h-4 w-4 shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{project.name}</div>
                        <CommandMeta>{project.path}</CommandMeta>
                      </div>
                      {entry.pinned && <TypeBadge>pinned</TypeBadge>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {defaultWorkspaceRows.length > 0 && (
                <Command.Group heading={searchActive ? 'Workspaces' : 'Recent workspaces'} className="cmdk-group">
                  {defaultWorkspaceRows.map(({ workspace, project }) => (
                    <Command.Item
                      key={`workspace-${workspace.id}`}
                      value={createSearchValue(['workspace worktree branch', workspace.name, workspace.branchName, workspace.worktreePath, project.name, project.path])}
                      keywords={keywordList([project.name, project.path, workspace.branchName, workspace.worktreePath, workspace.kind, workspace.status])}
                      onSelect={() => select(() => navigate(`/projects/${project.id}?workspace=${workspace.id}`))}
                      className="cmdk-item"
                    >
                      {workspace.kind === 'worktree'
                        ? <GitBranch className="h-4 w-4 shrink-0 text-dim" />
                        : <SquareStack className="h-4 w-4 shrink-0 text-dim" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{workspace.name}</div>
                        <CommandMeta>{buildWorkspaceMeta(workspace, project)}</CommandMeta>
                      </div>
                      <TypeBadge>{workspace.kind === 'main' ? 'main' : 'worktree'}</TypeBadge>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {searchActive && projects.length > 0 && (
                <Command.Group heading="Project routes" className="cmdk-group">
                  {projects.flatMap(({ project }) => [
                    <Command.Item
                      key={`project-conversations-${project.id}`}
                      value={createSearchValue([project.name, 'project conversations chats threads'])}
                      keywords={[project.name, 'conversations', 'chats', 'threads']}
                      onSelect={() => select(() => navigate(`/projects/${project.id}/conversations`))}
                      className="cmdk-item"
                    >
                      <MessagesSquare className="h-4 w-4 shrink-0 text-dim" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{project.name} conversations</div>
                        <CommandMeta>Project-scoped chat inbox</CommandMeta>
                      </div>
                    </Command.Item>,
                    <Command.Item
                      key={`project-skills-${project.id}`}
                      value={createSearchValue([project.name, 'project skills tools'])}
                      keywords={[project.name, 'skills']}
                      onSelect={() => select(() => navigate(`/projects/${project.id}/skills`))}
                      className="cmdk-item"
                    >
                      <Hammer className="h-4 w-4 shrink-0 text-dim" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{project.name} skills</div>
                        <CommandMeta>Project skill set</CommandMeta>
                      </div>
                    </Command.Item>,
                    <Command.Item
                      key={`project-pi-${project.id}`}
                      value={createSearchValue([project.name, 'project pi model packages extensions'])}
                      keywords={[project.name, 'pi', 'models', 'packages', 'extensions']}
                      onSelect={() => select(() => navigate(`/projects/${project.id}/pi`))}
                      className="cmdk-item"
                    >
                      <Wrench className="h-4 w-4 shrink-0 text-dim" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{project.name} Pi</div>
                        <CommandMeta>Project Pi configuration</CommandMeta>
                      </div>
                    </Command.Item>,
                    <Command.Item
                      key={`project-actions-${project.id}`}
                      value={createSearchValue([project.name, 'project quick actions commands'])}
                      keywords={[project.name, 'quick actions', 'commands']}
                      onSelect={() => select(() => navigate(`/projects/${project.id}/actions`))}
                      className="cmdk-item"
                    >
                      <Bolt className="h-4 w-4 shrink-0 text-dim" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{project.name} quick actions</div>
                        <CommandMeta>Workspace action presets</CommandMeta>
                      </div>
                    </Command.Item>,
                    <Command.Item
                      key={`project-settings-${project.id}`}
                      value={createSearchValue([project.name, 'project settings preferences secrets scripts'])}
                      keywords={[project.name, 'settings', 'preferences', 'secrets', 'scripts']}
                      onSelect={() => select(() => navigate(`/projects/${project.id}/settings`))}
                      className="cmdk-item"
                    >
                      <Settings className="h-4 w-4 shrink-0 text-dim" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{project.name} settings</div>
                        <CommandMeta>Project preferences</CommandMeta>
                      </div>
                    </Command.Item>,
                    <Command.Item
                      key={`project-new-workspace-${project.id}`}
                      value={createSearchValue([project.name, 'new workspace worktree branch'])}
                      keywords={[project.name, 'new workspace', 'worktree', 'branch']}
                      onSelect={() => select(() => navigate(`/projects/${project.id}?newWorkspace=1`))}
                      className="cmdk-item"
                    >
                      <GitBranch className="h-4 w-4 shrink-0 text-dim" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">New workspace in {project.name}</div>
                        <CommandMeta>Create a worktree</CommandMeta>
                      </div>
                    </Command.Item>,
                  ])}
                </Command.Group>
              )}
            </Command.List>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[10px] text-dim">
              <span><kbd className="rounded bg-[var(--color-bg-tertiary)] px-1 py-0.5">↑↓</kbd> move</span>
              <span><kbd className="rounded bg-[var(--color-bg-tertiary)] px-1 py-0.5">↵</kbd> open</span>
              <span className="ml-auto hidden items-center gap-1 sm:inline-flex">
                <CommandIcon size={11} /> K
              </span>
            </div>
          </Command>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function openCommandPalette(initialSearch = '') {
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_EVENT, { detail: { initialSearch } }));
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCommandPalette() {
  const [state, setState] = useState({ open: false, initialSearch: '' });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setState((current) => (
          current.open
            ? { open: false, initialSearch: '' }
            : { open: true, initialSearch: '' }
        ));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ initialSearch?: string }>).detail;
      setState({ open: true, initialSearch: detail?.initialSearch ?? '' });
    };
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
    return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
  }, []);

  const setOpen = useCallback((open: boolean) => {
    setState((current) => ({
      open,
      initialSearch: open ? current.initialSearch : '',
    }));
  }, []);

  return { open: state.open, initialSearch: state.initialSearch, setOpen };
}

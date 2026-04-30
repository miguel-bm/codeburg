import { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bolt,
  Bot,
  Braces,
  Command as CommandIcon,
  FolderGit2,
  GitBranch,
  Globe2,
  Hammer,
  Home,
  LoaderCircle,
  MessagesSquare,
  PackagePlus,
  PlugZap,
  Search,
  Settings,
  Sparkles,
  SquareStack,
  Wrench,
} from 'lucide-react';
import type { Conversation, Project, V2SidebarData, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';

const COMMAND_PALETTE_OPEN_EVENT = 'codeburg:open-command-palette';
const COMMAND_PALETTE_SIDEBAR_QUERY_KEY = ['v2-sidebar-summary', 'command-palette'] as const;
const COMMAND_PALETTE_LIST_ID = 'command-palette-results';
const DEFAULT_WORKSPACE_LIMIT = 8;
const SEARCH_WORKSPACE_LIMIT = 24;
const SEARCH_PROJECT_LIMIT = 24;
const PROJECT_ROUTE_LIMIT = 6;
const CONVERSATION_RESULT_LIMIT = 20;
const CONVERSATION_QUERY_MIN_LENGTH = 2;
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

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

type PaletteMode = 'root' | 'conversation-search';

interface PaletteRow {
  id: string;
  searchText: string;
  icon: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  badge?: string;
  onSelect: () => void;
}

interface PaletteGroup {
  id: string;
  title: string;
  rows: PaletteRow[];
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

function buildConversationMeta(conversation: Conversation, project?: Project) {
  const parts = [project?.name, formatStatus(conversation.status)];
  return parts.filter(Boolean).join(' · ');
}

function createSearchValue(parts: Array<string | undefined | null>) {
  return parts.filter(Boolean).join(' ');
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function rowMatches(row: PaletteRow, normalizedSearch: string) {
  return normalizedSearch.length === 0 || row.searchText.toLowerCase().includes(normalizedSearch);
}

function filterRows(rows: PaletteRow[], normalizedSearch: string, limit: number) {
  const matches: PaletteRow[] = [];
  for (const row of rows) {
    if (!rowMatches(row, normalizedSearch)) continue;
    matches.push(row);
    if (matches.length >= limit) break;
  }
  return matches;
}

function optionDomId(rowId: string) {
  return `command-palette-option-${rowId}`;
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
}

function PaletteItem({
  row,
  selected,
  onMouseEnter,
}: {
  row: PaletteRow;
  selected: boolean;
  onMouseEnter: () => void;
}) {
  return (
    <button
      id={optionDomId(row.id)}
      type="button"
      role="option"
      aria-selected={selected}
      className="command-palette-item"
      data-selected={selected}
      tabIndex={-1}
      onClick={row.onSelect}
      onMouseEnter={onMouseEnter}
    >
      {row.icon}
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm">{row.title}</div>
        {row.meta && <CommandMeta>{row.meta}</CommandMeta>}
      </div>
      {row.badge && <TypeBadge>{row.badge}</TypeBadge>}
    </button>
  );
}

function PaletteGroupView({
  group,
  activeRowId,
  onHoverRow,
}: {
  group: PaletteGroup;
  activeRowId?: string;
  onHoverRow: (rowId: string) => void;
}) {
  if (group.rows.length === 0) return null;
  return (
    <div className="command-palette-group">
      <div className="command-palette-group-heading">{group.title}</div>
      {group.rows.map((row) => (
        <PaletteItem
          key={row.id}
          row={row}
          selected={row.id === activeRowId}
          onMouseEnter={() => onHoverRow(row.id)}
        />
      ))}
    </div>
  );
}

export function CommandPalette({ initialSearch = '', onClose }: CommandPaletteProps) {
  const [search, setSearch] = useState(initialSearch);
  const [mode, setMode] = useState<PaletteMode>('root');
  const [activeIndex, setActiveIndex] = useState(0);
  const [hydrateDynamicRows, setHydrateDynamicRows] = useState(false);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedSearch = normalizeSearch(search);
  const searchActive = normalizedSearch.length > 0;
  const deferredSearch = useDeferredValue(search);
  const deferredConversationSearch = normalizeSearch(mode === 'conversation-search' ? deferredSearch : '');
  const conversationSearchReady = deferredConversationSearch.length >= CONVERSATION_QUERY_MIN_LENGTH;

  const { data: sidebar, isFetching: isFetchingSidebar } = useQuery({
    queryKey: COMMAND_PALETTE_SIDEBAR_QUERY_KEY,
    queryFn: () => v2Api.getSidebar({ includeConversations: false, includeStates: false }),
    enabled: hydrateDynamicRows,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: conversationResults, isFetching: isSearchingConversations } = useQuery({
    queryKey: ['v2-command-palette-conversations', deferredConversationSearch],
    queryFn: () => v2Api.listConversations({
      q: deferredConversationSearch,
      provider: 'pi',
      excludeStatus: 'archived',
      limit: CONVERSATION_RESULT_LIMIT,
    }),
    enabled: mode === 'conversation-search' && conversationSearchReady,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    setSearch(initialSearch);
    setMode('root');
    setActiveIndex(0);
  }, [initialSearch]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    const startHydration = () => setHydrateDynamicRows(true);
    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(startHydration);
      return () => window.cancelAnimationFrame(frame);
    }
    const timeout = window.setTimeout(startHydration, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const { projects, workspaces, projectsById } = useMemo(() => {
    const projectEntries: PaletteProject[] = [];
    const workspaceEntries: PaletteWorkspace[] = [];
    const projectMap = new Map<string, Project>();

    for (const entry of sidebar?.projects ?? []) {
      if (!entry?.project || entry.project.hidden) continue;
      projectMap.set(entry.project.id, entry.project);
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
      projectsById: projectMap,
    };
  }, [sidebar]);

  const closeAfter = useCallback((fn: () => void) => {
    fn();
    onClose();
  }, [onClose]);

  const navigateTo = useCallback((to: string) => {
    closeAfter(() => navigate(to));
  }, [closeAfter, navigate]);

  const enterConversationSearch = useCallback(() => {
    setMode('conversation-search');
    setActiveIndex(0);
  }, []);

  const handleBackdropClick = useCallback((event: React.MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
      onClose();
    }
  }, [onClose]);

  const rootGroups = useMemo<PaletteGroup[]>(() => {
    const goToRows: PaletteRow[] = [
      {
        id: 'route-projects',
        searchText: 'home projects repositories repos',
        icon: <Home className="h-4 w-4 shrink-0 text-accent" />,
        title: 'Projects',
        meta: 'V2 home',
        badge: 'route',
        onSelect: () => navigateTo('/'),
      },
      {
        id: 'mode-search-conversations',
        searchText: createSearchValue(['search conversations chats threads summaries content pi inbox', search]),
        icon: <Search className="h-4 w-4 shrink-0 text-accent" />,
        title: searchActive ? `Search conversations for "${search.trim()}"` : 'Search conversations',
        meta: 'Search titles and summaries in this palette',
        badge: 'mode',
        onSelect: enterConversationSearch,
      },
      {
        id: 'route-conversations',
        searchText: 'all conversations chats threads inbox pi',
        icon: <MessagesSquare className="h-4 w-4 shrink-0 text-accent" />,
        title: 'All conversations',
        meta: 'Chat inbox',
        badge: 'route',
        onSelect: () => navigateTo('/conversations'),
      },
      {
        id: 'route-skills',
        searchText: 'skills library global',
        icon: <Hammer className="h-4 w-4 shrink-0 text-dim" />,
        title: 'Skills library',
        meta: 'Global skills',
        badge: 'route',
        onSelect: () => navigateTo('/skills'),
      },
      {
        id: 'route-discover-skills',
        searchText: 'discover skills catalog install',
        icon: <Sparkles className="h-4 w-4 shrink-0 text-dim" />,
        title: 'Discover skills',
        meta: 'Catalog and local installs',
        badge: 'route',
        onSelect: () => navigateTo('/skills/discover'),
      },
      {
        id: 'route-harness',
        searchText: 'harness overview runtime pi codex claude tools auth',
        icon: <PlugZap className="h-4 w-4 shrink-0 text-dim" />,
        title: 'Harness',
        meta: 'Overview',
        badge: 'route',
        onSelect: () => navigateTo('/harness'),
      },
      {
        id: 'route-harness-runtimes',
        searchText: 'harness runtimes runtime pi codex claude update tools',
        icon: <Bot className="h-4 w-4 shrink-0 text-dim" />,
        title: 'Harness runtimes',
        meta: 'Update toolchain',
        badge: 'route',
        onSelect: () => navigateTo('/harness/runtimes'),
      },
      {
        id: 'route-harness-pi',
        searchText: 'harness pi web access auth credentials search providers',
        icon: <Globe2 className="h-4 w-4 shrink-0 text-dim" />,
        title: 'Pi and web access',
        meta: 'Auth and search config',
        badge: 'route',
        onSelect: () => navigateTo('/harness/pi'),
      },
      {
        id: 'route-harness-packages',
        searchText: 'harness packages extensions pi install global',
        icon: <PackagePlus className="h-4 w-4 shrink-0 text-dim" />,
        title: 'Harness packages',
        meta: 'Packages and extensions',
        badge: 'route',
        onSelect: () => navigateTo('/harness/packages'),
      },
      {
        id: 'route-harness-config',
        searchText: 'harness config settings models json pi advanced',
        icon: <Braces className="h-4 w-4 shrink-0 text-dim" />,
        title: 'Harness config',
        meta: 'Advanced JSON editors',
        badge: 'route',
        onSelect: () => navigateTo('/harness/config'),
      },
      {
        id: 'route-settings',
        searchText: 'settings preferences general',
        icon: <Settings className="h-4 w-4 shrink-0 text-dim" />,
        title: 'Settings',
        meta: 'General preferences',
        badge: 'route',
        onSelect: () => navigateTo('/settings'),
      },
    ];

    const projectRows = filterRows(
      projects.map(({ entry, project }) => ({
        id: `project-${project.id}`,
        searchText: createSearchValue(['project repo repository', project.name, project.path, project.gitOrigin, project.defaultBranch, entry.pinned ? 'pinned' : null]),
        icon: <FolderGit2 className="h-4 w-4 shrink-0 text-accent" />,
        title: project.name,
        meta: project.path,
        badge: entry.pinned ? 'pinned' : undefined,
        onSelect: () => navigateTo(`/projects/${project.id}`),
      })),
      normalizedSearch,
      SEARCH_PROJECT_LIMIT,
    );

    const workspaceLimit = searchActive ? SEARCH_WORKSPACE_LIMIT : DEFAULT_WORKSPACE_LIMIT;
    const workspaceRows = filterRows(
      workspaces.map(({ workspace, project }) => ({
        id: `workspace-${workspace.id}`,
        searchText: createSearchValue(['workspace worktree branch', workspace.name, workspace.branchName, workspace.worktreePath, project.name, project.path, workspace.kind, workspace.status]),
        icon: workspace.kind === 'worktree'
          ? <GitBranch className="h-4 w-4 shrink-0 text-dim" />
          : <SquareStack className="h-4 w-4 shrink-0 text-dim" />,
        title: workspace.name,
        meta: buildWorkspaceMeta(workspace, project),
        badge: workspace.kind === 'main' ? 'main' : 'worktree',
        onSelect: () => navigateTo(`/projects/${project.id}?workspace=${workspace.id}`),
      })),
      normalizedSearch,
      workspaceLimit,
    );

    const projectRouteRows = searchActive
      ? filterRows(
        projects.flatMap(({ project }) => [
          {
            id: `project-conversations-${project.id}`,
            searchText: createSearchValue([project.name, 'project conversations chats threads']),
            icon: <MessagesSquare className="h-4 w-4 shrink-0 text-dim" />,
            title: `${project.name} conversations`,
            meta: 'Project-scoped chat inbox',
            onSelect: () => navigateTo(`/projects/${project.id}/conversations`),
          },
          {
            id: `project-skills-${project.id}`,
            searchText: createSearchValue([project.name, 'project skills tools']),
            icon: <Hammer className="h-4 w-4 shrink-0 text-dim" />,
            title: `${project.name} skills`,
            meta: 'Project skill set',
            onSelect: () => navigateTo(`/projects/${project.id}/skills`),
          },
          {
            id: `project-pi-${project.id}`,
            searchText: createSearchValue([project.name, 'project pi model packages extensions']),
            icon: <Wrench className="h-4 w-4 shrink-0 text-dim" />,
            title: `${project.name} Pi`,
            meta: 'Project Pi configuration',
            onSelect: () => navigateTo(`/projects/${project.id}/pi`),
          },
          {
            id: `project-actions-${project.id}`,
            searchText: createSearchValue([project.name, 'project quick actions commands']),
            icon: <Bolt className="h-4 w-4 shrink-0 text-dim" />,
            title: `${project.name} quick actions`,
            meta: 'Workspace action presets',
            onSelect: () => navigateTo(`/projects/${project.id}/actions`),
          },
          {
            id: `project-settings-${project.id}`,
            searchText: createSearchValue([project.name, 'project settings preferences secrets scripts']),
            icon: <Settings className="h-4 w-4 shrink-0 text-dim" />,
            title: `${project.name} settings`,
            meta: 'Project preferences',
            onSelect: () => navigateTo(`/projects/${project.id}/settings`),
          },
          {
            id: `project-new-workspace-${project.id}`,
            searchText: createSearchValue([project.name, 'new workspace worktree branch']),
            icon: <GitBranch className="h-4 w-4 shrink-0 text-dim" />,
            title: `New workspace in ${project.name}`,
            meta: 'Create a worktree',
            onSelect: () => navigateTo(`/projects/${project.id}?newWorkspace=1`),
          },
        ]),
        normalizedSearch,
        PROJECT_ROUTE_LIMIT,
      )
      : [];

    return [
      { id: 'go-to', title: 'Go to', rows: filterRows(goToRows, normalizedSearch, goToRows.length) },
      { id: 'projects', title: 'Projects', rows: projectRows },
      { id: 'workspaces', title: searchActive ? 'Workspaces' : 'Recent workspaces', rows: workspaceRows },
      { id: 'project-routes', title: 'Project routes', rows: projectRouteRows },
    ].filter((group) => group.rows.length > 0);
  }, [enterConversationSearch, navigateTo, normalizedSearch, projects, search, searchActive, workspaces]);

  const conversationGroups = useMemo<PaletteGroup[]>(() => {
    if (!conversationSearchReady) return [];
    const rows = (conversationResults ?? [])
      .slice(0, CONVERSATION_RESULT_LIMIT)
      .map((conversation) => {
        const project = projectsById.get(conversation.projectId);
        return {
          id: `conversation-${conversation.id}`,
          searchText: createSearchValue([conversation.title, conversation.summary, project?.name, conversation.status, conversation.provider]),
          icon: <MessagesSquare className="h-4 w-4 shrink-0 text-accent" />,
          title: conversation.title,
          meta: buildConversationMeta(conversation, project),
          badge: conversation.unreadAt ? 'unread' : undefined,
          onSelect: () => navigateTo(`/conversations/${conversation.id}`),
        };
      });
    return [{ id: 'conversations', title: 'Conversations', rows }];
  }, [conversationResults, conversationSearchReady, navigateTo, projectsById]);

  const groups = mode === 'conversation-search' ? conversationGroups : rootGroups;
  const visibleRows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const activeRow = visibleRows[activeIndex];
  const activeOptionId = activeRow ? optionDomId(activeRow.id) : undefined;

  useEffect(() => {
    setActiveIndex(0);
  }, [mode, normalizedSearch]);

  useEffect(() => {
    setActiveIndex((current) => {
      if (visibleRows.length === 0) return 0;
      return Math.min(current, visibleRows.length - 1);
    });
  }, [visibleRows.length]);

  const goBackOrClose = useCallback(() => {
    if (mode === 'conversation-search') {
      setMode('root');
      setActiveIndex(0);
      return;
    }
    onClose();
  }, [mode, onClose]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent) => {
    if (event.key === 'Tab') {
      if (!containerRef.current) return;
      const focusable = focusableElements(containerRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
        return;
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      goBackOrClose();
      return;
    }
    if (mode === 'conversation-search' && event.key === 'Backspace' && search.length === 0) {
      event.preventDefault();
      setMode('root');
      setActiveIndex(0);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => visibleRows.length === 0 ? 0 : (current + 1) % visibleRows.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => visibleRows.length === 0 ? 0 : (current - 1 + visibleRows.length) % visibleRows.length);
      return;
    }
    if (event.key === 'Enter') {
      if (!activeRow) return;
      event.preventDefault();
      activeRow.onSelect();
    }
  }, [activeRow, goBackOrClose, mode, search.length, visibleRows.length]);

  const handleHoverRow = useCallback((rowId: string) => {
    const nextIndex = visibleRows.findIndex((row) => row.id === rowId);
    if (nextIndex >= 0) setActiveIndex(nextIndex);
  }, [visibleRows]);

  const emptyState = mode === 'conversation-search'
    ? conversationSearchReady
      ? isSearchingConversations
        ? 'Searching conversations...'
        : 'No conversations matched.'
      : `Type at least ${CONVERSATION_QUERY_MIN_LENGTH} characters to search conversations.`
    : isFetchingSidebar && visibleRows.length === 0
      ? 'Loading projects and workspaces...'
      : 'No routes, projects, or workspaces matched.';

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center px-3 pt-[12vh]"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="absolute inset-0 bg-[var(--color-bg-primary)]/55 backdrop-blur-sm" />

      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'conversation-search' ? 'Search conversations' : 'Command palette'}
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-[var(--color-card)] shadow-[0_24px_80px_rgba(15,23,42,0.20)] ring-1 ring-[var(--color-card-border)]"
      >
        <div className="flex items-center gap-2 px-4 py-3">
          {mode === 'conversation-search' ? (
            <button
              type="button"
              aria-label="Back to commands"
              className="rounded-md p-1 text-dim transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
              onClick={() => {
                setMode('root');
                setActiveIndex(0);
              }}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <Search className="h-4 w-4 shrink-0 text-dim" />
          )}
          <input
            ref={inputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={mode === 'conversation-search' ? 'Search conversation titles and summaries' : 'Search projects, workspaces, routes'}
            aria-label={mode === 'conversation-search' ? 'Search conversations' : 'Search commands'}
            aria-controls={COMMAND_PALETTE_LIST_ID}
            aria-activedescendant={activeOptionId}
            className="command-palette-input min-w-0 flex-1 bg-transparent text-[15px] text-[var(--color-text-primary)] outline-none placeholder:text-dim"
            autoFocus
          />
          {mode === 'conversation-search' && isSearchingConversations ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-dim" />
          ) : isFetchingSidebar ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-dim" />
          ) : (
            <kbd className="rounded-md bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px] font-medium text-dim">esc</kbd>
          )}
        </div>

        <div
          id={COMMAND_PALETTE_LIST_ID}
          role="listbox"
          aria-label={mode === 'conversation-search' ? 'Conversation results' : 'Command results'}
          className="command-palette-list max-h-[58vh] overflow-y-auto px-2 pb-2"
        >
          {visibleRows.length === 0 ? (
            <div role="status" className="px-4 py-9 text-center text-sm text-dim">{emptyState}</div>
          ) : (
            groups.map((group) => (
              <PaletteGroupView
                key={group.id}
                group={group}
                activeRowId={activeRow?.id}
                onHoverRow={handleHoverRow}
              />
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[10px] text-dim">
          <span><kbd className="rounded bg-[var(--color-bg-tertiary)] px-1 py-0.5">↑↓</kbd> move</span>
          <span><kbd className="rounded bg-[var(--color-bg-tertiary)] px-1 py-0.5">↵</kbd> open</span>
          <span><kbd className="rounded bg-[var(--color-bg-tertiary)] px-1 py-0.5">esc</kbd> {mode === 'conversation-search' ? 'back' : 'close'}</span>
          <span className="ml-auto hidden items-center gap-1 sm:inline-flex">
            <CommandIcon size={11} /> K
          </span>
        </div>
      </div>
    </div>,
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

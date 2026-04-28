import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import {
  Archive,
  Circle,
  CircleAlert,
  CircleDot,
  Ellipsis,
  GitBranchPlus,
  LoaderCircle,
  MessageSquareText,
  Pin,
  PinOff,
  Search,
  SquareStack,
} from 'lucide-react';
import { preferencesApi, projectsApi } from '../../api';
import type { Conversation, PiConversationSnapshot, Project, V2SidebarData, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Badge } from '../../components/ui/Badge';
import { useMobile } from '../../hooks/useMobile';
import { V2Content, V2Empty, V2Header, V2Input, V2Panel, V2PanelHeader, V2Screen } from './v2-ui';

type ConversationSectionModel = {
  id: 'pinned' | 'attention' | 'running' | 'recent';
  title: string;
  subtitle: string;
  conversations: Conversation[];
};

export function V2ConversationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useMobile();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());

  const { data: conversations } = useQuery({
    queryKey: ['v2-conversations', deferredSearch],
    queryFn: () => v2Api.listConversations({ q: deferredSearch, provider: 'pi' }),
  });

  const { data: projects } = useQuery({
    queryKey: ['v2-projects'],
    queryFn: () => projectsApi.list(),
  });
  const { data: pinnedConversationIds = [] } = useQuery({
    queryKey: ['v2-pinned-conversations'],
    queryFn: getPinnedConversationIds,
  });

  const forkConversation = useMutation({
    mutationFn: (conversation: Conversation) =>
      v2Api.forkConversation(conversation.id, {
        title: `${conversation.title} fork`,
        currentWorkspaceId: conversation.currentWorkspaceId,
      }),
    onSuccess: async (forked) => {
      await invalidateConversationLists(queryClient, forked.projectId, forked.id);
      navigate(`/conversations/${forked.id}`);
    },
  });

  const archiveConversation = useMutation({
    mutationFn: (conversation: Conversation) => v2Api.archiveConversation(conversation.id),
    onMutate: async (conversation) => {
      await cancelConversationListQueries(queryClient, conversation);
      const snapshot = snapshotConversationListCaches(queryClient, conversation);
      removeConversationFromListCaches(queryClient, conversation.id);
      return snapshot;
    },
    onError: (_error, _conversation, snapshot) => {
      if (snapshot) restoreConversationListCaches(queryClient, snapshot);
    },
    onSettled: async (updated, _error, conversation) => {
      await invalidateConversationLists(queryClient, updated?.projectId ?? conversation.projectId, updated?.id ?? conversation.id);
    },
  });

  const markConversationReadState = useMutation({
    mutationFn: ({ conversation, unread }: { conversation: Conversation; unread: boolean }) =>
      unread ? v2Api.markConversationUnread(conversation.id) : v2Api.markConversationRead(conversation.id),
    onSuccess: async (updated) => {
      await invalidateConversationLists(queryClient, updated.projectId, updated.id);
    },
  });
  const switchConversationWorkspace = useMutation({
    mutationFn: ({ conversation, workspaceId }: { conversation: Conversation; workspaceId?: string }) =>
      v2Api.switchConversationWorkspace(conversation.id, {
        currentWorkspaceId: workspaceId,
        reason: 'inbox menu',
      }),
    onSuccess: async (updated) => {
      await invalidateConversationLists(queryClient, updated.projectId, updated.id);
    },
  });

  const projectById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project])),
    [projects],
  );
  const workspaceQueries = useQueries({
    queries: (projects ?? []).map((project) => ({
      queryKey: ['v2-workspaces', project.id],
      queryFn: () => v2Api.listWorkspaces(project.id),
      staleTime: 30_000,
    })),
  });
  const workspacesByProject = new Map<string, Workspace[]>();
  (projects ?? []).forEach((project, index) => {
    workspacesByProject.set(project.id, workspaceQueries[index]?.data ?? []);
  });
  const safeConversations = useMemo(() => conversations ?? [], [conversations]);
  const safePinnedConversationIds = useMemo(
    () => Array.isArray(pinnedConversationIds) ? pinnedConversationIds : [],
    [pinnedConversationIds],
  );
  const sortedConversations = useMemo(
    () => [...safeConversations]
      .filter((conversation) => conversation.status !== 'archived')
      .sort((a, b) => comparePinnedThenActivity(a, b, safePinnedConversationIds)),
    [safeConversations, safePinnedConversationIds],
  );
  const stateConversations = sortedConversations.slice(0, 48);
  const stateQueries = useQueries({
    queries: stateConversations.map((conversation) => ({
      queryKey: ['v2-conversation-state', conversation.id, 'inbox'],
      queryFn: () => v2Api.getConversationState(conversation.id),
      enabled: conversation.provider === 'pi',
      staleTime: 5_000,
      refetchInterval: conversation.status === 'active' ? 5_000 : false,
    })),
  });
  const snapshotById = new Map<string, PiConversationSnapshot>();
  stateConversations.forEach((conversation, index) => {
    const snapshot = stateQueries[index]?.data;
    if (snapshot) snapshotById.set(conversation.id, snapshot);
  });
  const sections = buildConversationSections(sortedConversations, snapshotById, safePinnedConversationIds);
  const pinnedCount = sections.find((section) => section.id === 'pinned')?.conversations.length ?? 0;
  const attentionCount = sections.find((section) => section.id === 'attention')?.conversations.length ?? 0;
  const runningCount = sections.find((section) => section.id === 'running')?.conversations.length ?? 0;
  const actionPending =
    forkConversation.isPending ||
    archiveConversation.isPending ||
    markConversationReadState.isPending ||
    switchConversationWorkspace.isPending;
  const togglePinnedConversationFromMenu = (conversation: Conversation) => {
    void togglePinnedConversation(conversation.id, queryClient);
  };
  const switchConversationWorkspaceFromMenu = (conversation: Conversation) => {
    const workspaceId = chooseConversationWorkspace(conversation, workspacesByProject.get(conversation.projectId) ?? []);
    if (workspaceId === undefined) return;
    switchConversationWorkspace.mutate({ conversation, workspaceId });
  };

  if (isMobile) {
    return (
      <V2Screen>
        <header className="shrink-0 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <div className="flex items-center justify-between gap-3">
            <h1 className="truncate text-lg font-semibold text-[var(--color-text-primary)]">Inbox</h1>
            <Badge variant="count">{attentionCount || sortedConversations.length}</Badge>
          </div>
          <label className="relative mt-3 block">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
            <V2Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations"
              className="w-full !pl-9"
            />
          </label>
          <InboxSummary pinnedCount={pinnedCount} attentionCount={attentionCount} runningCount={runningCount} totalCount={sortedConversations.length} mobile />
        </header>

        <main className="min-h-0 flex-1 overflow-auto">
          {sections.map((section) => (
            <ConversationSection
              key={section.id}
              section={section}
              projectById={projectById}
              snapshotById={snapshotById}
              pinnedConversationIds={safePinnedConversationIds}
              actionPending={actionPending}
              mobile
              onOpen={(conversation) => navigate(`/conversations/${conversation.id}`)}
              onFork={(conversation) => forkConversation.mutate(conversation)}
              onArchive={(conversation) => archiveConversation.mutate(conversation)}
              onMarkRead={(conversation) => markConversationReadState.mutate({ conversation, unread: false })}
              onMarkUnread={(conversation) => markConversationReadState.mutate({ conversation, unread: true })}
              onTogglePin={togglePinnedConversationFromMenu}
              onSwitchWorkspace={switchConversationWorkspaceFromMenu}
            />
          ))}

          {sortedConversations.length === 0 && (
            <V2Empty
              icon={<MessageSquareText size={28} />}
              title={deferredSearch ? 'No conversations match' : 'No conversations yet'}
              body={deferredSearch ? 'Try a broader query.' : 'Create a conversation from a project to begin.'}
            />
          )}
        </main>
      </V2Screen>
    );
  }

  return (
    <V2Screen>
      <V2Header
        eyebrow="Conversations"
        title="Inbox"
        subtitle="Triage Pi threads by attention, runtime, and recent activity."
      />
      <V2Content className="space-y-4">
        <V2Panel>
          <V2PanelHeader
            title="Activity queue"
            subtitle={`${sortedConversations.length} visible threads, newest activity first`}
            actions={
              <label className="flex items-center gap-2">
                <Search size={14} className="text-dim" />
                <V2Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search title or summary"
                  className="w-64"
                />
              </label>
            }
          />

          <InboxSummary pinnedCount={pinnedCount} attentionCount={attentionCount} runningCount={runningCount} totalCount={sortedConversations.length} />

          {sections.map((section) => (
            <ConversationSection
              key={section.id}
              section={section}
              projectById={projectById}
              snapshotById={snapshotById}
              pinnedConversationIds={safePinnedConversationIds}
              actionPending={actionPending}
              onOpen={(conversation) => navigate(`/conversations/${conversation.id}`)}
              onFork={(conversation) => forkConversation.mutate(conversation)}
              onArchive={(conversation) => archiveConversation.mutate(conversation)}
              onMarkRead={(conversation) => markConversationReadState.mutate({ conversation, unread: false })}
              onMarkUnread={(conversation) => markConversationReadState.mutate({ conversation, unread: true })}
              onTogglePin={togglePinnedConversationFromMenu}
              onSwitchWorkspace={switchConversationWorkspaceFromMenu}
            />
          ))}

          {sortedConversations.length === 0 && (
            <V2Empty
              icon={<MessageSquareText size={28} />}
              title={deferredSearch ? 'No conversations match that search' : 'No conversations yet'}
              body={deferredSearch
                ? 'Try a broader query, or open a project and create a new pi thread.'
                : 'Create conversations from a project. This inbox will highlight unread replies, running agents, and recent project work.'}
            />
          )}
        </V2Panel>
      </V2Content>
    </V2Screen>
  );
}

function InboxSummary({
  pinnedCount,
  attentionCount,
  runningCount,
  totalCount,
  mobile = false,
}: {
  pinnedCount: number;
  attentionCount: number;
  runningCount: number;
  totalCount: number;
  mobile?: boolean;
}) {
  return (
    <div className={`flex min-w-0 flex-wrap gap-1.5 ${mobile ? 'mt-3' : 'mx-4 mb-3'}`}>
      <InboxSummaryItem label="Pinned" value={pinnedCount} tone={pinnedCount > 0 ? 'accent' : 'muted'} />
      <InboxSummaryItem label="Attention" value={attentionCount} tone={attentionCount > 0 ? 'accent' : 'muted'} />
      <InboxSummaryItem label="Running" value={runningCount} tone={runningCount > 0 ? 'yellow' : 'muted'} />
      <InboxSummaryItem label="Total" value={totalCount} tone={totalCount > 0 ? 'default' : 'muted'} />
    </div>
  );
}

function InboxSummaryItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'accent' | 'yellow' | 'default' | 'muted';
}) {
  const valueClass = tone === 'accent'
    ? 'text-accent'
    : tone === 'yellow'
      ? 'text-[var(--color-status-in-review)]'
      : 'text-[var(--color-text-primary)]';

  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-xs text-dim transition-colors hover:bg-[var(--color-card-hover)]">
      <span className={`font-semibold ${valueClass}`}>{value}</span>
      <span>{label}</span>
    </span>
  );
}

function ConversationSection({
  section,
  projectById,
  snapshotById,
  pinnedConversationIds,
  actionPending,
  mobile = false,
  onOpen,
  onFork,
  onArchive,
  onMarkRead,
  onMarkUnread,
  onTogglePin,
  onSwitchWorkspace,
}: {
  section: ConversationSectionModel;
  projectById: Map<string, Project>;
  snapshotById: Map<string, PiConversationSnapshot>;
  pinnedConversationIds: string[];
  actionPending: boolean;
  mobile?: boolean;
  onOpen: (conversation: Conversation) => void;
  onFork: (conversation: Conversation) => void;
  onArchive: (conversation: Conversation) => void;
  onMarkRead: (conversation: Conversation) => void;
  onMarkUnread: (conversation: Conversation) => void;
  onTogglePin: (conversation: Conversation) => void;
  onSwitchWorkspace: (conversation: Conversation) => void;
}) {
  if (section.conversations.length === 0) return null;

  return (
    <section className="pt-2 first:pt-0">
      <div className="px-4 py-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase text-dim">{section.title}</div>
            {!mobile && <div className="mt-0.5 text-xs text-dim">{section.subtitle}</div>}
          </div>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-dim">{section.conversations.length}</span>
        </div>
      </div>
      <div className="grid gap-1 px-2">
        {section.conversations.map((conversation) => (
          <ConversationListItem
            key={conversation.id}
            conversation={conversation}
            project={projectById.get(conversation.projectId)}
            snapshot={snapshotById.get(conversation.id)}
            pinned={pinnedConversationIds.includes(conversation.id)}
            actionPending={actionPending}
            mobile={mobile}
            onOpen={() => onOpen(conversation)}
            onFork={() => onFork(conversation)}
            onArchive={() => onArchive(conversation)}
            onMarkRead={() => onMarkRead(conversation)}
            onMarkUnread={() => onMarkUnread(conversation)}
            onTogglePin={() => onTogglePin(conversation)}
            onSwitchWorkspace={() => onSwitchWorkspace(conversation)}
          />
        ))}
      </div>
    </section>
  );
}

function ConversationListItem({
  conversation,
  project,
  snapshot,
  pinned,
  actionPending,
  mobile = false,
  onOpen,
  onFork,
  onArchive,
  onMarkRead,
  onMarkUnread,
  onTogglePin,
  onSwitchWorkspace,
}: {
  conversation: Conversation;
  project?: Project;
  snapshot?: PiConversationSnapshot;
  pinned: boolean;
  actionPending: boolean;
  mobile?: boolean;
  onOpen: () => void;
  onFork: () => void;
  onArchive: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onTogglePin: () => void;
  onSwitchWorkspace: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);

  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
  }, []);

  const openMenu = () => setMenuOpen(true);
  const closeMenu = () => setMenuOpen(false);
  const runAction = (action: () => void) => {
    closeMenu();
    action();
  };
  const startLongPress = () => {
    if (!mobile) return;
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

  return (
    <div
      className={`group/conversation relative rounded-lg transition-[background-color,opacity,transform] duration-150 ease-out-quart animate-message-enter ${menuOpen ? 'bg-[var(--color-card)]' : 'hover:bg-[var(--color-card-hover)]'}`}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu();
      }}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerLeave={cancelLongPress}
    >
      <div
        role="link"
        tabIndex={0}
        onClick={() => {
          if (longPressTriggered.current) {
            longPressTriggered.current = false;
            return;
          }
          onOpen();
        }}
        onKeyDown={(event) => {
          if (event.currentTarget !== event.target) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen();
          }
        }}
        className={`flex cursor-pointer items-start gap-3 px-4 outline-none focus-visible:bg-[var(--color-card-hover)] ${
          mobile ? 'min-h-[92px] py-3 pr-16' : 'py-3 pr-14'
        }`}
      >
        <ConversationRuntimeIcon conversation={conversation} snapshot={snapshot} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {pinned && <Pin size={13} className="shrink-0 text-accent" />}
            <span className={`${mobile ? 'text-base' : 'text-sm'} truncate font-semibold text-[var(--color-text-primary)]`}>
              {conversation.title}
            </span>
            <Badge variant="label" color={conversationStatusColor(conversation.status)}>
              {conversation.status}
            </Badge>
          </div>
          <div className={`mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-dim ${mobile ? 'text-xs' : 'text-xs'}`}>
            <span className="truncate">{project?.name ?? conversation.projectId}</span>
            <span>{conversation.currentWorkspaceId ? 'workspace attached' : 'project default'}</span>
            {conversation.parentConversationId && <span>forked</span>}
            <span>{formatRelativeDate(conversation.lastActivityAt)}</span>
            <ConversationActivityLabel conversation={conversation} snapshot={snapshot} />
          </div>
          {snapshot?.lastError && (
            <p className="mt-2 line-clamp-2 text-sm leading-5 text-[var(--color-error)]">{snapshot.lastError}</p>
          )}
          {!snapshot?.lastError && conversation.summary && (
            <p className="mt-2 line-clamp-2 text-sm leading-5 text-[var(--color-text-secondary)]">{conversation.summary}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        disabled={actionPending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenu();
        }}
        className={`absolute right-3 top-3 inline-flex items-center justify-center rounded-md text-dim transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:opacity-50 ${
          mobile ? 'h-[44px] w-[44px]' : 'h-8 w-8 opacity-70 group-hover/conversation:opacity-100'
        }`}
        title="Conversation actions"
        aria-label="Conversation actions"
      >
        <Ellipsis size={15} />
      </button>
      {menuOpen && (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close conversation menu" onClick={closeMenu} />
          <div className={mobile
            ? 'fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'
            : 'absolute right-3 top-11 z-50 w-52 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]'}
          >
            <InboxMenuItem
              icon={<CircleDot size={14} />}
              onClick={() => runAction(conversation.unreadAt ? onMarkRead : onMarkUnread)}
            >
              {conversation.unreadAt ? 'Mark read' : 'Mark unread'}
            </InboxMenuItem>
            <InboxMenuItem icon={pinned ? <PinOff size={14} /> : <Pin size={14} />} onClick={() => runAction(onTogglePin)}>
              {pinned ? 'Unpin conversation' : 'Pin conversation'}
            </InboxMenuItem>
            <InboxMenuItem icon={<SquareStack size={14} />} onClick={() => runAction(onSwitchWorkspace)}>
              Switch workspace
            </InboxMenuItem>
            <InboxMenuItem icon={<GitBranchPlus size={14} />} onClick={() => runAction(onFork)}>
              Fork conversation
            </InboxMenuItem>
            <InboxMenuItem
              icon={<Archive size={14} />}
              danger
              disabled={conversation.status === 'archived'}
              onClick={() => runAction(onArchive)}
            >
              Archive
            </InboxMenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function ConversationRuntimeIcon({ conversation, snapshot }: { conversation: Conversation; snapshot?: PiConversationSnapshot }) {
  if (snapshot?.lastError) {
    return (
      <span className="mt-0.5 flex w-5 shrink-0 justify-center text-[var(--color-error)]" title={snapshot.lastError}>
        <CircleAlert size={15} />
      </span>
    );
  }

  if (snapshot?.streaming) {
    return (
      <span className="mt-0.5 flex w-5 shrink-0 justify-center text-accent" title="Pi is working">
        <LoaderCircle size={15} className="animate-spin" />
      </span>
    );
  }

  if (snapshot?.runtimeActive) {
    return (
      <span className="mt-0.5 flex w-5 shrink-0 justify-center text-[var(--color-status-in-review)]" title="Runtime active">
        <CircleDot size={15} />
      </span>
    );
  }

  if (conversation.unreadAt) {
    return (
      <span className="mt-1 flex w-5 shrink-0 justify-center text-accent" title="Unread">
        <Circle size={9} fill="currentColor" />
      </span>
    );
  }

  return (
    <span className="mt-0.5 flex w-5 shrink-0 justify-center text-dim" aria-hidden="true">
      <MessageSquareText size={15} />
    </span>
  );
}

function ConversationActivityLabel({ conversation, snapshot }: { conversation: Conversation; snapshot?: PiConversationSnapshot }) {
  if (snapshot?.lastError) {
    return <span className="text-[var(--color-error)]">failed</span>;
  }
  if (snapshot?.streaming) {
    return <span className="text-accent">streaming</span>;
  }
  if (snapshot?.runtimeActive) {
    return <span className="text-[var(--color-status-in-review)]">runtime active</span>;
  }
  if (conversation.unreadAt) {
    return <span className="text-accent">unread</span>;
  }
  return null;
}

function InboxMenuItem({
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

function buildConversationSections(
  conversations: Conversation[],
  snapshotById: Map<string, PiConversationSnapshot>,
  pinnedConversationIds: string[],
): ConversationSectionModel[] {
  const pinned: Conversation[] = [];
  const attention: Conversation[] = [];
  const running: Conversation[] = [];
  const recent: Conversation[] = [];

  conversations.forEach((conversation) => {
    const snapshot = snapshotById.get(conversation.id);
    if (pinnedConversationIds.includes(conversation.id)) {
      pinned.push(conversation);
      return;
    }
    if (conversationNeedsAttention(conversation, snapshot)) {
      attention.push(conversation);
      return;
    }
    if (conversationIsRunning(snapshot)) {
      running.push(conversation);
      return;
    }
    recent.push(conversation);
  });

  return [
    {
      id: 'pinned',
      title: 'Pinned',
      subtitle: 'Threads kept at the top across projects.',
      conversations: pinned,
    },
    {
      id: 'attention',
      title: 'Needs attention',
      subtitle: 'Unread replies and failed runs.',
      conversations: attention,
    },
    {
      id: 'running',
      title: 'Running',
      subtitle: 'Pi runtimes currently active or streaming.',
      conversations: running,
    },
    {
      id: 'recent',
      title: 'Recent activity',
      subtitle: 'Everything else, sorted by latest activity.',
      conversations: recent,
    },
  ];
}

function comparePinnedThenActivity(a: Conversation, b: Conversation, pinnedConversationIds: string[]) {
  const pinnedA = pinnedConversationIds.includes(a.id);
  const pinnedB = pinnedConversationIds.includes(b.id);
  if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;
  return b.lastActivityAt.localeCompare(a.lastActivityAt);
}

function conversationNeedsAttention(conversation: Conversation, snapshot?: PiConversationSnapshot) {
  return Boolean(conversation.unreadAt || snapshot?.lastError);
}

function conversationIsRunning(snapshot?: PiConversationSnapshot) {
  return Boolean(
    snapshot?.streaming ||
    snapshot?.runtimeActive ||
    snapshot?.pending ||
    snapshot?.tools?.some((tool) => tool.status === 'running' || tool.status === 'pending'),
  );
}

function conversationStatusColor(status: Conversation['status']): 'blue' | 'green' | 'yellow' | 'gray' {
  if (status === 'active') return 'blue';
  if (status === 'completed') return 'green';
  if (status === 'paused') return 'yellow';
  return 'gray';
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

async function invalidateConversationLists(
  queryClient: QueryClient,
  projectId: string,
  conversationId?: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
    queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations'] }),
    queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', projectId, 'sidebar'] }),
    queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
    ...(conversationId ? [queryClient.invalidateQueries({ queryKey: ['v2-conversation', conversationId] })] : []),
  ]);
}

type ConversationListCacheSnapshot = {
  conversationLists: Array<[QueryKey, Conversation[] | undefined]>;
  workspaceLists: Array<[QueryKey, Conversation[] | undefined]>;
  projectLists: Array<[QueryKey, Conversation[] | undefined]>;
  sidebar?: V2SidebarData;
  conversation?: Conversation;
};

async function cancelConversationListQueries(queryClient: QueryClient, conversation: Conversation) {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: ['v2-conversations'] }),
    queryClient.cancelQueries({ queryKey: ['v2-workspace-conversations'] }),
    queryClient.cancelQueries({ queryKey: ['v2-project-conversations', conversation.projectId] }),
    queryClient.cancelQueries({ queryKey: ['v2-sidebar-summary'] }),
    queryClient.cancelQueries({ queryKey: ['v2-conversation', conversation.id] }),
  ]);
}

function snapshotConversationListCaches(
  queryClient: QueryClient,
  conversation: Conversation,
): ConversationListCacheSnapshot {
  return {
    conversationLists: queryClient.getQueriesData<Conversation[]>({ queryKey: ['v2-conversations'] }),
    workspaceLists: queryClient.getQueriesData<Conversation[]>({ queryKey: ['v2-workspace-conversations'] }),
    projectLists: queryClient.getQueriesData<Conversation[]>({ queryKey: ['v2-project-conversations', conversation.projectId] }),
    sidebar: queryClient.getQueryData<V2SidebarData>(['v2-sidebar-summary']),
    conversation: queryClient.getQueryData<Conversation>(['v2-conversation', conversation.id]),
  };
}

function restoreConversationListCaches(queryClient: QueryClient, snapshot: ConversationListCacheSnapshot) {
  for (const [queryKey, data] of snapshot.conversationLists) queryClient.setQueryData(queryKey, data);
  for (const [queryKey, data] of snapshot.workspaceLists) queryClient.setQueryData(queryKey, data);
  for (const [queryKey, data] of snapshot.projectLists) queryClient.setQueryData(queryKey, data);
  queryClient.setQueryData(['v2-sidebar-summary'], snapshot.sidebar);
  if (snapshot.conversation) {
    queryClient.setQueryData(['v2-conversation', snapshot.conversation.id], snapshot.conversation);
  }
}

function removeConversationFromListCaches(queryClient: QueryClient, conversationId: string) {
  const removeFromList = (current: Conversation[] | undefined) => (
    current ? current.filter((conversation) => conversation.id !== conversationId) : current
  );

  queryClient.setQueriesData<Conversation[]>({ queryKey: ['v2-conversations'] }, removeFromList);
  queryClient.setQueriesData<Conversation[]>({ queryKey: ['v2-workspace-conversations'] }, removeFromList);
  queryClient.setQueriesData<Conversation[]>({ queryKey: ['v2-project-conversations'] }, removeFromList);
  queryClient.setQueryData<Conversation>(['v2-conversation', conversationId], (current) => (
    current ? { ...current, status: 'archived' } : current
  ));
  queryClient.setQueryData<V2SidebarData>(['v2-sidebar-summary'], (current) => {
    if (!current) return current;
    return {
      ...current,
      projects: current.projects.map((entry) => ({
        ...entry,
        conversations: entry.conversations.filter((conversation) => conversation.id !== conversationId),
        states: entry.states.filter((state) => state.conversationId !== conversationId),
      })),
    };
  });
}

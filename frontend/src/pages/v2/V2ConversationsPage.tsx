import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranchPlus, MessageSquareText, Search } from 'lucide-react';
import { projectsApi } from '../../api';
import type { Conversation } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Badge } from '../../components/ui/Badge';
import { useMobile } from '../../hooks/useMobile';
import { Button, V2Content, V2Empty, V2Header, V2Input, V2Panel, V2PanelHeader, V2Row, V2Screen } from './v2-ui';

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

  const forkConversation = useMutation({
    mutationFn: (conversation: Conversation) =>
      v2Api.forkConversation(conversation.id, {
        title: `${conversation.title} fork`,
        currentWorkspaceId: conversation.currentWorkspaceId,
      }),
    onSuccess: async (forked) => {
      await queryClient.invalidateQueries({ queryKey: ['v2-conversations'] });
      navigate(`/v2/conversations/${forked.id}`);
    },
  });

  const projectById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project])),
    [projects],
  );
  const safeConversations = useMemo(() => conversations ?? [], [conversations]);
  const sortedConversations = useMemo(
    () => [...safeConversations].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
    [safeConversations],
  );
  const unreadConversations = sortedConversations.filter((conversation) => conversation.unreadAt);
  const recentConversations = sortedConversations.filter((conversation) => !conversation.unreadAt);

  if (isMobile) {
    return (
      <V2Screen>
        <header className="shrink-0 border-b border-[var(--color-card-border)] px-4 py-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <div className="flex items-center justify-between gap-3">
            <h1 className="truncate text-lg font-semibold text-[var(--color-text-primary)]">Inbox</h1>
            <Badge variant="count">{unreadConversations.length || sortedConversations.length}</Badge>
          </div>
        </header>

        <div className="shrink-0 border-b border-[var(--color-card-border)] px-4 py-3">
          <label className="relative block">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
            <V2Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations"
              className="w-full !pl-9"
            />
          </label>
        </div>

        <main className="min-h-0 flex-1 overflow-auto">
          {unreadConversations.length > 0 && (
            <MobileConversationSection
              title="Unread"
              conversations={unreadConversations}
              projectById={projectById}
              forkPending={forkConversation.isPending}
              onFork={(conversation) => forkConversation.mutate(conversation)}
            />
          )}

          <MobileConversationSection
            title={unreadConversations.length > 0 ? 'Recent' : 'Recent activity'}
            conversations={recentConversations}
            projectById={projectById}
            forkPending={forkConversation.isPending}
            onFork={(conversation) => forkConversation.mutate(conversation)}
          />

          {safeConversations.length === 0 && (
            <V2Empty
              icon={<MessageSquareText size={28} />}
              title={deferredSearch ? 'No conversations match' : 'No conversations yet'}
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
        title="Durable pi threads"
        subtitle="A conversation is a provider-native thinking thread. Codeburg stores its project, workspace attachment, lifecycle, and fork relationships."
      />
      <V2Content className="space-y-4">
        <V2Panel>
          <V2PanelHeader
            title="All conversations"
            subtitle={`${conversations?.length ?? 0} pi threads${deferredSearch ? ' matching search' : ''}`}
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

          <div className="divide-y divide-[var(--color-card-border)]">
            {safeConversations.map((conversation) => {
              const project = projectById.get(conversation.projectId);
              return (
                <V2Row key={conversation.id} className="rounded-none px-4 py-3 hover:bg-[var(--color-card-hover)]">
                  <div
                    role="link"
                    tabIndex={0}
                    onClick={() => navigate(`/v2/conversations/${conversation.id}`)}
                    onKeyDown={(event) => {
                      if (event.currentTarget !== event.target) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/v2/conversations/${conversation.id}`);
                      }
                    }}
                    className="flex cursor-pointer items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <MessageSquareText size={15} className="shrink-0 text-dim" />
                        <span className="truncate text-sm font-medium">
                          {conversation.title}
                        </span>
                        <Badge variant="label" color={conversationStatusColor(conversation.status)}>{conversation.status}</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 pl-6 text-xs text-dim">
                        <span>{project?.name ?? conversation.projectId}</span>
                        <span>{conversation.currentWorkspaceId ? 'workspace attached' : 'project default'}</span>
                        {conversation.parentConversationId && <span>forked</span>}
                        <span>{formatRelativeDate(conversation.lastActivityAt)}</span>
                      </div>
                      {conversation.summary && <p className="mt-2 max-w-3xl pl-6 text-sm leading-5 text-[var(--color-text-secondary)]">{conversation.summary}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="xs"
                        variant="secondary"
                        icon={<GitBranchPlus size={13} />}
                        disabled={forkConversation.isPending}
                        onClick={(event) => {
                          event.stopPropagation();
                          forkConversation.mutate(conversation);
                        }}
                      >
                        Fork
                      </Button>
                    </div>
                  </div>
                </V2Row>
              );
            })}
          </div>

          {(conversations?.length ?? 0) === 0 && (
            <V2Empty
              icon={<MessageSquareText size={28} />}
              title={deferredSearch ? 'No conversations match that search' : 'No conversations yet'}
              body={deferredSearch
                ? 'Try a broader query, or open a project and create a new pi thread.'
                : 'Create conversations from a project. They can later be paused, resumed, completed, forked, or moved to another workspace.'}
            />
          )}
        </V2Panel>
      </V2Content>
    </V2Screen>
  );
}

function MobileConversationSection({
  title,
  conversations,
  projectById,
  forkPending,
  onFork,
}: {
  title: string;
  conversations: Conversation[];
  projectById: Map<string, { name: string }>;
  forkPending: boolean;
  onFork: (conversation: Conversation) => void;
}) {
  if (conversations.length === 0) return null;

  return (
    <section>
      <div className="border-y border-[var(--color-card-border)] bg-[var(--color-card)]/45 px-4 py-2 text-[11px] font-semibold uppercase text-dim first:border-t-0">
        {title}
      </div>
      <div className="divide-y divide-[var(--color-card-border)]">
        {conversations.map((conversation) => {
          const project = projectById.get(conversation.projectId);
          return (
            <div key={conversation.id} className="relative transition-colors active:bg-[var(--color-card-hover)]">
              <Link
                to={`/v2/conversations/${conversation.id}`}
                className="block min-h-[92px] px-4 py-3 pr-16 text-[var(--color-text-primary)]"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${conversation.unreadAt ? 'bg-accent' : 'bg-[var(--color-card-border)]'}`}
                    aria-label={conversation.unreadAt ? 'Unread' : 'Read'}
                  />
                  <MessageSquareText size={16} className="shrink-0 text-dim" />
                  <span className="truncate text-base font-semibold">{conversation.title}</span>
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-[1.625rem] text-xs text-dim">
                  <span className="truncate">{project?.name ?? conversation.projectId}</span>
                  <Badge variant="label" color={conversationStatusColor(conversation.status)}>{conversation.status}</Badge>
                  <span>{conversation.currentWorkspaceId ? 'workspace' : 'project'}</span>
                  {conversation.parentConversationId && <span>forked</span>}
                  <span>{formatRelativeDate(conversation.lastActivityAt)}</span>
                </div>
                {conversation.summary && (
                  <p className="mt-2 line-clamp-2 pl-[1.625rem] text-sm leading-5 text-[var(--color-text-secondary)]">
                    {conversation.summary}
                  </p>
                )}
              </Link>
              <button
                type="button"
                disabled={forkPending}
                onClick={() => onFork(conversation)}
                className="absolute right-3 top-3 inline-flex h-[44px] w-[44px] items-center justify-center rounded-md text-dim transition-colors hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                title="Fork conversation"
                aria-label="Fork conversation"
              >
                <GitBranchPlus size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
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
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString();
}

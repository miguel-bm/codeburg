import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, GitBranchPlus, MessageSquareText, Search } from 'lucide-react';
import { projectsApi } from '../../api';
import type { Conversation } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Badge } from '../../components/ui/Badge';
import { Button, V2Content, V2Empty, V2Header, V2Input, V2Panel, V2PanelHeader, V2Row, V2Screen } from './v2-ui';

export function V2ConversationsPage() {
  const queryClient = useQueryClient();
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2-conversations'] });
    },
  });

  const projectById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project])),
    [projects],
  );

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
            {(conversations ?? []).map((conversation) => {
              const project = projectById.get(conversation.projectId);
              return (
                <V2Row key={conversation.id} className="rounded-none px-4 py-3 hover:bg-[var(--color-card-hover)]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <MessageSquareText size={15} className="shrink-0 text-dim" />
                        <Link to={`/v2/conversations/${conversation.id}`} className="truncate text-sm font-medium hover:text-accent">
                          {conversation.title}
                        </Link>
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
                      <Button size="xs" variant="secondary" icon={<GitBranchPlus size={13} />} disabled={forkConversation.isPending} onClick={() => forkConversation.mutate(conversation)}>
                        Fork
                      </Button>
                      <Link to={`/v2/conversations/${conversation.id}`}>
                        <Button size="xs" variant="primary" iconRight={<ArrowRight size={13} />}>Open</Button>
                      </Link>
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

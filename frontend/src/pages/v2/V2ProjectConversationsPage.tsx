import { useDeferredValue, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, GitBranchPlus, MessageSquarePlus, MessageSquareText, Search, Settings2, Sparkles } from 'lucide-react';
import { projectsApi } from '../../api';
import type { Conversation, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';
import { Badge } from '../../components/ui/Badge';
import { Button, V2Content, V2Empty, V2Header, V2Input, V2Panel, V2PanelHeader, V2Row, V2Screen, V2Select } from './v2-ui';

export function V2ProjectConversationsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  });

  const { data: workspaces } = useQuery({
    queryKey: ['v2-workspaces', id],
    queryFn: () => v2Api.listWorkspaces(id!),
    enabled: !!id,
  });

  const { data: conversations } = useQuery({
    queryKey: ['v2-project-conversations', id, deferredSearch],
    queryFn: () => v2Api.listProjectConversations(id!, { q: deferredSearch, provider: 'pi' }),
    enabled: !!id,
  });

  const createConversation = useMutation({
    mutationFn: (input: { title: string; currentWorkspaceId?: string }) => v2Api.createConversation(id!, input),
    onSuccess: async () => {
      setTitle('');
      await queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', id] });
      await queryClient.invalidateQueries({ queryKey: ['v2-conversations'] });
    },
  });

  const forkConversation = useMutation({
    mutationFn: (conversation: Conversation) =>
      v2Api.forkConversation(conversation.id, {
        title: `${conversation.title} fork`,
        currentWorkspaceId: conversation.currentWorkspaceId,
      }),
    onSuccess: async (forked) => {
      await queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', id] });
      await queryClient.invalidateQueries({ queryKey: ['v2-conversations'] });
      navigate(`/v2/conversations/${forked.id}`);
    },
  });

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    createConversation.mutate({ title: trimmed, currentWorkspaceId: workspaceId || undefined });
  };

  return (
    <V2Screen>
      <V2Header
        backTo={project ? `/v2/projects/${project.id}` : '/v2'}
        backLabel="Back to workspace"
        eyebrow="Project conversations"
        title={project?.name ?? 'Project'}
        subtitle="Use conversations for durable planning and agent work. A thread can be project-scoped, attached to a workspace, moved later, or forked when the work branches."
        actions={project && (
          <Link to={`/v2/projects/${project.id}/pi`}>
            <Button size="xs" variant="secondary" icon={<Settings2 size={13} />}>Harness</Button>
          </Link>
        )}
      />

      <V2Content className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <V2Panel className="min-h-0 overflow-hidden">
          <V2PanelHeader
            title="Threads"
            subtitle={`${conversations?.length ?? 0} conversations`}
            actions={
              <label className="flex items-center gap-2">
                <Search size={14} className="text-dim" />
                <V2Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className="w-52" />
              </label>
            }
          />

          <div className="border-b border-[var(--color-card-border)] px-4 py-3">
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_16rem_auto]">
              <V2Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Investigate parser edge cases"
              />
              <V2Select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
                <option value="">Default workspace</option>
                {(workspaces ?? []).map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.branchName}</option>
                ))}
              </V2Select>
              <Button size="sm" variant="primary" icon={<MessageSquarePlus size={14} />} loading={createConversation.isPending} disabled={!title.trim()} onClick={submit}>
                New
              </Button>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-dim">
              <button type="button" onClick={() => setTitle(project?.name ? `Explore ${project.name}` : 'New pi conversation')} className="inline-flex items-center gap-1.5 hover:text-[var(--color-text-primary)]">
                <Sparkles size={13} />
                Draft a title
              </button>
              {createConversation.error instanceof Error && <span className="text-[var(--color-error)]">{createConversation.error.message}</span>}
            </div>
          </div>

          <div className="min-h-0 overflow-auto">
            {(conversations ?? []).map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                workspace={(workspaces ?? []).find((workspace) => workspace.id === conversation.currentWorkspaceId)}
                onFork={() => forkConversation.mutate(conversation)}
                forkPending={forkConversation.isPending}
              />
            ))}
            {(conversations?.length ?? 0) === 0 && (
              <V2Empty
                icon={<MessageSquareText size={28} />}
                title={deferredSearch ? 'No conversations match that search' : 'No pi conversations yet'}
                body="Create a thread here, then open it to chat with pi. Codeburg keeps the lifecycle and workspace relationship around the provider-native history."
              />
            )}
          </div>
        </V2Panel>

        <V2Panel className="self-start">
          <V2PanelHeader title="How to use this" subtitle="Conversation lifecycle" />
          <div className="space-y-3 p-4 text-sm leading-6 text-[var(--color-text-secondary)]">
            <p>Create a conversation when you want a durable pi thread for a project.</p>
            <p>Attach it to a workspace when the agent should operate in a specific branch or worktree.</p>
            <p>Pause/resume/complete controls live inside the conversation. Fork creates a new thread when the idea splits.</p>
          </div>
        </V2Panel>
      </V2Content>
    </V2Screen>
  );
}

function ConversationRow({
  conversation,
  workspace,
  onFork,
  forkPending,
}: {
  conversation: Conversation;
  workspace?: Workspace;
  onFork: () => void;
  forkPending: boolean;
}) {
  return (
    <V2Row className="rounded-none border-b border-[var(--color-card-border)] px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquareText size={15} className="shrink-0 text-dim" />
            <Link to={`/v2/conversations/${conversation.id}`} className="truncate text-sm font-medium hover:text-accent">
              {conversation.title}
            </Link>
            <Badge variant="label" color={conversation.status === 'active' ? 'blue' : conversation.status === 'completed' ? 'green' : 'gray'}>
              {conversation.status}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 pl-6 text-xs text-dim">
            <span>{workspace ? `${workspace.name} · ${workspace.branchName}` : 'default workspace'}</span>
            <span>{conversation.parentConversationId ? 'forked' : 'primary'}</span>
            <span>{new Date(conversation.lastActivityAt).toLocaleDateString()}</span>
          </div>
          {conversation.summary && <p className="mt-2 max-w-3xl pl-6 text-sm leading-5 text-[var(--color-text-secondary)]">{conversation.summary}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="xs" variant="secondary" icon={<GitBranchPlus size={13} />} disabled={forkPending} onClick={onFork}>Fork</Button>
          <Link to={`/v2/conversations/${conversation.id}`}>
            <Button size="xs" variant="primary" iconRight={<ArrowRight size={13} />}>Open</Button>
          </Link>
        </div>
      </div>
    </V2Row>
  );
}

import { startTransition, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CheckCircle2, GitBranchPlus, MessageSquareText, PauseCircle, PlayCircle, Send, SquareTerminal, StopCircle } from 'lucide-react';
import { projectsApi } from '../../api';
import type { ConversationStatus, PiConversationMessage, PiConversationSnapshot } from '../../api/types';
import { v2Api } from '../../api/v2';
import { MarkdownRenderer } from '../../components/ui/MarkdownRenderer';
import { usePiConversation } from '../../hooks/usePiConversation';
import { Button, V2Content, V2Empty, V2Header, V2Panel, V2PanelHeader, V2Row, V2Screen, V2Select, V2Textarea } from './v2-ui';

export function V2ConversationDetailPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [forkTitle, setForkTitle] = useState('');

  const { data: conversation } = useQuery({
    queryKey: ['v2-conversation', conversationId],
    queryFn: () => v2Api.getConversation(conversationId!),
    enabled: !!conversationId,
  });

  const { data: project } = useQuery({
    queryKey: ['project', conversation?.projectId],
    queryFn: () => projectsApi.get(conversation!.projectId),
    enabled: !!conversation?.projectId,
  });

  const { data: workspaces } = useQuery({
    queryKey: ['v2-workspaces', conversation?.projectId],
    queryFn: () => v2Api.listWorkspaces(conversation!.projectId),
    enabled: !!conversation?.projectId,
  });

  const { data: stateSnapshot } = useQuery({
    queryKey: ['v2-conversation-state', conversationId, conversation?.status],
    queryFn: () => v2Api.getConversationState(conversationId!),
    enabled: !!conversationId,
  });

  const { data: workspaceHistory } = useQuery({
    queryKey: ['v2-conversation-workspaces', conversationId],
    queryFn: () => v2Api.listConversationWorkspaceLinks(conversationId!),
    enabled: !!conversationId,
  });

  const isActiveConversation = conversation?.status === 'active';
  const { snapshot: liveSnapshot, connected, connecting, error, sendMessage, abort } = usePiConversation(conversationId ?? '', isActiveConversation);
  const snapshot: PiConversationSnapshot | null = liveSnapshot ?? stateSnapshot ?? null;
  const attachedWorkspace = useMemo(
    () => workspaces?.find((workspace) => workspace.id === conversation?.currentWorkspaceId),
    [workspaces, conversation?.currentWorkspaceId],
  );

  const updateWorkspace = useMutation({
    mutationFn: (currentWorkspaceId?: string) => v2Api.switchConversationWorkspace(conversationId!, { currentWorkspaceId }),
    onSuccess: async (updated) => {
      startTransition(() => setSelectedWorkspaceId(updated.currentWorkspaceId ?? ''));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-conversation', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversation-state', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversation-workspaces', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId] }),
      ]);
    },
  });

  const forkConversation = useMutation({
    mutationFn: () =>
      v2Api.forkConversation(conversationId!, {
        title: forkTitle.trim() || `${conversation?.title ?? 'Conversation'} fork`,
        currentWorkspaceId: selectedWorkspaceId || conversation?.currentWorkspaceId,
      }),
    onSuccess: async (forked) => {
      setForkTitle('');
      await queryClient.invalidateQueries({ queryKey: ['v2-conversations'] });
      await queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', forked.projectId] });
    },
  });

  const transitionConversation = useMutation({
    mutationFn: (nextState: 'pause' | 'resume' | 'complete' | 'archive') => {
      if (nextState === 'pause') return v2Api.pauseConversation(conversationId!);
      if (nextState === 'resume') return v2Api.resumeConversation(conversationId!);
      if (nextState === 'complete') return v2Api.completeConversation(conversationId!);
      return v2Api.archiveConversation(conversationId!);
    },
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-conversation', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversation-state', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId] }),
      ]);
    },
  });

  const handleSubmit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || !conversationId) return;
    setSending(true);
    try {
      await sendMessage(trimmed);
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  const workspaceValue = selectedWorkspaceId || conversation?.currentWorkspaceId || '';

  return (
    <V2Screen>
      <V2Header
        backTo={conversation ? `/v2/projects/${conversation.projectId}/conversations` : '/v2/conversations'}
        backLabel="Back to conversations"
        eyebrow="Pi conversation"
        title={conversation?.title ?? 'Conversation'}
        subtitle={`${project?.name ?? conversation?.projectId ?? 'Project'} · ${conversation?.status ?? 'loading'} · ${attachedWorkspace?.name ?? 'default workspace'}`}
        actions={
          <>
            <LifecycleButton status={conversation?.status} target="pause" icon={<PauseCircle size={13} />} label="Pause" pending={transitionConversation.isPending} onClick={() => transitionConversation.mutate('pause')} />
            <LifecycleButton status={conversation?.status} target="resume" icon={<PlayCircle size={13} />} label="Resume" pending={transitionConversation.isPending} onClick={() => transitionConversation.mutate('resume')} />
            <LifecycleButton status={conversation?.status} target="complete" icon={<CheckCircle2 size={13} />} label="Complete" pending={transitionConversation.isPending} onClick={() => transitionConversation.mutate('complete')} />
            {conversation?.status !== 'archived' && <Button size="xs" variant="ghost" icon={<Archive size={13} />} disabled={transitionConversation.isPending} onClick={() => transitionConversation.mutate('archive')}>Archive</Button>}
            {attachedWorkspace && (
              <Link to={`/v2/projects/${attachedWorkspace.projectId}?workspace=${attachedWorkspace.id}`}>
                <Button size="xs" variant="secondary" icon={<SquareTerminal size={13} />}>Workspace</Button>
              </Link>
            )}
          </>
        }
      />

      <V2Content className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <V2Panel className="flex min-h-0 flex-col overflow-hidden">
          <V2PanelHeader
            title="Thread"
            subtitle={connected ? 'Connected' : connecting ? 'Connecting' : error ?? 'Provider-native history'}
            actions={<Button size="xs" variant="danger" icon={<StopCircle size={13} />} disabled={!snapshot?.streaming || !isActiveConversation} onClick={() => void abort()}>Abort</Button>}
          />

          <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
            {snapshot?.messages?.length ? (
              <div className="space-y-4">
                {snapshot.messages.map((message, index) => (
                  <MessageBubble key={message.id || `${message.role}-${index}`} message={message} />
                ))}
                {snapshot.pending && (
                  <div className="rounded-lg border border-[var(--color-card-border)] bg-inset px-4 py-3 text-sm">
                    {snapshot.pending.thinking && <div className="mb-3 text-xs text-dim">Thinking: {snapshot.pending.thinking}</div>}
                    {snapshot.pending.text && <MarkdownRenderer>{snapshot.pending.text}</MarkdownRenderer>}
                  </div>
                )}
              </div>
            ) : (
              <V2Empty
                icon={<MessageSquareText size={28} />}
                title="Ready for the first prompt"
                body="Send a message to start or resume the pi thread. Codeburg tracks the thread lifecycle and workspace context; pi owns the transcript."
              />
            )}
          </div>

          <div className="border-t border-[var(--color-card-border)] p-4">
            <V2Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={conversation?.status === 'active' ? 'Send a prompt to pi...' : 'Resume the conversation before sending a prompt'}
              disabled={!isActiveConversation || sending}
              className="min-h-24 w-full resize-none"
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="text-xs text-dim">Cmd/Ctrl Enter to send</div>
              <Button size="sm" variant="primary" icon={<Send size={14} />} loading={sending} disabled={!draft.trim() || !isActiveConversation} onClick={() => void handleSubmit()}>
                Send
              </Button>
            </div>
          </div>
        </V2Panel>

        <div className="space-y-4 overflow-auto">
          <V2Panel>
            <V2PanelHeader title="Workspace attachment" subtitle="Move this thread when the code context changes" />
            <div className="space-y-3 p-4">
              <V2Select value={workspaceValue} onChange={(event) => setSelectedWorkspaceId(event.target.value)} className="w-full">
                <option value="">Project default</option>
                {(workspaces ?? []).map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.branchName}</option>
                ))}
              </V2Select>
              <Button className="w-full" size="sm" variant="secondary" loading={updateWorkspace.isPending} onClick={() => updateWorkspace.mutate(selectedWorkspaceId || '')}>
                Save attachment
              </Button>
            </div>
          </V2Panel>

          <V2Panel>
            <V2PanelHeader title="Fork thread" subtitle="Create a new branch of the conversation" />
            <div className="space-y-3 p-4">
              <input value={forkTitle} onChange={(event) => setForkTitle(event.target.value)} placeholder="Optional fork title" className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-primary px-2.5 text-sm outline-none" />
              <Button className="w-full" size="sm" variant="secondary" icon={<GitBranchPlus size={14} />} loading={forkConversation.isPending} onClick={() => forkConversation.mutate()}>
                Fork conversation
              </Button>
            </div>
          </V2Panel>

          <V2Panel>
            <V2PanelHeader title="Runtime" subtitle={snapshot?.model ? `${snapshot.model.provider} · ${snapshot.model.id}` : 'No model snapshot'} />
            <div className="space-y-2 p-4 text-sm text-[var(--color-text-secondary)]">
              <MetaRow label="Runtime" value={snapshot?.runtimeActive ? 'Active' : 'Idle'} />
              <MetaRow label="Streaming" value={snapshot?.streaming ? 'Yes' : 'No'} />
              <div className="break-all rounded-lg bg-inset px-3 py-2 font-mono text-xs text-dim">{snapshot?.workDir ?? 'No workdir yet'}</div>
              {snapshot?.lastError && <div className="text-xs text-[var(--color-error)]">{snapshot.lastError}</div>}
            </div>
          </V2Panel>

          <V2Panel>
            <V2PanelHeader title="Workspace history" />
            {(workspaceHistory ?? []).map((link) => (
              <V2Row key={link.id} className="rounded-none border-b border-[var(--color-card-border)]">
                <div className="text-sm">{link.reason}</div>
                <div className="mt-1 text-xs text-dim">{new Date(link.createdAt).toLocaleString()}</div>
              </V2Row>
            ))}
            {(workspaceHistory?.length ?? 0) === 0 && <div className="p-4 text-sm text-dim">No workspace transitions recorded.</div>}
          </V2Panel>
        </div>
      </V2Content>
    </V2Screen>
  );
}

function LifecycleButton({
  status,
  target,
  icon,
  label,
  pending,
  onClick,
}: {
  status?: ConversationStatus;
  target: 'pause' | 'resume' | 'complete';
  icon: ReactNode;
  label: string;
  pending: boolean;
  onClick: () => void;
}) {
  const visible =
    (target === 'pause' && status === 'active') ||
    (target === 'resume' && (status === 'paused' || status === 'completed')) ||
    (target === 'complete' && (status === 'active' || status === 'paused'));
  if (!visible) return null;
  return <Button size="xs" variant="secondary" icon={icon} disabled={pending} onClick={onClick}>{label}</Button>;
}

function MessageBubble({ message }: { message: PiConversationMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[min(88%,46rem)] rounded-lg border px-4 py-3 text-sm ${
        isUser ? 'border-[var(--color-accent)]/20 bg-[var(--color-accent)]/10' : message.isError ? 'border-[var(--color-error)]/30 bg-[var(--color-error)]/10 text-[var(--color-error)]' : 'border-[var(--color-card-border)] bg-inset'
      }`}>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-dim">{message.role}</div>
        {message.thinking && <div className="mb-3 rounded-md bg-card px-3 py-2 text-xs text-dim">Thinking: {message.thinking}</div>}
        {message.text && <MarkdownRenderer>{message.text}</MarkdownRenderer>}
        {message.toolName && <div className="mt-2 text-xs text-dim">Tool: {message.toolName}</div>}
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-dim">{label}</span>
      <span>{value}</span>
    </div>
  );
}

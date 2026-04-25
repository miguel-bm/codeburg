import { startTransition, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Archive,
  CheckCircle2,
  FolderGit2,
  GitBranchPlus,
  Loader2,
  MessagesSquare,
  PauseCircle,
  PlayCircle,
  Send,
  Sparkles,
  SquareTerminal,
  StopCircle,
  Wrench,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { ConversationWorkspaceLink, PiConversationMessage, PiConversationSnapshot } from '../../api/types';
import { v2Api } from '../../api/v2';
import { MarkdownRenderer } from '../../components/ui/MarkdownRenderer';
import { usePiConversation } from '../../hooks/usePiConversation';

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
  const { snapshot: liveSnapshot, connected, connecting, error, sendMessage, abort } = usePiConversation(
    conversationId ?? '',
    isActiveConversation,
  );
  const snapshot: PiConversationSnapshot | null = liveSnapshot ?? stateSnapshot ?? null;
  const attachedWorkspace = useMemo(
    () => workspaces?.find((workspace) => workspace.id === conversation?.currentWorkspaceId),
    [workspaces, conversation?.currentWorkspaceId],
  );

  const updateConversation = useMutation({
    mutationFn: (input: { currentWorkspaceId?: string }) =>
      v2Api.switchConversationWorkspace(conversationId!, input),
    onSuccess: async (updatedConversation) => {
      startTransition(() => {
        setSelectedWorkspaceId(updatedConversation.currentWorkspaceId ?? '');
      });
      await queryClient.invalidateQueries({ queryKey: ['v2-conversation', conversationId] });
      await queryClient.invalidateQueries({ queryKey: ['v2-conversation-state', conversationId] });
      await queryClient.invalidateQueries({ queryKey: ['v2-conversation-workspaces', conversationId] });
      await queryClient.invalidateQueries({ queryKey: ['v2-conversations'] });
      await queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updatedConversation.projectId] });
    },
  });

  const forkConversation = useMutation({
    mutationFn: () =>
      v2Api.forkConversation(conversationId!, {
        title: forkTitle.trim() || `${conversation?.title ?? 'Conversation'} fork`,
        currentWorkspaceId: selectedWorkspaceId || conversation?.currentWorkspaceId,
      }),
    onSuccess: async (forkedConversation) => {
      startTransition(() => {
        setForkTitle('');
      });
      await queryClient.invalidateQueries({ queryKey: ['v2-conversations'] });
      await queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', forkedConversation.projectId] });
    },
  });

  const transitionConversation = useMutation({
    mutationFn: async (nextState: 'pause' | 'resume' | 'complete' | 'archive') => {
      switch (nextState) {
        case 'pause':
          return v2Api.pauseConversation(conversationId!);
        case 'resume':
          return v2Api.resumeConversation(conversationId!);
        case 'complete':
          return v2Api.completeConversation(conversationId!);
        case 'archive':
          return v2Api.archiveConversation(conversationId!);
      }
    },
    onSuccess: async (updatedConversation) => {
      await queryClient.invalidateQueries({ queryKey: ['v2-conversation', conversationId] });
      await queryClient.invalidateQueries({ queryKey: ['v2-conversation-state', conversationId] });
      await queryClient.invalidateQueries({ queryKey: ['v2-conversation-workspaces', conversationId] });
      await queryClient.invalidateQueries({ queryKey: ['v2-conversations'] });
      await queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updatedConversation.projectId] });
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

  const handleWorkspaceSave = () => {
    if (!conversationId) return;
    updateConversation.mutate({
      currentWorkspaceId: selectedWorkspaceId || '',
    });
  };

  const workspaceValue = selectedWorkspaceId || conversation?.currentWorkspaceId || '';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-6 py-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to={conversation ? `/v2/projects/${conversation.projectId}/conversations` : '/v2/conversations'}
            className="inline-flex items-center gap-2 text-sm text-neutral-500 transition-colors hover:text-neutral-900"
          >
            <ArrowLeft size={15} />
            Back to conversations
          </Link>
          <div className="mt-4 text-[11px] uppercase tracking-[0.28em] text-neutral-500">Pi conversation</div>
          <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.05em] text-neutral-950">
            {conversation?.title ?? 'Conversation'}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-neutral-500">
            <span>{project?.name ?? conversation?.projectId}</span>
            <span>{conversation?.provider ?? 'pi'}</span>
            <span>{conversation?.status ?? 'active'}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LifecycleButton
            icon={<PauseCircle size={15} />}
            label="Pause"
            visible={conversation?.status === 'active'}
            pending={transitionConversation.isPending}
            onClick={() => transitionConversation.mutate('pause')}
          />
          <LifecycleButton
            icon={<PlayCircle size={15} />}
            label="Resume"
            visible={conversation?.status === 'paused' || conversation?.status === 'completed'}
            pending={transitionConversation.isPending}
            onClick={() => transitionConversation.mutate('resume')}
          />
          <LifecycleButton
            icon={<CheckCircle2 size={15} />}
            label="Complete"
            visible={conversation?.status === 'active' || conversation?.status === 'paused'}
            pending={transitionConversation.isPending}
            onClick={() => transitionConversation.mutate('complete')}
          />
          <LifecycleButton
            icon={<Archive size={15} />}
            label="Archive"
            visible={conversation?.status !== 'archived'}
            pending={transitionConversation.isPending}
            onClick={() => transitionConversation.mutate('archive')}
          />
          {attachedWorkspace && (
            <Link
              to={`/v2/projects/${attachedWorkspace.projectId}`}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm text-neutral-700 shadow-[0_10px_20px_rgba(31,24,16,0.04)]"
            >
              <SquareTerminal size={15} />
              Open workspace
            </Link>
          )}
          <button
            type="button"
            onClick={() => void abort()}
            className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
            disabled={!snapshot?.streaming || !isActiveConversation}
          >
            <StopCircle size={15} />
            Abort
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-[2rem] border border-white/75 bg-white/60 shadow-[0_30px_60px_rgba(30,20,8,0.08)] backdrop-blur-xl">
        <div className="grid h-full min-h-0 gap-0 lg:grid-cols-[minmax(0,1.25fr)_22rem]">
          <section className="flex min-h-0 flex-col border-b border-black/6 lg:border-b-0 lg:border-r">
            <div className="border-b border-black/6 px-6 py-4">
              <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-500">
                <StatusDot active={connected} />
                <span>{connected ? 'Connected to pi runtime' : connecting ? 'Connecting to pi runtime' : 'Disconnected'}</span>
                {snapshot?.model && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-neutral-300" />
                    <span>{snapshot.model.provider}/{snapshot.model.id}</span>
                  </>
                )}
                {attachedWorkspace && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-neutral-300" />
                    <span>{attachedWorkspace.name} · {attachedWorkspace.branchName}</span>
                  </>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
              <div className="space-y-6">
                {(snapshot?.messages ?? []).map((message) => (
                  <ConversationMessageRow key={message.id} message={message} />
                ))}

                {snapshot?.pending && (
                  <div className="rounded-[1.4rem] border border-blue-200 bg-blue-50/80 px-5 py-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-blue-900">
                      <Loader2 size={15} className="animate-spin" />
                      pi is responding
                    </div>
                    {snapshot.pending.thinking && (
                      <div className="mb-4 rounded-2xl bg-white/80 px-4 py-3 text-sm text-neutral-600">
                        <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-neutral-400">Thinking</div>
                        <div className="whitespace-pre-wrap leading-6">{snapshot.pending.thinking}</div>
                      </div>
                    )}
                    {snapshot.pending.text && (
                      <div className="prose-md text-[14px] leading-7 text-neutral-900">
                        <MarkdownRenderer>{snapshot.pending.text}</MarkdownRenderer>
                      </div>
                    )}
                    {(snapshot.pending.toolCalls?.length ?? 0) > 0 && (
                      <div className="mt-4 space-y-3">
                        {snapshot.pending.toolCalls?.map((toolCall) => (
                          <ToolCard key={toolCall.id} name={toolCall.name} body={toolCall.arguments} />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!(snapshot?.messages.length || snapshot?.pending) && (
                  <div className="rounded-[1.5rem] border border-dashed border-black/10 bg-[#faf8f4] px-8 py-12 text-center">
                    <Sparkles size={28} className="mx-auto mb-4 text-neutral-400" />
                    <div className="text-base font-medium text-neutral-950">Ready for the first prompt</div>
                    <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-neutral-500">
                      This is now a provider-native pi conversation. The transcript lives in pi’s session format; Codeburg is
                      attaching project and workspace context around it.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-black/6 px-6 py-5">
              <div className="rounded-[1.6rem] border border-black/8 bg-[#faf8f4] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Ask pi to inspect, plan, or modify this project..."
                  className="min-h-[7rem] w-full resize-none bg-transparent text-[15px] leading-7 text-neutral-900 outline-none placeholder:text-neutral-400"
                />
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-neutral-500">
                    {error ?? snapshot?.lastError ?? 'Provider-native session history, Codeburg-managed workspace context.'}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={sending || !draft.trim() || !isActiveConversation}
                    className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white shadow-[0_16px_28px_rgba(17,17,17,0.16)] disabled:opacity-50"
                  >
                    {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                    Send
                  </button>
                </div>
              </div>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col bg-[linear-gradient(180deg,rgba(248,246,240,0.92),rgba(241,238,231,0.96))]">
            <div className="border-b border-black/6 px-5 py-5">
              <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Context</div>
              <div className="mt-3 text-lg font-medium tracking-[-0.03em] text-neutral-950">Conversation state</div>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-auto px-5 py-5">
              <InfoCard title="Workspace">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <FolderGit2 size={16} className="mt-0.5 text-neutral-400" />
                    <div>
                      <div className="font-medium text-neutral-900">
                        {attachedWorkspace ? `${attachedWorkspace.name} · ${attachedWorkspace.branchName}` : 'Project root'}
                      </div>
                      <div className="mt-1 break-all text-xs leading-5 text-neutral-500">
                        {snapshot?.workDir ?? project?.path ?? 'Loading...'}
                      </div>
                    </div>
                  </div>

                  <label className="block">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">Reattach workspace</div>
                    <select
                      value={workspaceValue}
                      onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                      className="w-full rounded-2xl border border-black/8 bg-white/80 px-4 py-3 text-sm text-neutral-900 outline-none transition focus:border-black/15"
                    >
                      <option value="">Project root / default branch</option>
                      {(workspaces ?? []).map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name} · {workspace.branchName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={handleWorkspaceSave}
                    disabled={updateConversation.isPending || workspaceValue === (conversation?.currentWorkspaceId ?? '')}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {updateConversation.isPending ? <Loader2 size={15} className="animate-spin" /> : <FolderGit2 size={15} />}
                    Save workspace
                  </button>
                </div>
              </InfoCard>

              <InfoCard title="Fork thread">
                <div className="space-y-3">
                  <input
                    value={forkTitle}
                    onChange={(event) => setForkTitle(event.target.value)}
                    placeholder={`${conversation?.title ?? 'Conversation'} fork`}
                    className="w-full rounded-2xl border border-black/8 bg-white/80 px-4 py-3 text-sm text-neutral-900 outline-none transition focus:border-black/15"
                  />
                  <button
                    type="button"
                    onClick={() => forkConversation.mutate()}
                    disabled={forkConversation.isPending}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-black/8 bg-[#f7f4ee] px-4 py-2.5 text-sm text-neutral-700 disabled:opacity-50"
                  >
                    {forkConversation.isPending ? <Loader2 size={15} className="animate-spin" /> : <GitBranchPlus size={15} />}
                    Create fork
                  </button>
                  <div className="text-xs leading-5 text-neutral-500">
                    Forking keeps the project context and current workspace attachment, but starts a fresh provider session.
                  </div>
                </div>
              </InfoCard>

              <InfoCard title="Session">
                <div className="space-y-3 text-sm text-neutral-600">
                  <div className="flex items-center justify-between gap-3">
                    <span>Runtime</span>
                    <span className="font-medium text-neutral-900">{snapshot?.runtimeActive ? 'Active' : 'Idle'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Streaming</span>
                    <span className="font-medium text-neutral-900">{snapshot?.streaming ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="break-all rounded-2xl bg-[#f7f4ee] px-4 py-3 text-xs leading-5 text-neutral-500">
                    {snapshot?.sessionFile ?? 'Session file not known yet'}
                  </div>
                </div>
              </InfoCard>

              <InfoCard title="Workspace history">
                {(workspaceHistory?.length ?? 0) > 0 ? (
                  <div className="space-y-3">
                    {workspaceHistory?.map((link) => (
                      <WorkspaceHistoryRow key={link.id} link={link} workspaces={workspaces ?? []} />
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-neutral-500">No workspace transitions recorded yet.</div>
                )}
              </InfoCard>

              <InfoCard title="Tool activity">
                {(snapshot?.tools?.length ?? 0) > 0 ? (
                  <div className="space-y-3">
                    {snapshot?.tools?.map((tool) => (
                      <div key={tool.toolCallId} className="rounded-2xl bg-[#f7f4ee] px-4 py-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-neutral-900">
                          <Wrench size={14} />
                          {tool.toolName}
                        </div>
                        <div className="mt-1 text-xs uppercase tracking-[0.2em] text-neutral-400">{tool.status}</div>
                        {tool.output && (
                          <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-xl bg-white px-3 py-3 text-xs leading-5 text-neutral-600">
                            {tool.output}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-neutral-500">No active tool executions right now.</div>
                )}
              </InfoCard>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function LifecycleButton({
  icon,
  label,
  visible,
  pending,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  visible: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm text-neutral-700 disabled:opacity-50"
    >
      {pending ? <Loader2 size={15} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function WorkspaceHistoryRow({
  link,
  workspaces,
}: {
  link: ConversationWorkspaceLink;
  workspaces: Array<{ id: string; name: string; branchName: string }>;
}) {
  const workspace = workspaces.find((item) => item.id === link.workspaceId);
  return (
    <div className="rounded-2xl bg-[#f7f4ee] px-4 py-3 text-sm text-neutral-600">
      <div className="font-medium text-neutral-900">
        {workspace ? `${workspace.name} · ${workspace.branchName}` : 'Project root / detached'}
      </div>
      <div className="mt-1 text-xs uppercase tracking-[0.2em] text-neutral-400">
        {link.reason} · {link.active ? 'active' : 'historical'}
      </div>
      <div className="mt-2 text-xs text-neutral-500">{new Date(link.createdAt).toLocaleString()}</div>
    </div>
  );
}

function ConversationMessageRow({ message }: { message: PiConversationMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[min(88%,46rem)] rounded-[1.6rem] rounded-br-md border border-[rgba(33,110,255,0.16)] bg-[rgba(33,110,255,0.08)] px-5 py-4">
          <MarkdownRenderer className="text-[14px] leading-7">{message.text ?? ''}</MarkdownRenderer>
        </div>
      </div>
    );
  }

  if (message.role === 'assistant') {
    return (
      <div className="space-y-4">
        {message.thinking && (
          <div className="rounded-[1.25rem] border border-black/8 bg-[#faf8f4] px-4 py-3 text-sm text-neutral-600">
            <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-neutral-400">Thinking</div>
            <div className="whitespace-pre-wrap leading-6">{message.thinking}</div>
          </div>
        )}
        {message.text && (
          <div className="prose-md text-[14px] leading-7 text-neutral-900">
            <MarkdownRenderer>{message.text}</MarkdownRenderer>
          </div>
        )}
        {(message.toolCalls?.length ?? 0) > 0 && (
          <div className="space-y-3">
            {message.toolCalls?.map((toolCall) => (
              <ToolCard key={toolCall.id} name={toolCall.name} body={toolCall.arguments} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-[1.25rem] border px-4 py-3 text-sm ${
      message.isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-black/8 bg-[#faf8f4] text-neutral-700'
    }`}>
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-neutral-400">
        <MessagesSquare size={13} />
        <span>{message.toolName || message.role}</span>
      </div>
      {message.text && <pre className="whitespace-pre-wrap break-words font-sans leading-6">{message.text}</pre>}
    </div>
  );
}

function ToolCard({ name, body }: { name: string; body?: string }) {
  return (
    <div className="rounded-[1.2rem] border border-black/8 bg-[#faf8f4] px-4 py-3">
      <div className="text-sm font-medium text-neutral-900">{name}</div>
      {body && (
        <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-xl bg-white px-3 py-3 text-xs leading-5 text-neutral-600">
          {body}
        </pre>
      )}
    </div>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return <span className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-amber-500'}`} />;
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.5rem] border border-white/75 bg-white/78 px-4 py-4 shadow-[0_14px_28px_rgba(30,20,8,0.05)]">
      <div className="mb-4 text-sm font-medium text-neutral-950">{title}</div>
      {children}
    </section>
  );
}

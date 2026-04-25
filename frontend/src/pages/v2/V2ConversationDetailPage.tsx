import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ChevronDown,
  FileText,
  GitBranchPlus,
  GitCommitHorizontal,
  PanelRightOpen,
  Send,
  Sparkles,
  SquareTerminal,
  StopCircle,
  Wrench,
  X,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { PiConversationMessage, PiConversationSnapshot, Workspace } from '../../api/types';
import { v2Api } from '../../api/v2';
import { MarkdownRenderer } from '../../components/ui/MarkdownRenderer';
import { DiffTab } from '../../components/workspace/DiffTab';
import { EditorTab } from '../../components/workspace/EditorTab';
import { WorkspaceProvider } from '../../components/workspace/WorkspaceContext';
import { fileName } from '../../components/workspace/editorUtils';
import { usePiConversation } from '../../hooks/usePiConversation';
import { useWorkspaceStore, type WorkspaceTab } from '../../stores/workspace';
import { Button, V2Empty, V2Input, V2Screen, V2Select, V2Textarea } from './v2-ui';
import { V2QuickActionsMenu } from './V2QuickActionsMenu';
import { V2WorkspaceTools, type V2HelperTab } from './V2WorkspaceTools';

type MainSurface = 'conversation' | { type: 'workspaceTab'; index: number };

export function V2ConversationDetailPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const queryClient = useQueryClient();
  const resetWorkspaceTabs = useWorkspaceStore((state) => state.resetTabs);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabIndex = useWorkspaceStore((state) => state.activeTabIndex);
  const closeTab = useWorkspaceStore((state) => state.closeTab);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [forkTitle, setForkTitle] = useState('');
  const [helperTab, setHelperTab] = useState<V2HelperTab>('files');
  const [toolsOpen, setToolsOpen] = useState(true);
  const [toolsWidth, setToolsWidth] = useState(360);
  const [mainSurface, setMainSurface] = useState<MainSurface>('conversation');
  const resizeStart = useRef<{ x: number; width: number } | null>(null);

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
  const activeWorkspace = attachedWorkspace
    ?? workspaces?.find((workspace) => workspace.kind === 'main')
    ?? workspaces?.[0]
    ?? null;
  const activeWorkspaceTab = mainSurface !== 'conversation' ? tabs[mainSurface.index] : null;
  const activePreviewTab = activeWorkspaceTab?.type === 'editor' || activeWorkspaceTab?.type === 'diff'
    ? activeWorkspaceTab
    : null;

  useEffect(() => {
    resetWorkspaceTabs();
    setMainSurface('conversation');
  }, [conversationId, activeWorkspace?.id, resetWorkspaceTabs]);

  useEffect(() => {
    if (tabs.length === 0) return;
    const activeTab = tabs[activeTabIndex];
    if (activeTab?.type === 'editor' || activeTab?.type === 'diff') {
      setMainSurface({ type: 'workspaceTab', index: activeTabIndex });
    }
  }, [tabs, activeTabIndex]);

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
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId, 'sidebar'] }),
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
      await queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', forked.projectId, 'sidebar'] });
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
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId, 'sidebar'] }),
      ]);
    },
  });

  const beginResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    resizeStart.current = { x: event.clientX, width: toolsWidth };
    const onMove = (moveEvent: MouseEvent) => {
      if (!resizeStart.current) return;
      const delta = resizeStart.current.x - moveEvent.clientX;
      setToolsWidth(Math.max(280, Math.min(640, resizeStart.current.width + delta)));
    };
    const onUp = () => {
      resizeStart.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [toolsWidth]);

  const handleSubmit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || !conversationId) return;
    setSending(true);
    try {
      await sendMessage(trimmed);
      setDraft('');
      setMainSurface('conversation');
    } finally {
      setSending(false);
    }
  };

  const workspaceValue = selectedWorkspaceId || conversation?.currentWorkspaceId || '';
  const shell = (
    <V2Screen>
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 bg-canvas px-4">
        <div className="flex min-w-0 items-center gap-2 text-xs text-dim">
          <span className="truncate">{project?.name ?? 'Project'}</span>
          {activeWorkspace && <span className="truncate">on {activeWorkspace.name}</span>}
          {connected ? <span className="text-[var(--color-success)]">connected</span> : connecting ? <span>connecting</span> : error ? <span className="text-[var(--color-error)]">{error}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <V2QuickActionsMenu projectId={project?.id} workspaceId={activeWorkspace?.id} disabled={!project || !activeWorkspace || activeWorkspace.status !== 'active'} />
          {activeWorkspace && (
            <Link to={`/v2/projects/${activeWorkspace.projectId}?workspace=${activeWorkspace.id}`}>
              <Button size="xs" variant="ghost" icon={<SquareTerminal size={13} />}>Workspace</Button>
            </Link>
          )}
        </div>
      </div>
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 bg-primary px-4">
        <div className="flex min-w-0 items-center gap-2 text-xs text-dim">
          <Sparkles size={14} />
          <span className="truncate font-medium text-[var(--color-text-primary)]">{conversation?.title ?? 'Conversation'}</span>
          <span>{conversation?.status ?? 'loading'}</span>
          {(workspaceHistory?.length ?? 0) > 0 && <span>{workspaceHistory?.length} workspace moves</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {conversation && <CompactWorkspaceMenu value={workspaceValue} workspaces={workspaces ?? []} pending={updateWorkspace.isPending} onChange={setSelectedWorkspaceId} onSave={() => updateWorkspace.mutate(workspaceValue || '')} />}
          <V2Input value={forkTitle} onChange={(event) => setForkTitle(event.target.value)} placeholder="Fork title" className="hidden w-36 lg:block" />
          <Button size="xs" variant="secondary" icon={<GitBranchPlus size={13} />} loading={forkConversation.isPending} onClick={() => forkConversation.mutate()}>Fork</Button>
          {conversation?.status !== 'archived' && <Button size="xs" variant="ghost" icon={<Archive size={13} />} disabled={transitionConversation.isPending} onClick={() => transitionConversation.mutate('archive')}>Archive</Button>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col bg-primary">
          {activePreviewTab && mainSurface !== 'conversation' && (
            <FileSurfaceBar
              tab={activePreviewTab}
              onClose={() => {
                closeTab(mainSurface.index);
                setMainSurface('conversation');
              }}
            />
          )}

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeWorkspaceTab?.type === 'editor' ? (
              <EditorTab path={activeWorkspaceTab.path} line={activeWorkspaceTab.line} />
            ) : activeWorkspaceTab?.type === 'diff' ? (
              <DiffTab file={activeWorkspaceTab.file} staged={activeWorkspaceTab.staged} base={activeWorkspaceTab.base} commit={activeWorkspaceTab.commit} />
            ) : (
              <ConversationSurface
                snapshot={snapshot}
                isActiveConversation={isActiveConversation}
                sending={sending}
                draft={draft}
                setDraft={setDraft}
                abort={() => void abort()}
                submit={() => void handleSubmit()}
              />
            )}
          </div>
        </section>

        {toolsOpen && (
          <>
            <div className="w-1.5 shrink-0 cursor-col-resize bg-canvas hover:bg-accent/30" onMouseDown={beginResize} />
            <aside className="min-h-0 shrink-0 bg-canvas" style={{ width: toolsWidth }}>
              {activeWorkspace && project ? (
                <V2WorkspaceTools helperTab={helperTab} onSelectHelperTab={setHelperTab} onClose={() => setToolsOpen(false)} />
              ) : (
                <V2Empty icon={<Wrench size={24} />} title="No workspace tools yet" body="Attach this conversation to a workspace to inspect files, search, and git changes." />
              )}
            </aside>
          </>
        )}

        {!toolsOpen && (
          <button
            type="button"
            onClick={() => setToolsOpen(true)}
            className="flex w-9 shrink-0 items-center justify-center bg-canvas text-dim hover:text-[var(--color-text-primary)]"
            title="Open tools"
          >
            <PanelRightOpen size={16} />
          </button>
        )}
      </div>
    </V2Screen>
  );

  if (!project || !activeWorkspace) return shell;
  return (
    <WorkspaceProvider scope={{ type: 'workspace', workspaceId: activeWorkspace.id, workspace: activeWorkspace, project }}>
      {shell}
    </WorkspaceProvider>
  );
}

function ConversationSurface({
  snapshot,
  isActiveConversation,
  sending,
  draft,
  setDraft,
  abort,
  submit,
}: {
  snapshot: PiConversationSnapshot | null;
  isActiveConversation: boolean;
  sending: boolean;
  draft: string;
  setDraft: (draft: string) => void;
  abort: () => void;
  submit: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {snapshot?.messages?.length ? (
          <div className="mx-auto max-w-5xl space-y-6">
            {snapshot.messages.map((message, index) => (
              <MessageRow key={message.id || `${message.role}-${index}`} message={message} />
            ))}
            {snapshot.pending && (
              <div className="space-y-2 text-sm">
                {snapshot.pending.thinking && <CollapsibleEvent icon={<Sparkles size={14} />} title="Thinking" body={snapshot.pending.thinking} />}
                {snapshot.pending.text && <MarkdownRenderer>{snapshot.pending.text}</MarkdownRenderer>}
              </div>
            )}
          </div>
        ) : (
          <V2Empty
            icon={<Sparkles size={28} />}
            title="Ready for the first prompt"
            body="Send a message to start or resume the pi thread. The sidebar will keep this conversation under its workspace."
          />
        )}
      </div>

      <div className="shrink-0 bg-primary px-6 pb-5">
        <div className="mx-auto max-w-5xl rounded-2xl bg-card p-3 shadow-[var(--shadow-card)]">
          <V2Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={isActiveConversation ? 'Send a prompt to pi...' : 'Resume the conversation before sending a prompt'}
            disabled={!isActiveConversation || sending}
            className="min-h-24 w-full resize-none border-0 bg-transparent"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-dim">
              <span>Cmd/Ctrl Enter</span>
              {snapshot?.streaming && <button type="button" onClick={abort} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[var(--color-error)] hover:bg-[var(--color-error)]/10"><StopCircle size={13} />Abort</button>}
            </div>
            <Button size="sm" variant="primary" icon={<Send size={14} />} loading={sending} disabled={!draft.trim() || !isActiveConversation} onClick={submit}>
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: PiConversationMessage }) {
  const isUser = message.role === 'user';
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[min(74%,46rem)] rounded-2xl bg-[var(--color-accent)]/10 px-4 py-3 text-sm text-[var(--color-text-primary)]">
          {message.text && <MarkdownRenderer>{message.text}</MarkdownRenderer>}
          <ToolCallSummary message={message} />
        </div>
      </div>
    );
  }
  return (
    <article className={`w-full text-sm leading-6 ${message.isError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]'}`}>
      {message.thinking && <CollapsibleEvent icon={<Sparkles size={14} />} title="Thinking" body={message.thinking} />}
      {message.text && <MarkdownRenderer>{message.text}</MarkdownRenderer>}
      <ToolCallSummary message={message} />
    </article>
  );
}

function ToolCallSummary({ message }: { message: PiConversationMessage }) {
  const toolCalls = message.toolCalls ?? [];
  if (!message.toolName && toolCalls.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {message.toolName && <CollapsibleEvent icon={<Wrench size={14} />} title={`Tool: ${message.toolName}`} body={message.text ? 'Tool details are folded by default.' : ''} />}
      {toolCalls.map((tool, index) => (
        <details key={tool.id || index} className="group rounded-lg bg-inset px-3 py-2 text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-dim">
            <Wrench size={13} />
            <span className="font-medium text-[var(--color-text-secondary)]">{tool.name}</span>
          <span>call</span>
            <ChevronDown size={13} className="ml-auto transition-transform group-open:rotate-180" />
          </summary>
          {tool.arguments && <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md bg-primary p-2 font-mono text-[11px]">{tool.arguments}</pre>}
        </details>
      ))}
    </div>
  );
}

function CollapsibleEvent({ icon, title, body }: { icon: ReactNode; title: string; body: ReactNode }) {
  return (
    <details className="group mb-3 rounded-lg bg-inset px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-dim">
        {icon}
        <span className="font-medium text-[var(--color-text-secondary)]">{title}</span>
        <span className="ml-auto">collapsed</span>
        <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
      </summary>
      {body && <div className="mt-2 whitespace-pre-wrap text-[var(--color-text-secondary)]">{body}</div>}
    </details>
  );
}

function CompactWorkspaceMenu({
  value,
  workspaces,
  pending,
  onChange,
  onSave,
}: {
  value: string;
  workspaces: Workspace[];
  pending: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="hidden items-center gap-1 xl:flex">
      <V2Select value={value} onChange={(event) => onChange(event.target.value)} className="w-48">
        <option value="">Project default</option>
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
        ))}
      </V2Select>
      <Button size="xs" variant="ghost" loading={pending} onClick={onSave}>Attach</Button>
    </div>
  );
}

function FileSurfaceBar({
  tab,
  onClose,
}: {
  tab: Extract<WorkspaceTab, { type: 'editor' | 'diff' }>;
  onClose: () => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-3 bg-canvas px-3">
      <div className="flex min-w-0 items-center gap-2 text-xs text-dim">
        {tab.type === 'editor' ? <FileText size={13} /> : <GitCommitHorizontal size={13} />}
        <span className="truncate font-medium text-[var(--color-text-primary)]">{previewTabLabel(tab)}</span>
      </div>
      <button type="button" onClick={onClose} className="rounded-md p-1 text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)]" title="Close file surface">
        <X size={13} />
      </button>
    </div>
  );
}

function previewTabLabel(tab: Extract<WorkspaceTab, { type: 'editor' | 'diff' }>) {
  if (tab.type === 'editor') return fileName(tab.path);
  if (tab.file) return fileName(tab.file);
  if (tab.commit) return tab.commit.slice(0, 7);
  return 'All changes';
}

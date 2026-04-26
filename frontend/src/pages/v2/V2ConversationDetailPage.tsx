import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  AtSign,
  Check,
  ChevronDown,
  Clipboard,
  CircleDot,
  Command,
  FileCode2,
  FolderTree,
  GitBranch,
  GitBranchPlus,
  Loader2,
  Mic,
  MessageSquarePlus,
  MessageSquareText,
  Plus,
  PlusCircle,
  Send,
  Slash,
  Sparkles,
  Square,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { Conversation, PiAvailableModel, PiConversationMessage, PiConversationSnapshot, PiSlashCommand, PiToolExecution, Workspace } from '../../api/types';
import { v2Api, type V2FileEntry } from '../../api/v2';
import { Badge } from '../../components/ui/Badge';
import { MarkdownRenderer } from '../../components/ui/MarkdownRenderer';
import { DiffTab } from '../../components/workspace/DiffTab';
import { EditorTab } from '../../components/workspace/EditorTab';
import { WorkspaceProvider } from '../../components/workspace/WorkspaceContext';
import { useMobile } from '../../hooks/useMobile';
import { usePiConversation } from '../../hooks/usePiConversation';
import { useVirtualKeyboard } from '../../hooks/useVirtualKeyboard';
import { useWorkspaceStore } from '../../stores/workspace';
import { applySuggestionToText, findActiveToken, fuzzyScore, type InputSelection } from '../../components/chat/chatAutocomplete';
import { Button, V2Empty, V2Input, V2Screen, V2Select } from './v2-ui';
import { V2QuickActionsMenu } from './V2QuickActionsMenu';
import { V2WorkspaceToolTabs, V2WorkspaceTools, V2WorkspaceToolsSurface, type V2HelperTab } from './V2WorkspaceTools';

type MainSurface = 'conversation' | { type: 'workspaceTab'; index: number };

interface ComposerSuggestion {
  key: string;
  type: 'slash' | 'file';
  label: string;
  detail?: string;
  value: string;
  addSpace: boolean;
  disabled?: boolean;
  icon: 'command' | 'file' | 'folder';
}

const MAX_SUGGESTIONS = 8;
const FILE_INDEX_DEPTH = 12;
const FALLBACK_PI_COMMANDS: PiSlashCommand[] = [
  { name: 'model', description: 'Select model' },
  { name: 'fork', description: 'Fork from a previous message' },
  { name: 'tree', description: 'Navigate conversation tree' },
  { name: 'compact', description: 'Compact the session context' },
  { name: 'session', description: 'Show session info' },
  { name: 'copy', description: 'Copy the last assistant message' },
  { name: 'hotkeys', description: 'Show keyboard shortcuts' },
  { name: 'reload', description: 'Reload Pi resources' },
];

export function V2ConversationDetailPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const resetWorkspaceTabs = useWorkspaceStore((state) => state.resetTabs);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabIndex = useWorkspaceStore((state) => state.activeTabIndex);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const isMobile = useMobile();

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [forkTitle, setForkTitle] = useState('');
  const [helperTab, setHelperTab] = useState<V2HelperTab>('files');
  const [toolsOpen, setToolsOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  const [toolsWidth, setToolsWidth] = useState(360);
  const [toolsResizing, setToolsResizing] = useState(false);
  const [mainSurface, setMainSurface] = useState<MainSurface>('conversation');
  const [newTabOpen, setNewTabOpen] = useState(false);
  const [conversationActionsOpen, setConversationActionsOpen] = useState(false);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const readOnFocusConversation = useRef<string | null>(null);
  const wasStreaming = useRef(false);

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
  const { snapshot: liveSnapshot, connected, connecting, error, sendMessage, abort, applySnapshot } = usePiConversation(conversationId ?? '', isActiveConversation);
  const snapshot: PiConversationSnapshot | null = liveSnapshot ?? stateSnapshot ?? null;
  const safeWorkspaces = useMemo(() => Array.isArray(workspaces) ? workspaces : [], [workspaces]);
  const safeWorkspaceHistory = Array.isArray(workspaceHistory) ? workspaceHistory : [];
  const attachedWorkspace = useMemo(
    () => safeWorkspaces.find((workspace) => workspace.id === conversation?.currentWorkspaceId),
    [safeWorkspaces, conversation?.currentWorkspaceId],
  );
  const activeWorkspace = attachedWorkspace
    ?? safeWorkspaces.find((workspace) => workspace.kind === 'main')
    ?? safeWorkspaces[0]
    ?? null;
  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const activeWorkspaceTab = mainSurface !== 'conversation' ? tabs[mainSurface.index] : null;
  const activePreviewTab = activeWorkspaceTab?.type === 'editor' || activeWorkspaceTab?.type === 'diff'
    ? activeWorkspaceTab
    : null;
  const workspaceContextReady = !!project && !!activeWorkspace;

  useEffect(() => {
    resetWorkspaceTabs();
    setMainSurface('conversation');
  }, [conversationId, activeWorkspace?.id, resetWorkspaceTabs]);

  useEffect(() => {
    if (!conversationId) return;
    const key = forkDraftStorageKey(conversationId);
    const savedDraft = window.sessionStorage.getItem(key);
    if (!savedDraft) return;
    window.sessionStorage.removeItem(key);
    setDraft(savedDraft);
  }, [conversationId]);

  useEffect(() => {
    setToolsOpen(!isMobile);
  }, [isMobile]);

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
  const { data: terminals = [] } = useQuery({
    queryKey: ['v2-terminals', activeWorkspaceId],
    queryFn: () => v2Api.listTerminals(activeWorkspaceId!),
    enabled: !!activeWorkspaceId,
    refetchInterval: 5000,
  });
  const { data: workspaceConversations = [] } = useQuery({
    queryKey: ['v2-workspace-conversations', activeWorkspaceId],
    queryFn: async () => {
      if (!project || !activeWorkspaceId) return [];
      const conversations = await v2Api.listProjectConversations(project.id, { provider: 'pi', status: 'active' });
      return conversations.filter((candidate) => candidate.currentWorkspaceId === activeWorkspaceId);
    },
    enabled: !!project && !!activeWorkspaceId,
  });
  const safeTerminals = Array.isArray(terminals) ? terminals : [];
  const safeWorkspaceConversations = Array.isArray(workspaceConversations) ? workspaceConversations : [];
  const createTerminal = useMutation({
    mutationFn: () => v2Api.createTerminal(activeWorkspaceId!, {
      title: `Terminal #${safeTerminals.length + 1}`,
    }),
    onSuccess: async (terminal) => {
      await queryClient.invalidateQueries({ queryKey: ['v2-terminals', terminal.workspaceId] });
      navigate(`/v2/projects/${terminalWorkspaceProjectId(project, conversation)}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`);
    },
  });
  const createConversation = useMutation({
    mutationFn: () => v2Api.createConversation(conversation!.projectId, {
      title: `New ${activeWorkspace?.name ?? project?.name ?? 'workspace'} conversation`,
      currentWorkspaceId: activeWorkspaceId ?? undefined,
    }),
    onSuccess: async (created) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', created.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', created.projectId, 'sidebar'] }),
      ]);
      navigate(`/v2/conversations/${created.id}`);
    },
  });
  const renameConversation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      v2Api.updateConversation(id, { title }),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-conversation', updated.id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId, 'sidebar'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
      ]);
    },
  });

  const markConversationReadState = useMutation({
    mutationFn: (unread: boolean) =>
      unread ? v2Api.markConversationUnread(conversationId!) : v2Api.markConversationRead(conversationId!),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-conversation', updated.id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
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
      navigate(`/v2/conversations/${forked.id}`);
    },
  });
  const setConversationModel = useMutation({
    mutationFn: (model: { provider: string; modelId: string }) => v2Api.setConversationModel(conversationId!, model),
    onSuccess: (nextSnapshot) => {
      applySnapshot(nextSnapshot);
    },
  });
  const forkConversationFromMessage = useMutation({
    mutationFn: ({ entryId }: { entryId: string }) =>
      v2Api.forkConversationFromMessage(conversationId!, {
        entryId,
        title: `${conversation?.title ?? 'Conversation'} fork`,
        currentWorkspaceId: activeWorkspaceId ?? conversation?.currentWorkspaceId,
      }),
    onSuccess: async (forked) => {
      if (forked.selectedText) {
        window.sessionStorage.setItem(forkDraftStorageKey(forked.conversation.id), forked.selectedText);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', forked.conversation.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', forked.conversation.projectId, 'sidebar'] }),
      ]);
      navigate(`/v2/conversations/${forked.conversation.id}`);
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
    setToolsResizing(true);
    resizeStart.current = { x: event.clientX, width: toolsWidth };
    const onMove = (moveEvent: MouseEvent) => {
      if (!resizeStart.current) return;
      const delta = resizeStart.current.x - moveEvent.clientX;
      setToolsWidth(Math.max(280, Math.min(640, resizeStart.current.width + delta)));
    };
    const onUp = () => {
      resizeStart.current = null;
      setToolsResizing(false);
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

  useEffect(() => {
    if (!conversation?.id) return;
    if (readOnFocusConversation.current === conversation.id) return;
    readOnFocusConversation.current = conversation.id;
    if (conversation.unreadAt) {
      markConversationReadState.mutate(false);
    }
  }, [conversation?.id, conversation?.unreadAt, markConversationReadState]);

  useEffect(() => {
    if (!conversationId) {
      wasStreaming.current = false;
      return;
    }
    const streaming = Boolean(snapshot?.streaming);
    if (wasStreaming.current && !streaming) {
      markConversationReadState.mutate(false);
    }
    wasStreaming.current = streaming;
  }, [conversationId, snapshot?.streaming, markConversationReadState]);

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

  const closeWorkspaceSurface = useCallback(() => {
    if (mainSurface !== 'conversation') closeTab(mainSurface.index);
    setMainSurface('conversation');
  }, [closeTab, mainSurface]);

  const toggleHelperTab = useCallback((tab: V2HelperTab) => {
    if (toolsOpen && helperTab === tab) {
      setToolsOpen(false);
      return;
    }
    setHelperTab(tab);
    setToolsOpen(true);
  }, [helperTab, toolsOpen]);

  const workspaceValue = selectedWorkspaceId || conversation?.currentWorkspaceId || '';
  const sortedTerminals = [...safeTerminals].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const shell = (
    <V2Screen>
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 bg-canvas px-3 py-2 md:h-10 md:min-h-0 md:px-4 md:py-0">
        <div className="flex min-w-0 items-center gap-2 text-xs text-dim">
          <GitBranch size={14} />
          <span className="truncate font-medium text-[var(--color-text-primary)]">{activeWorkspace?.name ?? 'Workspace'}</span>
          {activeWorkspace && activeWorkspace.branchName !== activeWorkspace.name && <span className="truncate">{activeWorkspace.branchName}</span>}
          {activeWorkspace && <Badge variant="label" color={statusColor(activeWorkspace.status)}>{activeWorkspace.status}</Badge>}
          {connected ? <span className="text-[var(--color-success)]">connected</span> : connecting ? <span>connecting</span> : error ? <span className="text-[var(--color-error)]">{error}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <V2QuickActionsMenu projectId={project?.id} workspaceId={activeWorkspace?.id} disabled={!project || !activeWorkspace || activeWorkspace.status !== 'active'} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col bg-primary">
          {!activePreviewTab && (
            <div className="flex h-12 shrink-0 items-center gap-1 bg-canvas px-2 md:h-9">
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
                {safeWorkspaceConversations.map((candidate) => (
                  <ConversationTab
                    key={candidate.id}
                    conversation={candidate}
                    active={candidate.id === conversationId}
                    onSelect={() => navigate(`/v2/conversations/${candidate.id}`)}
                    onRename={(title) => renameConversation.mutate({ id: candidate.id, title })}
                  />
                ))}
                {sortedTerminals.map((terminal) => (
                  <button
                    key={terminal.id}
                    type="button"
                    onClick={() => navigate(`/v2/projects/${terminalWorkspaceProjectId(project, conversation)}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`)}
                    className="inline-flex h-[44px] max-w-[12rem] shrink-0 items-center gap-2 rounded-md px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] md:h-7 md:gap-1.5 md:px-2 md:text-xs"
                  >
                    <SquareTerminal size={13} />
                    <span className="truncate">{terminal.title || 'Terminal'}</span>
                  </button>
                ))}
              </div>
              <div className="relative shrink-0">
                <button
                  type="button"
                  disabled={!activeWorkspace || activeWorkspace.status !== 'active'}
                  onClick={() => setNewTabOpen((value) => !value)}
                  className="inline-flex h-[44px] cursor-pointer items-center justify-center rounded-md px-3 text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50 md:h-7 md:px-2"
                  title="New tab"
                >
                  <PlusCircle size={15} />
                </button>
                {newTabOpen && (
                  <>
                    <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close new tab menu" onClick={() => setNewTabOpen(false)} />
                    <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-1 shadow-[var(--shadow-card)] md:absolute md:inset-auto md:right-0 md:top-8 md:w-44">
                      <NewTabMenuItem icon={<MessageSquarePlus size={14} />} disabled={createConversation.isPending} onClick={() => { setNewTabOpen(false); createConversation.mutate(); }}>Conversation</NewTabMenuItem>
                      <NewTabMenuItem icon={<SquareTerminal size={14} />} disabled={createTerminal.isPending || !activeWorkspace} onClick={() => { setNewTabOpen(false); createTerminal.mutate(); }}>Terminal</NewTabMenuItem>
                    </div>
                  </>
                )}
              </div>
              {!toolsOpen && (
                <V2WorkspaceToolTabs
                  helperTab={helperTab}
                  toolsOpen={toolsOpen}
                  disabled={!project || !activeWorkspace}
                  onToggleHelperTab={toggleHelperTab}
                />
              )}
            </div>
          )}
          {!activePreviewTab && (
            <div className="mx-auto flex min-h-12 w-full max-w-5xl shrink-0 items-center justify-between gap-3 px-3 py-1 md:h-9 md:min-h-0 md:px-6 md:py-0">
              <div className="flex min-w-0 items-center gap-2 text-xs text-dim">
                <Sparkles size={13} />
                <span className="truncate font-medium text-[var(--color-text-primary)]">{conversation?.title ?? 'Conversation'}</span>
                {safeWorkspaceHistory.length > 1 && <span>{safeWorkspaceHistory.length} moves</span>}
              </div>
              <div className="relative flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => setConversationActionsOpen((value) => !value)} className="rounded-md px-3 py-2 text-sm text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] md:px-2 md:py-1 md:text-xs">
                  Actions
                </button>
                {conversationActionsOpen && (
                  <>
                    <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close conversation actions" onClick={() => setConversationActionsOpen(false)} />
                    <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-3 shadow-[var(--shadow-card)] md:absolute md:inset-auto md:right-0 md:top-7 md:w-80">
                      {conversation && <CompactWorkspaceMenu value={workspaceValue} workspaces={safeWorkspaces} pending={updateWorkspace.isPending} onChange={setSelectedWorkspaceId} onSave={() => updateWorkspace.mutate(workspaceValue || '')} />}
                      <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
                        <V2Input value={forkTitle} onChange={(event) => setForkTitle(event.target.value)} placeholder="Fork title" className="min-w-0 flex-1" />
                        <Button size="xs" variant="secondary" icon={<GitBranchPlus size={13} />} loading={forkConversation.isPending} onClick={() => forkConversation.mutate()} title="Fork conversation">Fork</Button>
                      </div>
                      <Button
                        className="mt-3 w-full"
                        size="xs"
                        variant="ghost"
                        icon={<CircleDot size={13} />}
                        loading={markConversationReadState.isPending}
                        onClick={() => markConversationReadState.mutate(!conversation?.unreadAt)}
                      >
                        {conversation?.unreadAt ? 'Mark read' : 'Mark unread'}
                      </Button>
                      {conversation?.status !== 'archived' && (
                        <Button className="mt-3 w-full" size="xs" variant="ghost" icon={<Archive size={13} />} disabled={transitionConversation.isPending} onClick={() => transitionConversation.mutate('archive')} title="Archive conversation">
                          Archive conversation
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeWorkspaceTab?.type === 'editor' && workspaceContextReady ? (
              <EditorTab path={activeWorkspaceTab.path} line={activeWorkspaceTab.line} onClose={closeWorkspaceSurface} />
            ) : activeWorkspaceTab?.type === 'diff' && workspaceContextReady ? (
              <DiffTab file={activeWorkspaceTab.file} staged={activeWorkspaceTab.staged} base={activeWorkspaceTab.base} commit={activeWorkspaceTab.commit} onClose={closeWorkspaceSurface} />
            ) : (
              <ConversationSurface
                conversationId={conversationId ?? ''}
                activeWorkspaceId={activeWorkspaceId ?? undefined}
                snapshot={snapshot}
                isActiveConversation={isActiveConversation}
                sending={sending}
                draft={draft}
                setDraft={setDraft}
                modelSwitching={setConversationModel.isPending}
                forkPending={forkConversationFromMessage.isPending}
                onSetModel={(provider, modelId) => setConversationModel.mutate({ provider, modelId })}
                onForkFromMessage={(entryId) => forkConversationFromMessage.mutate({ entryId })}
                abort={() => void abort()}
                submit={() => void handleSubmit()}
              />
            )}
          </div>
        </section>

        <V2WorkspaceToolsSurface
          open={toolsOpen}
          width={toolsWidth}
          resizing={toolsResizing}
          helperTab={helperTab}
          disabled={!project || !activeWorkspace}
          onToggleHelperTab={toggleHelperTab}
          onResizeStart={beginResize}
        >
          {activeWorkspace && project ? (
            <V2WorkspaceTools helperTab={helperTab} />
          ) : (
            <V2Empty icon={<Wrench size={24} />} title="No workspace tools yet" body="Attach this conversation to a workspace to inspect files, search, and git changes." />
          )}
        </V2WorkspaceToolsSurface>
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
  conversationId,
  activeWorkspaceId,
  snapshot,
  isActiveConversation,
  sending,
  draft,
  setDraft,
  modelSwitching,
  forkPending,
  onSetModel,
  onForkFromMessage,
  abort,
  submit,
}: {
  conversationId: string;
  activeWorkspaceId?: string;
  snapshot: PiConversationSnapshot | null;
  isActiveConversation: boolean;
  sending: boolean;
  draft: string;
  setDraft: (draft: string) => void;
  modelSwitching: boolean;
  forkPending: boolean;
  onSetModel: (provider: string, modelId: string) => void;
  onForkFromMessage: (entryId: string) => void;
  abort: () => void;
  submit: () => void;
}) {
  const isMobile = useMobile();
  const { keyboardVisible, keyboardHeight } = useVirtualKeyboard();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [selection, setSelection] = useState<InputSelection>({ start: 0, end: 0 });
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [dismissedTokenKey, setDismissedTokenKey] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [fileIndexRequested, setFileIndexRequested] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const composerStyle = isMobile && keyboardVisible
    ? { paddingBottom: keyboardHeight + 12 }
    : undefined;
  const messages = snapshot?.messages ?? [];
  const pendingVisible = hasPendingAssistant(snapshot);
  const shouldCollapseHistory = messages.length > 1 && !snapshot?.streaming && !pendingVisible;
  const collapsedMessages = shouldCollapseHistory ? messages.slice(0, -1) : [];
  const visibleMessages = shouldCollapseHistory ? messages.slice(-1) : messages;
  const modelValue = snapshot?.model ? modelOptionValue(snapshot.model.provider, snapshot.model.id) : '';

  const { data: fileEntries = [], isFetching: filesLoading } = useQuery({
    queryKey: ['v2-workspace-file-index', activeWorkspaceId],
    queryFn: async () => {
      const response = await v2Api.listFiles(activeWorkspaceId!, { depth: FILE_INDEX_DEPTH });
      return response.entries;
    },
    enabled: Boolean(activeWorkspaceId && fileIndexRequested),
    staleTime: 30_000,
  });
  const { data: commandResponse } = useQuery({
    queryKey: ['v2-conversation-commands', conversationId],
    queryFn: () => v2Api.listConversationCommands(conversationId),
    enabled: Boolean(conversationId && isActiveConversation),
    staleTime: 60_000,
  });
  const { data: modelResponse, isFetching: modelsLoading } = useQuery({
    queryKey: ['v2-conversation-models', conversationId],
    queryFn: () => v2Api.listConversationModels(conversationId),
    enabled: Boolean(conversationId && isActiveConversation),
    staleTime: 60_000,
  });

  const activeToken = useMemo(
    () => findActiveToken(draft, selection, ['/', '@']),
    [draft, selection],
  );
  const tokenKey = activeToken ? `${activeToken.start}:${activeToken.end}:${activeToken.token}` : null;
  const slashCommands = useMemo(() => {
    const byName = new Map<string, PiSlashCommand>();
    for (const command of FALLBACK_PI_COMMANDS) byName.set(command.name, command);
    for (const command of commandResponse?.commands ?? []) byName.set(command.name, command);
    return Array.from(byName.values());
  }, [commandResponse?.commands]);
  const models = useMemo(() => {
    const all = modelResponse?.models ?? [];
    if (!snapshot?.model) return all;
    if (all.some((model) => model.provider === snapshot.model?.provider && model.id === snapshot.model?.id)) return all;
    return [{ provider: snapshot.model.provider, id: snapshot.model.id }, ...all];
  }, [modelResponse?.models, snapshot]);
  const suggestions = useMemo<ComposerSuggestion[]>(() => {
    if (!activeToken) return [];

    if (activeToken.prefix === '/') {
      const query = activeToken.query.toLowerCase();
      return slashCommands
        .filter((command) => query === '' || command.name.toLowerCase().includes(query))
        .slice(0, MAX_SUGGESTIONS)
        .map((command) => ({
          key: `slash:${command.name}`,
          type: 'slash',
          label: `/${command.name}`,
          detail: command.description || command.source || 'Pi command',
          value: `/${command.name}`,
          addSpace: true,
          icon: 'command',
        }));
    }

    if (activeToken.prefix === '@') {
      if (filesLoading && fileEntries.length === 0) {
        return [{
          key: 'files:loading',
          type: 'file',
          label: 'Indexing files...',
          detail: 'Preparing workspace suggestions',
          value: '@',
          addSpace: false,
          disabled: true,
          icon: 'file',
        }];
      }
      const query = activeToken.query.trim();
      return fileEntries
        .map((entry) => ({
          entry,
          score: query ? fuzzyScore(entry.path, query) : 1000 - entry.path.length,
        }))
        .filter((item) => item.score >= 0)
        .sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          if (a.entry.type !== b.entry.type) return a.entry.type === 'dir' ? -1 : 1;
          return a.entry.path.localeCompare(b.entry.path);
        })
        .slice(0, MAX_SUGGESTIONS)
        .map(({ entry }) => fileSuggestion(entry));
    }

    return [];
  }, [activeToken, fileEntries, filesLoading, slashCommands]);
  const visibleSuggestions = useMemo(
    () => (tokenKey && dismissedTokenKey !== tokenKey ? suggestions : []),
    [dismissedTokenKey, suggestions, tokenKey],
  );

  useEffect(() => {
    if (activeToken?.prefix === '@') {
      setFileIndexRequested(true);
    }
  }, [activeToken?.prefix]);

  useEffect(() => {
    setSelectedSuggestionIndex(findFirstEnabledSuggestionIndex(visibleSuggestions));
  }, [tokenKey, visibleSuggestions]);

  useEffect(() => {
    const node = suggestionRefs.current[selectedSuggestionIndex];
    if (!node) return;
    node.scrollIntoView({ block: 'nearest' });
  }, [selectedSuggestionIndex, visibleSuggestions.length]);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    const minHeight = isMobile ? 96 : 118;
    const maxHeight = isMobile ? 180 : 260;
    node.style.height = '0px';
    node.style.height = `${Math.min(maxHeight, Math.max(minHeight, node.scrollHeight))}px`;
  }, [draft, isMobile]);

  const setDraftWithSelection = (nextDraft: string, nextSelection?: InputSelection) => {
    setDraft(nextDraft);
    if (nextSelection) setSelection(nextSelection);
    setDismissedTokenKey(null);
  };

  const applyComposerSuggestion = (suggestion: ComposerSuggestion) => {
    if (suggestion.disabled) return;
    const next = applySuggestionToText(draft, selection, suggestion.value, ['/', '@'], suggestion.addSpace);
    setDraftWithSelection(next.text, { start: next.cursor, end: next.cursor });
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const insertTrigger = (trigger: '/' | '@') => {
    const node = textareaRef.current;
    const start = node?.selectionStart ?? selection.start;
    const end = node?.selectionEnd ?? selection.end;
    const previous = start > 0 ? draft[start - 1] : '';
    const insertValue = `${previous && !/\s/.test(previous) ? ' ' : ''}${trigger}`;
    const nextDraft = `${draft.slice(0, start)}${insertValue}${draft.slice(end)}`;
    const cursor = start + insertValue.length;
    if (trigger === '@') setFileIndexRequested(true);
    setDraftWithSelection(nextDraft, { start: cursor, end: cursor });
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const copyMessage = async (message: PiConversationMessage) => {
    const text = messageCopyText(message);
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedMessageId(message.id);
    window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1200);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-3 py-4 md:px-6 md:py-5">
        {messages.length ? (
          <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
            {collapsedMessages.length > 0 && (
              <CollapsedPreviousMessages
                messages={collapsedMessages}
                copiedMessageId={copiedMessageId}
                onCopy={(message) => void copyMessage(message)}
              />
            )}
            {visibleMessages.map((message, index) => (
              <MessageRow
                key={message.id || `${message.role}-${index}`}
                message={message}
                copied={copiedMessageId === message.id}
                forkPending={forkPending}
                onCopy={() => void copyMessage(message)}
                onForkFromMessage={onForkFromMessage}
              />
            ))}
            {pendingVisible && <PendingAssistant snapshot={snapshot} />}
          </div>
        ) : (
          <V2Empty
            icon={<Sparkles size={28} />}
            title="Start with a prompt"
            body="This conversation is attached to the current workspace."
          />
        )}
      </div>

      <div className="shrink-0 bg-primary px-3 pb-3 md:px-6 md:pb-5" style={composerStyle}>
        <div className={`relative mx-auto max-w-5xl overflow-visible rounded-[1.35rem] border bg-card shadow-[0_18px_60px_rgba(15,23,42,0.12)] transition-colors ${
          inputFocused ? 'border-accent/70' : 'border-subtle'
        }`}>
          {visibleSuggestions.length > 0 && (
            <div className="absolute bottom-full left-3 right-3 z-30 mb-2 overflow-hidden rounded-xl border border-subtle bg-card shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between border-b border-subtle px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-dim">
                <span>{activeToken?.prefix === '@' ? 'Workspace files' : 'Pi commands'}</span>
                {!isMobile && <span className="normal-case tracking-normal">Arrows, Enter, Esc</span>}
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {visibleSuggestions.map((suggestion, index) => {
                  const selected = index === selectedSuggestionIndex;
                  return (
                    <button
                      key={suggestion.key}
                      ref={(el) => { suggestionRefs.current[index] = el; }}
                      type="button"
                      disabled={Boolean(suggestion.disabled)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyComposerSuggestion(suggestion)}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
                        selected ? 'bg-accent/10' : 'hover:bg-secondary'
                      } ${suggestion.disabled ? 'cursor-default opacity-70' : ''}`}
                    >
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-subtle bg-primary">
                        {suggestionIcon(suggestion.icon)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[var(--color-text-primary)]">{suggestion.label}</span>
                        {suggestion.detail && <span className="block truncate text-[10px] text-dim">{suggestion.detail}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setDraftWithSelection(event.target.value, {
                start: event.target.selectionStart,
                end: event.target.selectionEnd,
              });
            }}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onClick={(event) => {
              const target = event.target as HTMLTextAreaElement;
              setSelection({ start: target.selectionStart, end: target.selectionEnd });
            }}
            onSelect={(event) => {
              const target = event.target as HTMLTextAreaElement;
              setSelection({ start: target.selectionStart, end: target.selectionEnd });
            }}
            onKeyDown={(event) => {
              if (visibleSuggestions.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSelectedSuggestionIndex((current) => nextEnabledSuggestionIndex(visibleSuggestions, current, 1));
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSelectedSuggestionIndex((current) => nextEnabledSuggestionIndex(visibleSuggestions, current, -1));
                  return;
                }
                if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
                  const suggestion = visibleSuggestions[selectedSuggestionIndex] ?? visibleSuggestions.find((item) => !item.disabled);
                  if (suggestion && !suggestion.disabled) {
                    event.preventDefault();
                    applyComposerSuggestion(suggestion);
                    return;
                  }
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDismissedTokenKey(tokenKey);
                  return;
                }
              }
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
              if (event.key === 'Escape') {
                textareaRef.current?.blur();
              }
            }}
            placeholder={isActiveConversation ? 'Send a prompt to Pi...' : 'Resume the conversation before sending a prompt'}
            disabled={!isActiveConversation || sending}
            className="block w-full resize-none rounded-t-[1.35rem] bg-transparent px-4 pt-4 text-sm leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-dim disabled:opacity-60 md:px-5 md:pt-5"
          />

          <div className="flex min-h-12 items-center justify-between gap-3 border-t border-subtle/70 px-3 py-2 md:px-4">
            <div className="flex min-w-0 items-center gap-1.5">
              <button type="button" onClick={() => insertTrigger('@')} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]" title="Add workspace context" aria-label="Add workspace context">
                <Plus size={17} />
              </button>
              <button type="button" onClick={() => insertTrigger('/')} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]" title="Pi command" aria-label="Pi command">
                <Slash size={15} />
              </button>
              <button type="button" onClick={() => insertTrigger('@')} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]" title="Mention file" aria-label="Mention file">
                <AtSign size={15} />
              </button>
              <span className="hidden text-xs text-dim sm:inline">Cmd/Ctrl Enter</span>
            </div>

            <div className="flex min-w-0 shrink-0 items-center gap-2">
              {snapshot?.streaming && (
                <button type="button" onClick={abort} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-error)] hover:bg-[var(--color-error)]/10" title="Abort" aria-label="Abort">
                  <Square size={13} />
                </button>
              )}
              <div className="relative max-w-[12rem]">
                {modelsLoading || modelSwitching ? (
                  <Loader2 size={14} className="absolute left-2 top-1/2 -translate-y-1/2 animate-spin text-dim" />
                ) : null}
                <select
                  value={modelValue}
                  onChange={(event) => {
                    const [provider, modelId] = parseModelOptionValue(event.target.value);
                    if (provider && modelId) onSetModel(provider, modelId);
                  }}
                  disabled={!isActiveConversation || sending || modelSwitching || models.length === 0}
                  className="h-8 max-w-full rounded-full border border-transparent bg-transparent px-2 pr-7 text-xs text-[var(--color-text-secondary)] outline-none hover:bg-secondary disabled:opacity-50"
                  title="Model"
                >
                  {modelValue === '' && <option value="">Model</option>}
                  {models.map((model) => (
                    <option key={modelOptionValue(model.provider, model.id)} value={modelOptionValue(model.provider, model.id)}>
                      {modelLabel(model)}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="hidden h-8 w-8 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)] sm:inline-flex" title="Voice input" aria-label="Voice input" disabled>
                <Mic size={15} />
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!draft.trim() || !isActiveConversation || sending}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-card)] shadow-sm transition-transform hover:scale-[1.03] disabled:scale-100 disabled:opacity-35"
                title="Send"
                aria-label="Send"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  copied,
  compact = false,
  forkPending = false,
  onCopy,
  onForkFromMessage,
}: {
  message: PiConversationMessage;
  copied: boolean;
  compact?: boolean;
  forkPending?: boolean;
  onCopy: () => void;
  onForkFromMessage?: (entryId: string) => void;
}) {
  const isUser = message.role === 'user';
  if (isToolMessage(message)) {
    return <ToolResultRow message={message} compact={compact} />;
  }

  if (isUser) {
    return (
      <div className="group flex justify-end">
        <div className="max-w-[90%] md:max-w-[min(74%,46rem)]">
          <MessageActions
            copied={copied}
            canFork={Boolean(message.entryId && onForkFromMessage && !compact)}
            forkPending={forkPending}
            onCopy={onCopy}
            onFork={() => message.entryId && onForkFromMessage?.(message.entryId)}
          />
          <div className="rounded-2xl rounded-br-md bg-[var(--color-accent)]/10 px-4 py-3 text-sm text-[var(--color-text-primary)]">
            {message.text && <MarkdownRenderer>{message.text}</MarkdownRenderer>}
            <ToolCallSummary message={message} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <article className={`group w-full text-sm leading-6 ${message.isError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]'}`}>
      <MessageActions copied={copied} onCopy={onCopy} />
      {message.thinking && <CollapsibleEvent icon={<Sparkles size={14} />} title="Thinking" body={message.thinking} />}
      {message.text && <MarkdownRenderer>{message.text}</MarkdownRenderer>}
      <ToolCallSummary message={message} />
    </article>
  );
}

function CollapsedPreviousMessages({
  messages,
  copiedMessageId,
  onCopy,
}: {
  messages: PiConversationMessage[];
  copiedMessageId: string | null;
  onCopy: (message: PiConversationMessage) => void;
}) {
  return (
    <details className="group rounded-2xl border border-subtle bg-card/85 shadow-sm">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm text-dim">
        <span>{messages.length} previous {messages.length === 1 ? 'message' : 'messages'}</span>
        <ChevronDown size={15} className="ml-auto transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-subtle px-4 py-4">
        {messages.map((message, index) => (
          <MessageRow
            key={message.id || `${message.role}-${index}`}
            message={message}
            compact
            copied={copiedMessageId === message.id}
            onCopy={() => onCopy(message)}
          />
        ))}
      </div>
    </details>
  );
}

function MessageActions({
  copied,
  canFork = false,
  forkPending = false,
  onCopy,
  onFork,
}: {
  copied: boolean;
  canFork?: boolean;
  forkPending?: boolean;
  onCopy: () => void;
  onFork?: () => void;
}) {
  return (
    <div className="mb-1 flex h-7 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <button type="button" onClick={onCopy} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]" title="Copy message" aria-label="Copy message">
        {copied ? <Check size={14} /> : <Clipboard size={14} />}
      </button>
      {canFork && (
        <button type="button" onClick={onFork} disabled={forkPending} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-dim hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-50" title="Edit in fork" aria-label="Edit in fork">
          {forkPending ? <Loader2 size={14} className="animate-spin" /> : <GitBranchPlus size={14} />}
        </button>
      )}
    </div>
  );
}

function ToolResultRow({ message, compact }: { message: PiConversationMessage; compact?: boolean }) {
  return (
    <details className={`group rounded-xl border border-subtle bg-inset text-xs ${compact ? '' : 'mx-0'}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-dim">
        <Wrench size={13} />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-text-secondary)]">{toolMessageTitle(message)}</span>
        {message.isError && <span className="text-[var(--color-error)]">error</span>}
        <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
      </summary>
      {message.text && (
        <div className="border-t border-subtle px-3 py-2 text-[var(--color-text-secondary)]">
          {message.text && <MarkdownRenderer>{message.text}</MarkdownRenderer>}
        </div>
      )}
    </details>
  );
}

function PendingAssistant({ snapshot }: { snapshot: PiConversationSnapshot | null }) {
  if (!snapshot) return null;
  return (
    <article className="space-y-3 text-sm leading-6 text-[var(--color-text-primary)]">
      {snapshot.pending?.thinking && <CollapsibleEvent icon={<Sparkles size={14} />} title="Thinking" body={snapshot.pending.thinking} />}
      {snapshot.pending?.text && <MarkdownRenderer>{snapshot.pending.text}</MarkdownRenderer>}
      <ToolCallsList toolCalls={snapshot.pending?.toolCalls ?? []} />
      <ToolExecutionList tools={snapshot.tools ?? []} />
      {snapshot.streaming && !snapshot.pending?.text && !snapshot.pending?.thinking && (
        <div className="flex items-center gap-2 text-xs text-dim">
          <Loader2 size={13} className="animate-spin" />
          <span>Pi is working...</span>
        </div>
      )}
    </article>
  );
}

function ToolExecutionList({ tools }: { tools: PiToolExecution[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="space-y-2">
      {tools.map((tool) => (
        <details key={tool.toolCallId || tool.toolName} className="group rounded-lg bg-inset px-3 py-2 text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-dim">
            {tool.status === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
            <span className="font-medium text-[var(--color-text-secondary)]">{tool.toolName || 'Tool'}</span>
            <span>{tool.status}</span>
            {tool.isError && <span className="text-[var(--color-error)]">error</span>}
            <ChevronDown size={13} className="ml-auto transition-transform group-open:rotate-180" />
          </summary>
          {tool.output && <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-primary p-2 font-mono text-[11px] text-[var(--color-text-secondary)]">{tool.output}</pre>}
        </details>
      ))}
    </div>
  );
}

function ToolCallSummary({ message }: { message: PiConversationMessage }) {
  return <ToolCallsList toolCalls={message.toolCalls ?? []} />;
}

function ToolCallsList({ toolCalls }: { toolCalls: NonNullable<PiConversationMessage['toolCalls']> }) {
  if (toolCalls.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {toolCalls.map((tool, index) => (
        <details key={tool.id || index} className="group rounded-lg bg-inset px-3 py-2 text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-dim">
            <Wrench size={13} />
            <span className="font-medium text-[var(--color-text-secondary)]">{tool.name || 'Tool call'}</span>
            <span>call</span>
            <ChevronDown size={13} className="ml-auto transition-transform group-open:rotate-180" />
          </summary>
          {tool.arguments && <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-primary p-2 font-mono text-[11px] text-[var(--color-text-secondary)]">{tool.arguments}</pre>}
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

function hasPendingAssistant(snapshot: PiConversationSnapshot | null): boolean {
  if (!snapshot) return false;
  return Boolean(
    snapshot.streaming
      || snapshot.pending?.text
      || snapshot.pending?.thinking
      || (snapshot.pending?.toolCalls?.length ?? 0) > 0
      || (snapshot.tools?.some((tool) => tool.status === 'running') ?? false),
  );
}

function isToolMessage(message: PiConversationMessage): boolean {
  return message.role === 'toolResult' || message.role === 'bashExecution' || Boolean(message.toolName);
}

function toolMessageTitle(message: PiConversationMessage): string {
  if (message.toolName) return `Tool result: ${message.toolName}`;
  if (message.role === 'bashExecution') return 'Bash execution';
  return `Tool response: ${message.role}`;
}

function messageCopyText(message: PiConversationMessage): string {
  return [message.thinking, message.text].filter(Boolean).join('\n\n').trim();
}

function modelOptionValue(provider: string, id: string): string {
  return JSON.stringify([provider, id]);
}

function parseModelOptionValue(value: string): [string, string] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return ['', ''];
    const [provider, id] = parsed;
    return [typeof provider === 'string' ? provider : '', typeof id === 'string' ? id : ''];
  } catch {
    return ['', ''];
  }
}

function modelLabel(model: PiAvailableModel): string {
  return model.provider ? `${model.id} (${model.provider})` : model.id;
}

function fileSuggestion(entry: V2FileEntry): ComposerSuggestion {
  const pathValue = entry.type === 'dir' ? `${entry.path}/` : entry.path;
  return {
    key: `file:${entry.path}`,
    type: 'file',
    label: `@${pathValue}`,
    detail: entry.type === 'dir' ? 'Directory' : 'File',
    value: `@${pathValue}`,
    addSpace: entry.type !== 'dir',
    icon: entry.type === 'dir' ? 'folder' : 'file',
  };
}

function suggestionIcon(icon: ComposerSuggestion['icon']) {
  if (icon === 'command') return <Command size={13} className="text-accent" />;
  if (icon === 'folder') return <FolderTree size={13} className="text-amber-500" />;
  return <FileCode2 size={13} className="text-accent" />;
}

function findFirstEnabledSuggestionIndex(suggestions: ComposerSuggestion[]): number {
  const index = suggestions.findIndex((suggestion) => !suggestion.disabled);
  return index >= 0 ? index : 0;
}

function nextEnabledSuggestionIndex(suggestions: ComposerSuggestion[], current: number, direction: 1 | -1): number {
  if (suggestions.length === 0) return 0;
  let next = current;
  for (let i = 0; i < suggestions.length; i += 1) {
    next = (next + direction + suggestions.length) % suggestions.length;
    if (!suggestions[next].disabled) return next;
  }
  return current;
}

function forkDraftStorageKey(conversationId: string): string {
  return `codeburg:v2-fork-draft:${conversationId}`;
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
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-1">
      <V2Select value={value} onChange={(event) => onChange(event.target.value)} className="w-full md:w-48">
        <option value="">Project default</option>
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
        ))}
      </V2Select>
      <Button size="xs" variant="ghost" loading={pending} onClick={onSave} title="Attach conversation to selected workspace">
        Save
      </Button>
    </div>
  );
}

function NewTabMenuItem({ icon, children, disabled, onClick }: { icon: ReactNode; children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50 md:min-h-0 md:text-xs"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function ConversationTab({
  conversation,
  active,
  onSelect,
  onRename,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);

  useEffect(() => {
    setDraft(conversation.title);
  }, [conversation.title]);

  const save = () => {
    const title = draft.trim();
    setEditing(false);
    if (title && title !== conversation.title) onRename(title);
    else setDraft(conversation.title);
  };

  return (
    <div className={`inline-flex h-[44px] max-w-[15rem] shrink-0 items-center gap-2 rounded-md px-3 text-sm md:h-7 md:gap-1.5 md:px-2 md:text-xs ${
      active
        ? 'bg-[var(--color-card-hover)] text-[var(--color-text-primary)]'
        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]'
    }`}>
      <MessageSquareText size={13} className="shrink-0" />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
            if (event.key === 'Escape') {
              setEditing(false);
              setDraft(conversation.title);
            }
          }}
          className="h-8 min-w-0 bg-transparent outline-none md:h-6"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={() => setEditing(true)}
          className="flex h-full min-w-0 items-center truncate text-left"
          title="Double-click to rename"
        >
          {conversation.title}
        </button>
      )}
    </div>
  );
}

function terminalWorkspaceProjectId(project?: { id: string } | null, conversation?: { projectId: string } | null) {
  return project?.id ?? conversation?.projectId ?? '';
}

function statusColor(status: Workspace['status']): 'blue' | 'green' | 'yellow' | 'gray' {
  if (status === 'active') return 'blue';
  if (status === 'merged') return 'green';
  if (status === 'abandoned') return 'yellow';
  return 'gray';
}

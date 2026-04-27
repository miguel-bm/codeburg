import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, Dispatch, DragEvent, ReactNode, SetStateAction } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowUp,
  AtSign,
  Brain,
  Check,
  ChevronDown,
  Clipboard,
  Command,
  Download,
  FileCode2,
  FolderTree,
  GitBranch,
  GitBranchPlus,
  Image as ImageIcon,
  Loader2,
  Mic,
  MessageSquarePlus,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  PlusCircle,
  RefreshCw,
  Search,
  Slash,
  Sparkles,
  Square,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { Conversation, PiAvailableModel, PiConversationImageAttachment, PiConversationMessage, PiConversationSessionStats, PiConversationSnapshot, PiThinkingLevel, PiToolExecution, TerminalSession, Workspace } from '../../api/types';
import { v2Api, type V2FileEntry } from '../../api/v2';
import { MarkdownRenderer } from '../../components/ui/MarkdownRenderer';
import { Modal } from '../../components/ui/Modal';
import { DiffTab } from '../../components/workspace/DiffTab';
import { EditorTab } from '../../components/workspace/EditorTab';
import { WorkspaceProvider } from '../../components/workspace/WorkspaceContext';
import { useMobile } from '../../hooks/useMobile';
import { usePiConversation } from '../../hooks/usePiConversation';
import { useVirtualKeyboard } from '../../hooks/useVirtualKeyboard';
import { useWorkspaceStore } from '../../stores/workspace';
import { applySuggestionToText, findActiveToken, fuzzyScore, type InputSelection } from '../../components/chat/chatAutocomplete';
import { Button, V2Empty, V2Screen } from './v2-ui';
import { V2WorkspaceActionHeader } from './V2WorkspaceActionHeader';
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

interface ComposerAttachment {
  id: string;
  name: string;
  previewUrl: string;
  image: PiConversationImageAttachment;
}

type ConversationRenderItem =
  | { type: 'message'; message: PiConversationMessage }
  | { type: 'collapsed'; messages: PiConversationMessage[] };

const MAX_SUGGESTIONS = 8;
const FILE_INDEX_DEPTH = 12;
const THINKING_LEVELS: PiThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

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
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [runtimeRequested, setRuntimeRequested] = useState(false);
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | undefined | null>(null);
  const [helperTab, setHelperTab] = useState<V2HelperTab>('files');
  const [toolsOpen, setToolsOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  const [toolsWidth, setToolsWidth] = useState(360);
  const [toolsResizing, setToolsResizing] = useState(false);
  const [mainSurface, setMainSurface] = useState<MainSurface>('conversation');
  const [newTabOpen, setNewTabOpen] = useState(false);
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

  const isActiveConversation = conversation?.status === 'active';
  const shouldConnectRuntime = isActiveConversation && (runtimeRequested || Boolean(stateSnapshot?.runtimeActive));
  const activateRuntime = runtimeRequested && !stateSnapshot?.runtimeActive;
  const { snapshot: liveSnapshot, connected, connecting, error, sendMessage, abort, applySnapshot } = usePiConversation(conversationId ?? '', shouldConnectRuntime, { activate: activateRuntime });
  const snapshot: PiConversationSnapshot | null = liveSnapshot ?? stateSnapshot ?? null;
  const safeWorkspaces = useMemo(() => Array.isArray(workspaces) ? workspaces : [], [workspaces]);
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
    setRuntimeRequested(false);
    setSendError(null);
  }, [conversationId, activeWorkspace?.id, resetWorkspaceTabs]);

  useEffect(() => {
    if (stateSnapshot?.runtimeActive) {
      setRuntimeRequested(true);
    }
  }, [stateSnapshot?.runtimeActive]);

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

  useEffect(() => {
    if (isMobile && activePreviewTab && toolsOpen) {
      setToolsOpen(false);
    }
  }, [activePreviewTab, isMobile, toolsOpen]);

  const updateWorkspace = useMutation({
    mutationFn: (currentWorkspaceId?: string) => v2Api.switchConversationWorkspace(conversationId!, { currentWorkspaceId }),
    onSuccess: async (updated) => {
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
        title: `${conversation?.title ?? 'Conversation'} fork`,
        currentWorkspaceId: activeWorkspaceId ?? conversation?.currentWorkspaceId,
      }),
    onSuccess: async (forked) => {
      if (activeWorkspaceId) {
        queryClient.setQueryData<Conversation[]>(['v2-workspace-conversations', activeWorkspaceId], (current = []) => (
          current.some((candidate) => candidate.id === forked.id) ? current : [forked, ...current]
        ));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', forked.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', forked.projectId, 'sidebar'] }),
      ]);
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
      if (activeWorkspaceId) {
        queryClient.setQueryData<Conversation[]>(['v2-workspace-conversations', activeWorkspaceId], (current = []) => (
          current.some((candidate) => candidate.id === forked.conversation.id) ? current : [forked.conversation, ...current]
        ));
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

  const syncWorkspace = useMutation({
    mutationFn: (workspaceId: string) => v2Api.syncWorkspace(workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2-workspaces', conversation?.projectId] });
    },
  });

  const mutateWorkspaceStatus = useMutation({
    mutationFn: ({ workspaceId, action, mergeInput }: { workspaceId: string; action: 'activate' | 'merge' | 'abandon' | 'archive'; mergeInput?: Parameters<typeof v2Api.mergeWorkspace>[1] }) => {
      if (action === 'activate') return v2Api.activateWorkspace(workspaceId);
      if (action === 'merge') return v2Api.mergeWorkspace(workspaceId, mergeInput ?? { cleanupWorktree: true });
      if (action === 'abandon') return v2Api.abandonWorkspace(workspaceId, { cleanupWorktree: true });
      return v2Api.archiveWorkspace(workspaceId, { cleanupWorktree: true });
    },
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-workspaces', updated.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-terminals', updated.id] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversation', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversation-workspaces', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId, 'sidebar'] }),
      ]);
    },
  });

  const deleteWorkspace = useMutation({
    mutationFn: (workspaceId: string) => v2Api.deleteWorkspace(workspaceId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-workspaces', conversation?.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversation', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversation-workspaces', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', conversation?.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', conversation?.projectId, 'sidebar'] }),
      ]);
    },
  });

  const resolveConflictWithAgent = useMutation({
    mutationFn: async (target: 'current' | 'new') => {
      if (!activeWorkspaceId || !conversation?.projectId || !conversationId) throw new Error('No active workspace');
      const context = await v2Api.getWorkspaceConflictContext(activeWorkspaceId);
      if (target === 'current') {
        const snapshot = await v2Api.promptConversation(conversationId, { message: context.prompt });
        return { target, snapshot };
      }
      const created = await v2Api.createConversation(conversation.projectId, {
        title: `Resolve ${activeWorkspace?.name ?? 'workspace'} conflicts`,
        currentWorkspaceId: activeWorkspaceId,
      });
      await v2Api.promptConversation(created.id, { message: context.prompt });
      return { target, conversation: created };
    },
    onSuccess: async (result) => {
      if (result.target === 'current') {
        applySnapshot(result.snapshot);
        setMainSurface('conversation');
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', result.conversation.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', result.conversation.projectId, 'sidebar'] }),
      ]);
      navigate(`/v2/conversations/${result.conversation.id}`);
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

  const handleSubmit = async (streamingBehavior?: 'steer' | 'followUp') => {
    const trimmed = draft.trim();
    if ((!trimmed && attachments.length === 0) || !conversationId) return;
    if (!isActiveConversation) return;
    if (snapshot?.streaming && !streamingBehavior) return;
    setRuntimeRequested(true);
    setSendError(null);
    setSending(true);
    try {
      await sendMessage(trimmed, attachments.map(({ image }) => image), streamingBehavior);
      setDraft('');
      setAttachments([]);
      setMainSurface('conversation');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send prompt');
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

  const pendingWorkspace = typeof pendingWorkspaceId === 'string'
    ? safeWorkspaces.find((workspace) => workspace.id === pendingWorkspaceId) ?? null
    : null;
  const mobileConversations = conversation && !safeWorkspaceConversations.some((candidate) => candidate.id === conversation.id)
    ? [conversation, ...safeWorkspaceConversations]
    : safeWorkspaceConversations;
  const sortedTerminals = [...safeTerminals].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const workspaceActionPending =
    syncWorkspace.isPending ||
    mutateWorkspaceStatus.isPending ||
    deleteWorkspace.isPending ||
    resolveConflictWithAgent.isPending;
  const shell = (
    <V2Screen>
      {project && activeWorkspace ? (
        <V2WorkspaceActionHeader
          project={project}
          workspace={activeWorkspace}
          pending={workspaceActionPending}
          currentConversationAvailable={Boolean(conversationId && isActiveConversation)}
          detail={connected ? <span className="text-[var(--color-success)]">connected</span> : connecting ? <span>connecting</span> : error ? <span className="text-[var(--color-error)]">{error}</span> : null}
          onUpdateFromBase={() => syncWorkspace.mutate(activeWorkspace.id)}
          onMerge={(mergeInput) => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'merge', mergeInput })}
          onCloseWithoutMerging={() => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'abandon' })}
          onReactivate={() => mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'activate' })}
          onArchive={() => {
            if (window.confirm(`Archive "${activeWorkspace.name}" and clean up its local worktree?`)) {
              mutateWorkspaceStatus.mutate({ workspaceId: activeWorkspace.id, action: 'archive' });
            }
          }}
          onDelete={() => {
            if (window.confirm(`Delete workspace "${activeWorkspace.name}"? This removes the workspace record and local worktree.`)) {
              deleteWorkspace.mutate(activeWorkspace.id);
            }
          }}
          onOpenGitPanel={() => {
            setHelperTab('git');
            setToolsOpen(true);
          }}
          onResolveConflicts={(target) => resolveConflictWithAgent.mutate(target)}
        />
      ) : (
        <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 bg-canvas px-3 py-2 md:h-10 md:min-h-0 md:px-4 md:py-0">
          <div className="flex min-w-0 items-center gap-2 text-xs text-dim">
            <GitBranch size={14} />
            <span className="truncate font-medium text-[var(--color-text-primary)]">Workspace</span>
            {connected ? <span className="text-[var(--color-success)]">connected</span> : connecting ? <span>connecting</span> : error ? <span className="text-[var(--color-error)]">{error}</span> : null}
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col bg-primary">
          {!activePreviewTab && !isMobile && (
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
          {!activePreviewTab && isMobile && (
            <MobileConversationSurfaceBar
              conversations={mobileConversations}
              activeConversationId={conversationId}
              terminals={sortedTerminals}
              projectId={terminalWorkspaceProjectId(project, conversation)}
              onSelectConversation={(candidate) => navigate(`/v2/conversations/${candidate.id}`)}
              onSelectTerminal={(terminal) => navigate(`/v2/projects/${terminalWorkspaceProjectId(project, conversation)}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`)}
              onCreateConversation={() => createConversation.mutate()}
              onCreateTerminal={() => createTerminal.mutate()}
              createConversationPending={createConversation.isPending}
              createTerminalPending={createTerminal.isPending}
              createTerminalDisabled={!activeWorkspace || activeWorkspace.status !== 'active'}
              helperTab={helperTab}
              toolsOpen={toolsOpen}
              toolsDisabled={!project || !activeWorkspace}
              onToggleHelperTab={toggleHelperTab}
            />
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
                attachments={attachments}
                setAttachments={setAttachments}
                sendError={sendError}
                modelSwitching={setConversationModel.isPending}
                forkPending={forkConversationFromMessage.isPending}
                onSetModel={(provider, modelId) => setConversationModel.mutate({ provider, modelId })}
                onForkFromMessage={(entryId) => forkConversationFromMessage.mutate({ entryId })}
                workspaces={safeWorkspaces}
                activeWorkspace={attachedWorkspace ?? null}
                movePending={updateWorkspace.isPending}
                forkConversationPending={forkConversation.isPending}
                archivePending={transitionConversation.isPending}
                archiveDisabled={conversation?.status === 'archived'}
                onRequestWorkspaceChange={(workspaceId) => setPendingWorkspaceId(workspaceId)}
                onForkConversation={() => forkConversation.mutate()}
                onArchiveConversation={() => transitionConversation.mutate('archive')}
                abort={() => void abort()}
                submit={(streamingBehavior) => void handleSubmit(streamingBehavior)}
                onOpenPiSettings={() => {
                  if (conversation?.projectId) navigate(`/v2/projects/${conversation.projectId}/settings`);
                }}
                onApplySnapshot={applySnapshot}
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
      <Modal
        open={pendingWorkspaceId !== null}
        onClose={() => setPendingWorkspaceId(null)}
        title="Move conversation"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button size="xs" variant="ghost" onClick={() => setPendingWorkspaceId(null)}>Cancel</Button>
            <Button
              size="xs"
              loading={updateWorkspace.isPending}
              onClick={() => {
                if (pendingWorkspaceId === null) return;
                updateWorkspace.mutate(pendingWorkspaceId, {
                  onSuccess: () => setPendingWorkspaceId(null),
                });
              }}
            >
              Move
            </Button>
          </div>
        }
      >
        <div className="px-5 py-4 text-sm leading-6 text-[var(--color-text-secondary)]">
          Move this conversation to <span className="font-medium text-[var(--color-text-primary)]">{pendingWorkspace ? workspaceBranchLabel(pendingWorkspace) : 'Project default'}</span>?
        </div>
      </Modal>
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
  attachments,
  setAttachments,
  sendError,
  modelSwitching,
  forkPending,
  onSetModel,
  onForkFromMessage,
  workspaces,
  activeWorkspace,
  movePending,
  forkConversationPending,
  archivePending,
  archiveDisabled,
  onRequestWorkspaceChange,
  onForkConversation,
  onArchiveConversation,
  abort,
  submit,
  onOpenPiSettings,
  onApplySnapshot,
}: {
  conversationId: string;
  activeWorkspaceId?: string;
  snapshot: PiConversationSnapshot | null;
  isActiveConversation: boolean;
  sending: boolean;
  draft: string;
  setDraft: (draft: string) => void;
  attachments: ComposerAttachment[];
  setAttachments: Dispatch<SetStateAction<ComposerAttachment[]>>;
  sendError: string | null;
  modelSwitching: boolean;
  forkPending: boolean;
  onSetModel: (provider: string, modelId: string) => void;
  onForkFromMessage: (entryId: string) => void;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  movePending: boolean;
  forkConversationPending: boolean;
  archivePending: boolean;
  archiveDisabled: boolean;
  onRequestWorkspaceChange: (workspaceId?: string) => void;
  onForkConversation: () => void;
  onArchiveConversation: () => void;
  abort: () => void;
  submit: (streamingBehavior?: 'steer' | 'followUp') => void;
  onOpenPiSettings: () => void;
  onApplySnapshot: (snapshot: PiConversationSnapshot) => void;
}) {
  const isMobile = useMobile();
  const { keyboardVisible, keyboardHeight } = useVirtualKeyboard();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<InputSelection>({ start: 0, end: 0 });
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [dismissedTokenKey, setDismissedTokenKey] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [fileIndexRequested, setFileIndexRequested] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [imageDragActive, setImageDragActive] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [streamingMode, setStreamingMode] = useState<'steer' | 'followUp'>('followUp');
  const imageDragDepth = useRef(0);
  const composerStyle = isMobile && keyboardVisible
    ? { paddingBottom: keyboardHeight + 12 }
    : undefined;
  const messages = useMemo(() => snapshot?.messages ?? [], [snapshot?.messages]);
  const isStreaming = Boolean(snapshot?.streaming);
  const composerDisabled = !isActiveConversation || sending;
  const pendingVisible = hasPendingAssistant(snapshot);
  const messageItems = useMemo(() => buildConversationItems(messages), [messages]);
  const selectedModel = snapshot?.model ? { provider: snapshot.model.provider, id: snapshot.model.id } : null;
  const activeToken = useMemo(
    () => findActiveToken(draft, selection, ['/', '@']),
    [draft, selection],
  );
  const tokenKey = activeToken ? `${activeToken.start}:${activeToken.end}:${activeToken.token}` : null;

  const { data: fileEntries = [], isFetching: filesLoading } = useQuery({
    queryKey: ['v2-workspace-file-index', activeWorkspaceId],
    queryFn: async () => {
      const response = await v2Api.listFiles(activeWorkspaceId!, { depth: FILE_INDEX_DEPTH });
      return response.entries;
    },
    enabled: Boolean(activeWorkspaceId && fileIndexRequested),
    staleTime: 30_000,
  });
  const { data: commandResponse, isFetching: commandsLoading } = useQuery({
    queryKey: ['v2-conversation-commands', conversationId],
    queryFn: () => v2Api.listConversationCommands(conversationId, { activate: true }),
    enabled: Boolean(conversationId && isActiveConversation && activeToken?.prefix === '/'),
    staleTime: 60_000,
  });
  const { data: modelResponse, isFetching: modelsLoading } = useQuery({
    queryKey: ['v2-conversation-models', conversationId],
    queryFn: () => v2Api.listConversationModels(conversationId),
    enabled: Boolean(conversationId && isActiveConversation && snapshot?.runtimeActive),
    staleTime: 60_000,
  });

  const slashCommands = useMemo(() => commandResponse?.commands ?? [], [commandResponse?.commands]);
  const setThinking = useMutation({
    mutationFn: (level: PiThinkingLevel) => v2Api.setConversationThinking(conversationId, { level }),
    onSuccess: (nextSnapshot) => {
      onApplySnapshot(nextSnapshot);
      void queryClient.invalidateQueries({ queryKey: ['v2-conversation-session', conversationId] });
    },
  });
  const models = useMemo(() => {
    const all = modelResponse?.models ?? [];
    if (!snapshot?.model) return all;
    if (all.some((model) => model.provider === snapshot.model?.provider && model.id === snapshot.model?.id)) return all;
    return [{ provider: snapshot.model.provider, id: snapshot.model.id }, ...all];
  }, [modelResponse?.models, snapshot]);
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return models;
    return models.filter((model) => `${model.id} ${model.name ?? ''} ${model.provider}`.toLowerCase().includes(query));
  }, [modelSearch, models]);
  const suggestions = useMemo<ComposerSuggestion[]>(() => {
    if (!activeToken) return [];

    if (activeToken.prefix === '/') {
      const query = activeToken.query.toLowerCase();
      if (commandsLoading && slashCommands.length === 0) {
        return [{
          key: 'slash:loading',
          type: 'slash',
          label: 'Loading commands...',
          detail: 'Fetching prompt, skill, and extension commands',
          value: '/',
          addSpace: false,
          disabled: true,
          icon: 'command',
        }];
      }
      const matches: ComposerSuggestion[] = slashCommands
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
      if (matches.length > 0) return matches;
      return [{
        key: 'slash:empty',
        type: 'slash',
        label: query ? 'No matching commands' : 'No prompt commands',
        detail: query ? 'Try another command name' : 'Pi did not report prompt, skill, or extension commands',
        value: '/',
        addSpace: false,
        disabled: true,
        icon: 'command',
      }];
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
  }, [activeToken, commandsLoading, fileEntries, filesLoading, slashCommands]);
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
    if (!modelMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (modelMenuRef.current?.contains(event.target as Node)) return;
      setModelMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModelMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    const minHeight = isMobile ? 70 : 82;
    const maxHeight = isMobile ? 150 : 210;
    node.style.height = '0px';
    node.style.height = `${Math.min(maxHeight, Math.max(minHeight, node.scrollHeight))}px`;
  }, [attachments.length, draft, isMobile]);

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

  const attachImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const nextAttachments = await Promise.all(imageFiles.map(fileToComposerAttachment));
    setAttachments((current) => [...current, ...nextAttachments]);
  }, [setAttachments]);

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFilesFromClipboard(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void attachImageFiles(files);
  };

  const handleComposerDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!canDropFiles(event, isActiveConversation, composerDisabled)) return;
    event.preventDefault();
    imageDragDepth.current += 1;
    setImageDragActive(true);
  };

  const handleComposerDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canDropFiles(event, isActiveConversation, composerDisabled)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setImageDragActive(true);
  };

  const handleComposerDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!canDropFiles(event, isActiveConversation, composerDisabled)) return;
    event.preventDefault();
    imageDragDepth.current = Math.max(0, imageDragDepth.current - 1);
    if (imageDragDepth.current === 0) setImageDragActive(false);
  };

  const handleComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!canDropFiles(event, isActiveConversation, composerDisabled)) return;
    event.preventDefault();
    imageDragDepth.current = 0;
    setImageDragActive(false);
    void attachImageFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-3 py-4 md:px-6 md:py-5">
        {messages.length ? (
          <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
            {messageItems.map((item, index) => item.type === 'message' ? (
              <MessageRow
                key={item.message.id || `${item.message.role}-${index}`}
                message={item.message}
                copied={copiedMessageId === item.message.id}
                forkPending={forkPending}
                onCopy={() => void copyMessage(item.message)}
                onForkFromMessage={onForkFromMessage}
              />
            ) : (
              <CollapsedTurnEvents
                key={`collapsed-${index}-${item.messages.map((message) => message.id).join(':')}`}
                messages={item.messages}
                copiedMessageId={copiedMessageId}
                onCopy={(message) => void copyMessage(message)}
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

      <div className="shrink-0 bg-primary px-2 pb-2 md:px-3 md:pb-3" style={composerStyle}>
        <div
          onDragEnter={handleComposerDragEnter}
          onDragOver={handleComposerDragOver}
          onDragLeave={handleComposerDragLeave}
          onDrop={handleComposerDrop}
          className={`relative mx-auto max-w-5xl overflow-visible rounded-[1.35rem] border bg-card shadow-[0_18px_60px_rgba(15,23,42,0.12)] transition-colors ${
          inputFocused ? 'border-accent/70' : 'border-subtle'
        } ${imageDragActive ? 'border-accent bg-accent/5 shadow-[0_20px_70px_rgba(37,99,235,0.2)] ring-2 ring-accent/25' : ''}`}
        >
          {imageDragActive && (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-[1.35rem] border-2 border-dashed border-accent bg-[var(--color-card)]/88 backdrop-blur-sm">
              <div className="flex items-center gap-3 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-lg">
                <ImageIcon size={17} />
                <span>Drop image to attach</span>
              </div>
            </div>
          )}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pb-1 pt-2 md:px-4">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="group inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-subtle bg-primary px-2.5 pr-1.5 text-sm text-[var(--color-text-primary)] shadow-sm">
                  <img src={attachment.previewUrl} alt="" className="h-5 w-5 shrink-0 rounded-md object-cover" />
                  <span className="max-w-52 truncate">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]"
                    title="Remove image"
                    aria-label="Remove image"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {sendError && (
            <div className="mx-3 mt-2 rounded-xl bg-[var(--color-error)]/10 px-3 py-2 text-xs text-[var(--color-error)] md:mx-4">
              {sendError}
            </div>
          )}
          {visibleSuggestions.length > 0 && (
            <div className="absolute bottom-full left-3 right-3 z-30 mb-2 overflow-hidden rounded-xl border border-subtle bg-card shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between border-b border-subtle px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-dim">
                <span>{activeToken?.prefix === '@' ? 'Workspace files' : 'Pi prompt commands'}</span>
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
            onPaste={handleComposerPaste}
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
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (!composerDisabled) submit(isStreaming ? streamingMode : undefined);
                return;
              }
              if (event.key === 'Escape') {
                textareaRef.current?.blur();
              }
            }}
            placeholder={isStreaming ? (streamingMode === 'steer' ? 'Steer the current turn...' : 'Queue a follow-up...') : isActiveConversation ? 'Send a prompt to Pi...' : 'Resume the conversation before sending a prompt'}
            disabled={composerDisabled}
            className="block w-full resize-none rounded-t-[1.35rem] bg-transparent px-3 pt-3 text-sm leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-dim disabled:opacity-60 md:px-4 md:pt-3"
          />

          <div className="flex min-h-10 items-center justify-between gap-2 px-2 pb-1.5 pt-0 md:px-2.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  void attachImageFiles(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
              <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]" title="Attach screenshot" aria-label="Attach screenshot">
                <Paperclip size={16} />
              </button>
              <button type="button" onClick={() => insertTrigger('/')} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]" title="Prompt, skill, or extension command" aria-label="Prompt, skill, or extension command">
                <Slash size={15} />
              </button>
              <button type="button" onClick={() => insertTrigger('@')} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]" title="Mention file" aria-label="Mention file">
                <AtSign size={15} />
              </button>
              {attachments.length > 0 && (
                <span className="hidden items-center gap-1 text-xs text-dim sm:inline-flex">
                  <ImageIcon size={13} />
                  {attachments.length}
                </span>
              )}
            </div>

            <div className="flex min-w-0 shrink-0 items-center gap-2">
              {isStreaming && (
                <div className="inline-flex rounded-full bg-primary p-0.5" aria-label="Streaming prompt mode">
                  {(['steer', 'followUp'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setStreamingMode(mode)}
                      className={`h-7 rounded-full px-2 text-[11px] font-medium transition-colors sm:px-2.5 sm:text-xs ${
                        streamingMode === mode ? 'bg-card text-[var(--color-text-primary)] shadow-sm' : 'text-dim hover:text-[var(--color-text-secondary)]'
                      }`}
                    >
                      {mode === 'steer' ? 'Steer' : 'Follow up'}
                    </button>
                  ))}
                </div>
              )}
              {snapshot?.streaming && (
                <button type="button" onClick={abort} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-error)] hover:bg-[var(--color-error)]/10" title="Abort" aria-label="Abort">
                  <Square size={13} />
                </button>
              )}
              <div ref={modelMenuRef} className="relative max-w-[14rem]">
                <button
                  type="button"
                  disabled={composerDisabled || isStreaming || modelSwitching || models.length === 0}
                  onClick={() => {
                    setModelMenuOpen((open) => !open);
                    setModelSearch('');
                  }}
                  className="inline-flex h-9 max-w-full items-center gap-2 rounded-full px-2.5 text-sm text-[var(--color-text-secondary)] outline-none hover:bg-secondary disabled:opacity-50"
                  title="Model"
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                >
                  {modelsLoading || modelSwitching ? <Loader2 size={14} className="shrink-0 animate-spin text-dim" /> : null}
                  <span className="min-w-0 truncate">{selectedModel ? compactModelLabel(selectedModel) : 'Model'}</span>
                  <ChevronDown size={14} className={`shrink-0 text-dim transition-transform ${modelMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {modelMenuOpen && (
                  <div className="absolute bottom-full right-0 z-50 mb-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-subtle bg-card shadow-[0_18px_60px_rgba(15,23,42,0.18)]">
                    <div className="border-b border-subtle/70 p-2">
                      <input
                        autoFocus
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        placeholder="Search models"
                        className="h-9 w-full rounded-xl bg-primary px-3 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-dim"
                      />
                    </div>
                    <div className="max-h-60 overflow-y-auto p-1" role="listbox">
                      {filteredModels.length === 0 ? (
                        <div className="px-3 py-6 text-center text-sm text-dim">No models found</div>
                      ) : filteredModels.map((model) => {
                        const selected = selectedModel?.provider === model.provider && selectedModel.id === model.id;
                        return (
                          <button
                            key={modelOptionValue(model.provider, model.id)}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              onSetModel(model.provider, model.id);
                              setModelMenuOpen(false);
                            }}
                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-secondary ${selected ? 'bg-secondary' : ''}`}
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-[var(--color-text-secondary)]">
                              {providerInitial(model.provider)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-[var(--color-text-primary)]">{model.name || model.id}</span>
                              <span className="block truncate text-xs text-dim">{model.id} · {model.provider}</span>
                            </span>
                            {selected && <Check size={15} className="shrink-0 text-accent" />}
                          </button>
                        );
                      })}
                    </div>
                    <div className="border-t border-subtle/70 px-3 py-2.5">
                      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
                        <Brain size={13} />
                        <span>Thinking</span>
                        {setThinking.isPending && <Loader2 size={12} className="animate-spin text-dim" />}
                      </div>
                      <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
                        {THINKING_LEVELS.map((level) => {
                          const selected = (snapshot?.thinkingLevel ?? 'off') === level;
                          return (
                            <button
                              key={level}
                              type="button"
                              disabled={composerDisabled || isStreaming || setThinking.isPending}
                              onClick={() => setThinking.mutate(level)}
                              className={`h-8 rounded-lg px-2 text-xs font-medium transition-colors disabled:opacity-45 ${
                                selected ? 'bg-[var(--color-text-primary)] text-[var(--color-card)]' : 'text-[var(--color-text-secondary)] hover:bg-secondary hover:text-[var(--color-text-primary)]'
                              }`}
                            >
                              {formatThinkingLevel(level)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <button type="button" className="hidden h-8 w-8 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)] sm:inline-flex" title="Voice input" aria-label="Voice input" disabled>
                <Mic size={15} />
              </button>
              <button
                type="button"
                onClick={() => submit(isStreaming ? streamingMode : undefined)}
                disabled={(!draft.trim() && attachments.length === 0) || composerDisabled}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-card)] shadow-[0_7px_16px_rgba(15,23,42,0.16)] transition-transform hover:scale-[1.03] disabled:scale-100 disabled:opacity-35"
                title={isStreaming ? (streamingMode === 'steer' ? 'Steer current turn' : 'Queue follow-up') : 'Send'}
                aria-label={isStreaming ? (streamingMode === 'steer' ? 'Steer current turn' : 'Queue follow-up') : 'Send'}
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={20} strokeWidth={2.2} />}
              </button>
            </div>
          </div>
        </div>
        <ConversationComposerActions
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          movePending={movePending}
          forkPending={forkConversationPending}
          archivePending={archivePending}
          archiveDisabled={archiveDisabled}
          onRequestWorkspaceChange={onRequestWorkspaceChange}
          onForkConversation={onForkConversation}
          onArchiveConversation={onArchiveConversation}
          conversationActions={(
            <ConversationMoreActions
              conversationId={conversationId}
              snapshot={snapshot}
              active={isActiveConversation}
              onOpenSettings={onOpenPiSettings}
              onApplySnapshot={onApplySnapshot}
            />
          )}
        />
      </div>
    </div>
  );
}

function ConversationComposerActions({
  workspaces,
  activeWorkspace,
  movePending,
  forkPending,
  archivePending,
  archiveDisabled,
  onRequestWorkspaceChange,
  onForkConversation,
  onArchiveConversation,
  conversationActions,
}: {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  movePending: boolean;
  forkPending: boolean;
  archivePending: boolean;
  archiveDisabled: boolean;
  onRequestWorkspaceChange: (workspaceId?: string) => void;
  onForkConversation: () => void;
  onArchiveConversation: () => void;
  conversationActions?: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const activeWorkspaceId = activeWorkspace?.id ?? '';
  const filteredWorkspaces = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return workspaces;
    return workspaces.filter((workspace) => `${workspace.name} ${workspace.branchName}`.toLowerCase().includes(normalizedQuery));
  }, [query, workspaces]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="mx-auto mt-1 flex max-w-5xl items-center gap-2 px-1 text-sm text-dim md:px-1.5">
      <div ref={menuRef} className="relative">
        <button
          type="button"
          disabled={movePending || workspaces.length === 0}
          onClick={() => {
            setOpen((value) => !value);
            setQuery('');
          }}
          className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-[var(--color-text-secondary)] transition-colors hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-50"
          aria-haspopup="listbox"
          aria-expanded={open}
          title="Move conversation"
        >
          {movePending ? <Loader2 size={16} className="animate-spin" /> : <GitBranch size={16} />}
          <span className="max-w-[46vw] truncate md:max-w-44">{activeWorkspace ? workspaceBranchLabel(activeWorkspace) : 'Project default'}</span>
          <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-subtle bg-card p-2 shadow-[0_18px_60px_rgba(15,23,42,0.18)]">
            <label className="flex h-10 items-center gap-2 px-2 text-dim">
              <Search size={16} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search branches"
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-dim"
              />
            </label>
            <div className="px-2 pb-1 pt-3 text-xs font-medium text-dim">Branches</div>
            <div className="max-h-72 overflow-y-auto" role="listbox">
              <button
                type="button"
                role="option"
                aria-selected={!activeWorkspace}
                onClick={() => {
                  setOpen(false);
                  if (activeWorkspace) onRequestWorkspaceChange(undefined);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-secondary ${!activeWorkspace ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
              >
                <MessageSquareText size={17} className={!activeWorkspace ? 'text-[var(--color-text-primary)]' : 'text-dim'} />
                <span className="min-w-0 flex-1 truncate">Project default</span>
                {!activeWorkspace && <Check size={17} className="text-[var(--color-text-primary)]" />}
              </button>
              {filteredWorkspaces.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-dim">No branches found</div>
              ) : filteredWorkspaces.map((workspace) => {
                const selected = workspace.id === activeWorkspaceId;
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      setOpen(false);
                      if (!selected) onRequestWorkspaceChange(workspace.id);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-secondary ${selected ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
                  >
                    <GitBranch size={17} className={selected ? 'text-[var(--color-text-primary)]' : 'text-dim'} />
                    <span className="min-w-0 flex-1 truncate">{workspaceBranchLabel(workspace)}</span>
                    {selected && <Check size={17} className="text-[var(--color-text-primary)]" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        disabled={forkPending}
        onClick={onForkConversation}
        className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-[var(--color-text-secondary)] transition-colors hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-50"
        title="Fork conversation"
      >
        {forkPending ? <Loader2 size={16} className="animate-spin" /> : <GitBranchPlus size={16} />}
        <span className="hidden sm:inline">Fork</span>
      </button>
      {conversationActions}
      <button
        type="button"
        disabled={archivePending || archiveDisabled}
        onClick={onArchiveConversation}
        className="ml-auto inline-flex h-9 items-center gap-2 rounded-full px-3 text-[var(--color-text-secondary)] transition-colors hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-50"
        title="Archive conversation"
      >
        {archivePending ? <Loader2 size={16} className="animate-spin" /> : <Archive size={16} />}
        <span className="hidden sm:inline">Archive</span>
      </button>
    </div>
  );
}

function ConversationMoreActions({
  conversationId,
  snapshot,
  active,
  onOpenSettings,
  onApplySnapshot,
}: {
  conversationId: string;
  snapshot: PiConversationSnapshot | null;
  active: boolean;
  onOpenSettings: () => void;
  onApplySnapshot: (snapshot: PiConversationSnapshot) => void;
}) {
  const queryClient = useQueryClient();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [compactInstructions, setCompactInstructions] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [copiedLast, setCopiedLast] = useState(false);
  const busy = Boolean(snapshot?.streaming || snapshot?.compacting);

  const sessionQuery = useQuery({
    queryKey: ['v2-conversation-session', conversationId],
    queryFn: () => v2Api.getConversationSession(conversationId),
    enabled: Boolean(open && active && conversationId),
    staleTime: 15_000,
  });

  const applyAndRefresh = (nextSnapshot: PiConversationSnapshot) => {
    onApplySnapshot(nextSnapshot);
    void queryClient.invalidateQueries({ queryKey: ['v2-conversation-session', conversationId] });
  };
  const reportError = (fallback: string) => (error: unknown) => {
    setStatusMessage(error instanceof Error ? error.message : fallback);
  };

  const setAutoCompaction = useMutation({
    mutationFn: (enabled: boolean) => v2Api.setConversationAutoCompaction(conversationId, { enabled }),
    onSuccess: (nextSnapshot, enabled) => {
      applyAndRefresh(nextSnapshot);
      setStatusMessage(enabled ? 'Auto-compaction enabled.' : 'Auto-compaction disabled.');
    },
    onError: reportError('Could not update auto-compaction.'),
  });
  const compact = useMutation({
    mutationFn: () => v2Api.compactConversation(conversationId, { customInstructions: compactInstructions.trim() || undefined }),
    onSuccess: (nextSnapshot) => {
      applyAndRefresh(nextSnapshot);
      setCompactInstructions('');
      setStatusMessage('Context compacted.');
    },
    onError: reportError('Could not compact context.'),
  });
  const exportHTML = useMutation({
    mutationFn: () => v2Api.exportConversationHTML(conversationId),
    onSuccess: (result) => setStatusMessage(result.path ? `Exported HTML to ${result.path}` : 'Exported HTML.'),
    onError: reportError('Could not export conversation.'),
  });
  const reloadPi = useMutation({
    mutationFn: () => v2Api.reloadConversationPi(conversationId),
    onSuccess: (nextSnapshot) => {
      applyAndRefresh(nextSnapshot);
      setStatusMessage('Pi resources reloaded.');
    },
    onError: reportError('Could not reload Pi resources.'),
  });

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const copyLastAssistant = async () => {
    const text = lastAssistantText(snapshot);
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedLast(true);
    setStatusMessage('Copied last assistant reply.');
    window.setTimeout(() => setCopiedLast(false), 1200);
  };

  const state = snapshot ?? sessionQuery.data?.state;
  const statRows = sessionStatRows(sessionQuery.data);
  const disabled = !active || !conversationId;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((value) => !value);
          setStatusMessage(null);
        }}
        className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-[var(--color-text-secondary)] transition-colors hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-50"
        title="More conversation actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={16} />
        <span className="hidden sm:inline">More</span>
        <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(26rem,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-subtle bg-card shadow-[0_18px_60px_rgba(15,23,42,0.18)]">
          <div className="border-b border-subtle/70 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{state?.sessionName || 'Conversation'}</p>
              {sessionQuery.isFetching && <Loader2 size={13} className="shrink-0 animate-spin text-dim" />}
            </div>
            <p className="mt-0.5 truncate text-xs text-dim">{state?.sessionFile || state?.workDir || 'Session details load when Pi is active.'}</p>
          </div>

          <div className="divide-y divide-subtle/70">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--color-text-primary)]">Auto-compact context</span>
                <span className="block text-xs text-dim">Let Pi summarize before the context gets too heavy.</span>
              </span>
              <ToggleSwitch
                checked={Boolean(state?.autoCompactionEnabled)}
                disabled={disabled || busy || setAutoCompaction.isPending}
                onChange={(enabled) => setAutoCompaction.mutate(enabled)}
              />
            </div>

            <div className="px-4 py-3">
              <textarea
                value={compactInstructions}
                onChange={(event) => setCompactInstructions(event.target.value)}
                rows={2}
                placeholder="Optional compaction instructions"
                className="block max-h-24 min-h-16 w-full resize-y rounded-lg bg-primary px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-dim"
              />
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <ConversationActionButton icon={<Sparkles size={14} />} pending={compact.isPending || Boolean(snapshot?.compacting)} disabled={disabled || busy} onClick={() => compact.mutate()}>
                  Compact
                </ConversationActionButton>
                <ConversationActionButton icon={<Download size={14} />} pending={exportHTML.isPending} disabled={disabled} onClick={() => exportHTML.mutate()}>
                  Export HTML
                </ConversationActionButton>
                <ConversationActionButton icon={copiedLast ? <Check size={14} /> : <Clipboard size={14} />} disabled={!lastAssistantText(snapshot)} onClick={() => void copyLastAssistant()}>
                  Copy last
                </ConversationActionButton>
                <ConversationActionButton icon={<RefreshCw size={14} />} pending={reloadPi.isPending} disabled={disabled || busy} onClick={() => reloadPi.mutate()}>
                  Reload
                </ConversationActionButton>
                <ConversationActionButton icon={<MoreHorizontal size={14} />} onClick={onOpenSettings}>
                  Settings
                </ConversationActionButton>
              </div>
            </div>

            {statRows.length > 0 && (
              <div className="grid gap-x-4 gap-y-1 px-4 py-3 text-xs sm:grid-cols-2">
                {statRows.map(([label, value]) => (
                  <div key={label} className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate text-dim">{label}</span>
                    <span className="truncate font-medium text-[var(--color-text-secondary)]">{value}</span>
                  </div>
                ))}
              </div>
            )}
            {statusMessage && (
              <div className="px-4 py-2 text-xs text-[var(--color-text-secondary)]">
                {statusMessage}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-accent' : 'bg-secondary'
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function ConversationActionButton({
  icon,
  pending,
  disabled,
  onClick,
  children,
}: {
  icon: ReactNode;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={onClick}
      className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-45"
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : icon}
      <span>{children}</span>
    </button>
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
            <MessageImages images={message.images ?? []} />
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

function MessageImages({ images }: { images: PiConversationImageAttachment[] }) {
  if (images.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {images.map((image, index) => (
        <img
          key={`${image.mimeType}-${index}`}
          src={`data:${image.mimeType};base64,${image.data}`}
          alt="Attached screenshot"
          className="max-h-64 rounded-lg object-contain"
        />
      ))}
    </div>
  );
}

function CollapsedTurnEvents({
  messages,
  copiedMessageId,
  onCopy,
}: {
  messages: PiConversationMessage[];
  copiedMessageId: string | null;
  onCopy: (message: PiConversationMessage) => void;
}) {
  const toolCount = messages.filter((message) => isToolMessage(message) || (message.toolCalls?.length ?? 0) > 0).length;
  const thinkingCount = messages.filter((message) => Boolean(message.thinking)).length;
  const labelParts = [
    thinkingCount > 0 ? `${thinkingCount} thinking` : null,
    toolCount > 0 ? `${toolCount} tool ${toolCount === 1 ? 'event' : 'events'}` : null,
  ].filter(Boolean);

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 py-1 text-xs text-dim/80 transition-colors hover:text-[var(--color-text-secondary)]">
        <span className="h-px flex-1 bg-[var(--color-border)]/60" />
        <span>{labelParts.join(', ') || `${messages.length} background ${messages.length === 1 ? 'event' : 'events'}`}</span>
        <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 space-y-3 pl-4">
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
      {tools.map((tool, index) => (
        <details key={tool.toolCallId || `${tool.toolName}-${index}`} className="group rounded-lg bg-inset px-3 py-2 text-xs">
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

function buildConversationItems(messages: PiConversationMessage[]): ConversationRenderItem[] {
  const items: ConversationRenderItem[] = [];
  let turnNoise: PiConversationMessage[] = [];

  const flushNoiseExpanded = () => {
    for (const message of turnNoise) items.push({ type: 'message', message });
    turnNoise = [];
  };

  for (const message of messages) {
    if (message.role === 'user') {
      flushNoiseExpanded();
      items.push({ type: 'message', message });
      continue;
    }

    if (isFinalAssistantMessage(message)) {
      if (turnNoise.length > 0) {
        items.push({ type: 'collapsed', messages: turnNoise });
        turnNoise = [];
      }
      items.push({ type: 'message', message });
      continue;
    }

    if (isTurnNoiseMessage(message)) {
      turnNoise.push(message);
      continue;
    }

    flushNoiseExpanded();
    items.push({ type: 'message', message });
  }

  flushNoiseExpanded();
  return items;
}

function isFinalAssistantMessage(message: PiConversationMessage): boolean {
  return message.role === 'assistant' && Boolean(message.text?.trim());
}

function isTurnNoiseMessage(message: PiConversationMessage): boolean {
  if (isToolMessage(message)) return true;
  if (message.role === 'assistant') return !message.text?.trim();
  return message.role !== 'user';
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

function lastAssistantText(snapshot: PiConversationSnapshot | null): string {
  if (!snapshot) return '';
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message.role === 'assistant' && message.text?.trim()) {
      return message.text.trim();
    }
  }
  return '';
}

function formatThinkingLevel(level?: string): string {
  if (!level) return 'Off';
  if (level === 'xhigh') return 'X high';
  return level.slice(0, 1).toUpperCase() + level.slice(1);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function sessionStatRows(session?: PiConversationSessionStats): Array<[string, string]> {
  if (!session?.stats) return [];
  return Object.entries(session.stats)
    .map(([key, value]) => [humanizeStatKey(key), formatPiStatValue(value)] as [string, string])
    .filter(([, value]) => value !== '')
    .slice(0, 8);
}

function formatPiStatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? formatNumber(value) : '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `${value.length}`;
  if (typeof value === 'object') return '';
  return String(value);
}

function humanizeStatKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function modelOptionValue(provider: string, id: string): string {
  return JSON.stringify([provider, id]);
}

function compactModelLabel(model: Pick<PiAvailableModel, 'id' | 'provider'>): string {
  return model.provider ? `${model.id}` : model.id;
}

function providerInitial(provider: string): string {
  return (provider.trim()[0] || 'M').toUpperCase();
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

async function fileToComposerAttachment(file: File): Promise<ComposerAttachment> {
  const dataUrl = await readFileAsDataUrl(file);
  const [, base64 = ''] = dataUrl.split(',', 2);
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    name: file.name,
    previewUrl: dataUrl,
    image: {
      type: 'image',
      data: base64,
      mimeType: file.type || 'image/png',
    },
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

function imageFilesFromClipboard(data: DataTransfer): File[] {
  const files = Array.from(data.files).filter((file) => file.type.startsWith('image/'));
  if (files.length > 0) return files;
  return Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

function canDropFiles(event: DragEvent<HTMLElement>, isActiveConversation: boolean, sending: boolean): boolean {
  if (!isActiveConversation || sending) return false;
  const items = Array.from(event.dataTransfer.items ?? []);
  if (items.some((item) => item.kind === 'file')) return true;
  return Array.from(event.dataTransfer.types ?? []).includes('Files');
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

function MobileConversationSurfaceBar({
  conversations,
  activeConversationId,
  terminals,
  projectId,
  onSelectConversation,
  onSelectTerminal,
  onCreateConversation,
  onCreateTerminal,
  createConversationPending,
  createTerminalPending,
  createTerminalDisabled,
  helperTab,
  toolsOpen,
  toolsDisabled,
  onToggleHelperTab,
}: {
  conversations: Conversation[];
  activeConversationId?: string;
  terminals: TerminalSession[];
  projectId: string;
  onSelectConversation: (conversation: Conversation) => void;
  onSelectTerminal: (terminal: TerminalSession) => void;
  onCreateConversation: () => void;
  onCreateTerminal: () => void;
  createConversationPending: boolean;
  createTerminalPending: boolean;
  createTerminalDisabled: boolean;
  helperTab: V2HelperTab;
  toolsOpen: boolean;
  toolsDisabled?: boolean;
  onToggleHelperTab: (tab: V2HelperTab) => void;
}) {
  const [newTabOpen, setNewTabOpen] = useState(false);
  const activeValue = activeConversationId ? `conversation:${activeConversationId}` : '';

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 bg-canvas px-2">
      <select
        value={activeValue}
        onChange={(event) => {
          const [type, id] = event.target.value.split(':');
          if (type === 'conversation') {
            const conversation = conversations.find((candidate) => candidate.id === id);
            if (conversation) onSelectConversation(conversation);
          }
          if (type === 'terminal') {
            const terminal = terminals.find((candidate) => candidate.id === id);
            if (terminal) onSelectTerminal(terminal);
          }
        }}
        className="h-[44px] min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm text-[var(--color-text-primary)] outline-none hover:bg-[var(--color-card)]"
        aria-label="Select conversation or terminal"
      >
        {conversations.map((conversation) => (
          <option key={conversation.id} value={`conversation:${conversation.id}`}>{conversation.title}</option>
        ))}
        {terminals.map((terminal) => (
          <option key={terminal.id} value={`terminal:${terminal.id}`}>{terminal.title || 'Terminal'}</option>
        ))}
      </select>
      <div className="relative shrink-0">
        <button
          type="button"
          disabled={createTerminalDisabled && createConversationPending}
          onClick={() => setNewTabOpen((value) => !value)}
          className="inline-flex h-[44px] w-[44px] cursor-pointer items-center justify-center rounded-md text-dim hover:bg-[var(--color-card)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-50"
          title="New tab"
          aria-label="New tab"
        >
          <PlusCircle size={15} />
        </button>
        {newTabOpen && (
          <>
            <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close new tab menu" onClick={() => setNewTabOpen(false)} />
            <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]">
              <NewTabMenuItem icon={<MessageSquarePlus size={14} />} disabled={createConversationPending} onClick={() => { setNewTabOpen(false); onCreateConversation(); }}>Conversation</NewTabMenuItem>
              <NewTabMenuItem icon={<SquareTerminal size={14} />} disabled={!projectId || createTerminalDisabled || createTerminalPending} onClick={() => { setNewTabOpen(false); onCreateTerminal(); }}>Terminal</NewTabMenuItem>
            </div>
          </>
        )}
      </div>
      <V2WorkspaceToolTabs
        helperTab={helperTab}
        toolsOpen={toolsOpen}
        disabled={toolsDisabled}
        onToggleHelperTab={onToggleHelperTab}
      />
    </div>
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

function workspaceBranchLabel(workspace: Workspace): string {
  return workspace.branchName || workspace.name;
}

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, DragEvent, ReactNode, SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowUp,
  AtSign,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Command,
  Download,
  FileCode2,
  FolderTree,
  GitBranch,
  GitBranchPlus,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Mic,
  MessageSquarePlus,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Pencil,
  PlusCircle,
  RefreshCw,
  Search,
  Shapes,
  Slash,
  Sparkles,
  Square,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react';
import { projectsApi } from '../../api';
import type { Conversation, PiAvailableModel, PiConversationForkPosition, PiConversationImageAttachment, PiConversationMessage, PiConversationMessageVersionInfo, PiConversationSessionStats, PiConversationSnapshot, PiSlashCommand, PiThinkingLevel, PiToolExecution, TerminalSession, V2SidebarData, Workspace } from '../../api/types';
import { v2Api, type V2FileEntry } from '../../api/v2';
import { MarkdownRenderer } from '../../components/ui/MarkdownRenderer';
import { Modal } from '../../components/ui/Modal';
import { DiffTab } from '../../components/workspace/DiffTab';
import { EditorTab } from '../../components/workspace/EditorTab';
import { WorkspaceProvider } from '../../components/workspace/WorkspaceContext';
import { useMacTabShortcuts, type MacTabShortcutItem } from '../../hooks/useMacTabShortcuts';
import { useMobile } from '../../hooks/useMobile';
import { usePiConversation } from '../../hooks/usePiConversation';
import { useVirtualKeyboard } from '../../hooks/useVirtualKeyboard';
import { useWorkspaceStore } from '../../stores/workspace';
import { isDesktopShell } from '../../platform/runtimeConfig';
import { applySuggestionToText, findActiveToken, fuzzyScore, type InputSelection } from '../../components/chat/chatAutocomplete';
import { findCodeburgReferenceRanges, type CodeburgReference, type CodeburgReferenceRange } from '../../components/chat/referenceTokens';
import { TokenAwareComposer, type TokenAwareComposerHandle } from '../../components/chat/TokenAwareComposer';
import { Button, V2Empty, V2Screen } from './v2-ui';
import { V2WorkspaceActionHeader } from './V2WorkspaceActionHeader';
import { WorkspaceConversationTab, WorkspaceTerminalTab } from './V2WorkspaceTabs';
import { V2WorkspaceToolTabs, V2WorkspaceTools, V2WorkspaceToolsSurface, type V2HelperTab } from './V2WorkspaceTools';
import type { DiagramAttachmentResult, ExcalidrawAnnotationSeed, ExcalidrawDiagramSource } from '../../components/chat/ExcalidrawDiagramDialog';

const ExcalidrawDiagramDialog = lazy(() =>
  import('../../components/chat/ExcalidrawDiagramDialog').then((module) => ({
    default: module.ExcalidrawDiagramDialog,
  })),
);
const ExcalidrawDiagramViewerDialog = lazy(() =>
  import('../../components/chat/ExcalidrawDiagramViewerDialog').then((module) => ({
    default: module.ExcalidrawDiagramViewerDialog,
  })),
);

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
  source?: ExcalidrawDiagramSource;
}

type DiagramEditorState =
  | { mode: 'new' }
  | { mode: 'edit'; attachmentId: string; source: ExcalidrawDiagramSource }
  | { mode: 'annotate'; seed: ExcalidrawAnnotationSeed };

type ConversationRenderItem =
  | { type: 'message'; message: PiConversationMessage }
  | { type: 'collapsed'; messages: PiConversationMessage[] };

type ForkDialogState =
  | { kind: 'current'; title: string }
  | { kind: 'message'; entryId: string; position: PiConversationForkPosition; title: string };
type ForkDialogTarget =
  | { kind: 'current' }
  | { kind: 'message'; entryId: string; position: PiConversationForkPosition };
type EditingMessageState = {
  entryId: string;
};

const MAX_SUGGESTIONS = 8;
const FILE_INDEX_DEPTH = 12;
const THINKING_LEVELS: PiThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const EMPTY_FILE_ENTRIES: V2FileEntry[] = [];
const embeddedExcalidrawSourceCache = new Map<string, Promise<ExcalidrawDiagramSource | undefined>>();

export function V2ConversationDetailPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const resetWorkspaceTabs = useWorkspaceStore((state) => state.resetTabs);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabIndex = useWorkspaceStore((state) => state.activeTabIndex);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const openFile = useWorkspaceStore((state) => state.openFile);
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
  const shouldConnectRuntime = isActiveConversation && (runtimeRequested || Boolean(stateSnapshot?.runtimeActive));
  const activateRuntime = runtimeRequested;
  const { snapshot: liveSnapshot, connected, connecting, error, sendMessage, abort, applySnapshot } = usePiConversation(conversationId ?? '', shouldConnectRuntime, { activate: activateRuntime, resetKey: activeWorkspaceId });
  const snapshot: PiConversationSnapshot | null = liveSnapshot ?? stateSnapshot ?? null;
  const activeWorkspaceTab = mainSurface !== 'conversation' ? tabs[mainSurface.index] : null;
  const activePreviewTab = activeWorkspaceTab?.type === 'editor' || activeWorkspaceTab?.type === 'diff'
    ? activeWorkspaceTab
    : null;
  const workspaceContextReady = !!project && !!activeWorkspace;
  const insertWorkspaceReference = useCallback((path: string) => {
    setDraft((current) => appendWorkspaceReference(current, path));
    setMainSurface('conversation');
  }, []);
  const insertWorkspaceText = useCallback((text: string) => {
    setDraft((current) => appendDraftText(current, text));
    setMainSurface('conversation');
  }, []);
  const openWorkspaceFileReference = useCallback((path: string, line?: number, isDirectory?: boolean) => {
    if (!project || !activeWorkspace) return;
    if (isDirectory) {
      const workspaceStore = useWorkspaceStore.getState();
      workspaceStore.setActivePanel('files');
      workspaceStore.revealFile(path);
      setHelperTab('files');
      setToolsOpen(true);
      return;
    }
    openFile(path, line, { ephemeral: false });
    setMainSurface({ type: 'workspaceTab', index: useWorkspaceStore.getState().activeTabIndex });
  }, [activeWorkspace, openFile, project]);
  const conversationDraftTarget = useMemo(
    () => ({
      enabled: isActiveConversation && mainSurface === 'conversation',
      insertReference: insertWorkspaceReference,
      insertText: insertWorkspaceText,
    }),
    [insertWorkspaceReference, insertWorkspaceText, isActiveConversation, mainSurface],
  );

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
    if (isActiveConversation) {
      setRuntimeRequested(true);
    }
  }, [activeWorkspaceId, conversationId, isActiveConversation]);

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
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', updated.currentWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId, 'sidebar'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
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
  const safeTerminals = useMemo(() => Array.isArray(terminals) ? terminals : [], [terminals]);
  const safeWorkspaceConversations = useMemo(() => Array.isArray(workspaceConversations) ? workspaceConversations : [], [workspaceConversations]);
  const createTerminal = useMutation({
    mutationFn: () => v2Api.createTerminal(activeWorkspaceId!, {
      title: `Terminal #${safeTerminals.length + 1}`,
    }),
    onSuccess: async (terminal) => {
      await queryClient.invalidateQueries({ queryKey: ['v2-terminals', terminal.workspaceId] });
      navigate(`/projects/${terminalWorkspaceProjectId(project, conversation)}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`);
    },
  });
  const createConversation = useMutation({
    mutationFn: () => v2Api.createConversation(conversation!.projectId, {
      title: `New ${activeWorkspace?.name ?? project?.name ?? 'workspace'} conversation`,
      currentWorkspaceId: activeWorkspaceId ?? undefined,
    }),
    onSuccess: async (created) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', created.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', created.projectId, 'sidebar'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
      ]);
      navigate(`/conversations/${created.id}`);
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
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
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
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
      ]);
    },
  });

  const forkConversation = useMutation({
    mutationFn: ({ title }: { title?: string }) =>
      v2Api.forkConversation(conversationId!, {
        title: cleanForkTitle(title, conversation?.title),
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
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
      ]);
      navigate(`/conversations/${forked.id}`);
    },
  });
  const setConversationModel = useMutation({
    mutationFn: (model: { provider: string; modelId: string }) => v2Api.setConversationModel(conversationId!, model),
    onSuccess: (nextSnapshot) => {
      applySnapshot(nextSnapshot);
    },
  });
  const forkConversationFromMessage = useMutation({
    mutationFn: ({ entryId, position, title }: { entryId: string; position: PiConversationForkPosition; title?: string }) =>
      v2Api.forkConversationFromMessage(conversationId!, {
        entryId,
        position,
        title: cleanForkTitle(title, conversation?.title),
        currentWorkspaceId: activeWorkspaceId ?? conversation?.currentWorkspaceId,
      }),
    onSuccess: async (forked) => {
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
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
      ]);
      navigate(`/conversations/${forked.conversation.id}`);
    },
  });

  const transitionConversation = useMutation({
    mutationFn: (nextState: 'pause' | 'resume' | 'complete' | 'archive') => {
      if (nextState === 'pause') return v2Api.pauseConversation(conversationId!);
      if (nextState === 'resume') return v2Api.resumeConversation(conversationId!);
      if (nextState === 'complete') return v2Api.completeConversation(conversationId!);
      return v2Api.archiveConversation(conversationId!);
    },
    onSuccess: async (updated, nextState) => {
      if (nextState === 'archive') {
        removeConversationFromV2Caches(queryClient, updated.id);
        navigate(nextConversationDestination(updated.id, updated.projectId, activeWorkspaceId, safeWorkspaceConversations), { replace: true });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2-conversation', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversation-state', conversationId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', updated.projectId, 'sidebar'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
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
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
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
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
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
        queryClient.invalidateQueries({ queryKey: ['v2-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-workspace-conversations', activeWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', result.conversation.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v2-project-conversations', result.conversation.projectId, 'sidebar'] }),
        queryClient.invalidateQueries({ queryKey: ['v2-sidebar-summary'] }),
      ]);
      navigate(`/conversations/${result.conversation.id}`);
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

  const handleSubmit = async (streamingBehavior?: 'steer' | 'followUp', draftOverride?: string) => {
    const trimmed = (draftOverride ?? draft).trim();
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
  const visibleTabConversations = useMemo(() => (
    conversation?.status === 'active' && !safeWorkspaceConversations.some((candidate) => candidate.id === conversation.id)
      ? [conversation, ...safeWorkspaceConversations]
      : safeWorkspaceConversations
  ), [conversation, safeWorkspaceConversations]);
  const mobileConversations = visibleTabConversations;
  const sortedTerminals = useMemo(() => [...safeTerminals].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [safeTerminals]);
  const tabShortcutItems = useMemo<MacTabShortcutItem[]>(() => ([
    ...visibleTabConversations.map((candidate) => ({
      id: `conversation:${candidate.id}`,
      action: () => navigate(`/conversations/${candidate.id}`),
    })),
    ...sortedTerminals.map((terminal) => ({
      id: `terminal:${terminal.id}`,
      action: () => navigate(`/projects/${terminalWorkspaceProjectId(project, conversation)}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`),
    })),
  ].slice(0, 9)), [conversation, navigate, project, sortedTerminals, visibleTabConversations]);
  const showTabShortcutHints = useMacTabShortcuts(tabShortcutItems, !isMobile && !activePreviewTab);
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
                {visibleTabConversations.map((candidate, index) => (
                  <WorkspaceConversationTab
                    key={candidate.id}
                    conversation={candidate}
                    active={candidate.id === conversationId}
                    onSelect={() => navigate(`/conversations/${candidate.id}`)}
                    onRename={(title) => renameConversation.mutate({ id: candidate.id, title })}
                    shortcutIndex={index + 1}
                    showShortcutHint={showTabShortcutHints}
                  />
                ))}
                {sortedTerminals.map((terminal, index) => (
                  <WorkspaceTerminalTab
                    key={terminal.id}
                    terminal={terminal}
                    active={false}
                    onSelect={() => navigate(`/projects/${terminalWorkspaceProjectId(project, conversation)}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`)}
                    shortcutIndex={visibleTabConversations.length + index + 1}
                    showShortcutHint={showTabShortcutHints}
                  />
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
              onSelectConversation={(candidate) => navigate(`/conversations/${candidate.id}`)}
              onSelectTerminal={(terminal) => navigate(`/projects/${terminalWorkspaceProjectId(project, conversation)}?workspace=${terminal.workspaceId}&terminal=${terminal.id}`)}
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
                conversationTitle={conversation?.title ?? 'Conversation'}
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
                onForkFromMessage={async (entryId, position, title) => { await forkConversationFromMessage.mutateAsync({ entryId, position, title }); }}
                workspaces={safeWorkspaces}
                activeWorkspace={attachedWorkspace ?? null}
                movePending={updateWorkspace.isPending}
                forkConversationPending={forkConversation.isPending}
                archivePending={transitionConversation.isPending}
                archiveDisabled={conversation?.status === 'archived'}
                onRequestWorkspaceChange={(workspaceId) => setPendingWorkspaceId(workspaceId)}
                onForkConversation={async (title) => { await forkConversation.mutateAsync({ title }); }}
                onArchiveConversation={() => transitionConversation.mutate('archive')}
                abort={abort}
                submit={(streamingBehavior) => void handleSubmit(streamingBehavior)}
                onOpenWorkspaceFile={openWorkspaceFileReference}
                onOpenPiSettings={() => {
                  if (conversation?.projectId) navigate(`/projects/${conversation.projectId}/settings`);
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
    <WorkspaceProvider
      scope={{ type: 'workspace', workspaceId: activeWorkspace.id, workspace: activeWorkspace, project }}
      conversationDraft={conversationDraftTarget}
    >
      {shell}
    </WorkspaceProvider>
  );
}

function ConversationSurface({
  conversationId,
  activeWorkspaceId,
  snapshot,
  conversationTitle,
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
  onOpenWorkspaceFile,
  onOpenPiSettings,
  onApplySnapshot,
}: {
  conversationId: string;
  activeWorkspaceId?: string;
  snapshot: PiConversationSnapshot | null;
  conversationTitle: string;
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
  onForkFromMessage: (entryId: string, position: PiConversationForkPosition, title?: string) => Promise<void>;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  movePending: boolean;
  forkConversationPending: boolean;
  archivePending: boolean;
  archiveDisabled: boolean;
  onRequestWorkspaceChange: (workspaceId?: string) => void;
  onForkConversation: (title?: string) => Promise<void>;
  onArchiveConversation: () => void;
  abort: () => Promise<void>;
  submit: (streamingBehavior?: 'steer' | 'followUp', draftOverride?: string) => void;
  onOpenWorkspaceFile?: (path: string, line?: number, isDirectory?: boolean) => void;
  onOpenPiSettings: () => void;
  onApplySnapshot: (snapshot: PiConversationSnapshot) => void;
}) {
  const isMobile = useMobile();
  const { keyboardVisible, keyboardHeight } = useVirtualKeyboard();
  const composerRef = useRef<TokenAwareComposerHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const messageScrollerRef = useRef<HTMLDivElement>(null);
  const messageRowRefs = useRef<Map<number, HTMLElement>>(new Map());
  const stickToLatestRef = useRef(true);
  const preEditComposerRef = useRef<{ draft: string; attachments: ComposerAttachment[] } | null>(null);
  const editAttachmentSourceRequestRef = useRef(0);
  const branchSwitchAnchorRef = useRef<{ index: number; top: number } | null>(null);
  const branchSwitchTimerRef = useRef<number | null>(null);
  const suppressBranchAutoScrollRef = useRef(false);
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
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [streamingMode, setStreamingMode] = useState<'steer' | 'followUp'>('followUp');
  const [abortPending, setAbortPending] = useState(false);
  const [isAtLatest, setIsAtLatest] = useState(true);
  const [forkDialog, setForkDialog] = useState<ForkDialogState | null>(null);
  const [forkDialogError, setForkDialogError] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<EditingMessageState | null>(null);
  const [diagramEditor, setDiagramEditor] = useState<DiagramEditorState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [branchSwitching, setBranchSwitching] = useState(false);
  const imageDragDepth = useRef(0);
  const composerStyle = isMobile && keyboardVisible
    ? { paddingBottom: keyboardHeight + 12 }
    : undefined;
  const messages = useMemo(() => snapshot?.messages ?? [], [snapshot?.messages]);
  const isStreaming = Boolean(snapshot?.streaming);
  const baseComposerDisabled = !isActiveConversation || sending;
  const pendingVisible = hasPendingAssistant(snapshot);
  const messageItems = useMemo(() => buildConversationItems(messages), [messages]);
  const messageActivityKey = `${messages.length}:${snapshot?.updatedAt ?? ''}:${snapshot?.pending?.text?.length ?? 0}:${snapshot?.pending?.thinking?.length ?? 0}:${snapshot?.tools?.map((tool) => `${tool.toolCallId}:${tool.status}:${tool.output?.length ?? 0}`).join('|') ?? ''}`;
  const selectedModel = snapshot?.model ? { provider: snapshot.model.provider, id: snapshot.model.id } : null;
  const forkDialogPending = forkPending || forkConversationPending;
  const activeToken = useMemo(
    () => findActiveToken(draft, selection, ['/', '@']),
    [draft, selection],
  );
  const tokenKey = activeToken ? `${activeToken.start}:${activeToken.end}:${activeToken.token}` : null;
  const activeTokenRange = useMemo(
    () => activeToken ? { from: activeToken.start, to: activeToken.end } : null,
    [activeToken],
  );

  const { data: fileEntries = EMPTY_FILE_ENTRIES, isFetching: filesLoading } = useQuery({
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
  const { data: tree } = useQuery({
    queryKey: ['v2-conversation-tree', conversationId, snapshot?.sessionFile, snapshot?.updatedAt],
    queryFn: () => v2Api.getConversationTree(conversationId),
    enabled: Boolean(conversationId && isActiveConversation && snapshot?.sessionFile && !isStreaming),
    staleTime: 10_000,
  });

  const slashCommands = useMemo(() => commandResponse?.commands ?? [], [commandResponse?.commands]);
  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    requestAnimationFrame(() => {
      const node = messageScrollerRef.current;
      if (!node) return;
      node.scrollTo({ top: node.scrollHeight, behavior });
    });
  }, []);
  const updateStickToLatest = useCallback(() => {
    const node = messageScrollerRef.current;
    if (!node) return;
    const atLatest = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
    stickToLatestRef.current = atLatest;
    setIsAtLatest(atLatest);
  }, []);
  const setThinking = useMutation({
    mutationFn: (level: PiThinkingLevel) => v2Api.setConversationThinking(conversationId, { level }),
    onSuccess: (nextSnapshot) => {
      onApplySnapshot(nextSnapshot);
      void queryClient.invalidateQueries({ queryKey: ['v2-conversation-session', conversationId] });
    },
  });
  const selectTreeLeaf = useMutation({
    mutationFn: (leafId: string) => v2Api.selectConversationTreeLeaf(conversationId, { leafId }),
    onMutate: () => {
      if (branchSwitchTimerRef.current) {
        window.clearTimeout(branchSwitchTimerRef.current);
        branchSwitchTimerRef.current = null;
      }
      suppressBranchAutoScrollRef.current = true;
      setBranchSwitching(true);
    },
    onSuccess: (nextSnapshot) => {
      onApplySnapshot(nextSnapshot);
    },
    onSettled: () => {
      branchSwitchTimerRef.current = window.setTimeout(() => {
        setBranchSwitching(false);
        suppressBranchAutoScrollRef.current = false;
        branchSwitchAnchorRef.current = null;
        branchSwitchTimerRef.current = null;
      }, 120);
    },
  });
  const editTreeMessage = useMutation({
    mutationFn: (input: { entryId: string; message: string; images: PiConversationImageAttachment[] }) =>
      v2Api.editConversationTreeMessage(conversationId, input),
    onSuccess: (nextSnapshot) => {
      onApplySnapshot(nextSnapshot);
      setDraft('');
      setAttachments([]);
      setEditingMessage(null);
      editAttachmentSourceRequestRef.current += 1;
      preEditComposerRef.current = null;
      setEditError(null);
      void queryClient.invalidateQueries({ queryKey: ['v2-conversation-tree', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['v2-conversation-state', conversationId] });
      scrollToLatest('smooth');
    },
    onError: (err) => {
      setEditError(err instanceof Error ? err.message : 'Could not edit message');
    },
  });
  const composerDisabled = baseComposerDisabled || editTreeMessage.isPending;
  const models = useMemo(() => {
    const all = modelResponse?.models ?? [];
    if (!snapshot?.model) return all;
    if (all.some((model) => model.provider === snapshot.model?.provider && model.id === snapshot.model?.id)) return all;
    return [{ provider: snapshot.model.provider, id: snapshot.model.id }, ...all];
  }, [modelResponse?.models, snapshot]);
  const versionsByEntryId = useMemo(() => {
    const map = new Map<string, PiConversationMessageVersionInfo>();
    for (const info of tree?.messages ?? []) {
      map.set(info.entryId, info);
    }
    return map;
  }, [tree?.messages]);
  const setMessageRowRef = useCallback((index: number, node: HTMLElement | null) => {
    if (node) {
      messageRowRefs.current.set(index, node);
      return;
    }
    messageRowRefs.current.delete(index);
  }, []);
  const selectVersionAt = useCallback((leafId: string, index: number) => {
    const node = messageRowRefs.current.get(index);
    branchSwitchAnchorRef.current = node ? { index, top: node.getBoundingClientRect().top } : null;
    selectTreeLeaf.mutate(leafId);
  }, [selectTreeLeaf]);
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return models;
    return models.filter((model) => `${model.id} ${model.name ?? ''} ${model.provider}`.toLowerCase().includes(query));
  }, [modelSearch, models]);
  const selectedFilteredModel = filteredModels[selectedModelIndex];
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
        .filter((command) => {
          const display = slashCommandDisplay(command);
          return query === '' || command.name.toLowerCase().includes(query) || display.label.toLowerCase().includes(query);
        })
        .slice(0, MAX_SUGGESTIONS)
        .map((command) => {
          const display = slashCommandDisplay(command);
          return {
            key: `slash:${command.name}`,
            type: 'slash',
            label: display.label,
            detail: display.detail,
            value: `/${command.name}`,
            addSpace: true,
            icon: 'command',
          };
        });
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
    () => (inputFocused && tokenKey && dismissedTokenKey !== tokenKey ? suggestions : []),
    [dismissedTokenKey, inputFocused, suggestions, tokenKey],
  );
  const parsedComposerReferenceRanges = useMemo(
    () => findCodeburgReferenceRanges(draft),
    [draft],
  );
  const composerReferenceRanges = useMemo(
    () => enrichComposerReferenceRangeTypes(parsedComposerReferenceRanges, fileEntries),
    [fileEntries, parsedComposerReferenceRanges],
  );
  const composerReferences = useMemo(
    () => uniqueComposerReferences(composerReferenceRanges.map((range) => range.reference)),
    [composerReferenceRanges],
  );
  const suggestionSignature = useMemo(
    () => visibleSuggestions.map((suggestion) => `${suggestion.key}:${suggestion.disabled ? 'disabled' : 'enabled'}`).join('|'),
    [visibleSuggestions],
  );
  const firstEnabledSuggestionIndex = useMemo(
    () => findFirstEnabledSuggestionIndex(visibleSuggestions),
    [visibleSuggestions],
  );

  useEffect(() => {
    if (activeToken?.prefix === '@') {
      setFileIndexRequested(true);
    }
  }, [activeToken?.prefix]);

  useEffect(() => {
    if (composerReferences.some((reference) => reference.kind === 'file')) {
      setFileIndexRequested(true);
    }
  }, [composerReferences]);

  useEffect(() => {
    suggestionRefs.current = [];
    setSelectedSuggestionIndex(firstEnabledSuggestionIndex);
  }, [firstEnabledSuggestionIndex, suggestionSignature, tokenKey]);

  useEffect(() => {
    const node = suggestionRefs.current[selectedSuggestionIndex];
    if (!node) return;
    node.scrollIntoView({ block: 'nearest' });
  }, [selectedSuggestionIndex, visibleSuggestions.length]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const selectedIndex = filteredModels.findIndex((model) => selectedModel?.provider === model.provider && selectedModel.id === model.id);
    setSelectedModelIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [filteredModels, modelMenuOpen, selectedModel?.id, selectedModel?.provider]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const node = modelOptionRefs.current[selectedModelIndex];
    if (!node) return;
    node.scrollIntoView({ block: 'nearest' });
  }, [modelMenuOpen, selectedModelIndex]);

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
    stickToLatestRef.current = true;
    setIsAtLatest(true);
    branchSwitchAnchorRef.current = null;
    messageRowRefs.current.clear();
    scrollToLatest();
    setEditingMessage(null);
    editAttachmentSourceRequestRef.current += 1;
    preEditComposerRef.current = null;
    setEditError(null);
  }, [conversationId, scrollToLatest]);

  useEffect(() => () => {
    if (branchSwitchTimerRef.current) {
      window.clearTimeout(branchSwitchTimerRef.current);
    }
    suppressBranchAutoScrollRef.current = false;
  }, []);

  useLayoutEffect(() => {
    if (!branchSwitching) return;
    const anchor = branchSwitchAnchorRef.current;
    const scroller = messageScrollerRef.current;
    if (!anchor || !scroller) return;
    const node = messageRowRefs.current.get(anchor.index);
    if (!node) return;
    const delta = node.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > 0.5) {
      scroller.scrollTop += delta;
    }
  }, [branchSwitching, messageActivityKey]);

  useEffect(() => {
    if (suppressBranchAutoScrollRef.current) return;
    if (stickToLatestRef.current) scrollToLatest();
  }, [messageActivityKey, scrollToLatest]);

  const composerMinHeight = isMobile ? 70 : 82;
  const composerMaxHeight = isMobile ? 150 : 210;

  const setDraftWithSelection = (nextDraft: string, nextSelection?: InputSelection) => {
    setDraft(nextDraft);
    if (nextSelection) setSelection(nextSelection);
    setDismissedTokenKey(null);
  };

  const applyComposerSuggestion = (suggestion: ComposerSuggestion, targetSelection = selection) => {
    if (suggestion.disabled) return;
    const next = applySuggestionToText(draft, targetSelection, suggestion.value, ['/', '@'], suggestion.addSpace);
    setDraftWithSelection(next.text, { start: next.cursor, end: next.cursor });
    requestAnimationFrame(() => {
      composerRef.current?.setSelection({ start: next.cursor, end: next.cursor });
    });
  };

  const insertTrigger = (trigger: '/' | '@') => {
    const currentSelection = composerRef.current?.getSelection() ?? selection;
    const start = currentSelection.start;
    const end = currentSelection.end;
    const previous = start > 0 ? draft[start - 1] : '';
    const insertValue = `${previous && !/\s/.test(previous) ? ' ' : ''}${trigger}`;
    const nextDraft = `${draft.slice(0, start)}${insertValue}${draft.slice(end)}`;
    const cursor = start + insertValue.length;
    if (trigger === '@') setFileIndexRequested(true);
    setDraftWithSelection(nextDraft, { start: cursor, end: cursor });
    requestAnimationFrame(() => {
      composerRef.current?.setSelection({ start: cursor, end: cursor });
    });
  };

  const stopStreaming = async () => {
    if (abortPending) return;
    setAbortPending(true);
    try {
      await abort();
    } catch {
      // usePiConversation surfaces the error in the connection status.
    } finally {
      setAbortPending(false);
    }
  };

  const beginEditingMessage = (message: PiConversationMessage) => {
    if (isStreaming || sending || editTreeMessage.isPending || !message.entryId) return;
    const text = message.text ?? '';
    const nextAttachments = messageImagesToComposerAttachments(message.images);
    if (!text.trim() && nextAttachments.length === 0) return;
    const sourceRequestId = editAttachmentSourceRequestRef.current + 1;
    editAttachmentSourceRequestRef.current = sourceRequestId;
    if (!editingMessage) {
      preEditComposerRef.current = { draft, attachments };
    }
    setAttachments(nextAttachments);
    setDraftWithSelection(text, { start: text.length, end: text.length });
    setEditingMessage({ entryId: message.entryId });
    setEditError(null);
    requestAnimationFrame(() => {
      composerRef.current?.setSelection({ start: text.length, end: text.length });
    });
    if (nextAttachments.length > 0) {
      void hydrateEmbeddedExcalidrawSources(nextAttachments).then((hydratedAttachments) => {
        if (editAttachmentSourceRequestRef.current !== sourceRequestId) return;
        const sourceById = new Map(
          hydratedAttachments
            .filter((attachment) => attachment.source)
            .map((attachment) => [attachment.id, attachment.source] as const),
        );
        if (sourceById.size === 0) return;
        setAttachments((current) => current.map((attachment) => {
          const source = sourceById.get(attachment.id);
          return source ? { ...attachment, source } : attachment;
        }));
      });
    }
  };

  const cancelEditingMessage = () => {
    const previousComposer = preEditComposerRef.current;
    setEditingMessage(null);
    setEditError(null);
    editAttachmentSourceRequestRef.current += 1;
    preEditComposerRef.current = null;
    if (!previousComposer) return;
    setDraftWithSelection(previousComposer.draft, {
      start: previousComposer.draft.length,
      end: previousComposer.draft.length,
    });
    setAttachments(previousComposer.attachments);
  };

  const submitComposer = (streamingBehavior?: 'steer' | 'followUp') => {
    if (editingMessage) {
      const trimmed = normalizeComposerPromptText(draft, composerReferenceRanges).trim();
      if ((!trimmed && attachments.length === 0) || isStreaming || composerDisabled) return;
      setEditError(null);
      editTreeMessage.mutate({
        entryId: editingMessage.entryId,
        message: trimmed,
        images: attachments.map(({ image }) => image),
      });
      return;
    }
    submit(streamingBehavior, normalizeComposerPromptText(draft, composerReferenceRanges));
  };

  const copyMessage = async (message: PiConversationMessage) => {
    const text = messageCopyText(message);
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedMessageId(message.id);
    window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1200);
  };

  const requestForkConversation = (target: ForkDialogTarget) => {
    setForkDialog({ ...target, title: defaultForkTitle(conversationTitle) });
    setForkDialogError(null);
  };

  const confirmForkConversation = async () => {
    if (!forkDialog) return;
    const title = cleanForkTitle(forkDialog.title, conversationTitle);
    setForkDialogError(null);
    try {
      if (forkDialog.kind === 'message') {
        await onForkFromMessage(forkDialog.entryId, forkDialog.position, title);
      } else {
        await onForkConversation(title);
      }
      setForkDialog(null);
    } catch (err) {
      setForkDialogError(err instanceof Error ? err.message : 'Could not fork conversation');
    }
  };

  const attachImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const nextAttachments = await Promise.all(imageFiles.map(fileToComposerAttachment));
    setAttachments((current) => [...current, ...nextAttachments]);
  }, [setAttachments]);

  const openDiagramEditor = () => {
    if (composerDisabled) return;
    setDiagramEditor({ mode: 'new' });
  };

  const editDiagramAttachment = (attachment: ComposerAttachment) => {
    if (!attachment.source || composerDisabled) return;
    setDiagramEditor({
      mode: 'edit',
      attachmentId: attachment.id,
      source: attachment.source,
    });
  };

  const annotateImageAttachment = (attachment: ComposerAttachment) => {
    if (composerDisabled) return;
    setDiagramEditor({
      mode: 'annotate',
      seed: {
        name: attachment.name,
        dataUrl: attachment.previewUrl,
        mimeType: attachment.image.mimeType,
      },
    });
  };

  const attachDiagram = useCallback((result: DiagramAttachmentResult) => {
    const editingAttachmentId = diagramEditor?.mode === 'edit' ? diagramEditor.attachmentId : null;
    const nextAttachment: ComposerAttachment = {
      id: editingAttachmentId ?? `diagram-${crypto.randomUUID()}`,
      name: result.name,
      previewUrl: result.previewUrl,
      image: result.image,
      source: result.source,
    };

    setAttachments((current) => {
      if (!editingAttachmentId) return [...current, nextAttachment];
      let replaced = false;
      const next = current.map((attachment) => {
        if (attachment.id !== editingAttachmentId) return attachment;
        replaced = true;
        return nextAttachment;
      });
      return replaced ? next : [...current, nextAttachment];
    });
    setDiagramEditor(null);
  }, [diagramEditor, setAttachments]);

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  const handleComposerPaste = (clipboardData: DataTransfer): boolean => {
    const files = imageFilesFromClipboard(clipboardData);
    if (files.length === 0) return false;
    void attachImageFiles(files);
    return true;
  };

  const handleComposerKeyCommand = (event: KeyboardEvent, currentSelection: InputSelection): boolean => {
    setSelection(currentSelection);
    if (visibleSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedSuggestionIndex((current) => nextEnabledSuggestionIndex(visibleSuggestions, current, 1));
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedSuggestionIndex((current) => nextEnabledSuggestionIndex(visibleSuggestions, current, -1));
        return true;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        const suggestion = visibleSuggestions[selectedSuggestionIndex] ?? visibleSuggestions.find((item) => !item.disabled);
        if (suggestion && !suggestion.disabled) {
          event.preventDefault();
          applyComposerSuggestion(suggestion, currentSelection);
          return true;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissedTokenKey(tokenKey);
        return true;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!composerDisabled) submitComposer(isStreaming ? streamingMode : undefined);
      return true;
    }
    if (event.key === 'Escape') {
      composerRef.current?.blur();
      return true;
    }
    return false;
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
      <div ref={messageScrollerRef} onScroll={updateStickToLatest} className={`relative min-h-0 flex-1 overflow-auto px-3 py-4 md:px-6 md:py-5 ${branchSwitching ? '[overflow-anchor:none]' : ''}`}>
        {messages.length ? (
          <div className="mx-auto max-w-4xl space-y-4 md:space-y-5">
            {messageItems.map((item, index) => item.type === 'message' ? (
              <MessageRow
                key={item.message.id || `${item.message.role}-${index}`}
                message={item.message}
                copied={copiedMessageId === item.message.id}
                forkPending={forkPending}
                onCopy={() => void copyMessage(item.message)}
                forkTarget={messageForkTarget(item.message, messages)}
                onRequestFork={requestForkConversation}
                version={item.message.version ?? (item.message.entryId ? versionsByEntryId.get(item.message.entryId) : undefined)}
                versionPending={selectTreeLeaf.isPending}
                onSelectVersion={(leafId) => selectVersionAt(leafId, index)}
                onEdit={() => beginEditingMessage(item.message)}
                editDisabled={Boolean(isStreaming || sending || editTreeMessage.isPending)}
                onOpenWorkspaceFile={onOpenWorkspaceFile}
                animate={!branchSwitching}
                rowRef={(node) => setMessageRowRef(index, node)}
              />
            ) : (
              <CollapsedTurnEvents
                key={`collapsed-${index}-${item.messages.map((message) => message.id).join(':')}`}
                messages={item.messages}
                copiedMessageId={copiedMessageId}
                onCopy={(message) => void copyMessage(message)}
                onOpenWorkspaceFile={onOpenWorkspaceFile}
                animate={!branchSwitching}
                rowRef={(node) => setMessageRowRef(index, node)}
              />
            ))}
            {pendingVisible && <PendingAssistant snapshot={snapshot} onOpenWorkspaceFile={onOpenWorkspaceFile} />}
          </div>
        ) : (
          <V2Empty
            icon={<Sparkles size={28} />}
            title="Start with a prompt"
            body="Use a command, mention a file, or attach a screenshot to give Pi useful context."
            action={(
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => insertTrigger('/')} className="inline-flex h-8 items-center gap-2 rounded-full bg-card px-3 text-xs text-[var(--color-text-secondary)] shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]">
                  <Slash size={13} />
                  Command
                </button>
                <button type="button" onClick={() => insertTrigger('@')} className="inline-flex h-8 items-center gap-2 rounded-full bg-card px-3 text-xs text-[var(--color-text-secondary)] shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]">
                  <AtSign size={13} />
                  Mention file
                </button>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-8 items-center gap-2 rounded-full bg-card px-3 text-xs text-[var(--color-text-secondary)] shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]">
                  <Paperclip size={13} />
                  Attach
                </button>
                <button type="button" onClick={openDiagramEditor} className="inline-flex h-8 items-center gap-2 rounded-full bg-card px-3 text-xs text-[var(--color-text-secondary)] shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]">
                  <PenLine size={13} />
                  Sketch
                </button>
              </div>
            )}
          />
        )}
        {!isAtLatest && (
          <button
            type="button"
            onClick={() => {
              stickToLatestRef.current = true;
              setIsAtLatest(true);
              scrollToLatest('smooth');
            }}
            className="sticky bottom-2 z-20 mx-auto mt-3 flex w-fit items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] shadow-[var(--shadow-card-hover)] transition-colors hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)]"
          >
            <ChevronDown size={13} />
            Latest activity
          </button>
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
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-[1.35rem] border-2 border-dashed border-accent bg-[var(--color-card)]/88 backdrop-blur-sm animate-fadeIn">
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
                  {attachment.source && (
                    <button
                      type="button"
                      onClick={() => editDiagramAttachment(attachment)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]"
                      title="Edit diagram"
                      aria-label="Edit diagram"
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                  {!attachment.source && (
                    <button
                      type="button"
                      onClick={() => annotateImageAttachment(attachment)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]"
                      title="Annotate image"
                      aria-label="Annotate image"
                    >
                      <PenLine size={11} />
                    </button>
                  )}
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
          {(sendError || editError) && (
            <div className="mx-3 mt-2 rounded-xl bg-[var(--color-error)]/10 px-3 py-2 text-xs text-[var(--color-error)] md:mx-4">
              {sendError || editError}
            </div>
          )}
          {visibleSuggestions.length > 0 && (
            <div className="absolute bottom-full left-3 right-3 z-30 mb-2 overflow-hidden rounded-xl border border-subtle bg-card p-1 shadow-[var(--shadow-card-hover)] animate-popover-rise">
              <div className="flex items-center justify-between px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-dim">
                <span>{activeToken?.prefix === '@' ? 'Workspace files' : 'Commands'}</span>
                {!isMobile && <span className="normal-case tracking-normal">Enter to insert</span>}
              </div>
              <div className="max-h-56 overflow-y-auto">
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
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${
                        selected ? 'bg-accent/10 text-[var(--color-text-primary)]' : 'hover:bg-secondary'
                      } ${suggestion.disabled ? 'cursor-default opacity-70' : ''}`}
                    >
                      <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary ${selected ? 'text-accent' : 'text-dim'}`}>
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

          <TokenAwareComposer
            ref={composerRef}
            value={draft}
            placeholder={editingMessage ? 'Edit this message and send to continue...' : isStreaming ? (streamingMode === 'steer' ? 'Steer the current turn...' : 'Queue a follow-up...') : isActiveConversation ? 'Send a prompt to Pi...' : 'Resume the conversation before sending a prompt'}
            disabled={composerDisabled}
            minHeight={composerMinHeight}
            maxHeight={composerMaxHeight}
            referenceRanges={composerReferenceRanges}
            activeTokenRange={activeTokenRange}
            onChange={(nextDraft, nextSelection) => {
              if (editingMessage && editError) setEditError(null);
              setDraftWithSelection(nextDraft, nextSelection);
            }}
            onSelectionChange={setSelection}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onPasteFiles={handleComposerPaste}
            onKeyCommand={handleComposerKeyCommand}
            onOpenWorkspaceFile={onOpenWorkspaceFile}
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
              <button type="button" onClick={openDiagramEditor} disabled={composerDisabled} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-45" title="Sketch diagram" aria-label="Sketch diagram">
                <PenLine size={16} />
              </button>
              <button type="button" onClick={() => insertTrigger('/')} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]" title="Insert command" aria-label="Insert command">
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
              {editingMessage && (
                <span className="ml-1 inline-flex h-7 max-w-[11rem] items-center gap-1.5 rounded-full border border-subtle bg-primary px-2 text-xs text-[var(--color-text-secondary)] shadow-sm">
                  <Pencil size={12} className="shrink-0 text-dim" />
                  <span className="min-w-0 truncate">Editing</span>
                  <button
                    type="button"
                    onClick={cancelEditingMessage}
                    disabled={editTreeMessage.isPending}
                    className="-mr-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-dim hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-50"
                    title="Cancel edit"
                    aria-label="Cancel edit"
                  >
                    <X size={12} />
                  </button>
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
                      title={mode === 'steer' ? 'Steer the turn Pi is currently producing' : 'Queue the next prompt after this turn'}
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
                <button type="button" onClick={() => void stopStreaming()} disabled={abortPending} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-error)] hover:bg-[var(--color-error)]/10 disabled:opacity-50" title="Stop current turn" aria-label="Stop current turn">
                  {abortPending ? <Loader2 size={14} className="animate-spin" /> : <Square size={13} />}
                </button>
              )}
              <div ref={modelMenuRef} className="relative max-w-[14rem]">
                <button
                  type="button"
                  disabled={composerDisabled || isStreaming || modelSwitching || models.length === 0}
                  onClick={() => {
                    setModelMenuOpen((open) => !open);
                    setModelSearch('');
                    setSelectedModelIndex(0);
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
                  <div className="absolute bottom-full right-0 z-50 mb-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-subtle bg-card p-2 shadow-[0_18px_60px_rgba(15,23,42,0.18)] animate-popover-rise">
                    <div className="pb-1">
                      <input
                        autoFocus
                        value={modelSearch}
                        onChange={(event) => {
                          setModelSearch(event.target.value);
                          setSelectedModelIndex(0);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            setSelectedModelIndex((current) => Math.min(filteredModels.length - 1, current + 1));
                            return;
                          }
                          if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            setSelectedModelIndex((current) => Math.max(0, current - 1));
                            return;
                          }
                          if (event.key === 'Enter' && selectedFilteredModel) {
                            event.preventDefault();
                            onSetModel(selectedFilteredModel.provider, selectedFilteredModel.id);
                            setModelMenuOpen(false);
                          }
                        }}
                        placeholder="Search models"
                        className="h-9 w-full rounded-xl bg-primary px-3 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-dim"
                      />
                    </div>
                    <div className="max-h-60 overflow-y-auto" role="listbox">
                      {filteredModels.length === 0 ? (
                        <div className="px-3 py-6 text-center text-sm text-dim">No models found</div>
                      ) : filteredModels.map((model, index) => {
                        const selected = selectedModel?.provider === model.provider && selectedModel.id === model.id;
                        const highlighted = index === selectedModelIndex;
                        return (
                          <button
                            key={modelOptionValue(model.provider, model.id)}
                            ref={(el) => { modelOptionRefs.current[index] = el; }}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onMouseEnter={() => setSelectedModelIndex(index)}
                            onClick={() => {
                              onSetModel(model.provider, model.id);
                              setModelMenuOpen(false);
                            }}
                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-secondary ${highlighted || selected ? 'bg-secondary' : ''}`}
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
                    <div className="px-1 pt-2">
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
                onClick={() => submitComposer(isStreaming ? streamingMode : undefined)}
                disabled={(!draft.trim() && attachments.length === 0) || composerDisabled}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-card)] shadow-[0_7px_16px_rgba(15,23,42,0.16)] transition-transform duration-150 ease-out-quart hover:scale-[1.03] active:scale-95 disabled:scale-100 disabled:opacity-35"
                title={isStreaming ? (streamingMode === 'steer' ? 'Steer current turn' : 'Queue follow-up') : 'Send'}
                aria-label={isStreaming ? (streamingMode === 'steer' ? 'Steer current turn' : 'Queue follow-up') : 'Send'}
              >
                {sending || editTreeMessage.isPending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={20} strokeWidth={2.2} />}
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
          onForkConversation={() => requestForkConversation({ kind: 'current' })}
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
      <ForkConversationDialog
        state={forkDialog}
        pending={forkDialogPending}
        error={forkDialogError}
        onChangeTitle={(title) => {
          setForkDialog((current) => current ? { ...current, title } : current);
          setForkDialogError(null);
        }}
        onClose={() => {
          if (!forkDialogPending) setForkDialog(null);
        }}
        onConfirm={() => void confirmForkConversation()}
      />
      <Suspense fallback={diagramEditor ? <DiagramEditorLoading /> : null}>
        {diagramEditor && (
          <ExcalidrawDiagramDialog
            initialSource={diagramEditor.mode === 'edit' ? diagramEditor.source : undefined}
            annotationSeed={diagramEditor.mode === 'annotate' ? diagramEditor.seed : undefined}
            onAttach={attachDiagram}
            onClose={() => setDiagramEditor(null)}
          />
        )}
      </Suspense>
    </div>
  );
}

function DiagramEditorLoading() {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-primary text-sm text-dim">
      <span className="inline-flex items-center gap-2 rounded-xl border border-subtle bg-card px-4 py-3 shadow-card">
        <Loader2 size={15} className="animate-spin text-accent" />
        Loading sketch editor
      </span>
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

function ForkConversationDialog({
  state,
  pending,
  error,
  onChangeTitle,
  onClose,
  onConfirm,
}: {
  state: ForkDialogState | null;
  pending: boolean;
  error: string | null;
  onChangeTitle: (title: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const title = state?.title ?? '';
  return (
    <Modal
      open={Boolean(state)}
      onClose={onClose}
      title="Fork conversation"
      size="sm"
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button size="xs" variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
          <Button size="xs" loading={pending} disabled={!title.trim()} onClick={onConfirm}>Fork</Button>
        </div>
      )}
    >
      <div className="space-y-3 px-5 py-4">
        <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
          {state?.kind === 'message' ? 'Start a new conversation from this reply.' : 'Start a new conversation from the current state.'}
        </p>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-dim">Name</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => onChangeTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && title.trim() && !pending) onConfirm();
            }}
            className="h-10 w-full rounded-lg bg-primary px-3 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent transition-shadow placeholder:text-dim focus:ring-accent/40"
            placeholder="Conversation name"
          />
        </label>
        {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
      </div>
    </Modal>
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
  const [actionError, setActionError] = useState<string | null>(null);
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
    setActionError(error instanceof Error ? error.message : fallback);
  };

  const setAutoCompaction = useMutation({
    mutationFn: (enabled: boolean) => v2Api.setConversationAutoCompaction(conversationId, { enabled }),
    onSuccess: (nextSnapshot) => {
      applyAndRefresh(nextSnapshot);
      setActionError(null);
    },
    onError: reportError('Could not update auto-compaction.'),
  });
  const compact = useMutation({
    mutationFn: () => v2Api.compactConversation(conversationId, { customInstructions: compactInstructions.trim() || undefined }),
    onSuccess: (nextSnapshot) => {
      applyAndRefresh(nextSnapshot);
      setCompactInstructions('');
      setActionError(null);
    },
    onError: reportError('Could not compact context.'),
  });
  const exportHTML = useMutation({
    mutationFn: () => v2Api.exportConversationHTML(conversationId),
    onSuccess: () => setActionError(null),
    onError: reportError('Could not export conversation.'),
  });
  const reloadPi = useMutation({
    mutationFn: () => v2Api.reloadConversationPi(conversationId),
    onSuccess: (nextSnapshot) => {
      applyAndRefresh(nextSnapshot);
      setActionError(null);
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
    setActionError(null);
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
          setActionError(null);
        }}
        className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-[var(--color-text-secondary)] transition-colors hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-50"
        title="Conversation actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={16} />
        <span className="hidden sm:inline">Conversation</span>
        <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(26rem,calc(100vw-1rem))] rounded-2xl border border-subtle bg-card p-3 shadow-[0_18px_60px_rgba(15,23,42,0.18)]">
          <div className="px-1 pb-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{state?.sessionName || 'Conversation'}</p>
              {sessionQuery.isFetching && <Loader2 size={13} className="shrink-0 animate-spin text-dim" />}
            </div>
            <p className="mt-0.5 truncate text-xs text-dim">{state?.sessionFile || state?.workDir || 'Session details load when Pi is active.'}</p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 px-1 pt-1">
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

            <div>
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
              <div className="grid gap-x-4 gap-y-1 px-1 text-xs sm:grid-cols-2">
                {statRows.map(([label, value]) => (
                  <div key={label} className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate text-dim">{label}</span>
                    <span className="truncate font-medium text-[var(--color-text-secondary)]">{value}</span>
                  </div>
                ))}
              </div>
            )}
            {actionError && (
              <div className="px-1 text-xs text-[var(--color-error)]">
                {actionError}
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
      className={`relative h-6 w-10 shrink-0 rounded-full p-0.5 shadow-inner transition-colors duration-150 disabled:opacity-50 ${
        checked ? 'bg-accent' : 'bg-primary'
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--color-card)] shadow-[0_1px_4px_rgba(15,23,42,0.22)] transition-transform duration-150 ease-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
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
  forkTarget,
  onRequestFork,
  version,
  versionPending = false,
  onSelectVersion,
  onEdit,
  editDisabled = false,
  onOpenWorkspaceFile,
  animate = true,
  rowRef,
}: {
  message: PiConversationMessage;
  copied: boolean;
  compact?: boolean;
  forkPending?: boolean;
  onCopy: () => void;
  forkTarget?: ForkDialogTarget | null;
  onRequestFork?: (target: ForkDialogTarget) => void;
  version?: PiConversationMessageVersionInfo;
  versionPending?: boolean;
  onSelectVersion?: (leafId: string) => void;
  onEdit?: () => void;
  editDisabled?: boolean;
  onOpenWorkspaceFile?: (path: string, line?: number, isDirectory?: boolean) => void;
  animate?: boolean;
  rowRef?: (node: HTMLElement | null) => void;
}) {
  const isUser = message.role === 'user';
  if (isToolMessage(message)) {
    return <ToolResultRow message={message} compact={compact} animate={animate} rowRef={rowRef} onOpenWorkspaceFile={onOpenWorkspaceFile} />;
  }

  if (isUser) {
    return (
      <div ref={rowRef as ((node: HTMLDivElement | null) => void) | undefined} className={`group flex justify-end ${animate ? 'animate-message-enter' : ''}`}>
        <div className="max-w-[90%] md:max-w-[min(74%,46rem)]">
          <div className="rounded-2xl rounded-br-md bg-[var(--color-accent)]/8 px-2.5 py-2 text-sm leading-6 text-[var(--color-text-primary)] md:px-3">
            {message.text && <MarkdownRenderer enhanceCodeburgRefs onOpenWorkspaceFile={onOpenWorkspaceFile}>{message.text}</MarkdownRenderer>}
            <MessageImages images={message.images ?? []} />
            <ToolCallSummary message={message} />
          </div>
          <MessageActions
            copied={copied}
            align="right"
            canEdit={Boolean(!compact && onEdit && version?.canEdit)}
            editDisabled={editDisabled}
            version={version}
            versionPending={versionPending}
            onCopy={onCopy}
            onEdit={onEdit}
            onSelectVersion={onSelectVersion}
          />
        </div>
      </div>
    );
  }
  return (
    <article ref={rowRef as ((node: HTMLElement | null) => void) | undefined} className={`group w-full max-w-[74ch] text-sm leading-6 ${animate ? 'animate-message-enter' : ''} ${message.isError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]'}`}>
      <div>
        {message.thinking && <CollapsibleEvent icon={<Sparkles size={14} />} title="Thinking" body={message.thinking} />}
        {message.text && <MarkdownRenderer enhanceCodeburgRefs onOpenWorkspaceFile={onOpenWorkspaceFile}>{message.text}</MarkdownRenderer>}
        <ToolCallSummary message={message} />
      </div>
      <MessageActions
        copied={copied}
        canFork={Boolean(!compact && forkTarget && onRequestFork)}
        forkPending={forkPending}
        onCopy={onCopy}
        onFork={() => forkTarget && onRequestFork?.(forkTarget)}
      />
    </article>
  );
}

function MessageVersionControls({
  version,
  pending,
  onSelectVersion,
}: {
  version: PiConversationMessageVersionInfo;
  pending: boolean;
  onSelectVersion?: (leafId: string) => void;
}) {
  const previousDisabled = pending || !version.previousLeafId || !onSelectVersion;
  const nextDisabled = pending || !version.nextLeafId || !onSelectVersion;
  return (
    <div className="inline-flex h-7 items-center gap-0.5 rounded-md px-0.5 text-[11px] font-medium text-dim">
      <button
        type="button"
        disabled={previousDisabled}
        onClick={() => version.previousLeafId && onSelectVersion?.(version.previousLeafId)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-25 disabled:hover:bg-transparent"
        title="Previous version"
        aria-label="Previous message version"
      >
        <ChevronLeft size={13} />
      </button>
      <span className="min-w-7 text-center tabular-nums text-[var(--color-text-secondary)]">{version.versionIndex}/{version.versionCount}</span>
      <button
        type="button"
        disabled={nextDisabled}
        onClick={() => version.nextLeafId && onSelectVersion?.(version.nextLeafId)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-25 disabled:hover:bg-transparent"
        title="Next version"
        aria-label="Next message version"
      >
        <ChevronRight size={13} />
      </button>
    </div>
  );
}

interface AttachmentPreviewTarget {
  image: PiConversationImageAttachment;
  source?: ExcalidrawDiagramSource;
}

function MessageImages({ images }: { images: PiConversationImageAttachment[] }) {
  const [diagramSources, setDiagramSources] = useState<Record<number, ExcalidrawDiagramSource>>({});
  const [previewTarget, setPreviewTarget] = useState<AttachmentPreviewTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDiagramSources({});
    const pngImages = images
      .map((image, index) => ({ image, index }))
      .filter(({ image }) => image.mimeType === 'image/png' && image.data.trim());
    if (pngImages.length === 0) return () => { cancelled = true; };

    void Promise.all(pngImages.map(async ({ image, index }) => ({
      index,
      source: await recoverCachedEmbeddedExcalidrawSource(image),
    }))).then((entries) => {
      if (cancelled) return;
      const nextSources: Record<number, ExcalidrawDiagramSource> = {};
      for (const entry of entries) {
        if (entry.source) nextSources[entry.index] = entry.source;
      }
      setDiagramSources(nextSources);
    });

    return () => { cancelled = true; };
  }, [images]);

  if (images.length === 0) return null;
  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {images.map((image, index) => {
          const source = diagramSources[index];
          return (
            <button
              key={`${image.mimeType}-${index}`}
              type="button"
              onClick={() => setPreviewTarget({ image, source })}
              className="group relative overflow-hidden rounded-lg bg-primary/80 text-left ring-1 ring-[var(--color-card-border)] transition-shadow hover:shadow-[var(--shadow-card-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
              title={source ? 'Open diagram preview' : 'Open image preview'}
              aria-label={source ? 'Open diagram preview' : 'Open image preview'}
            >
              <img
                src={imageDataUrl(image)}
                alt="Attached screenshot"
                className="h-full max-h-64 w-full object-contain transition-transform duration-200 ease-out-quart group-hover:scale-[1.01]"
              />
              {source && (
                <span className="absolute left-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--color-text-primary)]/88 text-[var(--color-card)] shadow-sm backdrop-blur-sm" title="Diagram" aria-label="Diagram">
                  <Shapes size={13} />
                </span>
              )}
              <span className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--color-text-primary)]/82 text-[var(--color-card)] opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Maximize2 size={13} />
              </span>
            </button>
          );
        })}
      </div>
      <Suspense fallback={previewTarget ? <AttachmentPreviewLoading /> : null}>
        {previewTarget?.source ? (
          <ExcalidrawDiagramViewerDialog
            source={previewTarget.source}
            onClose={() => setPreviewTarget(null)}
          />
        ) : previewTarget ? (
          <ImageAttachmentPreviewDialog
            image={previewTarget.image}
            onClose={() => setPreviewTarget(null)}
          />
        ) : null}
      </Suspense>
    </>
  );
}

function AttachmentPreviewLoading() {
  return (
    <div className="fixed inset-0 z-[85] grid place-items-center bg-primary text-sm text-dim">
      <span className="inline-flex items-center gap-2 rounded-xl border border-subtle bg-card px-4 py-3 shadow-card">
        <Loader2 size={15} className="animate-spin text-accent" />
        Loading preview
      </span>
    </div>
  );
}

function ImageAttachmentPreviewDialog({ image, onClose }: { image: PiConversationImageAttachment; onClose: () => void }) {
  const desktopShell = isDesktopShell();
  const headerClassName = [
    'flex h-12 shrink-0 items-center justify-between border-b border-subtle bg-card shadow-card',
    desktopShell ? 'desktop-drag-region pl-[72px] pr-3' : 'px-3',
  ].join(' ');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[85] flex flex-col bg-primary text-[var(--color-text-primary)]" role="dialog" aria-modal="true" aria-label="Image preview">
      <header className={headerClassName}>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Image preview</div>
          <div className="hidden text-[11px] text-dim sm:block">{image.mimeType}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]"
          title="Close preview"
          aria-label="Close preview"
        >
          <X size={15} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--color-canvas)] p-4 sm:p-6">
        <img
          src={imageDataUrl(image)}
          alt="Attached screenshot preview"
          className="max-h-full max-w-full rounded-xl bg-card object-contain shadow-[var(--shadow-card-hover)] ring-1 ring-[var(--color-card-border)]"
        />
      </div>
    </div>,
    document.body,
  );
}

function CollapsedTurnEvents({
  messages,
  copiedMessageId,
  onCopy,
  onOpenWorkspaceFile,
  animate = true,
  rowRef,
}: {
  messages: PiConversationMessage[];
  copiedMessageId: string | null;
  onCopy: (message: PiConversationMessage) => void;
  onOpenWorkspaceFile?: (path: string, line?: number, isDirectory?: boolean) => void;
  animate?: boolean;
  rowRef?: (node: HTMLElement | null) => void;
}) {
  const toolCount = messages.filter((message) => isToolMessage(message) || (message.toolCalls?.length ?? 0) > 0).length;
  const thinkingCount = messages.filter((message) => Boolean(message.thinking)).length;
  const labelParts = [
    thinkingCount > 0 ? `${thinkingCount} thinking` : null,
    toolCount > 0 ? `${toolCount} tool ${toolCount === 1 ? 'event' : 'events'}` : null,
  ].filter(Boolean);

  return (
    <details ref={rowRef as ((node: HTMLDetailsElement | null) => void) | undefined} className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 py-1 text-xs text-dim transition-colors hover:text-[var(--color-text-secondary)]">
        <span>{labelParts.join(', ') || `${messages.length} background ${messages.length === 1 ? 'event' : 'events'}`}</span>
        <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 space-y-3 pl-4 text-[var(--color-text-secondary)]">
        {messages.map((message, index) => (
          <MessageRow
            key={message.id || `${message.role}-${index}`}
            message={message}
            compact
            copied={copiedMessageId === message.id}
            onCopy={() => onCopy(message)}
            onOpenWorkspaceFile={onOpenWorkspaceFile}
            animate={animate}
          />
        ))}
      </div>
    </details>
  );
}

function MessageActions({
  copied,
  align = 'left',
  canFork = false,
  forkPending = false,
  canEdit = false,
  editDisabled = false,
  version,
  versionPending = false,
  onCopy,
  onFork,
  onEdit,
  onSelectVersion,
}: {
  copied: boolean;
  align?: 'left' | 'right';
  canFork?: boolean;
  forkPending?: boolean;
  canEdit?: boolean;
  editDisabled?: boolean;
  version?: PiConversationMessageVersionInfo;
  versionPending?: boolean;
  onCopy: () => void;
  onFork?: () => void;
  onEdit?: () => void;
  onSelectVersion?: (leafId: string) => void;
}) {
  return (
    <div className={`mt-1.5 flex h-7 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${align === 'right' ? 'justify-end' : ''}`}>
      <button type="button" onClick={onCopy} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-dim hover:bg-secondary hover:text-[var(--color-text-primary)]" title="Copy message" aria-label="Copy message">
        {copied ? <Check size={14} /> : <Clipboard size={14} />}
      </button>
      {canEdit && (
        <button type="button" onClick={onEdit} disabled={editDisabled} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-dim hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-40" title="Edit and continue from here" aria-label="Edit and continue from here">
          <Pencil size={14} />
        </button>
      )}
      {version && version.versionCount > 1 && (
        <MessageVersionControls
          version={version}
          pending={versionPending}
          onSelectVersion={onSelectVersion}
        />
      )}
      {canFork && (
        <button type="button" onClick={onFork} disabled={forkPending} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-dim hover:bg-secondary hover:text-[var(--color-text-primary)] disabled:opacity-50" title="Fork from here" aria-label="Fork from here">
          {forkPending ? <Loader2 size={14} className="animate-spin" /> : <GitBranchPlus size={14} />}
        </button>
      )}
    </div>
  );
}

function ToolResultRow({ message, compact, animate = true, rowRef, onOpenWorkspaceFile }: { message: PiConversationMessage; compact?: boolean; animate?: boolean; rowRef?: (node: HTMLElement | null) => void; onOpenWorkspaceFile?: (path: string, line?: number, isDirectory?: boolean) => void }) {
  return (
    <details ref={rowRef as ((node: HTMLDetailsElement | null) => void) | undefined} className={`group text-xs ${compact ? '' : 'mx-0'} ${animate ? 'animate-message-enter' : ''}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-dim transition-colors hover:text-[var(--color-text-secondary)]">
        <Wrench size={13} />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-text-secondary)]">{toolMessageTitle(message)}</span>
        {message.isError && <span className="text-[var(--color-error)]">error</span>}
        <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
      </summary>
      {message.text && (
        <div className="mt-1 pl-5 text-[var(--color-text-secondary)]">
          {message.text && <MarkdownRenderer enhanceCodeburgRefs onOpenWorkspaceFile={onOpenWorkspaceFile}>{message.text}</MarkdownRenderer>}
        </div>
      )}
    </details>
  );
}

function PendingAssistant({ snapshot, onOpenWorkspaceFile }: { snapshot: PiConversationSnapshot | null; onOpenWorkspaceFile?: (path: string, line?: number, isDirectory?: boolean) => void }) {
  if (!snapshot) return null;
  const activitySummary = assistantActivitySummary(snapshot);
  const hasActivity = Boolean(snapshot.pending?.thinking || (snapshot.pending?.toolCalls?.length ?? 0) > 0 || (snapshot.tools?.length ?? 0) > 0);
  return (
    <article className="max-w-[74ch] animate-message-enter space-y-4 text-sm leading-6 text-[var(--color-text-primary)]">
      {hasActivity && (
        <details className="group" open={!snapshot.pending?.text}>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-dim transition-colors hover:text-[var(--color-text-secondary)]">
            <span className="relative flex h-2 w-2">
              {snapshot.streaming && <span className="absolute inline-flex h-full w-full rounded-full bg-accent/60 motion-safe:animate-ping" />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${snapshot.streaming ? 'bg-accent' : 'bg-[var(--color-text-dim)]'}`} />
            </span>
            <span>{activitySummary}</span>
            <ChevronDown size={15} className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 space-y-2 pl-4 text-sm text-dim">
            {snapshot.pending?.thinking && <ActivityDisclosure icon={<Sparkles size={14} />} title="Thinking" body={snapshot.pending.thinking} />}
            <ToolCallsList toolCalls={snapshot.pending?.toolCalls ?? []} compact />
            <ToolExecutionList tools={snapshot.tools ?? []} />
          </div>
        </details>
      )}
      {snapshot.pending?.text && <MarkdownRenderer enhanceCodeburgRefs onOpenWorkspaceFile={onOpenWorkspaceFile}>{snapshot.pending.text}</MarkdownRenderer>}
      {snapshot.streaming && !snapshot.pending?.text && !hasActivity && (
        <div className="flex items-center gap-2 text-xs text-dim">
          <Loader2 size={13} className="animate-spin" />
          <span>Working through the next step...</span>
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
        <details key={tool.toolCallId || `${tool.toolName}-${index}`} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-dim transition-colors hover:text-[var(--color-text-secondary)]">
            {tool.status === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
            <span>{toolActivityLabel(tool)}</span>
            {tool.isError && <span className="text-[var(--color-error)]">error</span>}
            <ChevronDown size={13} className="ml-auto transition-transform group-open:rotate-180" />
          </summary>
          {tool.output && <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap pl-5 font-mono text-[11px] text-[var(--color-text-secondary)]">{tool.output}</pre>}
        </details>
      ))}
    </div>
  );
}

function ToolCallSummary({ message }: { message: PiConversationMessage }) {
  return <ToolCallsList toolCalls={message.toolCalls ?? []} />;
}

function ToolCallsList({ toolCalls, compact = false }: { toolCalls: NonNullable<PiConversationMessage['toolCalls']>; compact?: boolean }) {
  if (toolCalls.length === 0) return null;
  return (
    <div className={`${compact ? '' : 'mt-3'} space-y-2`}>
      {toolCalls.map((tool, index) => (
        <details key={tool.id || index} className="group text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-dim transition-colors hover:text-[var(--color-text-secondary)]">
            <Command size={13} />
            <span>{tool.name ? `Called ${tool.name}` : 'Called a tool'}</span>
            <ChevronDown size={13} className="ml-auto transition-transform group-open:rotate-180" />
          </summary>
          {tool.arguments && <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap pl-5 font-mono text-[11px] text-[var(--color-text-secondary)]">{tool.arguments}</pre>}
        </details>
      ))}
    </div>
  );
}

function CollapsibleEvent({ icon, title, body }: { icon: ReactNode; title: string; body: ReactNode }) {
  return <ActivityDisclosure icon={icon} title={title} body={body} />;
}

function ActivityDisclosure({ icon, title, body }: { icon: ReactNode; title: string; body: ReactNode }) {
  return (
    <details className="group mb-3 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-dim transition-colors hover:text-[var(--color-text-secondary)]">
        {icon}
        <span>{title}</span>
        <span className="ml-auto">details</span>
        <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
      </summary>
      {body && <div className="mt-1 whitespace-pre-wrap pl-5 text-[var(--color-text-secondary)]">{body}</div>}
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

function assistantActivitySummary(snapshot: PiConversationSnapshot): string {
  const toolExecutions = snapshot.tools ?? [];
  const toolCalls = snapshot.pending?.toolCalls ?? [];
  const runningCount = toolExecutions.filter((tool) => tool.status === 'running').length;
  const completedCount = toolExecutions.length - runningCount;
  const parts = [
    snapshot.pending?.thinking ? 'thinking' : null,
    toolCalls.length > 0 ? `${toolCalls.length} ${toolCalls.length === 1 ? 'tool call' : 'tool calls'}` : null,
    runningCount > 0 ? `${runningCount} running` : null,
    completedCount > 0 ? `${completedCount} done` : null,
  ].filter(Boolean);
  if (parts.length === 0) return snapshot.streaming ? 'Working' : 'Activity';
  return `${snapshot.streaming ? 'Working' : 'Activity'}: ${parts.join(', ')}`;
}

function toolActivityLabel(tool: PiToolExecution): string {
  const name = tool.toolName || 'tool';
  if (tool.status === 'running') return `Running ${name}`;
  if (tool.isError) return `${name} failed`;
  if (tool.status === 'completed' || tool.status === 'done') return `Ran ${name}`;
  return `${name} ${tool.status}`;
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

function messageForkTarget(message: PiConversationMessage, messages: PiConversationMessage[]): ForkDialogTarget | null {
  if (message.role !== 'assistant' || !message.text?.trim()) return null;
  if (message.entryId) return { kind: 'message', entryId: message.entryId, position: 'at' };
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return { kind: 'current' };
  const nextUser = messages.slice(index + 1).find((candidate) => candidate.role === 'user' && candidate.entryId);
  if (nextUser?.entryId) return { kind: 'message', entryId: nextUser.entryId, position: 'before' };
  return { kind: 'current' };
}

function defaultForkTitle(title?: string): string {
  return cleanForkTitle(undefined, title);
}

function cleanForkTitle(title?: string, fallback?: string): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  return `${fallback?.trim() || 'Conversation'} fork`;
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

function slashCommandDisplay(command: PiSlashCommand): { label: string; detail: string } {
  const skillName = skillCommandName(command.name);
  if (skillName) {
    return {
      label: skillName,
      detail: command.description ? `Skill: ${command.description}` : 'Skill',
    };
  }
  return {
    label: `/${command.name}`,
    detail: command.description || command.source || 'Pi command',
  };
}

function skillCommandName(commandName: string): string | null {
  return commandName.startsWith('skill:') ? commandName.slice('skill:'.length) : null;
}

function uniqueComposerReferences(references: CodeburgReference[]): CodeburgReference[] {
  const seen = new Set<string>();
  const unique: CodeburgReference[] = [];
  for (const reference of references) {
    const key = reference.kind === 'skill'
      ? `skill:${reference.name}`
      : `file:${normalizeReferencePath(reference.path)}:${reference.line ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(reference);
  }
  return unique.slice(0, 8);
}

function enrichComposerReferenceRangeTypes(ranges: CodeburgReferenceRange[], fileEntries: V2FileEntry[]): CodeburgReferenceRange[] {
  if (fileEntries.length === 0) return ranges;
  const entryTypes = new Map(fileEntries.map((entry) => [normalizeReferencePath(entry.path), entry.type]));
  return ranges.map((range) => {
    const { reference } = range;
    if (reference.kind !== 'file') return range;
    const path = normalizeReferencePath(reference.path);
    return {
      ...range,
      reference: {
        ...reference,
        path,
        isDirectory: reference.isDirectory || entryTypes.get(path) === 'dir',
      },
    };
  });
}

function normalizeReferencePath(path: string): string {
  return path.replace(/\/+$/, '');
}

function normalizeComposerPromptText(text: string, ranges: CodeburgReferenceRange[]): string {
  let next = text;
  const orderedRanges = [...ranges].sort((a, b) => b.from - a.from);
  for (const range of orderedRanges) {
    const { reference } = range;
    if (reference.kind !== 'file' || !reference.isDirectory || reference.line) continue;
    const raw = next.slice(range.from, range.to);
    if (raw.endsWith('/')) continue;
    next = `${next.slice(0, range.from)}@${reference.path}/${next.slice(range.to)}`;
  }
  return next;
}

function appendWorkspaceReference(draft: string, path: string): string {
  const cleanPath = path.trim();
  if (!cleanPath) return draft;
  const reference = `@${cleanPath}`;
  const withoutTrailingSpace = draft.replace(/\s+$/, '');
  if (!withoutTrailingSpace) return `${reference} `;
  const needsLeadingSpace = !/\s$/.test(withoutTrailingSpace);
  return `${withoutTrailingSpace}${needsLeadingSpace ? ' ' : ''}${reference} `;
}

function appendDraftText(draft: string, text: string): string {
  const cleanText = text.trim();
  if (!cleanText) return draft;
  const withoutTrailingSpace = draft.replace(/\s+$/, '');
  if (!withoutTrailingSpace) return `${cleanText} `;
  const needsLeadingSpace = !/\s$/.test(withoutTrailingSpace);
  return `${withoutTrailingSpace}${needsLeadingSpace ? ' ' : ''}${cleanText} `;
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

function messageImagesToComposerAttachments(images?: PiConversationImageAttachment[]): ComposerAttachment[] {
  return (images ?? [])
    .filter((image) => image.data.trim() && image.mimeType.trim())
    .map((image, index) => {
      const mimeType = image.mimeType.trim();
        return {
          id: `message-image-${index}-${crypto.randomUUID()}`,
          name: `attachment-${index + 1}.${imageExtension(mimeType)}`,
          previewUrl: imageDataUrl({ ...image, mimeType }),
          image: {
            type: 'image',
            data: image.data,
          mimeType,
        },
      };
    });
}

async function hydrateEmbeddedExcalidrawSources(attachments: ComposerAttachment[]): Promise<ComposerAttachment[]> {
  const hydrated = await Promise.all(attachments.map(async (attachment) => {
    const source = await recoverCachedEmbeddedExcalidrawSource(attachment.image);
    return source ? { ...attachment, source } : attachment;
  }));
  return hydrated;
}

function recoverCachedEmbeddedExcalidrawSource(image: PiConversationImageAttachment): Promise<ExcalidrawDiagramSource | undefined> {
  const key = embeddedSourceCacheKey(image);
  const cached = embeddedExcalidrawSourceCache.get(key);
  if (cached) return cached;
  const next = recoverEmbeddedExcalidrawSource(image);
  embeddedExcalidrawSourceCache.set(key, next);
  return next;
}

async function recoverEmbeddedExcalidrawSource(image: PiConversationImageAttachment): Promise<ExcalidrawDiagramSource | undefined> {
  if (image.mimeType !== 'image/png' || !image.data.trim()) return undefined;
  try {
    const { loadFromBlob } = await import('@excalidraw/excalidraw');
    const restored = await loadFromBlob(imageAttachmentToBlob(image), null, null);
    if (restored.elements.length === 0) return undefined;
    return {
      type: 'excalidraw',
      data: JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'codeburg',
        elements: restored.elements,
        appState: restored.appState,
        files: restored.files,
      }),
    };
  } catch {
    return undefined;
  }
}

function embeddedSourceCacheKey(image: PiConversationImageAttachment): string {
  const data = image.data.trim();
  return `${image.mimeType}:${data.length}:${data.slice(0, 48)}:${data.slice(-48)}`;
}

function imageDataUrl(image: PiConversationImageAttachment): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

function imageAttachmentToBlob(image: PiConversationImageAttachment): Blob {
  const binary = window.atob(image.data);
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < binary.length; offset += 8192) {
    const slice = binary.slice(offset, offset + 8192);
    const bytes = new Uint8Array(slice.length);
    for (let index = 0; index < slice.length; index += 1) {
      bytes[index] = slice.charCodeAt(index);
    }
    chunks.push(bytes.buffer as ArrayBuffer);
  }
  return new Blob(chunks, { type: image.mimeType });
}

function imageExtension(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/svg+xml') return 'svg';
  return 'png';
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

function terminalWorkspaceProjectId(project?: { id: string } | null, conversation?: { projectId: string } | null) {
  return project?.id ?? conversation?.projectId ?? '';
}

function nextConversationDestination(
  archivedConversationId: string,
  projectId: string,
  workspaceId: string | null,
  conversations: Conversation[],
) {
  const activeConversations = conversations.filter((candidate) => (
    candidate.id !== archivedConversationId && candidate.status === 'active'
  ));
  if (activeConversations.length > 0) {
    const archivedIndex = conversations.findIndex((candidate) => candidate.id === archivedConversationId);
    const nextIndex = archivedIndex >= 0 ? Math.min(archivedIndex, activeConversations.length - 1) : 0;
    return `/conversations/${activeConversations[nextIndex].id}`;
  }

  const params = new URLSearchParams();
  if (workspaceId) params.set('workspace', workspaceId);
  const query = params.toString();
  return `/projects/${projectId}${query ? `?${query}` : ''}`;
}

function removeConversationFromV2Caches(queryClient: QueryClient, conversationId: string) {
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

function workspaceBranchLabel(workspace: Workspace): string {
  return workspace.branchName || workspace.name;
}

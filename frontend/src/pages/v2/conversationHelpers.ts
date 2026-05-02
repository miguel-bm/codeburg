import type { DragEvent } from 'react';
import type { PiAvailableModel, PiConversationImageAttachment, PiConversationMessage, PiConversationSessionStats, PiSlashCommand } from '../../api/types';
import type { V2FileEntry } from '../../api/v2';
import type { CodeburgReference, CodeburgReferenceRange } from '../../components/chat/referenceTokens';
import type { ExcalidrawDiagramSource } from '../../components/chat/ExcalidrawDiagramDialog';
import type { ComposerAttachment, ComposerSuggestion, ConversationRenderItem, ForkDialogTarget, OptimisticConversationPrompt, QueuedFollowUp } from './conversationTypes';

const MAX_QUEUED_FOLLOW_UPS = 20;
const FOLLOW_UP_QUEUE_STORAGE_PREFIX = 'codeburg:pi-follow-ups:';
const embeddedExcalidrawSourceCache = new Map<string, Promise<ExcalidrawDiagramSource | undefined>>();

export function buildConversationItems(messages: PiConversationMessage[]): ConversationRenderItem[] {
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

export function createOptimisticConversationPrompt(
  baseMessageCount: number,
  text: string,
  images: PiConversationImageAttachment[],
): OptimisticConversationPrompt {
  const createdAt = new Date().toISOString();
  return {
    id: createOptimisticPromptId(),
    baseMessageCount,
    text,
    images,
    createdAt,
  };
}

function createOptimisticPromptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `optimistic-prompt-${crypto.randomUUID()}`;
  }
  return `optimistic-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function mergeOptimisticPrompts(
  messages: PiConversationMessage[],
  optimisticPrompts: OptimisticConversationPrompt[],
): PiConversationMessage[] {
  const missingPrompts = optimisticPrompts.filter((prompt) => !conversationMessagesIncludePrompt(messages, prompt));
  if (missingPrompts.length === 0) return messages;
  const merged = [...messages];
  const orderedPrompts = [...missingPrompts].sort((a, b) => a.baseMessageCount - b.baseMessageCount);
  orderedPrompts.forEach((prompt, index) => {
    merged.splice(Math.min(merged.length, prompt.baseMessageCount + index), 0, optimisticPromptToMessage(prompt));
  });
  return merged;
}

function optimisticPromptToMessage(prompt: OptimisticConversationPrompt): PiConversationMessage {
  return {
    id: prompt.id,
    role: 'user',
    text: prompt.text,
    images: prompt.images,
    timestamp: prompt.createdAt,
  };
}

function conversationMessagesIncludePrompt(
  messages: PiConversationMessage[],
  prompt: OptimisticConversationPrompt,
): boolean {
  return messages
    .slice(Math.max(0, prompt.baseMessageCount))
    .some((message) => userMessageMatchesOptimisticPrompt(message, prompt));
}

function userMessageMatchesOptimisticPrompt(
  message: PiConversationMessage,
  prompt: OptimisticConversationPrompt,
): boolean {
  if (message.role !== 'user') return false;
  const promptText = prompt.text.trim();
  const messageText = (message.text ?? '').trim();
  if (promptText) return messageText === promptText;
  if (messageText) return false;
  return imagesMatch(message.images ?? [], prompt.images);
}

function imagesMatch(left: PiConversationImageAttachment[], right: PiConversationImageAttachment[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((image, index) => {
    const other = right[index];
    return image.data === other.data && image.mimeType === other.mimeType;
  });
}

function isFinalAssistantMessage(message: PiConversationMessage): boolean {
  return message.role === 'assistant' && Boolean(message.text?.trim());
}

function isTurnNoiseMessage(message: PiConversationMessage): boolean {
  if (isToolMessage(message)) return true;
  if (message.role === 'assistant') return !message.text?.trim();
  return message.role !== 'user';
}

export function isToolMessage(message: PiConversationMessage): boolean {
  return message.role === 'toolResult' || message.role === 'bashExecution' || Boolean(message.toolName);
}

export function messageCopyText(message: PiConversationMessage): string {
  return [message.thinking, message.text].filter(Boolean).join('\n\n').trim();
}

export function messageForkTarget(message: PiConversationMessage, messages: PiConversationMessage[]): ForkDialogTarget | null {
  if (message.role !== 'assistant' || !message.text?.trim()) return null;
  if (message.entryId) return { kind: 'message', entryId: message.entryId, position: 'at' };
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return { kind: 'current' };
  const nextUser = messages.slice(index + 1).find((candidate) => candidate.role === 'user' && candidate.entryId);
  if (nextUser?.entryId) return { kind: 'message', entryId: nextUser.entryId, position: 'before' };
  return { kind: 'current' };
}

export function defaultForkTitle(title?: string): string {
  return cleanForkTitle(undefined, title);
}

export function cleanForkTitle(title?: string, fallback?: string): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  return `${fallback?.trim() || 'Conversation'} fork`;
}

export function lastAssistantText(snapshot: { messages: PiConversationMessage[] } | null): string {
  if (!snapshot) return '';
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message.role === 'assistant' && message.text?.trim()) {
      return message.text.trim();
    }
  }
  return '';
}

export function formatThinkingLevel(level?: string): string {
  if (!level) return 'Off';
  if (level === 'xhigh') return 'X high';
  return level.slice(0, 1).toUpperCase() + level.slice(1);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

export function sessionStatRows(session?: PiConversationSessionStats): Array<[string, string]> {
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

export function modelOptionValue(provider: string, id: string): string {
  return JSON.stringify([provider, id]);
}

export function compactModelLabel(model: Pick<PiAvailableModel, 'id' | 'provider'>): string {
  return model.provider ? `${model.id}` : model.id;
}

export function providerInitial(provider: string): string {
  return (provider.trim()[0] || 'M').toUpperCase();
}

export function fileSuggestion(entry: V2FileEntry): ComposerSuggestion {
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

export function slashCommandDisplay(command: PiSlashCommand): { label: string; detail: string } {
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

export function uniqueComposerReferences(references: CodeburgReference[]): CodeburgReference[] {
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

export function enrichComposerReferenceRangeTypes(ranges: CodeburgReferenceRange[], fileEntries: V2FileEntry[]): CodeburgReferenceRange[] {
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

export function normalizeComposerPromptText(text: string, ranges: CodeburgReferenceRange[]): string {
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

export function appendWorkspaceReference(draft: string, path: string): string {
  const cleanPath = path.trim();
  if (!cleanPath) return draft;
  const reference = `@${cleanPath}`;
  const withoutTrailingSpace = draft.replace(/\s+$/, '');
  if (!withoutTrailingSpace) return `${reference} `;
  const needsLeadingSpace = !/\s$/.test(withoutTrailingSpace);
  return `${withoutTrailingSpace}${needsLeadingSpace ? ' ' : ''}${reference} `;
}

export function appendDraftText(draft: string, text: string): string {
  const cleanText = text.trim();
  if (!cleanText) return draft;
  const withoutTrailingSpace = draft.replace(/\s+$/, '');
  if (!withoutTrailingSpace) return `${cleanText} `;
  const needsLeadingSpace = !/\s$/.test(withoutTrailingSpace);
  return `${withoutTrailingSpace}${needsLeadingSpace ? ' ' : ''}${cleanText} `;
}

export function findFirstEnabledSuggestionIndex(suggestions: ComposerSuggestion[]): number {
  const index = suggestions.findIndex((suggestion) => !suggestion.disabled);
  return index >= 0 ? index : 0;
}

export function nextEnabledSuggestionIndex(suggestions: ComposerSuggestion[], current: number, direction: 1 | -1): number {
  if (suggestions.length === 0) return 0;
  let next = current;
  for (let i = 0; i < suggestions.length; i += 1) {
    next = (next + direction + suggestions.length) % suggestions.length;
    if (!suggestions[next].disabled) return next;
  }
  return current;
}

export function queuedFollowUpPreview(item: QueuedFollowUp): string {
  const text = item.message.replace(/\s+/g, ' ').trim();
  if (text) return text;
  if (item.images.length === 1) return 'Image follow-up';
  return `${item.images.length} image follow-up`;
}

export function pruneQueuedFollowUps(items: QueuedFollowUp[]): QueuedFollowUp[] {
  return items.slice(-MAX_QUEUED_FOLLOW_UPS);
}

export function createQueuedFollowUpId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `follow-up-${crypto.randomUUID()}`;
  }
  return `follow-up-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function loadQueuedFollowUps(conversationId?: string): QueuedFollowUp[] {
  const key = queuedFollowUpStorageKey(conversationId);
  if (!key || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    return pruneQueuedFollowUps(parseQueuedFollowUps(JSON.parse(raw)));
  } catch {
    return [];
  }
}

export function persistQueuedFollowUps(conversationId: string | undefined, items: QueuedFollowUp[]) {
  const key = queuedFollowUpStorageKey(conversationId);
  if (!key || typeof window === 'undefined') return;
  try {
    if (items.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(pruneQueuedFollowUps(items)));
  } catch {
    // The in-memory queue remains available for this tab if storage quota is exceeded.
  }
}

function queuedFollowUpStorageKey(conversationId?: string): string | null {
  const id = conversationId?.trim();
  return id ? `${FOLLOW_UP_QUEUE_STORAGE_PREFIX}${id}` : null;
}

function parseQueuedFollowUps(value: unknown): QueuedFollowUp[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseQueuedFollowUp).filter((item): item is QueuedFollowUp => Boolean(item));
}

function parseQueuedFollowUp(value: unknown): QueuedFollowUp | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const message = typeof value.message === 'string' ? value.message : '';
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString();
  const images = Array.isArray(value.images)
    ? value.images.map(parseQueuedFollowUpImage).filter((image): image is PiConversationImageAttachment => Boolean(image))
    : [];
  if (!id || (!message.trim() && images.length === 0)) return null;
  return { id, message, images, createdAt };
}

function parseQueuedFollowUpImage(value: unknown): PiConversationImageAttachment | null {
  if (!isRecord(value)) return null;
  const data = typeof value.data === 'string' ? value.data : '';
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType : '';
  if (!data.trim() || !mimeType.trim()) return null;
  return { type: 'image', data, mimeType };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function fileToComposerAttachment(file: File): Promise<ComposerAttachment> {
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

export function messageImagesToComposerAttachments(images?: PiConversationImageAttachment[]): ComposerAttachment[] {
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

export async function hydrateEmbeddedExcalidrawSources(attachments: ComposerAttachment[]): Promise<ComposerAttachment[]> {
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

export function imageDataUrl(image: PiConversationImageAttachment): string {
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

export function imageFilesFromClipboard(data: DataTransfer): File[] {
  const files = Array.from(data.files).filter((file) => file.type.startsWith('image/'));
  if (files.length > 0) return files;
  return Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

export function canDropFiles(event: DragEvent<HTMLElement>, isActiveConversation: boolean, sending: boolean): boolean {
  if (!isActiveConversation || sending) return false;
  const items = Array.from(event.dataTransfer.items ?? []);
  if (items.some((item) => item.kind === 'file')) return true;
  return Array.from(event.dataTransfer.types ?? []).includes('Files');
}

import type { PiConversationForkPosition, PiConversationImageAttachment, PiConversationMessage } from '../../api/types';
import type { ExcalidrawDiagramSource } from '../../components/chat/ExcalidrawDiagramDialog';

export interface ComposerSuggestion {
  key: string;
  type: 'slash' | 'file';
  label: string;
  detail?: string;
  value: string;
  addSpace: boolean;
  disabled?: boolean;
  icon: 'command' | 'file' | 'folder';
}

export interface ComposerAttachment {
  id: string;
  name: string;
  previewUrl: string;
  image: PiConversationImageAttachment;
  source?: ExcalidrawDiagramSource;
}

export interface QueuedFollowUp {
  id: string;
  message: string;
  images: PiConversationImageAttachment[];
  createdAt: string;
}

export interface OptimisticConversationPrompt {
  id: string;
  baseMessageCount: number;
  text: string;
  images: PiConversationImageAttachment[];
  createdAt: string;
}

export type ConversationRenderItem =
  | { type: 'message'; message: PiConversationMessage }
  | { type: 'collapsed'; messages: PiConversationMessage[] };

export type ForkDialogTarget =
  | { kind: 'current' }
  | { kind: 'message'; entryId: string; position: PiConversationForkPosition };

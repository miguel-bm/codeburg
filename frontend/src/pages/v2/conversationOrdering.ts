import { preferencesApi } from '../../api';
import type { Conversation } from '../../api/types';

export function comparePinnedThenCreated(a: Conversation, b: Conversation, pinnedConversationIds: string[]) {
  const pinnedA = pinnedConversationIds.includes(a.id);
  const pinnedB = pinnedConversationIds.includes(b.id);
  if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;
  const createdCompare = a.createdAt.localeCompare(b.createdAt);
  if (createdCompare !== 0) return createdCompare;
  return a.id.localeCompare(b.id);
}

export async function getPinnedConversationIds() {
  const pinned = await preferencesApi.get<string[]>('v2_pinned_conversations').catch(() => []);
  return Array.isArray(pinned) ? pinned : [];
}

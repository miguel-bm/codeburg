import { api } from './client';

export interface AttentionEvent {
  id: string;
  targetType: 'session' | 'conversation';
  targetId: string;
  projectId?: string;
  workspaceId?: string;
  taskId?: string;
  reason: string;
  title: string;
  body: string;
  url?: string;
  canReply: boolean;
  createdAt: string;
}

export interface WebPushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
}

export const notificationsApi = {
  getVapidPublicKey: () => api.get<{ publicKey: string }>('/notifications/vapid-public-key'),
  listPushSubscriptions: () => api.get<WebPushSubscriptionRecord[]>('/notifications/push-subscriptions'),
  subscribePush: (subscription: PushSubscriptionJSON) => api.post<WebPushSubscriptionRecord>('/notifications/push-subscriptions', subscription),
  deletePushSubscription: (id: string) => api.delete(`/notifications/push-subscriptions/${id}`),
  sendTest: () => api.post<{ status: string }>('/notifications/test', {}),
};

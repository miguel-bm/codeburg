import { notificationsApi } from '../api/notifications';

function urlBase64ToApplicationServerKey(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
}

export function isWebPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registerCodeburgServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) return null;
  return navigator.serviceWorker.register('/sw.js');
}

export async function enableWebPushNotifications(): Promise<boolean> {
  if (!isWebPushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  const registration = await registerCodeburgServiceWorker();
  if (!registration) return false;
  const { publicKey } = await notificationsApi.getVapidPublicKey();
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToApplicationServerKey(publicKey),
  });
  await notificationsApi.subscribePush(subscription.toJSON());
  return true;
}

export async function disableWebPushNotifications(): Promise<void> {
  if (!isWebPushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration('/sw.js') ?? await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  const endpoint = subscription?.endpoint;
  if (subscription) {
    await subscription.unsubscribe();
  }
  if (!endpoint) return;
  const records = await notificationsApi.listPushSubscriptions().catch(() => []);
  const matching = records.filter((record) => record.endpoint === endpoint);
  await Promise.all(matching.map((record) => notificationsApi.deletePushSubscription(record.id).catch(() => undefined)));
}

export async function hasLocalWebPushSubscription(): Promise<boolean> {
  if (!isWebPushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration('/sw.js') ?? await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return Boolean(subscription);
}

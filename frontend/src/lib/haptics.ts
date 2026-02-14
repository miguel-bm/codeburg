/**
 * Trigger haptic feedback via the Vibration API.
 * No-ops silently on devices/browsers that don't support it.
 */
export function haptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  const durations = { light: 10, medium: 20, heavy: 40 };
  navigator.vibrate(durations[style]);
}

const STORAGE_KEY = 'codeburg:notification-sound';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

export function playNotificationSound() {
  if (!isNotificationSoundEnabled()) return;

  const ctx = getAudioContext();

  // Resume if suspended (browsers require user gesture to start audio)
  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  const now = ctx.currentTime;

  // Tone 1: C5 (523 Hz), starts immediately
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.value = 523;
  gain1.gain.setValueAtTime(0, now);
  gain1.gain.linearRampToValueAtTime(0.3, now + 0.01);
  gain1.gain.linearRampToValueAtTime(0, now + 0.12);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.12);

  // Tone 2: E5 (659 Hz), starts at 150ms
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.value = 659;
  gain2.gain.setValueAtTime(0, now + 0.15);
  gain2.gain.linearRampToValueAtTime(0.3, now + 0.16);
  gain2.gain.linearRampToValueAtTime(0, now + 0.28);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.15);
  osc2.stop(now + 0.28);
}

export function isNotificationSoundEnabled(): boolean {
  const val = localStorage.getItem(STORAGE_KEY);
  return val !== 'false'; // default true
}

export function setNotificationSoundEnabled(enabled: boolean) {
  localStorage.setItem(STORAGE_KEY, String(enabled));
}

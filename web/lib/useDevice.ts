'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { installMethod, InstallMethod, wakeDefault } from './device';

// ------------------------------------------------------------- Hemskärmen

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Webbläsaren skickar erbjudandet en gång, ofta innan sidan har ritats: fånga det direkt
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

function snapshot(): InstallMethod {
  return installMethod({
    ua: navigator.userAgent,
    standalone: isStandalone(),
    canPrompt: deferred !== null,
    touchPoints: navigator.maxTouchPoints ?? 0,
  });
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Hur appen läggs på hemskärmen här. 'installed' på servern, så att inget blinkar fram. */
export function useInstall() {
  const method = useSyncExternalStore(subscribe, snapshot, () => 'installed' as InstallMethod);
  async function install() {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    notify();
    return outcome === 'accepted';
  }
  return { method, install };
}

// ------------------------------------------------------------- Vaken skärm

const WAKE_KEY = 'bordvakt.keepAwake';
const wakeListeners = new Set<() => void>();

function readWake(): boolean {
  try {
    const saved = localStorage.getItem(WAKE_KEY);
    if (saved !== null) return saved === '1';
  } catch {}
  return wakeDefault({ standalone: isStandalone(), width: window.innerWidth });
}

/** Inställningen för den här enheten: hålla skärmen vaken i Matsal och Kök. */
export function useWakeSetting() {
  const on = useSyncExternalStore(
    (l) => {
      wakeListeners.add(l);
      return () => wakeListeners.delete(l);
    },
    readWake,
    () => false
  );
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  function set(value: boolean) {
    try {
      localStorage.setItem(WAKE_KEY, value ? '1' : '0');
    } catch {}
    wakeListeners.forEach((l) => l());
  }
  return { on, set, supported };
}

type Sentinel = { release: () => Promise<void> };

/** Håller skärmen vaken medan sidan syns, om inställningen är på. Webbläsaren släpper låset när fliken döljs. */
export function useKeepAwake() {
  const { on } = useWakeSetting();
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: Sentinel | null = null;
    let alive = true;
    const request = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        lock = await (navigator as Navigator & { wakeLock: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock.request(
          'screen'
        );
        if (!alive) lock.release().catch(() => {});
      } catch {
        // t.ex. batterisparläge: skärmen släcks som vanligt
      }
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', request);
      lock?.release().catch(() => {});
    };
  }, [on]);
}

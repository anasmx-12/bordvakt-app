'use client';

import { useSyncExternalStore } from 'react';
import { TFunction, translate } from './i18n';

/** Adressen till AI-motorn och en biljett som gäller en stund (från /api/engine/access).
 *  Står det localhost men sidan öppnas från en annan enhet (t.ex. en mobil i samma wifi)
 *  används datorns adress i stället, annars skulle mobilen leta hos sig själv. */
interface Access {
  base: string;
  token: string;
  expires: number;
}
let access: Access | null = null;
/** Restaurangen har ingen AI-dator kopplad (svaret från /api/engine/access). */
let notPaired = false;

function localBase(configured: string) {
  const url = new URL(configured);
  const local = ['localhost', '127.0.0.1'];
  if (local.includes(url.hostname) && !local.includes(window.location.hostname)) url.hostname = window.location.hostname;
  return url.origin;
}

async function getAccess(): Promise<Access | null> {
  // Ny biljett när den gamla har mindre än 10 minuter kvar
  if (access && access.expires - Date.now() / 1000 > 600) return access;
  try {
    const res = await fetch('/api/engine/access', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    notPaired = data.paired === false;
    if (notPaired) return null;
    access = { base: localBase(data.base), token: data.token, expires: data.expires };
    return access;
  } catch {
    return null;
  }
}

/** Adressen till en kameras video, eller null innan biljetten har hämtats. */
export function streamUrl(engine: EngineStatus | null, cameraId: string, extra = '') {
  if (!engine?.base || !engine.token) return null;
  return `${engine.base}/stream/${encodeURIComponent(cameraId)}?t=${encodeURIComponent(engine.token)}${extra}`;
}

export interface EngineStatus {
  /** false = AI-motorn (AI.py) svarar inte */
  reachable: boolean;
  /** false = restaurangen har ingen AI-dator kopplad (Inställningar → AI-datorn) */
  paired: boolean;
  aiEnabled: boolean;
  aiDisabledReason: string | null;
  /** false = installationen (planritning, kameror, kalibrering) är inte klar */
  setupComplete: boolean;
  /** kamera-id → om kameran ger bild just nu */
  cameras: Record<string, { online: boolean }>;
  /** AI-motorns adress och biljetten för video */
  base: string | null;
  token: string | null;
}

const POLL_MS = 5000;

// En enda fråga var 5:e sekund, delad av alla delar av sidan som vill veta läget
let current: EngineStatus | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

async function check() {
  let next: EngineStatus;
  const a = await getAccess();
  try {
    if (!a) throw new Error('ingen biljett');
    const res = await fetch(`${a.base}/status`, {
      cache: 'no-store',
      headers: { 'X-Bordvakt-Ticket': a.token },
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 401) access = null; // biljetten gäller inte längre: hämta en ny nästa gång
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    next = {
      reachable: true,
      paired: true,
      aiEnabled: Boolean(data.ai_enabled),
      aiDisabledReason: data.ai_disabled_reason ?? null,
      setupComplete: Boolean(data.setup_complete),
      cameras: data.cameras ?? {},
      base: a.base,
      token: a.token,
    };
  } catch {
    next = { reachable: false, paired: !notPaired, aiEnabled: false, aiDisabledReason: null, setupComplete: false, cameras: {}, base: null, token: null };
  }
  if (listeners.size === 0) return;
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    check();
    timer = setInterval(check, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Frågar AI-motorn var 5:e sekund om kamerorna ger bild och om analysen är igång.
 *  Returnerar null tills första svaret har kommit. */
export function useEngineStatus(): EngineStatus | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/** Varför bordens status inte kan visas, eller null om allt är igång. */
export function monitoringProblem(
  engine: EngineStatus | null,
  cameraId: string | null,
  t: TFunction = (key) => translate('sv', key)
): string | null {
  if (!engine) return t('mon.checking');
  if (!engine.paired) return t('mon.notPaired');
  if (!engine.reachable) return t('mon.engineOff');
  if (!cameraId || !engine.cameras[cameraId]?.online) return t('mon.cameraOff');
  if (!engine.setupComplete) return t('mon.setup');
  if (!engine.aiEnabled) return t('mon.aiOff');
  return null;
}

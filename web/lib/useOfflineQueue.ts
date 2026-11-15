'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { drain, enqueue, fresh, Queued, QueuedAction, SendResult } from './offlineQueue';

const KEY = 'bordvakt.offlineQueue';
/** Korta avbrott (t.ex. när realtiden kopplar upp igen) ska inte blinka fram en varning */
const GRACE_MS = 4000;

function read(): Queued[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? fresh(list, Date.now()) : [];
  } catch {
    return [];
  }
}
function write(list: Queued[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {}
}

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

async function send(a: Queued): Promise<SendResult> {
  const res =
    a.kind === 'task'
      ? await fetch(`/api/tasks/${a.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(a.falseAlarm ? { false_alarm: true } : {}),
        })
      : await fetch(`/api/orders/${a.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'SERVED' }),
        });
  if (res.ok) return 'ok';
  // Finns inte längre, redan gjort eller går inte längre: släpp trycket
  if (res.status === 404 || res.status === 409 || res.status === 400 || res.status === 422) return 'gone';
  return 'retry';
}

/**
 * Uppkopplingen i Matsalen: om nätet eller realtiden är nere, sedan när, och tryck som väntar.
 * connected = realtidsanslutningen till databasen.
 */
export function useOfflineQueue(connected: boolean) {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [downSince, setDownSince] = useState<Date | null>(null);
  const [wasConnected, setWasConnected] = useState(false);
  const [retry, setRetry] = useState(0);
  const flushing = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setQueue(read()), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!connected) return;
    const t = setTimeout(() => setWasConnected(true), 0);
    return () => clearTimeout(t);
  }, [connected]);

  // Nere = webbläsaren är offline, eller realtiden tappades efter att ha fungerat
  const down = !online || (wasConnected && !connected);
  useEffect(() => {
    if (!down) {
      const t = setTimeout(() => setDownSince(null), 0);
      return () => clearTimeout(t);
    }
    const lost = new Date();
    const t = setTimeout(() => setDownSince(lost), online ? GRACE_MS : 0);
    return () => clearTimeout(t);
  }, [down, online]);

  const push = useCallback((action: QueuedAction) => {
    setQueue((q) => {
      const next = enqueue(q, action, Date.now());
      write(next);
      return next;
    });
  }, []);

  // Töm kön när nätet och realtiden är tillbaka
  useEffect(() => {
    if (down || !queue.length || flushing.current) return;
    flushing.current = true;
    const batch = queue;
    drain(batch, send, Date.now()).then((left) => {
      flushing.current = false;
      // Behåll det som inte gick fram och tryck som gjordes under tiden
      setQueue((q) => {
        const next = q.filter((x) => left.includes(x) || !batch.includes(x));
        if (next.length === q.length) return q; // inget gick fram: samma lista, så försöket väntar på retry
        write(next);
        return next;
      });
      if (left.length) setTimeout(() => setRetry((n) => n + 1), 10_000); // servern svarade fel: vänta lite
    });
  }, [down, queue, retry]);

  /** "task:<id>" och "serve:<id>" för tryck som väntar, så att de inte visas igen när allt hämtas om */
  const queued = new Set(queue.map((x) => `${x.kind}:${x.id}`));
  return { online, down: downSince !== null, downSince, pending: queue.length, queued, push };
}

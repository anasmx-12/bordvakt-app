'use client';

import { useEffect, useState } from 'react';
import type { Order } from './types';

// Hur länge rätterna brukar ta i köket, och när en beställning borde vara klar.

let cached: { at: number; prep: Record<string, number> } | null = null;

export function usePrepTimes() {
  const [prep, setPrep] = useState<Record<string, number>>(cached?.prep ?? {});
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(async () => {
      tick();
      if (cached && Date.now() - cached.at < 5 * 60_000) return setPrep(cached.prep);
      const res = await fetch('/api/insights').catch(() => null);
      if (!res?.ok) return;
      const { prepByName } = await res.json();
      cached = { at: Date.now(), prep: prepByName };
      setPrep(prepByName);
    }, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return { prep, now };
}

/** Minuter tills beställningen brukar vara klar (negativt = sen). null om okänt eller redan klar. */
export function minutesLeft(order: Order, prep: Record<string, number>, now: number): number | null {
  if (!now || (order.status !== 'RECEIVED' && order.status !== 'PREPARING')) return null;
  const known = order.items.map((i) => prep[i.name.trim().toLowerCase()]).filter((m) => m !== undefined);
  if (!known.length) return null;
  return Math.round(Math.max(...known) - (now - Date.parse(order.created_at)) / 60000);
}

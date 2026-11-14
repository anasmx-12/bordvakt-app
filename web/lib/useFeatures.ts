'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { Features, FeatureId, isOn } from './features';

// Restaurangens påslagna funktioner, delade av alla komponenter (en hämtning per sida).

let current: Features = {};
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

async function load() {
  // select('*'): kolumnen features finns först när 012 är körd. Saknas den är allt på.
  const { data } = await supabase.from('restaurants').select('*').maybeSingle();
  current = (data?.features as Features) ?? {};
  loaded = true;
  listeners.forEach((l) => l());
}

/** Uppdatera direkt efter att ägaren ändrat (utan att ladda om sidan). */
export function setFeatures(next: Features) {
  current = next;
  loaded = true;
  listeners.forEach((l) => l());
}

export function useFeatures() {
  const features = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current
  );
  useEffect(() => {
    if (!loaded && !loading) loading = load().finally(() => (loading = null));
  }, []);
  return { features, on: (id: FeatureId) => isOn(features, id), loaded };
}

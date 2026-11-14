import 'server-only';
import { SupabaseClient } from '@supabase/supabase-js';
import { OrderItem } from './types';

// Lärdomar ur restaurangens egna beställningar (senaste 60 dagarna):
// - hur lång tid varje rätt brukar ta i köket (för gästen, servitören och köket)
// - vad gäster brukar beställa tillsammans (för förslag i gästens kundvagn)
// Räknas om högst var 10:e minut per restaurang.

export interface Insights {
  /** Minuter från beställning till klar i köket (median), per rättens namn i gemener */
  prepByName: Record<string, number>;
  /** Samma sak per menyrätt (id) */
  prepById: Record<string, number>;
  /** Rätter som ofta beställs ihop med rätten (bäst först), per menyrätt (id) */
  pairs: Record<string, string[]>;
  /** Mest beställda menyrätter (id), bäst först */
  popular: string[];
}

const TTL = 10 * 60_000;
const MIN_SAMPLES = 3;
const cache = new Map<string, { at: number; value: Insights }>();

const median = (list: number[]) => {
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface Row {
  table_id: string;
  items: OrderItem[];
  created_at: string;
  ready_at: string | null;
  status: string;
}

export function learn(rows: Row[]): Insights {
  const byName = new Map<string, number[]>();
  const byId = new Map<string, number[]>();
  const count = new Map<string, number>();
  const together = new Map<string, Map<string, number>>();

  // Samma bord inom 90 minuter räknas som samma sällskap
  const visits = new Map<string, Set<string>[]>();
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lastAt = new Map<string, number>();
  for (const o of sorted) {
    if (o.status === 'CANCELLED') continue;
    const at = Date.parse(o.created_at);
    const items = (o.items ?? []) as OrderItem[];
    if (o.ready_at) {
      const min = (Date.parse(o.ready_at) - at) / 60000;
      if (min > 0 && min < 120) {
        for (const i of items) {
          const name = i.name.trim().toLowerCase();
          if (name) byName.set(name, [...(byName.get(name) ?? []), min]);
          if (i.menu_item_id) byId.set(i.menu_item_id, [...(byId.get(i.menu_item_id) ?? []), min]);
        }
      }
    }
    const list = visits.get(o.table_id) ?? [];
    if (!list.length || at - (lastAt.get(o.table_id) ?? 0) > 90 * 60_000) list.push(new Set());
    lastAt.set(o.table_id, at);
    for (const i of items) if (i.menu_item_id) list[list.length - 1].add(i.menu_item_id);
    visits.set(o.table_id, list);
  }

  for (const list of visits.values()) {
    for (const visit of list) {
      const ids = [...visit];
      for (const a of ids) {
        count.set(a, (count.get(a) ?? 0) + 1);
        for (const b of ids) {
          if (a === b) continue;
          const m = together.get(a) ?? new Map<string, number>();
          m.set(b, (m.get(b) ?? 0) + 1);
          together.set(a, m);
        }
      }
    }
  }

  const prep = (m: Map<string, number[]>) =>
    Object.fromEntries([...m].filter(([, l]) => l.length >= MIN_SAMPLES).map(([k, l]) => [k, Math.round(median(l))]));
  const pairs: Record<string, string[]> = {};
  for (const [a, m] of together) {
    pairs[a] = [...m]
      .filter(([, n]) => n >= MIN_SAMPLES)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([b]) => b);
  }
  return {
    prepByName: prep(byName),
    prepById: prep(byId),
    pairs,
    popular: [...count].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, 30),
  };
}

export async function insights(supabase: SupabaseClient, restaurantId: string): Promise<Insights> {
  const hit = cache.get(restaurantId);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const since = new Date(Date.now() - 60 * 86400_000).toISOString();
  const { data } = await supabase
    .from('orders')
    .select('table_id, items, created_at, ready_at, status')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000);
  const value = learn((data ?? []) as Row[]);
  cache.set(restaurantId, { at: Date.now(), value });
  return value;
}

/** Kategorier som troligen är dryck eller dessert (på menyns eget språk). */
export const DRINK = /dryck|drick|drink|bever|bebida|getränk|boisson|bebida|içecek|напит|مشروب|饮|飲|음료|minum|vin|wine|öl|beer|kaffe|coffee|te\b|tea|juice|läsk|soda/i;
export const DESSERT = /dessert|efterr|sweet|postre|nachspeise|nachtisch|tatlı|десерт|حلو|甜|デザート|디저트|pencuci/i;

import 'server-only';
import { SupabaseClient } from '@supabase/supabase-js';
import { OrderItem } from './types';

// Statistik för en period: räknas ut från sittningar (AI-motorn), beställningar, uppgifter,
// recensioner och svinn. Används av /statistik och av morgonrapporten.

export const TZ = 'Europe/Stockholm';

export interface Stats {
  from: string;
  to: string;
  currency: string;
  guests: number;
  sittings: number;
  avgSittingMin: number | null;
  avgFoodWaitMin: number | null; // från beställning till klar i köket
  avgResponseMin: number | null; // personalens svarstid på bordens behov
  sos: number;
  falseAlarms: number;
  revenue: number;
  orders: number;
  qrOrders: number;
  byDay: { day: string; revenue: number; guests: number }[];
  byHour: { hour: number; revenue: number; guests: number }[];
  topItems: { name: string; qty: number; revenue: number }[];
  reviews: { count: number; avg: number | null; low: { rating: number; comment: string | null; created_at: string }[] };
  waste: { count: number; value: number; top: { name: string; qty: number }[] };
  /** Bemanning: förslag på antal servitörer per veckodag (0 = måndag) och timme, från de senaste 4 veckorna */
  staffing: { weekday: number; hour: number; guests: number; waiters: number }[];
  guestsPerWaiter: number;
  missing: string[]; // tabeller som inte finns än (kör 012)
}

const parts = (iso: string) => {
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const weekday = ['mån', 'tis', 'ons', 'tors', 'fre', 'lör', 'sön'].indexOf(get('weekday').replace('.', ''));
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), weekday };
};

/** Dagens datum (ÅÅÅÅ-MM-DD) i restaurangens tidszon. */
export const localDay = (d = new Date()) => parts(d.toISOString()).day;
export const localHour = (d = new Date()) => parts(d.toISOString()).hour;

/** Midnatt (lokal tid) för en dag, som ISO-tid. */
export function dayStart(day: string): string {
  // Prova +01 och +02 (vinter/sommar) och välj den som blir midnatt lokalt
  for (const offset of ['+01:00', '+02:00', '+00:00']) {
    const iso = new Date(`${day}T00:00:00${offset}`).toISOString();
    const p = parts(iso);
    if (p.day === day && p.hour === 0) return iso;
  }
  return new Date(`${day}T00:00:00Z`).toISOString();
}

export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const minutes = (a: string | null, b: string | null) => (a && b ? (Date.parse(b) - Date.parse(a)) / 60000 : null);
const avg = (list: number[]) => (list.length ? Math.round((list.reduce((s, x) => s + x, 0) / list.length) * 10) / 10 : null);
const missingTable = (error: { code?: string; message: string } | null) =>
  !!error && (error.code === 'PGRST205' || error.code === '42P01' || /does not exist|schema cache/.test(error.message));
const itemValue = (i: OrderItem) => (Number(i.price) || 0) * (Number(i.qty) || 1);

interface SessionRow {
  started_at: string;
  ended_at: string;
  guests: number;
}

export async function computeStats(supabase: SupabaseClient, restaurantId: string, fromDay: string, toDay: string): Promise<Stats> {
  const from = dayStart(fromDay);
  const to = dayStart(addDays(toDay, 1));
  const history = dayStart(addDays(localDay(), -28));
  const missing: string[] = [];

  const [restaurant, sessions, orders, tasks, reviews, waste, past] = await Promise.all([
    supabase.from('restaurants').select('*').eq('id', restaurantId).maybeSingle(),
    supabase.from('table_sessions').select('started_at, ended_at, guests').eq('restaurant_id', restaurantId).gte('started_at', from).lt('started_at', to).limit(10000),
    supabase.from('orders').select('items, status, created_at, ready_at, source').eq('restaurant_id', restaurantId).gte('created_at', from).lt('created_at', to).limit(10000),
    supabase.from('tasks').select('type, created_at, resolved_at, false_alarm, tables!inner(restaurant_id)').eq('tables.restaurant_id', restaurantId).gte('created_at', from).lt('created_at', to).limit(10000),
    supabase.from('reviews').select('rating, comment, created_at').eq('restaurant_id', restaurantId).gte('created_at', from).lt('created_at', to).order('created_at', { ascending: false }).limit(2000),
    supabase.from('waste').select('item_name, qty, price').eq('restaurant_id', restaurantId).gte('created_at', from).lt('created_at', to).limit(5000),
    supabase.from('table_sessions').select('started_at, ended_at, guests').eq('restaurant_id', restaurantId).gte('started_at', history).limit(20000),
  ]);
  if (missingTable(sessions.error)) missing.push('table_sessions');
  if (missingTable(reviews.error)) missing.push('reviews');
  if (missingTable(waste.error)) missing.push('waste');

  const currency = restaurant.data?.currency ?? 'SEK';
  const guestsPerWaiter = Math.max(1, Number(restaurant.data?.guests_per_waiter) || 12);
  const sessionRows = (sessions.data ?? []) as SessionRow[];

  const days = new Map<string, { revenue: number; guests: number }>();
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) days.set(d, { revenue: 0, guests: 0 });
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0, guests: 0 }));

  for (const s of sessionRows) {
    const p = parts(s.started_at);
    const day = days.get(p.day);
    if (day) day.guests += s.guests;
    hours[p.hour].guests += s.guests;
  }

  let revenue = 0;
  let orderCount = 0;
  let qrOrders = 0;
  const waits: number[] = [];
  const items = new Map<string, { qty: number; revenue: number }>();
  for (const o of orders.data ?? []) {
    if (o.status === 'CANCELLED' || o.status === 'PENDING_APPROVAL') continue;
    orderCount += 1;
    if (o.source === 'qr') qrOrders += 1;
    const wait = minutes(o.created_at, o.ready_at);
    if (wait !== null && wait >= 0 && wait < 180) waits.push(wait);
    const value = ((o.items ?? []) as OrderItem[]).reduce((s, i) => s + itemValue(i), 0);
    revenue += value;
    const p = parts(o.created_at);
    const day = days.get(p.day);
    if (day) day.revenue += value;
    hours[p.hour].revenue += value;
    for (const i of (o.items ?? []) as OrderItem[]) {
      const key = i.name.trim();
      if (!key) continue;
      const row = items.get(key) ?? { qty: 0, revenue: 0 };
      row.qty += Number(i.qty) || 1;
      row.revenue += itemValue(i);
      items.set(key, row);
    }
  }

  const responses: number[] = [];
  let sos = 0;
  let falseAlarms = 0;
  for (const t of tasks.data ?? []) {
    if (t.type === 'EMERGENCY') {
      if (t.false_alarm) falseAlarms += 1;
      else sos += 1;
    }
    // Svarstid: hur snabbt personalen tar hand om ett behov (inte mat, den mäts för sig)
    if (['SERVICE', 'CLEANING', 'BILL', 'EMERGENCY'].includes(t.type) && !t.false_alarm) {
      const m = minutes(t.created_at, t.resolved_at);
      if (m !== null && m >= 0 && m < 120) responses.push(m);
    }
  }

  const reviewRows = reviews.data ?? [];
  const wasteRows = waste.data ?? [];
  const wasteItems = new Map<string, number>();
  for (const w of wasteRows) wasteItems.set(w.item_name, (wasteItems.get(w.item_name) ?? 0) + w.qty);

  return {
    from: fromDay,
    to: toDay,
    currency,
    guests: sessionRows.reduce((s, x) => s + x.guests, 0),
    sittings: sessionRows.length,
    avgSittingMin: avg(sessionRows.map((s) => minutes(s.started_at, s.ended_at) ?? 0).filter((m) => m > 0)),
    avgFoodWaitMin: avg(waits),
    avgResponseMin: avg(responses),
    sos,
    falseAlarms,
    revenue: Math.round(revenue * 100) / 100,
    orders: orderCount,
    qrOrders,
    byDay: [...days].map(([day, v]) => ({ day, ...v })),
    byHour: hours,
    topItems: [...items]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10),
    reviews: {
      count: reviewRows.length,
      avg: avg(reviewRows.map((r) => r.rating)),
      low: reviewRows.filter((r) => r.rating <= 3).slice(0, 10),
    },
    waste: {
      count: wasteRows.reduce((s, w) => s + w.qty, 0),
      value: Math.round(wasteRows.reduce((s, w) => s + (Number(w.price) || 0) * w.qty, 0) * 100) / 100,
      top: [...wasteItems].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 5),
    },
    staffing: staffing((past.data ?? []) as SessionRow[], guestsPerWaiter),
    guestsPerWaiter,
    missing,
  };
}

/** Hur många gäster som brukar sitta i restaurangen varje veckodag och timme (snitt per vecka),
 *  och hur många servitörer det kräver. */
export function staffing(sessions: SessionRow[], guestsPerWaiter: number) {
  const load = new Map<string, number>(); // "veckodag-timme" -> gästtimmar
  const weeks = new Map<number, Set<string>>(); // veckodag -> vilka datum som har data
  for (const s of sessions) {
    let t = Date.parse(s.started_at);
    const end = Date.parse(s.ended_at);
    while (t < end) {
      const p = parts(new Date(t).toISOString());
      const next = Math.min(end, t - (t % 3600000) + 3600000);
      const key = `${p.weekday}-${p.hour}`;
      load.set(key, (load.get(key) ?? 0) + (s.guests * (next - t)) / 3600000);
      if (!weeks.has(p.weekday)) weeks.set(p.weekday, new Set());
      weeks.get(p.weekday)!.add(p.day);
      t = next;
    }
  }
  const out: { weekday: number; hour: number; guests: number; waiters: number }[] = [];
  for (const [key, total] of load) {
    const [weekday, hour] = key.split('-').map(Number);
    const guests = Math.round((total / Math.max(1, weeks.get(weekday)?.size ?? 1)) * 10) / 10;
    if (guests < 0.5) continue;
    out.push({ weekday, hour, guests, waiters: Math.max(1, Math.ceil(guests / guestsPerWaiter)) });
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
}

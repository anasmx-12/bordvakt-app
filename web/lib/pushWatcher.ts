import 'server-only';
import { serverSupabase } from './server';
import { pushReady, sendPush } from './push';
import { orderSummary, OrderItem } from './types';

// Lyssnar på databasen (uppgifter från AI:n, beställningar) och skickar mobil-larm.
// Startas en gång av instrumentation.ts. Fångar allt oavsett vem som skrev (AI-motorn,
// personalen eller gästen), så att AI.py inte behöver veta något om mobilerna.

const TASK_KEYS = {
  EMERGENCY: 'task.EMERGENCY',
  SERVICE: 'task.SERVICE',
  FOOD_DELIVERY: 'task.FOOD_DELIVERY',
  CLEANING: 'task.CLEANING',
  DESSERT: 'task.DESSERT',
  BILL: 'task.BILL',
} as const;

const tables = new Map<string, { restaurant_id: string; table_number: number }>();

async function table(id: string) {
  if (!tables.has(id)) {
    const { data } = await serverSupabase().from('tables').select('restaurant_id, table_number').eq('id', id).maybeSingle();
    if (data) tables.set(id, data);
  }
  return tables.get(id);
}

type Row = Record<string, unknown> & { id?: string; table_id?: string };

/** Ny uppgift från AI:n eller personalen. */
export async function onTaskInsert(task: Row) {
  const key = TASK_KEYS[task.type as keyof typeof TASK_KEYS];
  const t = key && task.status === 'PENDING' ? await table(String(task.table_id)) : null;
  if (!t) return;
  const sos = task.type === 'EMERGENCY';
  await sendPush(t.restaurant_id, {
    key,
    vars: { n: t.table_number },
    detailKey: sos ? 'alert.sos' : 'alert.newTap',
    tableNumber: t.table_number,
    tag: `task-${task.table_id}-${task.type}`,
    urgent: sos || task.type === 'SERVICE',
  });
}

/** Ny beställning: larm bara för gästernas QR-beställningar. */
export async function onOrderInsert(order: Row) {
  if (order.source !== 'qr') return;
  const t = await table(String(order.table_id));
  if (!t) return;
  const approve = order.status === 'PENDING_APPROVAL';
  await sendPush(t.restaurant_id, {
    key: approve ? 'alert.qrApprove' : 'alert.qrOrder',
    vars: { n: t.table_number },
    detail: orderSummary({ items: (order.items ?? []) as OrderItem[] }, ''),
    tableNumber: t.table_number,
    tag: `qr-${order.id}`,
    urgent: approve,
  });
}

/** Ändrad beställning: larm när maten precis blivit klar i köket. */
export async function onOrderUpdate(order: Row, old: Row | null) {
  // old innehåller ibland bara id (realtime utan REPLICA IDENTITY FULL), så ready_at avgör att det är nytt
  if (order.status !== 'READY' || old?.status === 'READY') return;
  if (typeof order.ready_at === 'string' && Date.now() - Date.parse(order.ready_at) > 60_000) return;
  const t = await table(String(order.table_id));
  if (!t) return;
  await sendPush(t.restaurant_id, {
    key: 'alert.foodReady',
    vars: { n: t.table_number },
    detail: orderSummary({ items: (order.items ?? []) as OrderItem[] }, ''),
    tableNumber: t.table_number,
    url: '/matsal',
    tag: `ready-${order.id}`,
  });
}

let started = false;

/** Lokalt (en server som alltid är igång): lyssnar direkt på databasen.
 *  På Vercel används i stället databasens webhook (app/api/hooks/db, supabase/015_webhooks.sql). */
export function startPushWatcher() {
  if (started || !pushReady) return;
  started = true;
  const supabase = serverSupabase();
  supabase
    .channel('bordvakt-push')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, ({ new: task }) => onTaskInsert(task))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, ({ new: order }) => onOrderInsert(order))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, ({ new: order, old }) =>
      onOrderUpdate(order, old as Row)
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('Mobil-larm: lyssnar på nya larm.');
      if (status === 'CHANNEL_ERROR') console.error('Mobil-larm: kunde inte lyssna på databasen.');
    });
}

import 'server-only';
import { SupabaseClient } from '@supabase/supabase-js';
import { OrderItem } from './types';

export type WasteReason = 'returned' | 'remake' | 'cancelled';

/** Sparar svinn: mat som kom tillbaka, lagades om eller makulerades efter att köket börjat. */
export async function logWaste(
  supabase: SupabaseClient,
  row: { restaurant_id: string; table_id: string | null; order_id?: string | null; items: OrderItem[]; reason: WasteReason }
) {
  const rows = row.items
    .filter((i) => i.name?.trim())
    .map((i) => ({
      restaurant_id: row.restaurant_id,
      table_id: row.table_id,
      order_id: row.order_id ?? null,
      item_name: i.name.trim().slice(0, 80),
      qty: Math.min(99, Math.max(1, Math.round(Number(i.qty) || 1))),
      price: Number(i.price) || null,
      reason: row.reason,
    }));
  if (!rows.length) return;
  const { error } = await supabase.from('waste').insert(rows);
  if (error && !/waste/.test(error.message)) console.error('Kunde inte spara svinn:', error.message);
}

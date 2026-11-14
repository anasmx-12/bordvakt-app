import 'server-only';
import { UserError } from './server';
import { OrderItem } from './types';

const MAX_ITEMS = 50;

/** Godkänner bara rader med namn och antal 1–99. */
export function cleanItems(raw: unknown): OrderItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 80) : '';
      const qty = Math.round(Number(item?.qty ?? 1));
      const row: OrderItem = { name, qty: Number.isFinite(qty) ? Math.min(99, Math.max(1, qty)) : 1 };
      const price = Number(item?.price);
      if (item?.price !== undefined && Number.isFinite(price) && price >= 0 && price < 100000) row.price = Math.round(price * 100) / 100;
      if (typeof item?.menu_item_id === 'string' && /^[0-9a-f-]{36}$/.test(item.menu_item_id)) row.menu_item_id = item.menu_item_id;
      return row;
    })
    .filter((item) => item.name.length > 0)
    .slice(0, MAX_ITEMS);
}

export function missingOrdersTable(code: string | undefined) {
  return code === 'PGRST205' || code === '42P01'
    ? new UserError('Beställningar är inte aktiverade. Kör supabase/003_orders_and_decor.sql i Supabase.', 500)
    : null;
}

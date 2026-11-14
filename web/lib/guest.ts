import 'server-only';
import { SupabaseClient } from '@supabase/supabase-js';
import { UserError } from './server';
import { missingMenu } from './menu';
import { hasAccess } from './plans';
import { QrOrdering } from './types';
import { Features } from './features';

export interface GuestTable {
  table_id: string;
  table_number: number;
  restaurant_id: string;
  restaurant_name: string;
  currency: string;
  qr_ordering: QrOrdering;
  google_review_url: string | null;
  table_status: string;
  features: Features;
}

/** Bordet som QR-koden hör till. allowOff: koden fungerar även när QR-beställning är av
 *  (för recensioner och stämpelkort). Kastar 404 för okända koder (samma svar för alla fel,
 *  så att ingen kan pröva sig fram). */
export async function guestTable(supabase: SupabaseClient, token: string, { allowOff = false } = {}): Promise<GuestTable> {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new UserError('QR-koden gäller inte längre. Fråga personalen.', 404);
  const { data: table, error } = await supabase
    .from('tables')
    .select('id, table_number, restaurant_id, status')
    .eq('qr_token', token)
    .maybeSingle();
  if (error) throw missingMenu(error) ?? new UserError(error.message, 500);
  if (!table) throw new UserError('QR-koden gäller inte längre. Fråga personalen.', 404);
  const { data: r } = await supabase
    .from('restaurants')
    .select('*') // google_review_url finns först när 012 är körd
    .eq('id', table.restaurant_id)
    .maybeSingle();
  if (!r || !hasAccess(r) || (r.qr_ordering === 'off' && !allowOff)) {
    throw new UserError('Beställning via QR är avstängd här. Fråga personalen.', 403);
  }
  return {
    table_id: table.id,
    table_number: table.table_number,
    restaurant_id: table.restaurant_id,
    restaurant_name: r.name,
    currency: r.currency ?? 'SEK',
    qr_ordering: r.qr_ordering ?? 'off',
    google_review_url: r.google_review_url ?? null,
    table_status: table.status,
    features: (r.features as Features) ?? {},
  };
}

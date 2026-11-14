import 'server-only';
import { UserError } from './server';

export const WAIT_STATUSES = ['WAITING', 'NOTIFIED', 'SEATED', 'LEFT'] as const;
export type WaitStatus = (typeof WAIT_STATUSES)[number];
export const PARTY_FIELDS = 'id, name, party_size, phone, note, status, table_id, quoted_minutes, token, created_at, notified_at, seated_at';

export const missingWaitlist = (message: string) =>
  /waitlist/.test(message) ? new UserError('Kör supabase/012_growth.sql i Supabase först.', 500) : new UserError(message, 500);

/** Hur länge ett sällskap brukar sitta (snitt senaste 30 dagarna), 60 min om det inte är känt. */
export async function averageSitting(supabase: import('@supabase/supabase-js').SupabaseClient, restaurantId: string) {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data } = await supabase.from('table_sessions').select('started_at, ended_at').eq('restaurant_id', restaurantId).gte('started_at', since).limit(3000);
  const list = (data ?? []).map((s) => (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 60000).filter((m) => m > 5 && m < 300);
  return list.length >= 5 ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 60;
}

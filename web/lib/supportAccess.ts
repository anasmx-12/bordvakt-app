import 'server-only';
import { serverSupabase, UserError } from './server';

// Supportens läsåtkomst till kundens app (supabase/023_support_access.sql).
// En förfrågan väntar tills ägaren godkänner eller nekar. Godkänd gäller i ACCESS_HOURS timmar.

export const ACCESS_HOURS = 1;
const REQUEST_HOURS = 24; // en förfrågan som ingen svarat på efter ett dygn räknas inte längre

export interface AccessRow {
  id: string;
  requested_by_name: string;
  reason: string;
  requested_at: string;
  approved_at: string | null;
  expires_at: string | null;
  ended_at: string | null;
}

const COLS = 'id, requested_by_name, reason, requested_at, approved_at, expires_at, ended_at';
const missing = (e: { code?: string } | null) => e?.code === 'PGRST205' || e?.code === '42P01';
export const MISSING_023 = 'Kör supabase/023_support_access.sql i Supabase först.';

/** Väntande förfrågan och pågående åtkomst för restaurangen. */
export async function accessState(restaurantId: string): Promise<{ pending: AccessRow | null; active: AccessRow | null }> {
  const { data, error } = await serverSupabase()
    .from('support_access')
    .select(COLS)
    .eq('restaurant_id', restaurantId)
    .is('ended_at', null)
    .gte('requested_at', new Date(Date.now() - REQUEST_HOURS * 3600_000).toISOString())
    .order('requested_at', { ascending: false })
    .limit(5);
  if (missing(error)) return { pending: null, active: null };
  if (error) throw new UserError(error.message, 500);
  const now = Date.now();
  const rows = (data ?? []) as AccessRow[];
  return {
    active: rows.find((r) => r.approved_at && r.expires_at && new Date(r.expires_at).getTime() > now) ?? null,
    pending: rows.find((r) => !r.approved_at) ?? null,
  };
}

/** Ägaren svarar: godkänn (1 timme), neka, eller avsluta en pågående åtkomst. */
export async function answerAccess(restaurantId: string, userId: string, id: unknown, action: unknown) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new UserError('Okänd förfrågan.', 404);
  const db = serverSupabase();
  const now = new Date();
  let update: Record<string, unknown>;
  if (action === 'approve') {
    update = { approved_by: userId, approved_at: now.toISOString(), expires_at: new Date(now.getTime() + ACCESS_HOURS * 3600_000).toISOString() };
  } else if (action === 'deny' || action === 'end') {
    update = { ended_at: now.toISOString() };
  } else {
    throw new UserError('Okänt val.');
  }
  let q = db.from('support_access').update(update).eq('id', id).eq('restaurant_id', restaurantId).is('ended_at', null);
  if (action === 'approve') q = q.is('approved_at', null);
  const { data, error } = await q.select('id').maybeSingle();
  if (missing(error)) throw new UserError(MISSING_023, 500);
  if (error) throw new UserError(error.message, 500);
  if (!data) throw new UserError('Förfrågan finns inte längre.', 404);
  return { ok: true };
}

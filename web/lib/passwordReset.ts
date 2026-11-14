import 'server-only';
import { createHash } from 'crypto';
import { serverSupabase } from './server';

// Länken som supporten skickar (supportsajten skapar den, se supabase/020_password_resets.sql).
// Samma hash som supportsajten använder.
export const resetHash = (token: string) => createHash('sha256').update(`password-reset:${token}`).digest('hex');

/** Kontot som länken gäller, eller null om länken är fel, använd eller har gått ut. */
export async function findReset(token: unknown) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const supabase = serverSupabase();
  const { data } = await supabase.from('password_resets').select('user_id, expires_at').eq('token_hash', resetHash(token)).maybeSingle();
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  const { data: u } = await supabase.auth.admin.getUserById(data.user_id);
  const user = u?.user;
  if (!user?.email || user.app_metadata?.bordvakt_engine === true || user.app_metadata?.bordvakt_staff === true) return null;
  return { userId: user.id, email: user.email };
}

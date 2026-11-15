import 'server-only';
import { randomBytes } from 'crypto';
import { engineKey } from './engine';
import { currentRestaurantId, currentUser, serverSupabase, UserError } from './server';

// AI-datorns eget konto (roll 'engine', se supabase/014_engine_accounts.sql).
// Kopplingskoden innehåller allt datorn behöver: databasens adress, den publika nyckeln,
// kontots inloggning och nyckeln som webbappen använder mot AI-motorn.
// Service-nyckeln lämnar aldrig servern.

const PREFIX = 'BV1.';

const engineEmail = (restaurantId: string) => `ai-${restaurantId}@engine.bordvakt.se`;

/** Skapar kontot, eller byter lösenord (gamla koder slutar då fungera). Returnerar kopplingskoden. */
export async function createPairingCode(restaurantId: string): Promise<string> {
  const supabase = serverSupabase();
  const password = randomBytes(32).toString('base64url');
  const email = engineEmail(restaurantId);

  const { data: member, error: readError } = await supabase
    .from('restaurant_members')
    .select('user_id')
    .eq('restaurant_id', restaurantId)
    .eq('role', 'engine')
    .maybeSingle();
  if (readError) throw new UserError(readError.message, 500);

  if (member) {
    const { error } = await supabase.auth.admin.updateUserById(member.user_id, { password });
    if (error) throw new UserError(`Kunde inte byta kod: ${error.message}`, 500);
    // Loggar ut datorer som använde den gamla koden
    await supabase.auth.admin.signOut(member.user_id).catch(() => undefined);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { bordvakt_engine: true, restaurant_id: restaurantId },
    });
    if (error || !data.user) throw new UserError(`Kunde inte skapa AI-datorns konto: ${error?.message}`, 500);
    const { error: memberError } = await supabase
      .from('restaurant_members')
      .insert({ user_id: data.user.id, restaurant_id: restaurantId, role: 'engine' });
    if (memberError) {
      await supabase.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      throw new UserError(
        /role_check|violates check/.test(memberError.message)
          ? 'Kör supabase/014_engine_accounts.sql i Supabase först.'
          : memberError.message,
        500
      );
    }
  }

  const payload = {
    u: process.env.NEXT_PUBLIC_SUPABASE_URL,
    a: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    r: restaurantId,
    e: email,
    p: password,
    k: engineKey(restaurantId),
    // Webbappens adress: bara den får visa videon (WEB_ORIGINS i AI.py)
    w: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).origin : '',
  };
  return PREFIX + Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/** Om ett AI-konto finns för restaurangen. */
export async function hasEngineAccount(restaurantId: string) {
  const { count } = await serverSupabase()
    .from('restaurant_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('role', 'engine');
  return (count ?? 0) > 0;
}

/** Restaurangen för den inloggade, om hen är ägaren. Bara ägaren kopplar AI-datorn. */
export async function ownerRestaurant(): Promise<{ restaurantId: string; userId: string }> {
  const supabase = serverSupabase();
  const restaurantId = await currentRestaurantId(supabase);
  const user = await currentUser();
  const { data: member } = await supabase.from('restaurant_members').select('role').eq('user_id', user!.id).eq('restaurant_id', restaurantId).maybeSingle();
  if (member?.role !== 'owner') throw new UserError('Bara ägaren kan koppla AI-datorn.', 403);
  return { restaurantId, userId: user!.id };
}

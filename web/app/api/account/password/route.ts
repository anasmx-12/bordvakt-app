import { breachedPassword, BREACHED_MESSAGE } from '@/lib/breachedPassword';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { checkNewPassword } from '@/lib/password';
import { sharedRateLimit } from '@/lib/rateLimit';
import { currentRestaurantId, currentUser, errorResponse, serverSupabase, UserError } from '@/lib/server';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** true = lösenordet stämmer. Provar inloggningen och loggar genast ut just den inloggningen. */
async function passwordMatches(email: string, password: string) {
  const probe = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await probe.auth.signInWithPassword({ email, password });
  if (error) return false;
  await probe.auth.signOut({ scope: 'local' });
  return true;
}

// POST /api/account/password { current }            → steg 1: stämmer det nuvarande lösenordet?
// POST /api/account/password { current, password }  → steg 2: byter lösenord. Andra enheter loggas
// ut; den här webbläsaren loggas in igen med det nya lösenordet.
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user?.email) throw new UserError('Du är inte inloggad. Ladda om sidan.', 401);
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase); // nekar AI-datorns och supportens konton
    const body = await req.json().catch(() => null);
    const current = typeof body?.current === 'string' ? body.current : '';
    if (!current) throw new UserError('Skriv ditt nuvarande lösenord.');
    if (!(await sharedRateLimit(`pw-change:${user.id}`, 6, 900))) {
      throw new UserError('För många försök. Vänta en kvart och försök igen.', 429);
    }
    if (!(await passwordMatches(user.email, current))) throw new UserError('Fel lösenord.');
    if (body?.password === undefined) return Response.json({ ok: true });

    const { data: r } = await supabase.from('restaurants').select('name').eq('id', restaurantId).maybeSingle();
    const password = checkNewPassword(body.password, user.email, r?.name ?? '');
    if (await breachedPassword(password)) throw new UserError(BREACHED_MESSAGE);
    if (password === current) throw new UserError('Det nya lösenordet måste vara ett annat än det gamla.');

    const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
    if (error) throw new UserError(`Kunde inte byta lösenord: ${error.message}`, 500);
    // Logga ut alla enheter (en som kommit åt kontot åker ut) …
    await supabase.rpc('revoke_user_sessions', { p_user_id: user.id });
    // … och logga in den här webbläsaren igen
    const store = await cookies();
    const browser = createServerClient(URL_, ANON, {
      cookies: { getAll: () => store.getAll(), setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)) },
    });
    await browser.auth.signInWithPassword({ email: user.email, password });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

import { checkNewPassword } from '@/lib/password';
import { findReset } from '@/lib/passwordReset';
import { errorResponse, serverSupabase, UserError } from '@/lib/server';

// POST /api/password-reset { token, password } — kunden väljer nytt lösenord via länken från supporten.
// Länken fungerar en gång. Efteråt loggas kontot ut på alla enheter.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const reset = await findReset(body?.token);
    if (!reset) throw new UserError('Länken har gått ut eller redan använts. Kontakta supporten för en ny.', 410);
    const supabase = serverSupabase();
    const { data: m } = await supabase
      .from('restaurant_members')
      .select('restaurants(name)')
      .eq('user_id', reset.userId)
      .maybeSingle();
    const restaurant = (m?.restaurants as { name?: string } | null)?.name ?? '';
    const password = checkNewPassword(body?.password, reset.email, restaurant);

    // Länken förbrukas först, så att den inte kan användas två gånger samtidigt
    const { data: used } = await supabase.from('password_resets').delete().eq('user_id', reset.userId).select('token_hash');
    if (!used?.length) throw new UserError('Länken har redan använts.', 410);
    // Mejlet kom fram, så adressen är bekräftad
    const { error } = await supabase.auth.admin.updateUserById(reset.userId, { password, email_confirm: true });
    if (error) throw new UserError(`Kunde inte spara lösenordet: ${error.message}`, 500);
    await supabase.rpc('revoke_user_sessions', { p_user_id: reset.userId });
    return Response.json({ ok: true, email: reset.email });
  } catch (err) {
    return errorResponse(err);
  }
}

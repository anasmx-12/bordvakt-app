import { errorResponse, serverSupabase, UserError } from '@/lib/server';
import { assertRealEmail, sendEmailCode } from '@/lib/identity';
import { weakPassword } from '@/lib/password';


// POST /api/signup { restaurant, email, password } — skapar ett konto och en egen restaurang.
// Kontot är obekräftat tills kunden skriver in koden från mejlet (POST /api/signup/verify).
// Adressen måste kunna ta emot e-post och får inte vara en tillfällig engångsadress.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const restaurant = typeof body?.restaurant === 'string' ? body.restaurant.trim().slice(0, 80) : '';
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!restaurant) throw new UserError('Skriv restaurangens namn');
    if (password.length < 10) throw new UserError('Lösenordet måste ha minst 10 tecken');
    if (password.length > 72) throw new UserError('Lösenordet får ha högst 72 tecken');
    if (weakPassword(password, email, restaurant)) {
      throw new UserError('Lösenordet är för lätt att gissa. Välj något längre som inte innehåller e-postadressen eller restaurangens namn.');
    }
    await assertRealEmail(email);

    const supabase = serverSupabase();
    const { data: created, error: userError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
    });
    if (userError || !created.user) {
      const exists = userError?.code === 'email_exists' || /already/i.test(userError?.message ?? '');
      throw new UserError(
        exists ? 'Det finns redan ett konto med den e-postadressen. Logga in i stället.' : `Kunde inte skapa kontot: ${userError?.message}`,
        exists ? 409 : 500
      );
    }
    const userId = created.user.id;

    // Restaurang och koppling. Går något fel tas kontot bort, så att kunden kan försöka igen.
    const { data: row, error } = await supabase.from('restaurants').insert({ name: restaurant }).select('id').single();
    const { error: memberError } = row
      ? await supabase.from('restaurant_members').insert({ user_id: userId, restaurant_id: row.id, role: 'owner' })
      : { error: null };
    if (error || memberError) {
      if (row) await supabase.from('restaurants').delete().eq('id', row.id);
      await supabase.auth.admin.deleteUser(userId);
      const missing = memberError?.code === 'PGRST205';
      throw new UserError(
        missing
          ? 'Databasen är inte uppdaterad. Kör supabase/005_accounts_and_billing.sql i Supabase.'
          : `Kunde inte skapa restaurangen: ${(error ?? memberError)?.message}`,
        500
      );
    }

    // Koden i mejlet. Går det inte att skicka tas kontot bort, så att kunden kan försöka igen.
    try {
      await sendEmailCode(supabase, userId, email);
    } catch (err) {
      await supabase.from('restaurants').delete().eq('id', row!.id);
      await supabase.auth.admin.deleteUser(userId);
      throw err;
    }
    return Response.json({ ok: true, verify_email: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

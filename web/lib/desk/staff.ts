import 'server-only';
import { randomBytes } from 'crypto';
import { serverSupabase, UserError } from '@/lib/server';
import { audit, DeskContext, isEmail, isUuid, text } from './gate';
import { sendInvite } from './auth';

// Supportens personal och logg. Bara administratörer.

async function activeAdmins() {
  const { count } = await serverSupabase().from('support_staff').select('user_id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true);
  return count ?? 0;
}

/** GET staff — personalen, och om de kopplat autentiseringsappen eller har en öppen inbjudan. */
export async function listStaff() {
  const db = serverSupabase();
  const { data } = await db
    .from('support_staff')
    .select('user_id, name, email, role, active, last_login_at, created_at')
    .order('active', { ascending: false })
    .order('name');
  const people = await Promise.all(
    (data ?? []).map(async (p) => {
      const [{ data: f }, { count }] = await Promise.all([
        db.auth.admin.mfa.listFactors({ userId: p.user_id }),
        db.from('support_invites').select('user_id', { count: 'exact', head: true }).eq('user_id', p.user_id),
      ]);
      return { ...p, mfa: (f?.factors ?? []).some((x) => x.status === 'verified'), invited: (count ?? 0) > 0 };
    })
  );
  return { people };
}

/** POST staff { name, email, role } — bjuder in ny personal. Kontot är skilt från kundkonton. */
export async function inviteStaff(ctx: DeskContext, input: Record<string, unknown>) {
  const staff = ctx.staff!;
  const name = text(input.name, 100);
  const email = text(input.email, 200).toLowerCase();
  const role = input.role === 'admin' ? 'admin' : 'agent';
  if (name.length < 2 || !name.includes(' ')) throw new UserError('Skriv förnamn och efternamn.');
  if (!isEmail(email)) throw new UserError('Skriv en giltig e-postadress.');

  const db = serverSupabase();
  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomBytes(36).toString('base64url'), // ersätts när personen väljer lösenord via länken
    app_metadata: { bordvakt_staff: true },
    user_metadata: { name },
  });
  if (error || !data.user) {
    const exists = error?.code === 'email_exists' || /already/i.test(error?.message ?? '');
    throw new UserError(exists ? 'Adressen används redan av ett annat konto (t.ex. en kund). Personal behöver en egen adress.' : `Kunde inte skapa kontot: ${error?.message}`, exists ? 409 : 500);
  }
  const { error: insertError } = await db.from('support_staff').insert({ user_id: data.user.id, name, email, role, created_by: staff.user_id });
  if (insertError) {
    await db.auth.admin.deleteUser(data.user.id);
    throw new UserError(`Kunde inte spara personalen: ${insertError.message}`, 500);
  }
  const link = await sendInvite(data.user.id, name, email);
  await audit(ctx, staff, 'staff_invite', { type: 'staff', id: data.user.id }, { name, email, role, mailed: !link });
  return { ok: true, link };
}

/** PATCH staff/:id { action: 'role' | 'deactivate' | 'activate' | 'reset-password' | 'reset-mfa', role? } */
export async function updateStaff(ctx: DeskContext, input: Record<string, unknown>, id: string) {
  const me = ctx.staff!;
  if (!isUuid(id)) throw new UserError('Okänd person.', 404);
  if (id === me.user_id) throw new UserError('Du kan inte ändra ditt eget konto här. Be en annan administratör.', 409);
  const db = serverSupabase();
  const { data: person } = await db.from('support_staff').select('user_id, name, email, role, active').eq('user_id', id).maybeSingle();
  if (!person) throw new UserError('Okänd person.', 404);
  const action = input.action;
  const lastAdmin = person.role === 'admin' && person.active && (await activeAdmins()) <= 1;
  let detail: Record<string, unknown> = { name: person.name, action };
  let link: string | null = null;

  if (action === 'role') {
    const role = input.role === 'admin' ? 'admin' : 'agent';
    if (role === 'agent' && lastAdmin) throw new UserError('Det måste finnas minst en administratör.', 409);
    await db.from('support_staff').update({ role }).eq('user_id', id);
    detail = { ...detail, from: person.role, to: role };
  } else if (action === 'deactivate') {
    if (lastAdmin) throw new UserError('Det måste finnas minst en administratör.', 409);
    await db.from('support_staff').update({ active: false }).eq('user_id', id);
    await db.from('support_invites').delete().eq('user_id', id);
    // Spärrat: kan inte logga in eller förnya inloggningen. Varje anrop kontrollerar dessutom "active".
    await db.auth.admin.updateUserById(id, { ban_duration: '876000h' });
  } else if (action === 'activate') {
    await db.from('support_staff').update({ active: true }).eq('user_id', id);
    await db.auth.admin.updateUserById(id, { ban_duration: 'none' });
  } else if (action === 'reset-password') {
    if (!person.active) throw new UserError('Aktivera kontot först.', 409);
    link = await sendInvite(id, person.name, person.email, true);
  } else if (action === 'reset-mfa') {
    const { data } = await db.auth.admin.mfa.listFactors({ userId: id });
    for (const f of data?.factors ?? []) await db.auth.admin.mfa.deleteFactor({ userId: id, id: f.id });
    detail = { ...detail, removed: data?.factors?.length ?? 0 };
  } else {
    throw new UserError('Okänd åtgärd.');
  }
  await audit(ctx, me, 'staff_update', { type: 'staff', id }, detail);
  return { ok: true, link };
}

const LOG_PAGE = 100;

/** GET log?sida=&vem= — loggen över vad personalen gjort, nyast först. */
export async function listLog(_ctx: DeskContext, url: URL) {
  const page = Math.max(0, Number(url.searchParams.get('sida')) || 0);
  const vem = url.searchParams.get('vem');
  let q = serverSupabase()
    .from('support_audit')
    .select('id, staff_id, staff_name, action, target_type, target_id, detail, ip, created_at')
    .order('created_at', { ascending: false })
    .range(page * LOG_PAGE, page * LOG_PAGE + LOG_PAGE - 1);
  if (vem && isUuid(vem)) q = q.eq('staff_id', vem);
  const { data, error } = await q;
  return { rows: data ?? [], error: error?.message ?? null, pageSize: LOG_PAGE };
}

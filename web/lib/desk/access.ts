import 'server-only';
import { serverSupabase, UserError } from '@/lib/server';
import { sendMail } from '@/lib/mail';
import { accessState, MISSING_023 } from '@/lib/supportAccess';
import { audit, customerSite, DeskContext, isUuid, text } from './gate';

// "Se som kunden": supporten ser kundens app i läsläge, bara när ägaren har godkänt det
// (lib/supportAccess.ts). Supporten kan aldrig ändra något här, och ser aldrig kamerabilder,
// kameraadresser, nycklar eller gästernas kontaktuppgifter.

async function restaurantName(id: string) {
  if (!isUuid(id)) throw new UserError('Kunden finns inte.', 404);
  const { data } = await serverSupabase().from('restaurants').select('id, name').eq('id', id).maybeSingle();
  if (!data) throw new UserError('Kunden finns inte.', 404);
  return data as { id: string; name: string };
}

/** POST customers/:id/access-request { reason } — ber ägaren om läsåtkomst. Ägarna får ett mejl
 *  och ser förfrågan överst i appen. */
export async function requestAccess(ctx: DeskContext, input: Record<string, unknown>, id: string) {
  const staff = ctx.staff!;
  const r = await restaurantName(id);
  const reason = text(input.reason, 300);
  if (reason.length < 5) throw new UserError('Skriv varför du behöver se kundens app.');
  const state = await accessState(r.id);
  if (state.active) throw new UserError('Kunden har redan gett åtkomst.', 409);
  const db = serverSupabase();
  // En ny förfrågan ersätter en gammal som inte är besvarad
  if (state.pending) await db.from('support_access').update({ ended_at: new Date().toISOString() }).eq('id', state.pending.id);
  const { error } = await db.from('support_access').insert({ restaurant_id: r.id, requested_by: staff.user_id, requested_by_name: staff.name, reason });
  if (error) throw new UserError(error.code === 'PGRST205' || error.code === '42P01' ? MISSING_023 : error.message, 500);

  const { data: owners } = await db.from('restaurant_members').select('user_id').eq('restaurant_id', r.id).eq('role', 'owner');
  let mailed = 0;
  for (const { user_id } of owners ?? []) {
    const { data } = await db.auth.admin.getUserById(user_id);
    const email = data?.user?.email;
    if (!email || data?.user?.app_metadata?.bordvakt_engine === true) continue;
    const sent = await sendMail({
      to: email,
      fromName: 'Bordvakt support',
      subject: 'Bordvakts support ber om att få se er app',
      text: [
        'Hej!',
        '',
        `${staff.name} på Bordvakts support vill se ${r.name} i appen för att kunna hjälpa er.`,
        `Anledning: ${reason}`,
        '',
        'Supporten kan bara titta, inte ändra något, och ser aldrig kamerabilderna.',
        'Åtkomsten gäller i en timme och ni kan avsluta den när som helst.',
        '',
        `Godkänn eller neka här: ${customerSite()}/settings`,
        '',
        'Har ni inte kontaktat supporten? Neka förfrågan och svara gärna på det här mejlet.',
        '',
        '/ Bordvakt',
      ].join('\n'),
    });
    if (sent.sent) mailed++;
  }
  await audit(ctx, staff, 'support_access_request', { type: 'restaurant', id: r.id }, { name: r.name, reason, mailed });
  return { ok: true, mailed };
}

/** Status för supportens kundsida: väntar, öppen (till när) eller ingen. */
export async function accessSummary(restaurantId: string) {
  const { pending, active } = await accessState(restaurantId);
  if (active) return { state: 'open' as const, expires_at: active.expires_at, by: active.requested_by_name };
  if (pending) return { state: 'pending' as const, requested_at: pending.requested_at, by: pending.requested_by_name };
  return { state: 'none' as const };
}

/** GET customers/:id/app — kundens app i läsläge. Kräver att ägaren har godkänt. */
export async function customerApp(ctx: DeskContext, _url: URL, id: string) {
  const r = await restaurantName(id);
  const { active } = await accessState(r.id);
  if (!active) throw new UserError('Kunden har inte gett åtkomst, eller så har den gått ut.', 403);
  const db = serverSupabase();
  const [setup, settings, tables, cameras, orders, categories, items] = await Promise.all([
    db.rpc('setup_status', { p_restaurant_id: r.id }),
    db.from('restaurants').select('qr_ordering, currency, menu_step_done, features, guests_per_waiter, daily_report').eq('id', r.id).maybeSingle(),
    db.from('tables').select('id, table_number, area, status, last_updated, camera_id').eq('restaurant_id', r.id).order('table_number'),
    db.from('camera_feeds').select('id, name, status').eq('restaurant_id', r.id).order('created_at'),
    db.from('orders').select('id, table_id, items, status, created_at, served_at').eq('restaurant_id', r.id).order('created_at', { ascending: false }).limit(30),
    db.from('menu_categories').select('id', { count: 'exact', head: true }).eq('restaurant_id', r.id),
    db.from('menu_items').select('available').eq('restaurant_id', r.id),
  ]);
  const cams = (cameras.data ?? []) as { id: string; name: string; status: string }[];
  const camName = new Map(cams.map((c) => [c.id, c.name]));
  const tableRows = (tables.data ?? []) as { id: string; table_number: number; area: string; status: string; last_updated: string; camera_id: string | null }[];
  const tableNo = new Map(tableRows.map((t) => [t.id, t.table_number]));
  const menu = (items.data ?? []) as { available: boolean }[];
  await audit(ctx, ctx.staff, 'customer_app_view', { type: 'restaurant', id: r.id }, { name: r.name });
  return {
    restaurant: { id: r.id, name: r.name },
    expires_at: active.expires_at,
    setup: setup.data ?? null,
    settings: settings.data ?? null,
    tables: tableRows.map(({ id: _id, camera_id, ...t }) => (void _id, { ...t, camera: camera_id ? camName.get(camera_id) ?? null : null })),
    cameras: cams.map(({ name, status }) => ({ name, status })),
    orders: ((orders.data ?? []) as { id: string; table_id: string; items: unknown; status: string; created_at: string; served_at: string | null }[]).map(
      ({ table_id, ...o }) => ({ ...o, table: tableNo.get(table_id) ?? null })
    ),
    menu: { categories: categories.count ?? 0, items: menu.length, sold_out: menu.filter((m) => !m.available).length },
  };
}

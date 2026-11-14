import 'server-only';
import { createHash, randomBytes } from 'crypto';
import { serverSupabase, UserError } from '@/lib/server';
import { sendMail } from '@/lib/mail';
import { stripe } from '@/lib/billing';
import { safeEngineUrl } from '@/lib/engine';
import { sharedRateLimit } from '@/lib/rateLimit';
import { audit, customerSite, DeskContext, isUuid, text } from './gate';

// Supportens kunder: sök, visa och de åtgärder supporten får göra. Supporten ser aldrig
// kamerabilder, nycklar eller AI-datorns adress, bara om den svarar.

const LIST_COLS = 'id, name, created_at, plan, subscription_status, billing_exempt';
const DETAIL_COLS = `${LIST_COLS}, trial_ends_at, cancel_at_period_end, current_period_end, stripe_customer_id, stripe_subscription_id, engine_url`;

interface Restaurant {
  id: string;
  name: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  engine_url: string | null;
  [key: string]: unknown;
}

async function loadRestaurant(id: unknown): Promise<Restaurant> {
  if (!isUuid(id)) throw new UserError('Kunden finns inte.', 404);
  const { data } = await serverSupabase().from('restaurants').select(DETAIL_COLS).eq('id', id).maybeSingle();
  if (!data) throw new UserError('Kunden finns inte.', 404);
  return data as unknown as Restaurant;
}

/** Restaurangens konton (inte AI-datorns). */
async function restaurantPeople(restaurantId: string) {
  const db = serverSupabase();
  const { data: members } = await db.from('restaurant_members').select('user_id, role').eq('restaurant_id', restaurantId);
  const people = [];
  for (const m of members ?? []) {
    const { data } = await db.auth.admin.getUserById(m.user_id);
    const u = data?.user;
    if (!u || u.app_metadata?.bordvakt_engine === true) continue;
    const meta = u.app_metadata ?? {};
    people.push({
      id: u.id,
      email: u.email ?? '',
      role: m.role as string,
      legal_name: typeof meta.legal_name === 'string' ? meta.legal_name : null,
      email_confirmed: Boolean(u.email_confirmed_at),
      card_name_mismatch: typeof meta.card_name_mismatch === 'string' ? meta.card_name_mismatch : null,
      card_name_approved: typeof meta.card_name_approved === 'string' ? meta.card_name_approved : null,
      last_sign_in_at: u.last_sign_in_at ?? null,
    });
  }
  return people;
}

/** true = svarar, false = svarar inte, null = ingen AI-dator kopplad. Frågar bara /health. */
async function engineOnline(engineUrl: unknown): Promise<boolean | null> {
  const base = safeEngineUrl(engineUrl);
  if (!base) return null;
  try {
    const res = await fetch(`${base}/health`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** GET customers?q= — sök på restaurangens namn eller en e-post som hör till den. */
export async function listCustomers(ctx: DeskContext, url: URL) {
  const db = serverSupabase();
  const term = (url.searchParams.get('q') ?? '').replace(/[^\p{L}\p{N}@.\-_ &']/gu, '').trim().slice(0, 80);
  if (!term) {
    const { data } = await db.from('restaurants').select(LIST_COLS).order('created_at', { ascending: false }).limit(30);
    return { rows: data ?? [], term };
  }
  const [{ data: byName }, { data: users }] = await Promise.all([
    db.from('restaurants').select(LIST_COLS).ilike('name', `%${term}%`).limit(25),
    term.length >= 3 ? db.rpc('support_find_users', { p_query: term }) : Promise.resolve({ data: [] }),
  ]);
  const ids = ((users ?? []) as { id: string }[]).map((u) => u.id);
  const { data: links } = ids.length ? await db.from('restaurant_members').select('restaurant_id').in('user_id', ids) : { data: [] };
  const extra = (links ?? []).map((l) => l.restaurant_id).filter((id) => !(byName ?? []).some((r) => r.id === id));
  const { data: byEmail } = extra.length ? await db.from('restaurants').select(LIST_COLS).in('id', extra) : { data: [] };
  const rows = [...(byName ?? []), ...(byEmail ?? [])];
  await audit(ctx, ctx.staff, 'customer_search', undefined, { query: term, hits: rows.length });
  return { rows, term };
}

/** GET customers/:id — kunden, dess konton, ärenden och om AI-datorn svarar. */
export async function getCustomer(ctx: DeskContext, _url: URL, id: string) {
  const r = await loadRestaurant(id);
  const [people, online, { data: tickets }] = await Promise.all([
    restaurantPeople(r.id),
    engineOnline(r.engine_url),
    serverSupabase().from('support_tickets').select('id, number, topic, status, created_at').eq('restaurant_id', r.id).order('created_at', { ascending: false }).limit(20),
  ]);
  await audit(ctx, ctx.staff, 'customer_view', { type: 'restaurant', id: r.id }, { name: r.name });
  const { engine_url: _engine, ...restaurant } = r;
  void _engine;
  return { restaurant, people, online, tickets: tickets ?? [] };
}

/** POST customers/:id/approve-card { userId, note } — godkänner kortnamnet efter kontroll av legitimationen.
 *  Gäller bara exakt det namnet: byter kunden kort kontrolleras det nya som vanligt. */
export async function approveCard(ctx: DeskContext, input: Record<string, unknown>, id: string) {
  const staff = ctx.staff!;
  const r = await loadRestaurant(id);
  const note = text(input.note, 500);
  if (!isUuid(input.userId)) throw new UserError('Okänt konto.');
  if (note.length < 5) throw new UserError('Skriv hur det kontrollerades.');
  const db = serverSupabase();
  const { data: member } = await db
    .from('restaurant_members')
    .select('user_id')
    .eq('restaurant_id', r.id)
    .eq('user_id', input.userId)
    .eq('role', 'owner')
    .maybeSingle();
  if (!member) throw new UserError('Kontot hör inte till kunden.', 404);
  const { data } = await db.auth.admin.getUserById(input.userId);
  const meta = data?.user?.app_metadata ?? {};
  const card = meta.card_name_mismatch;
  if (typeof card !== 'string' || card === '(inget namn på kortet)') throw new UserError('Kontot är inte låst för ett kortnamn.', 409);
  const { error } = await db.auth.admin.updateUserById(input.userId, {
    app_metadata: {
      ...meta,
      card_name_mismatch: null,
      card_name_approved: card,
      card_name_approved_by: staff.name,
      card_name_approved_at: new Date().toISOString(),
    },
  });
  if (error) throw new UserError(error.message, 500);
  await audit(ctx, staff, 'card_name_approve', { type: 'restaurant', id: r.id }, { name: r.name, user: input.userId, legal_name: meta.legal_name ?? null, card, note });
  return { ok: true };
}

const missing = (e: unknown) => (e as { code?: string })?.code === 'resource_missing';

/** POST customers/:id/delete { confirm: "radera", reason } — raderar kunden helt: prenumerationen hos Stripe,
 *  restaurangen med all dess data och alla dess inloggningar. Går inte att ångra. Bara administratörer. */
export async function deleteCustomer(ctx: DeskContext, input: Record<string, unknown>, id: string) {
  const r = await loadRestaurant(id);
  if (text(input.confirm, 20).toLowerCase() !== 'radera') throw new UserError('Skriv "radera" för att bekräfta.');
  const reason = text(input.reason, 500);
  if (reason.length < 5) throw new UserError('Skriv varför kunden raderas.');

  // 1. Stripe först: slutar det dras pengar innan kontot försvinner. Går det inte, raderas inget.
  try {
    if (r.stripe_subscription_id) {
      await stripe().subscriptions.cancel(r.stripe_subscription_id).catch((e) => {
        if (!missing(e) && !/canceled/i.test(String((e as Error).message))) throw e;
      });
    }
    if (r.stripe_customer_id) {
      await stripe().customers.del(r.stripe_customer_id).catch((e) => {
        if (!missing(e)) throw e;
      });
    }
  } catch (e) {
    throw new UserError(`Stripe svarade med ett fel, inget är raderat: ${(e as Error).message}`, 502);
  }

  // 2. Loggen först, så att det finns kvar vad som raderades även om något nedan skulle gå fel
  const db = serverSupabase();
  const people = await restaurantPeople(r.id);
  const { data: members } = await db.from('restaurant_members').select('user_id').eq('restaurant_id', r.id);
  await audit(ctx, ctx.staff, 'customer_delete', { type: 'restaurant', id: r.id }, {
    name: r.name,
    email: people.map((p) => p.email).join(', '),
    reason,
  });

  // 3. Restaurangen (allt som hör till den raderas med den) och alla dess konton, även AI-datorns
  const { error } = await db.from('restaurants').delete().eq('id', r.id);
  if (error) throw new UserError(`Kunde inte radera restaurangen: ${error.message}`, 500);
  const failed: string[] = [];
  for (const { user_id } of members ?? []) {
    const { error: e } = await db.auth.admin.deleteUser(user_id);
    if (e) failed.push(user_id);
  }
  if (failed.length) throw new UserError(`Restaurangen är raderad, men ${failed.length} inloggning(ar) kunde inte tas bort. Försök igen eller ta bort dem i Supabase.`, 500);
  return { ok: true };
}

/** POST customers/:id/exempt { exempt, reason } — gratis eller betalande. Bara administratörer. */
export async function exempt(ctx: DeskContext, input: Record<string, unknown>, id: string) {
  const r = await loadRestaurant(id);
  const reason = text(input.reason, 500);
  if (typeof input.exempt !== 'boolean') throw new UserError('Ogiltigt val.');
  if (reason.length < 5) throw new UserError('Skriv varför.');
  const { error } = await serverSupabase().from('restaurants').update({ billing_exempt: input.exempt }).eq('id', r.id);
  if (error) throw new UserError(error.message, 500);
  await audit(ctx, ctx.staff, 'billing_exempt', { type: 'restaurant', id: r.id }, { name: r.name, exempt: input.exempt, reason });
  return { ok: true };
}

const RESET_MINUTES = 60;

/** POST customers/:id/reset-password { userId, confirm: "reset" } — mejlar kunden en länk för att välja
 *  nytt lösenord. Länken gäller i en timme och en gång; kontot loggas ut överallt när lösenordet är bytt. */
export async function resetPassword(ctx: DeskContext, input: Record<string, unknown>, id: string) {
  const staff = ctx.staff!;
  const r = await loadRestaurant(id);
  if (text(input.confirm, 20).toLowerCase() !== 'reset') throw new UserError('Skriv "reset" för att bekräfta.');
  if (!isUuid(input.userId)) throw new UserError('Okänt konto.');
  const db = serverSupabase();
  const { data: member } = await db.from('restaurant_members').select('user_id').eq('restaurant_id', r.id).eq('user_id', input.userId).maybeSingle();
  if (!member) throw new UserError('Kontot hör inte till kunden.', 404);
  const { data } = await db.auth.admin.getUserById(input.userId);
  const user = data?.user;
  if (!user?.email || user.app_metadata?.bordvakt_engine === true) throw new UserError('Det här kontot har inget lösenord att återställa.', 409);
  if (!(await sharedRateLimit(`support-reset:${user.id}`, 3, 3600))) throw new UserError('Högst 3 länkar per konto och timme. Be kunden kolla skräpposten.', 429);

  const token = randomBytes(32).toString('base64url');
  await db.from('password_resets').delete().eq('user_id', user.id);
  const { error } = await db.from('password_resets').insert({
    token_hash: createHash('sha256').update(`password-reset:${token}`).digest('hex'),
    user_id: user.id,
    expires_at: new Date(Date.now() + RESET_MINUTES * 60_000).toISOString(),
    requested_by: staff.user_id,
  });
  if (error) {
    const missingTable = error.code === 'PGRST205' || error.code === '42P01';
    throw new UserError(missingTable ? 'Kör supabase/020_password_resets.sql i Supabase → SQL Editor först.' : error.message, 500);
  }
  const link = `${customerSite()}/nytt-losenord?t=${token}`;
  const mail = await sendMail({
    to: user.email,
    subject: 'Välj ett nytt lösenord till Bordvakt',
    text: [
      'Hej!',
      '',
      `Bordvakts support har skickat en länk så att du kan välja ett nytt lösenord för ${user.email}.`,
      '',
      `Välj nytt lösenord här (länken gäller i ${RESET_MINUTES} minuter och kan bara användas en gång):`,
      link,
      '',
      'När lösenordet är bytt loggas kontot ut på alla enheter.',
      'Har du inte bett om det här? Strunta i mejlet, ditt lösenord ändras inte. Hör gärna av dig till oss.',
      '',
      '/ Bordvakt',
    ].join('\n'),
  });
  if (!mail.sent) {
    await db.from('password_resets').delete().eq('user_id', user.id);
    throw new UserError('Mejlet kunde inte skickas. Försök igen om en stund.', 502);
  }
  await audit(ctx, staff, 'customer_password_reset', { type: 'restaurant', id: r.id }, { name: r.name, email: user.email });
  return { ok: true, email: user.email };
}

const MAX_TRIAL_DAYS_AHEAD = 60;

/** POST customers/:id/trial { days, reason } — förlänger provperioden hos Stripe. Bara medan den pågår. */
export async function extendTrial(ctx: DeskContext, input: Record<string, unknown>, id: string) {
  const r = await loadRestaurant(id);
  const days = Number(input.days);
  const reason = text(input.reason, 500);
  if (![3, 7, 14, 30].includes(days)) throw new UserError('Välj 3, 7, 14 eller 30 dagar.');
  if (reason.length < 5) throw new UserError('Skriv varför.');
  if (!r.stripe_subscription_id) throw new UserError('Kunden har ingen prenumeration.', 409);

  const sub = await stripe().subscriptions.retrieve(r.stripe_subscription_id);
  if (sub.status !== 'trialing' || !sub.trial_end) throw new UserError('Provperioden pågår inte längre.', 409);
  const now = Math.floor(Date.now() / 1000);
  const trialEnd = Math.max(sub.trial_end, now) + days * 86400;
  if (trialEnd > now + MAX_TRIAL_DAYS_AHEAD * 86400) throw new UserError(`Provperioden kan högst sluta ${MAX_TRIAL_DAYS_AHEAD} dagar fram.`, 409);

  await stripe().subscriptions.update(sub.id, { trial_end: trialEnd, proration_behavior: 'none' });
  const iso = new Date(trialEnd * 1000).toISOString();
  await serverSupabase().from('restaurants').update({ trial_ends_at: iso }).eq('id', r.id);
  await audit(ctx, ctx.staff, 'trial_extend', { type: 'restaurant', id: r.id }, { name: r.name, days, reason, trial_ends_at: iso });
  return { ok: true, trial_ends_at: iso };
}

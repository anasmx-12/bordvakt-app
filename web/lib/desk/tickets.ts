import 'server-only';
import { serverSupabase, UserError } from '@/lib/server';
import { sendMail, SUPPORT_EMAIL } from '@/lib/mail';
import { audit, customerSite, DeskContext, isUuid, text } from './gate';

// Supportens ärenden: läsa, svara, föreslå tider och byta status.

const STATUS_LABEL: Record<string, string> = {
  NEW: 'Nytt',
  OPEN: 'Pågår',
  WAITING_CUSTOMER: 'Väntar på kunden',
  DATE_PROPOSED: 'Dagar föreslagna',
  SCHEDULED: 'Bokad',
  DONE: 'Klart',
  CLOSED: 'Stängt',
};
const STATUSES = Object.keys(STATUS_LABEL);
const OPEN_STATUSES = ['NEW', 'OPEN', 'WAITING_CUSTOMER', 'DATE_PROPOSED', 'SCHEDULED'];
export const FILTERS: Record<string, string[]> = {
  open: OPEN_STATUSES,
  NEW: ['NEW'],
  WAITING_CUSTOMER: ['WAITING_CUSTOMER'],
  SCHEDULED: ['SCHEDULED', 'DATE_PROPOSED'],
  closed: ['DONE', 'CLOSED'],
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Stockholm' });

interface Ticket {
  id: string;
  number: number;
  status: string;
  contact_name: string;
  contact_email: string;
  reply_token: string;
}

async function loadTicket(id: unknown): Promise<Ticket> {
  if (!isUuid(id)) throw new UserError('Ärendet finns inte.', 404);
  const { data } = await serverSupabase().from('support_tickets').select('*').eq('id', id).maybeSingle();
  if (!data) throw new UserError('Ärendet finns inte.', 404);
  return data as Ticket;
}

/** Kundens sida för ärendet (/s/<kod>). */
const customerLink = (t: Pick<Ticket, 'reply_token'>) => `${customerSite()}/s/${t.reply_token}`;

/** Mejl till kunden om ärendet. Svar på mejlet går till supportens inkorg. */
function mailCustomer(t: Ticket, subject: string, lines: string[]) {
  return sendMail({
    to: t.contact_email,
    fromName: 'Bordvakt support',
    replyTo: SUPPORT_EMAIL || undefined,
    subject: `${subject} (ärende #${t.number})`,
    text: [`Hej ${t.contact_name}!`, '', ...lines, '', `Svara eller se hela ärendet här: ${customerLink(t)}`, '', 'Vänliga hälsningar,', 'Bordvakt support'].join('\n'),
  });
}

const touch = (id: string, fields: Record<string, unknown> = {}) =>
  serverSupabase().from('support_tickets').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);

/** GET counts — antal nya ärenden (märket i menyn). */
export async function newCount() {
  const { count } = await serverSupabase().from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'NEW');
  return { newTickets: count ?? 0 };
}

const LIST_COLS = 'id, number, topic, status, contact_name, message, created_at, updated_at, restaurants(name)';

/** GET tickets?f=&q= — listan, med antal per filter. */
export async function listTickets(_ctx: DeskContext, url: URL) {
  const db = serverSupabase();
  const statuses = FILTERS[url.searchParams.get('f') ?? 'open'] ?? FILTERS.open;
  const term = (url.searchParams.get('q') ?? '').trim().replace(/^#/, '');
  let query = db.from('support_tickets').select(LIST_COLS).in('status', statuses).order('updated_at', { ascending: false }).limit(100);
  if (/^\d+$/.test(term)) query = db.from('support_tickets').select(LIST_COLS).eq('number', Number(term));
  else if (term) {
    // Bara bokstäver, siffror och vanliga tecken i e-post: inget som kan ändra filtret
    const safe = term.replace(/[^\p{L}\p{N}@.\-_ ]/gu, '').slice(0, 80);
    if (safe) query = query.or(`contact_name.ilike.%${safe}%,contact_email.ilike.%${safe}%`);
  }
  const ids = Object.keys(FILTERS);
  const [{ data, error }, counts] = await Promise.all([
    query,
    Promise.all(ids.map((id) => db.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', FILTERS[id]))),
  ]);
  if (error) {
    const missing = error.code === 'PGRST205' || error.code === '42P01';
    return { rows: [], counts: {}, error: missing ? 'Databasen saknar supporttabellerna. Kör supabase/019_support_staff.sql.' : error.message };
  }
  return { rows: data ?? [], counts: Object.fromEntries(ids.map((id, i) => [id, counts[i].count ?? 0])), error: null };
}

/** GET tickets/:id — ärendet med tråd och tider. Ett nytt ärende som öppnas blir "Pågår". */
export async function getTicket(ctx: DeskContext, _url: URL, id: string) {
  if (!isUuid(id)) throw new UserError('Ärendet finns inte.', 404);
  const db = serverSupabase();
  const { data } = await db.from('support_tickets').select('*, restaurants(id, name)').eq('id', id).maybeSingle();
  if (!data) throw new UserError('Ärendet finns inte.', 404);
  const [{ data: messages }, { data: slots }] = await Promise.all([
    db.from('support_messages').select('id, author, body, created_at, staff_name').eq('ticket_id', id).order('created_at'),
    db.from('support_slots').select('id, starts_at, chosen').eq('ticket_id', id).order('starts_at'),
  ]);
  await audit(ctx, ctx.staff, 'ticket_view', { type: 'ticket', id }, { number: data.number });
  if (data.status === 'NEW') await db.from('support_tickets').update({ status: 'OPEN' }).eq('id', id);
  const { reply_token: _token, ...ticket } = data;
  void _token;
  return {
    ticket: { ...ticket, status: data.status === 'NEW' ? 'OPEN' : data.status },
    customer_link: customerLink(data),
    messages: messages ?? [],
    slots: slots ?? [],
  };
}

/** POST tickets/:id/reply { body, waitForCustomer } — svar till kunden. Visas på kundens sida och mejlas. */
export async function reply(ctx: DeskContext, input: Record<string, unknown>, id: string) {
  const staff = ctx.staff!;
  const ticket = await loadTicket(id);
  const message = text(input.body, 4000);
  if (!message) throw new UserError('Skriv ett svar.');
  const { error } = await serverSupabase()
    .from('support_messages')
    .insert({ ticket_id: ticket.id, author: 'support', body: message, staff_id: staff.user_id, staff_name: staff.name });
  if (error) throw new UserError(error.message, 500);
  const status = input.waitForCustomer === false ? 'OPEN' : 'WAITING_CUSTOMER';
  await touch(ticket.id, { status });
  const mail = await mailCustomer(ticket, 'Svar från Bordvakt support', [message]);
  await audit(ctx, staff, 'ticket_reply', { type: 'ticket', id: ticket.id }, { number: ticket.number, mailed: mail.sent });
  return { ok: true, mailed: mail.sent, status };
}

/** POST tickets/:id/slots { times: ISO[] } — föreslår 1–5 dagar för ett besök. Kunden väljer en på sin sida. */
export async function slots(ctx: DeskContext, input: Record<string, unknown>, id: string) {
  const ticket = await loadTicket(id);
  const list = (Array.isArray(input.times) ? input.times : [])
    .map((t) => (typeof t === 'string' ? new Date(t) : null))
    .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
  if (list.length === 0 || list.length > 5) throw new UserError('Föreslå 1–5 tider.');
  if (list.some((d) => d.getTime() < Date.now())) throw new UserError('Tiderna måste ligga i framtiden.');

  const db = serverSupabase();
  await db.from('support_slots').delete().eq('ticket_id', ticket.id).eq('chosen', false);
  const { error } = await db.from('support_slots').insert(list.map((d) => ({ ticket_id: ticket.id, starts_at: d.toISOString() })));
  if (error) throw new UserError(error.message, 500);
  const pretty = list.sort((a, b) => a.getTime() - b.getTime()).map((d) => `• ${when(d.toISOString())}`);
  await db.from('support_messages').insert({ ticket_id: ticket.id, author: 'system', body: `Supporten föreslog:\n${pretty.join('\n')}` });
  await touch(ticket.id, { status: 'DATE_PROPOSED' });
  await mailCustomer(ticket, 'Välj en dag för besöket', [
    'Vi kan komma till er någon av de här tiderna:',
    ...pretty,
    '',
    `Välj den som passar bäst här: ${customerLink(ticket)}`,
  ]);
  await audit(ctx, ctx.staff, 'ticket_slots', { type: 'ticket', id: ticket.id }, { number: ticket.number, count: list.length });
  return { ok: true };
}

/** POST tickets/:id/status { status } — byter status. "Klart" mejlas till kunden. */
export async function setStatus(ctx: DeskContext, input: Record<string, unknown>, id: string) {
  const ticket = await loadTicket(id);
  const status = input.status;
  if (typeof status !== 'string' || !STATUSES.includes(status)) throw new UserError('Okänd status.');
  if (status === ticket.status) return { ok: true };
  await touch(ticket.id, { status });
  await serverSupabase().from('support_messages').insert({ ticket_id: ticket.id, author: 'system', body: `Status: ${STATUS_LABEL[status]}.` });
  if (status === 'DONE') {
    await mailCustomer(ticket, 'Ditt ärende är klart', [
      'Vi har markerat ditt ärende som klart. Hör av dig om något inte fungerar som det ska, så öppnar vi det igen.',
    ]);
  }
  await audit(ctx, ctx.staff, 'ticket_status', { type: 'ticket', id: ticket.id }, { number: ticket.number, from: ticket.status, to: status });
  return { ok: true };
}

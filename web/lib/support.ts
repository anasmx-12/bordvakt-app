import 'server-only';
import { SupabaseClient } from '@supabase/supabase-js';
import { enginePost } from './engine';
import { sendMail, SUPPORT_EMAIL } from './mail';
import { setupFacts } from './setupFacts';
import { UserError } from './server';
import { SUPPORT_TOPICS, SupportTopic } from './supportTopics';

export interface TicketRow {
  id: string;
  number: number;
  restaurant_id: string;
  topic: SupportTopic;
  message: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  preferred_times: string | null;
  status: string;
  scheduled_at: string | null;
  reply_token: string;
  created_at: string;
}

export const missingSupport = (error: { code?: string; message?: string } | null) =>
  error && (error.code === 'PGRST205' || error.code === '42P01' || /support_/.test(error.message ?? ''))
    ? new UserError('Supporten är inte aktiverad. Kör supabase/011_support.sql i Supabase → SQL Editor.', 500)
    : null;

export const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Webbadressen till appen (för länkarna i mejlen). */
export function siteUrl(req: Request) {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || new URL(req.url).origin;
}

const sv = (iso: string) =>
  new Date(iso).toLocaleString('sv-SE', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Stockholm' });

/** Den lokala AI:n sammanfattar ärendet och föreslår ett svar. null om AI-motorn inte är igång. */
async function aiSummary(supabase: SupabaseClient, ticket: TicketRow) {
  try {
    const facts = await setupFacts(supabase, ticket.restaurant_id).catch(() => '');
    const { ok, data } = await enginePost<{ summary: string; reply: string }>(
      ticket.restaurant_id,
      '/support-summary',
      JSON.stringify({ topic: SUPPORT_TOPICS[ticket.topic], message: `${ticket.message}\nPassar: ${ticket.preferred_times ?? '-'}`, facts }),
      'application/json',
      60_000
    );
    return ok && data.summary ? data : null;
  } catch {
    return null;
  }
}

/** Nytt ärende: mejl till supporten (med AI-sammanfattning) och en bekräftelse till kunden. */
export async function announceTicket(supabase: SupabaseClient, ticket: TicketRow, restaurantName: string, req: Request) {
  const link = `${siteUrl(req)}/s/${ticket.reply_token}`;
  const ai = await aiSummary(supabase, ticket);
  if (ai) await supabase.from('support_tickets').update({ ai_summary: ai.summary }).eq('id', ticket.id);

  const toSupport = SUPPORT_EMAIL
    ? sendMail({
        to: SUPPORT_EMAIL,
        replyTo: ticket.contact_email,
        subject: `Supportärende #${ticket.number}: ${SUPPORT_TOPICS[ticket.topic]} – ${restaurantName}`,
        text: [
          ai ? `AI-SAMMANFATTNING\n${ai.summary}\n` : '',
          `Restaurang: ${restaurantName}`,
          `Kontakt: ${ticket.contact_name}, ${ticket.contact_email}${ticket.contact_phone ? `, ${ticket.contact_phone}` : ''}`,
          `Gäller: ${SUPPORT_TOPICS[ticket.topic]}`,
          `Passar: ${ticket.preferred_times || '-'}`,
          '',
          ticket.message,
          '',
          ai ? `FÖRSLAG PÅ SVAR (från AI:n, kontrollera innan du skickar)\n${ai.reply}\n` : '',
          `Svara på det här mejlet så går svaret direkt till kunden.`,
          `Kundens sida för ärendet: ${link}`,
        ].join('\n'),
      })
    : Promise.resolve(null);

  const toCustomer = sendMail({
    to: ticket.contact_email,
    replyTo: SUPPORT_EMAIL || undefined,
    subject: `Vi har tagit emot ditt ärende #${ticket.number}`,
    text: [
      `Hej ${ticket.contact_name}!`,
      '',
      `Tack för att du kontaktade Bordvakts support. Vi har tagit emot ditt ärende om "${SUPPORT_TOPICS[ticket.topic]}" och återkommer så snart vi kan, oftast inom en arbetsdag.`,
      'Behöver vi komma till er föreslår vi några dagar som du får välja mellan.',
      '',
      `Svara eller lägg till mer information här: ${link}`,
      'Du kan också svara direkt på det här mejlet, eller öppna Installation → Support i appen.',
      '',
      'Vänliga hälsningar,',
      'Bordvakt support',
    ].join('\n'),
  });
  const [s, c] = await Promise.all([toSupport, toCustomer]);
  return { supportMailed: Boolean(s?.sent), customerMailed: c.sent };
}

/** Kunden har skrivit ett nytt meddelande: supporten får ett mejl. */
export async function announceCustomerMessage(ticket: TicketRow, body: string, restaurantName: string, req: Request) {
  if (!SUPPORT_EMAIL) return;
  await sendMail({
    to: SUPPORT_EMAIL,
    replyTo: ticket.contact_email,
    subject: `Nytt meddelande i ärende #${ticket.number} – ${restaurantName}`,
    text: `${ticket.contact_name} skrev:\n\n${body}\n\nKundens sida för ärendet: ${siteUrl(req)}/s/${ticket.reply_token}`,
  });
}

/** Kunden har valt en av de föreslagna dagarna. */
export async function announceChosenSlot(ticket: TicketRow, startsAt: string, restaurantName: string) {
  const when = sv(startsAt);
  await Promise.all([
    SUPPORT_EMAIL &&
      sendMail({
        to: SUPPORT_EMAIL,
        replyTo: ticket.contact_email,
        subject: `Bokad supportdag ${when}: ärende #${ticket.number} – ${restaurantName}`,
        text: `${ticket.contact_name} valde ${when}.\nTelefon: ${ticket.contact_phone ?? '-'}\nE-post: ${ticket.contact_email}`,
      }),
    sendMail({
      to: ticket.contact_email,
      replyTo: SUPPORT_EMAIL || undefined,
      subject: `Bokat: Bordvakt support kommer ${when}`,
      text: `Hej ${ticket.contact_name}!\n\nTack, vi har bokat ${when} för ärende #${ticket.number}. Hör av dig om något ändras.\n\nVänliga hälsningar,\nBordvakt support`,
    }),
  ]);
}

/** Ärendet med meddelanden och föreslagna dagar (det kunden får se). */
export async function ticketView(supabase: SupabaseClient, ticket: TicketRow) {
  const [{ data: messages }, { data: slots }] = await Promise.all([
    supabase.from('support_messages').select('id, author, body, created_at').eq('ticket_id', ticket.id).order('created_at'),
    supabase.from('support_slots').select('id, starts_at, chosen').eq('ticket_id', ticket.id).order('starts_at'),
  ]);
  return {
    id: ticket.id,
    number: ticket.number,
    topic: ticket.topic,
    status: ticket.status,
    scheduled_at: ticket.scheduled_at,
    created_at: ticket.created_at,
    messages: messages ?? [],
    slots: slots ?? [],
  };
}

/** Sparar ett meddelande från kunden. Ett ärende som väntade på kunden går tillbaka till supporten. */
export async function addCustomerMessage(supabase: SupabaseClient, ticket: TicketRow, raw: unknown) {
  const body = text(raw, 4000);
  if (!body) throw new UserError('Skriv ett meddelande');
  if (ticket.status === 'CLOSED') throw new UserError('Ärendet är stängt. Skicka ett nytt ärende.', 409);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase
    .from('support_messages')
    .select('id', { count: 'exact', head: true })
    .eq('ticket_id', ticket.id)
    .eq('author', 'customer')
    .gte('created_at', since);
  if ((count ?? 0) >= 20) throw new UserError('Många meddelanden på kort tid. Vänta en stund.', 429);
  const { error } = await supabase.from('support_messages').insert({ ticket_id: ticket.id, author: 'customer', body });
  if (error) throw new UserError(error.message, 500);
  const status = ticket.status === 'WAITING_CUSTOMER' || ticket.status === 'DONE' ? 'OPEN' : ticket.status;
  await supabase.from('support_tickets').update({ status, updated_at: new Date().toISOString() }).eq('id', ticket.id);
  return body;
}

/** Kunden väljer en dag som supporten föreslagit. */
export async function chooseSlot(supabase: SupabaseClient, ticket: TicketRow, slotId: unknown) {
  if (typeof slotId !== 'string') throw new UserError('Välj en dag');
  const { data: slot } = await supabase.from('support_slots').select('id, starts_at').eq('id', slotId).eq('ticket_id', ticket.id).maybeSingle();
  if (!slot) throw new UserError('Dagen finns inte längre', 404);
  await supabase.from('support_slots').update({ chosen: false }).eq('ticket_id', ticket.id);
  await supabase.from('support_slots').update({ chosen: true }).eq('id', slot.id);
  await supabase
    .from('support_tickets')
    .update({ status: 'SCHEDULED', scheduled_at: slot.starts_at, updated_at: new Date().toISOString() })
    .eq('id', ticket.id);
  await supabase.from('support_messages').insert({ ticket_id: ticket.id, author: 'system', body: `Kunden valde ${sv(slot.starts_at)}.` });
  return slot.starts_at as string;
}

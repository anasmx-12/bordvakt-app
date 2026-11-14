import { after } from 'next/server';
import { errorResponse, serverSupabase, UserError } from '@/lib/server';
import { addCustomerMessage, announceChosenSlot, announceCustomerMessage, chooseSlot, missingSupport, TicketRow, ticketView } from '@/lib/support';

// Länken i mejlen (/s/<kod>): kunden kan läsa ärendet, svara och välja dag utan att logga in.
// Koden är hemlig och slumpad (32 tecken).

async function ticketFor(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new UserError('Länken gäller inte längre', 404);
  const supabase = serverSupabase();
  const { data: ticket, error } = await supabase.from('support_tickets').select('*').eq('reply_token', token).maybeSingle();
  if (error) throw missingSupport(error) ?? new UserError(error.message, 500);
  if (!ticket) throw new UserError('Länken gäller inte längre', 404);
  return { supabase, ticket: ticket as TicketRow };
}

export async function GET(_req: Request, ctx: RouteContext<'/api/support-link/[token]'>) {
  try {
    const { supabase, ticket } = await ticketFor((await ctx.params).token);
    return Response.json(await ticketView(supabase, ticket), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST { body } eller { slot_id }
export async function POST(req: Request, ctx: RouteContext<'/api/support-link/[token]'>) {
  try {
    const { supabase, ticket } = await ticketFor((await ctx.params).token);
    const payload = await req.json().catch(() => null);
    const { data: r } = await supabase.from('restaurants').select('name').eq('id', ticket.restaurant_id).maybeSingle();
    const name = r?.name ?? 'Okänd restaurang';
    if (payload?.slot_id) {
      const startsAt = await chooseSlot(supabase, ticket, payload.slot_id);
      after(() => announceChosenSlot(ticket, startsAt, name));
    } else {
      const body = await addCustomerMessage(supabase, ticket, payload?.body);
      after(() => announceCustomerMessage(ticket, body, name, req));
    }
    return Response.json(await ticketView(supabase, ticket));
  } catch (err) {
    return errorResponse(err);
  }
}

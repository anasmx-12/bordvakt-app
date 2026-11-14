import { after } from 'next/server';
import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { addCustomerMessage, announceChosenSlot, announceCustomerMessage, chooseSlot, missingSupport, TicketRow } from '@/lib/support';

// POST /api/support/[id]/messages — { body } nytt meddelande, eller { slot_id } välj en föreslagen dag
export async function POST(req: Request, ctx: RouteContext<'/api/support/[id]/messages'>) {
  try {
    const { id } = await ctx.params;
    const payload = await req.json().catch(() => null);
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', id)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    if (error) throw missingSupport(error) ?? new UserError(error.message, 500);
    if (!ticket) throw new UserError('Ärendet finns inte', 404);
    const { data: r } = await supabase.from('restaurants').select('name').eq('id', restaurantId).maybeSingle();
    const name = r?.name ?? 'Okänd restaurang';

    if (payload?.slot_id) {
      const startsAt = await chooseSlot(supabase, ticket as TicketRow, payload.slot_id);
      after(() => announceChosenSlot(ticket as TicketRow, startsAt, name));
    } else {
      const body = await addCustomerMessage(supabase, ticket as TicketRow, payload?.body);
      after(() => announceCustomerMessage(ticket as TicketRow, body, name, req));
    }
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

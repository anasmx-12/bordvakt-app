import { after } from 'next/server';
import { currentRestaurantId, currentUser, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { announceTicket, isEmail, missingSupport, text, TicketRow } from '@/lib/support';
import { isTopic } from '@/lib/supportTopics';

const PER_DAY = 5; // nya ärenden per restaurang och dygn

// POST /api/support — nytt supportärende från Installation → Support.
// { topic, message, contact_name, contact_email, contact_phone?, preferred_times? }
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const row = {
      topic: isTopic(body?.topic) ? body.topic : 'other',
      message: text(body?.message, 4000),
      contact_name: text(body?.contact_name, 100),
      contact_email: text(body?.contact_email, 200).toLowerCase(),
      contact_phone: text(body?.contact_phone, 40) || null,
      preferred_times: text(body?.preferred_times, 500) || null,
    };
    if (!row.message) throw new UserError('Beskriv vad du behöver hjälp med');
    if (!row.contact_name) throw new UserError('Skriv ditt namn');
    if (!isEmail(row.contact_email)) throw new UserError('Skriv en giltig e-postadress');

    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const user = await currentUser();
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count, error: countError } = await supabase
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .gte('created_at', since);
    if (countError) throw missingSupport(countError) ?? new UserError(countError.message, 500);
    if ((count ?? 0) >= PER_DAY) throw new UserError('Ni har skickat många ärenden i dag. Svara i ett befintligt ärende i stället.', 429);

    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .insert({ ...row, restaurant_id: restaurantId, created_by: user?.id ?? null })
      .select()
      .single();
    if (error) throw missingSupport(error) ?? new UserError(error.message, 500);
    await supabase.from('support_messages').insert({ ticket_id: ticket.id, author: 'customer', body: row.message });
    const { data: r } = await supabase.from('restaurants').select('name').eq('id', restaurantId).maybeSingle();

    // Mejlen (och AI-sammanfattningen, som kan ta en stund) skickas efter att svaret gått iväg
    after(() => announceTicket(supabase, ticket as TicketRow, r?.name ?? 'Okänd restaurang', req));
    return Response.json({ id: ticket.id, number: ticket.number }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

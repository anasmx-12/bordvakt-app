import { stripe, syncSubscription } from '@/lib/billing';
import { checkCardName } from '@/lib/cardName';
import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';

// POST /api/billing/sync { session_id } — körs när kunden kommer tillbaka från Stripe,
// så att appen öppnas direkt (även om webhooken inte hunnit fram, eller inte är inställd).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const sessionId = typeof body?.session_id === 'string' ? body.session_id : '';
    if (!sessionId.startsWith('cs_')) throw new UserError('Okänd betalning');

    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
    if (session.client_reference_id !== restaurantId) throw new UserError('Betalningen hör inte till ditt konto', 403);
    const sub = session.subscription;
    if (!sub || typeof sub === 'string') throw new UserError('Betalningen är inte klar än. Försök igen om en stund.', 409);
    await syncSubscription(supabase, sub);
    // Namnet på kortet måste stämma med ägarens namn
    const nameOk = await checkCardName(supabase, sub);
    return Response.json({ status: sub.status, card_name_ok: nameOk });
  } catch (err) {
    return errorResponse(err);
  }
}

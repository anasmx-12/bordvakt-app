import { stripe, syncSubscription } from '@/lib/billing';
import { currentRestaurantId, currentUser, errorResponse, serverSupabase, UserError } from '@/lib/server';

// POST /api/billing/cancel          — säger upp prenumerationen. Den gäller till periodens slut.
// POST /api/billing/cancel {undo:true} — ångrar uppsägningen innan perioden är slut.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const undo = body?.undo === true;
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);

    // Bara ägaren får säga upp, inte personalkonton
    const user = await currentUser();
    const { data: member } = await supabase
      .from('restaurant_members')
      .select('role')
      .eq('user_id', user!.id)
      .maybeSingle();
    if (member?.role !== 'owner') throw new UserError('Bara restaurangens ägare kan ändra prenumerationen.', 403);

    const { data: r } = await supabase
      .from('restaurants')
      .select('stripe_subscription_id')
      .eq('id', restaurantId)
      .single();
    if (!r?.stripe_subscription_id) throw new UserError('Det finns ingen prenumeration att säga upp.', 404);

    const s = stripe();
    const current = await s.subscriptions.retrieve(r.stripe_subscription_id);
    if (current.status === 'canceled') throw new UserError('Prenumerationen är redan avslutad.', 409);

    const sub = await s.subscriptions.update(current.id, { cancel_at_period_end: !undo });
    await syncSubscription(supabase, sub);
    return Response.json({
      cancel_at_period_end: sub.cancel_at_period_end,
      ends_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

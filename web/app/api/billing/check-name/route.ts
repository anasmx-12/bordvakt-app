import { checkCardName, restaurantSubscription } from '@/lib/cardName';
import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';

// POST /api/billing/check-name — "Kontrollera igen" efter att ägaren bytt kort eller rättat namnet.
export async function POST() {
  try {
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const sub = await restaurantSubscription(supabase, restaurantId);
    if (!sub) throw new UserError('Restaurangen har ingen prenumeration än.', 404);
    return Response.json({ card_name_ok: await checkCardName(supabase, sub) });
  } catch (err) {
    return errorResponse(err);
  }
}

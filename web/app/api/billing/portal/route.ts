import { siteUrl, stripe } from '@/lib/billing';
import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';

// POST /api/billing/portal — Stripes kundportal: byta plan, byta kort, kvitton, säga upp.
export async function POST(req: Request) {
  try {
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data: r } = await supabase.from('restaurants').select('stripe_customer_id').eq('id', restaurantId).single();
    if (!r?.stripe_customer_id) throw new UserError('Det finns ingen prenumeration att hantera än.', 404);
    const session = await stripe()
      .billingPortal.sessions.create({ customer: r.stripe_customer_id, return_url: `${siteUrl(req)}/billing`, locale: 'sv' })
      .catch((err: { message?: string }) => {
        throw new UserError(
          /configuration/i.test(err.message ?? '')
            ? 'Kundportalen är inte aktiverad i Stripe. Spara inställningarna under Settings → Billing → Customer portal.'
            : `Stripe: ${err.message}`,
          502
        );
      });
    return Response.json({ url: session.url });
  } catch (err) {
    return errorResponse(err);
  }
}

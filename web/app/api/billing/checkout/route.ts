import { priceIdFor, siteUrl, stripe } from '@/lib/billing';
import { hasAccess, isPlanId, TRIAL_DAYS } from '@/lib/plans';
import { currentRestaurantId, currentUser, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { identityOf } from '@/lib/identity';

// POST /api/billing/checkout { plan } — öppnar Stripes betalsida.
// Första gången: 7 dagar gratis, kortet dras dag 8 och sedan automatiskt varje period.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const plan = body?.plan;
    if (!isPlanId(plan)) throw new UserError('Välj en plan');

    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const user = await currentUser();
    // Vem som betalar: bekräftad e-post och fullständigt namn (jämförs med kortet efteråt)
    const identity = identityOf(user!);
    if (!identity.email_confirmed) throw new UserError('Bekräfta e-postadressen med koden i mejlet först.', 403);
    if (!identity.legal_name) throw new UserError('Skriv ditt fullständiga namn först.', 403);
    const legalName = identity.legal_name;
    const { data: r, error } = await supabase
      .from('restaurants')
      .select('id, name, stripe_customer_id, stripe_subscription_id, subscription_status, billing_exempt, trial_ends_at')
      .eq('id', restaurantId)
      .single();
    if (error) throw new UserError(`Kunde inte läsa restaurangen: ${error.message}`, 500);
    if (hasAccess(r)) {
      throw new UserError('Restaurangen har redan en prenumeration. Byt plan under "Hantera prenumeration".', 409);
    }

    const s = stripe();
    let customerId = r.stripe_customer_id as string | null;
    if (customerId) {
      // Kunden kan saknas om Stripe-nyckeln bytts (live ↔ test) eller kunden tagits bort i Stripe
      const existing = await s.customers.retrieve(customerId).catch(() => null);
      if (!existing || existing.deleted) customerId = null;
      else await s.customers.update(customerId, { name: legalName, description: r.name, metadata: { restaurant_id: restaurantId, legal_name_source: 'typed' } });
    }
    if (!customerId) {
      const customer = await s.customers.create({
        email: user?.email,
        name: legalName,
        description: r.name,
        metadata: { restaurant_id: restaurantId, legal_name_source: 'typed' },
        preferred_locales: ['sv'],
      });
      customerId = customer.id;
      await supabase.from('restaurants').update({ stripe_customer_id: customerId }).eq('id', restaurantId);
    }

    // Provperioden ges bara en gång per restaurang
    const firstTime = !r.stripe_subscription_id && !r.trial_ends_at;
    const base = siteUrl(req);
    const session = await s.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: restaurantId,
      line_items: [{ price: await priceIdFor(plan), quantity: 1 }],
      payment_method_collection: 'always',
      // Kortinnehavarens namn (krävs) och adress sparas hos Stripe. Namnet jämförs sedan med ägarens
      // namn (lib/cardName.ts). Kundens namn hos Stripe skrivs inte över av kortet.
      billing_address_collection: 'required',
      customer_update: { address: 'auto', name: 'never' },
      subscription_data: {
        metadata: { restaurant_id: restaurantId },
        ...(firstTime
          ? {
              trial_period_days: TRIAL_DAYS,
              trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
            }
          : {}),
      },
      locale: 'sv',
      success_url: `${base}/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing?avbrutet=1`,
    });
    if (!session.url) throw new UserError('Stripe gav ingen betalsida. Försök igen.', 502);
    return Response.json({ url: session.url });
  } catch (err) {
    return errorResponse(err);
  }
}

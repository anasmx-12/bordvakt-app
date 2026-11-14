import 'server-only';
import Stripe from 'stripe';
import { SupabaseClient } from '@supabase/supabase-js';
import { isPlanId, planById, PlanId } from './plans';
import { UserError } from './server';

let client: Stripe | null = null;

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes('DIN_')) {
    throw new UserError('Betalningen är inte inställd än: STRIPE_SECRET_KEY saknas i web/.env.local', 500);
  }
  client ??= new Stripe(key);
  return client;
}

const PRODUCT_ID = 'bordvakt';
const lookupKey = (plan: PlanId) => `bordvakt_${plan}`;
const priceCache = new Map<PlanId, string>();

/** Stripe-priset för planen. Skapas automatiskt i Stripe första gången,
 *  så inget behöver läggas upp för hand i Stripes dashboard. */
export async function priceIdFor(plan: PlanId): Promise<string> {
  const cached = priceCache.get(plan);
  if (cached) return cached;
  const s = stripe();
  const existing = await s.prices.list({ lookup_keys: [lookupKey(plan)], active: true, limit: 1 });
  let id = existing.data[0]?.id;
  if (!id) {
    await s.products.retrieve(PRODUCT_ID).catch(() =>
      s.products.create({ id: PRODUCT_ID, name: 'Bordvakt', description: 'AI-driven servicestöd för restauranger' })
    );
    const p = planById(plan)!;
    const price = await s.prices.create({
      product: PRODUCT_ID,
      currency: 'sek',
      unit_amount: p.price * 100,
      recurring: { interval: 'month', interval_count: p.months },
      lookup_key: lookupKey(plan),
      nickname: `Bordvakt ${p.label}`,
    });
    id = price.id;
  }
  priceCache.set(plan, id);
  return id;
}

const toIso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);

/** Sparar prenumerationens läge på restaurangen. Anropas av webhooken och efter betalningen. */
export async function syncSubscription(supabase: SupabaseClient, sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const item = sub.items.data[0];
  const key = item?.price.lookup_key?.replace('bordvakt_', '');
  const update = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    plan: isPlanId(key) ? key : null,
    trial_ends_at: toIso(sub.trial_end),
    current_period_end: toIso(item?.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end,
  };
  const restaurantId = sub.metadata?.restaurant_id;
  const query = supabase.from('restaurants').update(update);
  const { error } = restaurantId
    ? await query.eq('id', restaurantId)
    : await query.eq('stripe_customer_id', customerId);
  if (error) throw new Error(`Kunde inte spara prenumerationen: ${error.message}`);
}

/** Adressen som Stripe skickar tillbaka kunden till. */
export function siteUrl(req: Request) {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || new URL(req.url).origin;
}

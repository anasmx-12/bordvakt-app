import 'server-only';
import Stripe from 'stripe';
import { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from './billing';

// Namnet på kortet (kortinnehavaren hos Stripe) måste stämma med ägarens fullständiga namn.
// Stämmer det inte låses appen (proxy.ts) tills ägaren byter till ett kort i sitt namn
// eller rättar sitt namn. Provperioden fortsätter under tiden, inget dras.

/** "Åsa Öberg-Lind" → ["asa", "oberg", "lind"] */
function tokens(name: string) {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Tillåter vanliga kortformat: "ANNA LINDQVIST", "A LINDQVIST", "ANNA M LINDQVIST", "LINDQVIST ANNA". */
export function namesMatch(legalName: string, cardName: string): boolean {
  const legal = tokens(legalName);
  const card = tokens(cardName);
  if (legal.length < 2 || card.length < 2) return false;
  const first = legal[0];
  const surname = legal[legal.length - 1];
  if (!card.includes(surname)) return false;
  return card.some((t) => t !== surname && (t === first || (t.length === 1 && t === first[0])));
}

/** Kortinnehavarens namn för prenumerationen, eller null om det saknas. */
async function cardholderName(sub: Stripe.Subscription): Promise<string | null> {
  const s = stripe();
  let pm = sub.default_payment_method;
  if (!pm) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const customer = await s.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] });
    if (!customer.deleted) pm = customer.invoice_settings?.default_payment_method ?? null;
  }
  if (typeof pm === 'string') pm = await s.paymentMethods.retrieve(pm);
  return pm?.billing_details?.name?.trim() || null;
}

/** Jämför kortet med ägarnas namn och låser eller låser upp deras konton. true = namnen stämmer. */
export async function checkCardName(supabase: SupabaseClient, sub: Stripe.Subscription): Promise<boolean> {
  const restaurantId = sub.metadata?.restaurant_id;
  if (!restaurantId || sub.status === 'canceled' || sub.status === 'incomplete_expired') return true;
  const cardName = await cardholderName(sub);

  const { data: owners } = await supabase
    .from('restaurant_members')
    .select('user_id')
    .eq('restaurant_id', restaurantId)
    .eq('role', 'owner');
  let allMatch = true;
  for (const { user_id } of owners ?? []) {
    const { data } = await supabase.auth.admin.getUserById(user_id);
    const user = data?.user;
    if (!user) continue;
    const legalName = typeof user.app_metadata?.legal_name === 'string' ? user.app_metadata.legal_name : null;
    // Supporten kan godkänna ett kortnamn efter att ha kontrollerat legitimationen (supportsajten)
    const approved = cardName !== null && user.app_metadata?.card_name_approved === cardName;
    const match = approved || Boolean(legalName && cardName && namesMatch(legalName, cardName));
    if (!match) allMatch = false;
    const mismatch = match ? null : cardName ?? '(inget namn på kortet)';
    if ((user.app_metadata?.card_name_mismatch ?? null) !== mismatch) {
      await supabase.auth.admin.updateUserById(user_id, {
        app_metadata: { ...user.app_metadata, card_name_mismatch: mismatch },
      });
    }
  }
  return allMatch;
}

/** Restaurangens prenumeration hos Stripe (för en ny kontroll), eller null. */
export async function restaurantSubscription(supabase: SupabaseClient, restaurantId: string) {
  const { data } = await supabase.from('restaurants').select('stripe_subscription_id').eq('id', restaurantId).maybeSingle();
  if (!data?.stripe_subscription_id) return null;
  return stripe().subscriptions.retrieve(data.stripe_subscription_id).catch(() => null);
}

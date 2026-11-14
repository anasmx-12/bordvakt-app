import Stripe from 'stripe';
import { stripe, syncSubscription } from '@/lib/billing';
import { serverSupabase } from '@/lib/server';
import { checkCardName } from '@/lib/cardName';

// POST /api/billing/webhook — Stripe meddelar när en prenumeration startar, förnyas,
// byter plan, misslyckas eller sägs upp. Ställs in i Stripe → Developers → Webhooks.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: 'STRIPE_WEBHOOK_SECRET saknas' }, { status: 500 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), req.headers.get('stripe-signature') ?? '', secret);
  } catch {
    return Response.json({ error: 'Ogiltig signatur' }, { status: 400 });
  }

  try {
    const supabase = serverSupabase();
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await syncSubscription(supabase, event.data.object);
        await checkCardName(supabase, event.data.object); // t.ex. nytt kort via "Hantera prenumeration"
        break;
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        await syncSubscription(supabase, event.data.object);
        break;
      case 'checkout.session.completed': {
        const id = event.data.object.subscription;
        if (typeof id === 'string') {
          const sub = await stripe().subscriptions.retrieve(id);
          await syncSubscription(supabase, sub);
          await checkCardName(supabase, sub);
        }
        break;
      }
    }
    return Response.json({ received: true });
  } catch (err) {
    console.error('Stripe-webhook misslyckades:', err);
    return Response.json({ error: 'Kunde inte spara' }, { status: 500 }); // Stripe försöker igen
  }
}

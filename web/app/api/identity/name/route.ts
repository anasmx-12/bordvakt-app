import { checkCardName, restaurantSubscription } from '@/lib/cardName';
import { cleanLegalName, identityOf } from '@/lib/identity';
import { hasAccess } from '@/lib/plans';
import { currentRestaurantId, currentUser, errorResponse, serverSupabase, UserError } from '@/lib/server';

// POST /api/identity/name { name } — ägarens fullständiga namn (som på legitimationen).
// Sparas i app_metadata, som bara servern kan ändra. Efter betalningen jämförs det med namnet
// på kortet (lib/cardName.ts). Namnet kan rättas innan prenumerationen startar, eller om det
// inte stämmer med kortet.
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new UserError('Du är inte inloggad.', 401);
    const identity = identityOf(user);
    if (!identity.email_confirmed) throw new UserError('Bekräfta e-postadressen först.', 403);
    const name = cleanLegalName((await req.json().catch(() => null))?.name);

    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data: r } = await supabase.from('restaurants').select('billing_exempt, subscription_status').eq('id', restaurantId).maybeSingle();
    if (identity.legal_name && hasAccess(r) && !identity.card_name_mismatch) {
      throw new UserError('Namnet är redan kopplat till prenumerationen. Kontakta oss om det är fel.', 409);
    }

    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, legal_name: name, legal_name_at: new Date().toISOString() },
    });
    if (error) throw new UserError(`Kunde inte spara namnet: ${error.message}`, 500);

    // Finns redan ett kort: jämför med det nya namnet direkt
    let cardNameOk: boolean | null = null;
    const sub = identity.card_name_mismatch ? await restaurantSubscription(supabase, restaurantId) : null;
    if (sub) cardNameOk = await checkCardName(supabase, sub);
    return Response.json({ legal_name: name, card_name_ok: cardNameOk });
  } catch (err) {
    return errorResponse(err);
  }
}

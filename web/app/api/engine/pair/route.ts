import { createPairingCode, hasEngineAccount } from '@/lib/engineAccount';
import { currentRestaurantId, currentUser, errorResponse, serverSupabase, UserError } from '@/lib/server';

async function ownerRestaurant() {
  const supabase = serverSupabase();
  const restaurantId = await currentRestaurantId(supabase);
  const user = await currentUser();
  const { data: member } = await supabase.from('restaurant_members').select('role').eq('user_id', user!.id).maybeSingle();
  if (member?.role !== 'owner') throw new UserError('Bara ägaren kan koppla AI-datorn.', 403);
  return restaurantId;
}

// GET /api/engine/pair: finns det redan en kopplad AI-dator?
export async function GET() {
  try {
    return Response.json({ paired: await hasEngineAccount(await ownerRestaurant()) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/engine/pair: ny kopplingskod (den gamla slutar fungera). Visas bara en gång.
export async function POST() {
  try {
    const code = await createPairingCode(await ownerRestaurant());
    return Response.json({ code }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}

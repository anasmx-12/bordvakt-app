import { approvePairing, previewPairing } from '@/lib/devicePairing';
import { ownerRestaurant } from '@/lib/engineAccount';
import { sharedRateLimit } from '@/lib/rateLimit';
import { errorResponse, serverSupabase, UserError } from '@/lib/server';

// POST /api/engine/device/approve { code, preview? } — ägaren skriver in koden som AI-datorn visar.
// preview: true = visa bara vilken dator det gäller. Annars kopplas datorn till restaurangen.
export async function POST(req: Request) {
  try {
    const { restaurantId, userId } = await ownerRestaurant();
    // Gissa koder: högst 10 försök per 10 minuter och ägare
    if (!(await sharedRateLimit(`engine-device-approve:${userId}`, 10, 600))) {
      throw new UserError('För många försök. Vänta 10 minuter.', 429);
    }
    const body = await req.json().catch(() => ({}));
    if (body?.preview === true) {
      const { data } = await serverSupabase().from('restaurants').select('name').eq('id', restaurantId).maybeSingle();
      return Response.json({ ...(await previewPairing(body?.code)), restaurant: data?.name ?? '' });
    }
    return Response.json(await approvePairing(body?.code, restaurantId, userId));
  } catch (err) {
    return errorResponse(err);
  }
}

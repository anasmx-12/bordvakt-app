import { engineUrl, viewTicket } from '@/lib/engine';
import { currentRestaurantId, errorResponse, serverSupabase } from '@/lib/server';

// GET /api/engine/access: adressen till restaurangens AI-motor och en biljett som gäller
// i två timmar. Webbläsaren behöver den för att se videon och kamerornas status.
export async function GET() {
  try {
    const restaurantId = await currentRestaurantId(serverSupabase());
    const base = await engineUrl(restaurantId);
    return Response.json({ base, ...viewTicket(restaurantId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}

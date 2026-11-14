import { currentRestaurantId, errorResponse, serverSupabase } from '@/lib/server';
import { insights } from '@/lib/insights';

// GET /api/insights — hur länge rätterna brukar ta i köket (för personalen)
export async function GET() {
  try {
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { prepByName } = await insights(supabase, restaurantId);
    return Response.json({ prepByName });
  } catch (err) {
    return errorResponse(err);
  }
}

import { enginePost } from '@/lib/engine';
import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { checkUrl } from '@/lib/cameraServer';

// POST /api/setup/cameras/test { stream_url } — AI-motorn försöker ansluta och skickar en förhandsbild
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const url = typeof body?.stream_url === 'string' ? body.stream_url.trim() : '';
    checkUrl(url);
    const restaurantId = await currentRestaurantId(serverSupabase());
    const { data } = await enginePost(restaurantId, '/test-camera', JSON.stringify({ stream_url: url }), 'application/json', 25_000);
    if (!data.ok) throw new UserError(data.error ?? 'Kunde inte ansluta till kameran', 422);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

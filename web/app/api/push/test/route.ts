import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { sendPush } from '@/lib/push';

// POST /api/push/test { endpoint } — skickar ett provlarm till den här mobilen
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (typeof body?.endpoint !== 'string') throw new UserError('Ogiltig mobil');
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    await sendPush(restaurantId, { key: 'push.testTitle', detailKey: 'push.testBody', tag: 'test', url: '/settings' }, body.endpoint);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

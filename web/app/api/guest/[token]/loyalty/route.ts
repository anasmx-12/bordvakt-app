import { errorResponse, serverSupabase, UserError } from '@/lib/server';
import { guestTable } from '@/lib/guest';
import { CARD_KEY, cardStatus } from '@/lib/loyalty';
import { isOn } from '@/lib/features';

// GET /api/guest/[token]/loyalty?key=<kort-id> — gästens stämplar och belöningskoder
export async function GET(req: Request, ctx: RouteContext<'/api/guest/[token]/loyalty'>) {
  try {
    const { token } = await ctx.params;
    const key = new URL(req.url).searchParams.get('key') ?? '';
    if (!CARD_KEY.test(key)) throw new UserError('Ogiltigt kort');
    const supabase = serverSupabase();
    const table = await guestTable(supabase, token, { allowOff: true });
    if (!isOn(table.features, 'loyalty')) return Response.json([]);
    return Response.json(await cardStatus(supabase, table.restaurant_id, key), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}

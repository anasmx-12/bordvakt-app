import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { addDays, computeStats, localDay } from '@/lib/stats';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/stats?from=ÅÅÅÅ-MM-DD&to=ÅÅÅÅ-MM-DD (båda dagarna räknas med)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const to = url.searchParams.get('to') ?? localDay();
    const from = url.searchParams.get('from') ?? addDays(to, -6);
    if (!DAY.test(from) || !DAY.test(to) || from > to) throw new UserError('Ogiltig period');
    if (Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new UserError('Välj högst ett år');
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    return Response.json(await computeStats(supabase, restaurantId, from, to));
  } catch (err) {
    return errorResponse(err);
  }
}

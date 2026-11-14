import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { missingMenu, newQrToken } from '@/lib/menu';

// POST /api/tables/[id]/qr — ny QR-kod för bordet. Den gamla slutar fungera direkt.
export async function POST(_req: Request, ctx: RouteContext<'/api/tables/[id]/qr'>) {
  try {
    const { id } = await ctx.params;
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data, error } = await supabase
      .from('tables')
      .update({ qr_token: newQrToken() })
      .eq('id', id)
      .eq('restaurant_id', restaurantId)
      .select('id, qr_token')
      .maybeSingle();
    if (error) throw missingMenu(error) ?? new UserError(error.message, 500);
    if (!data) throw new UserError('Bordet finns inte', 404);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

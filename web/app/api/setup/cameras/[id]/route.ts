import { engineReload } from '@/lib/engine';
import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';

// DELETE /api/setup/cameras/[id] — tar bort kameran. Borden som den såg måste kopplas till en annan kamera.
export async function DELETE(_req: Request, ctx: RouteContext<'/api/setup/cameras/[id]'>) {
  try {
    const { id } = await ctx.params;
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data, error } = await supabase
      .from('camera_feeds')
      .delete()
      .eq('id', id)
      .eq('restaurant_id', restaurantId)
      .select('id')
      .maybeSingle();
    if (error) throw new UserError(error.message, 500);
    if (!data) throw new UserError('Kameran finns inte', 404);
    // Borden som kameran såg har inte längre någon ruta
    await supabase
      .from('tables')
      .update({ roi_x1: null, roi_y1: null, roi_x2: null, roi_y2: null })
      .eq('restaurant_id', restaurantId)
      .is('camera_id', null);
    await engineReload(restaurantId);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

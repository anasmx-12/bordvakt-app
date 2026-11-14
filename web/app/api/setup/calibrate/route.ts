import { enginePost } from '@/lib/engine';
import { assertOwned, currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : NaN);

// POST /api/setup/calibrate { table_id, camera_id, roi: {x1, y1, x2, y2} }
// Sparar bordets ruta i kamerabilden och låter AI-motorn ta en kalibreringsbild.
// Om kameran inte tydligt ser bordet nekas kalibreringen (inga gissningar).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const tableId = typeof body?.table_id === 'string' ? body.table_id : '';
    const cameraId = typeof body?.camera_id === 'string' ? body.camera_id : '';
    const [x1, y1, x2, y2] = [body?.roi?.x1, body?.roi?.y1, body?.roi?.x2, body?.roi?.y2].map(num);
    if (!tableId || !cameraId) throw new UserError('Välj bord och kamera');
    if ([x1, y1, x2, y2].some(Number.isNaN) || x2 - x1 < 0.03 || y2 - y1 < 0.03) {
      throw new UserError('Rita en ruta runt bordet i kamerabilden');
    }

    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    await assertOwned(supabase, 'camera_feeds', cameraId, restaurantId, 'Kameran finns inte');
    const { data, error } = await supabase
      .from('tables')
      .update({ camera_id: cameraId, roi_x1: x1, roi_y1: y1, roi_x2: x2, roi_y2: y2 })
      .eq('id', tableId)
      .eq('restaurant_id', restaurantId)
      .select('id')
      .maybeSingle();
    if (error) throw new UserError(`Kunde inte spara rutan: ${error.message}`, 500);
    if (!data) throw new UserError('Bordet finns inte', 404);

    const { ok, data: result } = await enginePost(restaurantId, '/calibrate', JSON.stringify({ table_id: tableId }), 'application/json', 30_000);
    if (!ok) throw new UserError(result.error ?? 'Kalibreringen misslyckades', 422);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

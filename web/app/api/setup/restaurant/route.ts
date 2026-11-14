import { engineReload } from '@/lib/engine';
import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';

// POST /api/setup/restaurant { name } — byter namn på den inloggades restaurang.
// (Restaurangen skapas när kontot skapas, i /api/signup.)
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (!name) throw new UserError('Skriv restaurangens namn');

    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data, error } = await supabase
      .from('restaurants')
      .update({ name })
      .eq('id', restaurantId)
      .select('id, name')
      .single();
    if (error) throw new UserError(`Kunde inte spara restaurangen: ${error.message}`, 500);
    await engineReload(restaurantId);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

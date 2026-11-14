import { sanitizePlan } from '@/lib/floorPlan';
import { engineReload } from '@/lib/engine';
import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';

// POST /api/floor-plan — sparar planritningen som restaurangens aktiva ritning.
// Bord med samma nummer som redan finns behåller kamera, status och historik.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const plan = sanitizePlan(body);
    if (plan.tables.length === 0) throw new UserError('Planritningen måste ha minst ett bord');

    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);

    const { data, error } = await supabase.rpc('save_floor_plan', {
      p_restaurant_id: restaurantId,
      p_plan: plan,
    });
    if (error) {
      if (error.code === 'PGRST202') {
        throw new UserError('Databasen är inte uppdaterad. Kör supabase/002_floor_plan_and_statuses.sql i Supabase.', 500);
      }
      throw new UserError(`Kunde inte spara planritningen: ${error.message}`, 500);
    }
    await engineReload(restaurantId);
    return Response.json({ id: data });
  } catch (err) {
    return errorResponse(err);
  }
}

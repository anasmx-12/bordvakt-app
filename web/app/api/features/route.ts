import { currentRestaurantId, currentUser, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { FEATURE_IDS, FeatureId } from '@/lib/features';

// PATCH /api/features { [id]: boolean } — ägaren slår av eller på funktioner
export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const changes = Object.entries(body ?? {}).filter(([id, v]) => FEATURE_IDS.includes(id as FeatureId) && typeof v === 'boolean');
    if (!changes.length) throw new UserError('Inget att ändra');
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const user = await currentUser();
    const { data: member } = await supabase.from('restaurant_members').select('role').eq('user_id', user!.id).maybeSingle();
    if (member && member.role !== 'owner') throw new UserError('Bara ägaren kan ändra funktionerna.', 403);
    const { data: r, error } = await supabase.from('restaurants').select('features').eq('id', restaurantId).single();
    if (error) throw new UserError(/features/.test(error.message) ? 'Kör supabase/012_growth.sql i Supabase först.' : error.message, 500);
    const features: Record<string, boolean> = { ...(r.features ?? {}) };
    // Valet sparas alltid, så att installationen vet att tillvalen är besvarade
    for (const [id, on] of changes) features[id] = on as boolean;
    const { error: saveError } = await supabase.from('restaurants').update({ features }).eq('id', restaurantId);
    if (saveError) throw new UserError(saveError.message, 500);
    return Response.json({ features });
  } catch (err) {
    return errorResponse(err);
  }
}

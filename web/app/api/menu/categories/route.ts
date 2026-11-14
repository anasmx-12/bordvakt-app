import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { cleanCategory, missingMenu } from '@/lib/menu';

// POST /api/menu/categories { name } — ny kategori sist i menyn
export async function POST(req: Request) {
  try {
    const row = cleanCategory(await req.json().catch(() => null));
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { count } = await supabase
      .from('menu_categories')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId);
    if ((count ?? 0) >= 50) throw new UserError('Menyn kan ha högst 50 kategorier');
    const { data, error } = await supabase
      .from('menu_categories')
      .insert({ ...row, restaurant_id: restaurantId, position: count ?? 0 })
      .select()
      .single();
    if (error) throw missingMenu(error) ?? new UserError(error.message, 500);
    return Response.json(data, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

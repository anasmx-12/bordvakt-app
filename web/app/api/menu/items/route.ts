import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { cleanItem, missingMenu } from '@/lib/menu';

// POST /api/menu/items { name, price, description?, category_id?, allergens? } — ny rätt
export async function POST(req: Request) {
  try {
    const row = cleanItem(await req.json().catch(() => null));
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    if (row.category_id) {
      const { data: category } = await supabase
        .from('menu_categories')
        .select('id')
        .eq('id', row.category_id as string)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      if (!category) throw new UserError('Kategorin finns inte', 404);
    }
    const { count } = await supabase
      .from('menu_items')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId);
    if ((count ?? 0) >= 500) throw new UserError('Menyn kan ha högst 500 rätter');
    const { data, error } = await supabase
      .from('menu_items')
      .insert({ position: count ?? 0, ...row, restaurant_id: restaurantId })
      .select()
      .single();
    if (error) throw missingMenu(error) ?? new UserError(error.message, 500);
    return Response.json(data, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

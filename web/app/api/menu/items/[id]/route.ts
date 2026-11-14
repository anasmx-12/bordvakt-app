import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { cleanItem, missingMenu } from '@/lib/menu';

// PATCH /api/menu/items/[id] — ändrar rätten (t.ex. pris, "slut för i dag", ordning)
export async function PATCH(req: Request, ctx: RouteContext<'/api/menu/items/[id]'>) {
  try {
    const { id } = await ctx.params;
    const row = cleanItem(await req.json().catch(() => null), true);
    if (Object.keys(row).length === 0) throw new UserError('Inget att ändra');
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
    const { data, error } = await supabase
      .from('menu_items')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('restaurant_id', restaurantId)
      .select()
      .maybeSingle();
    if (error) throw missingMenu(error) ?? new UserError(error.message, 500);
    if (!data) throw new UserError('Rätten finns inte', 404);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/menu/items/[id]
export async function DELETE(_req: Request, ctx: RouteContext<'/api/menu/items/[id]'>) {
  try {
    const { id } = await ctx.params;
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data, error } = await supabase
      .from('menu_items')
      .delete()
      .eq('id', id)
      .eq('restaurant_id', restaurantId)
      .select('id')
      .maybeSingle();
    if (error) throw missingMenu(error) ?? new UserError(error.message, 500);
    if (!data) throw new UserError('Rätten finns inte', 404);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

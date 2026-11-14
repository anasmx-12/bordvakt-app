import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { cleanCategory, missingMenu } from '@/lib/menu';

// PATCH /api/menu/categories/[id] { name?, position? }
export async function PATCH(req: Request, ctx: RouteContext<'/api/menu/categories/[id]'>) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const row: Record<string, unknown> = {};
    if (body && 'name' in body) Object.assign(row, cleanCategory(body));
    if (body && Number.isFinite(Number(body.position))) row.position = Math.round(Number(body.position));
    if (Object.keys(row).length === 0) throw new UserError('Inget att ändra');
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data, error } = await supabase
      .from('menu_categories')
      .update(row)
      .eq('id', id)
      .eq('restaurant_id', restaurantId)
      .select()
      .maybeSingle();
    if (error) throw missingMenu(error) ?? new UserError(error.message, 500);
    if (!data) throw new UserError('Kategorin finns inte', 404);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/menu/categories/[id] — rätterna i kategorin hamnar under "Övrigt"
export async function DELETE(_req: Request, ctx: RouteContext<'/api/menu/categories/[id]'>) {
  try {
    const { id } = await ctx.params;
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data, error } = await supabase
      .from('menu_categories')
      .delete()
      .eq('id', id)
      .eq('restaurant_id', restaurantId)
      .select('id')
      .maybeSingle();
    if (error) throw missingMenu(error) ?? new UserError(error.message, 500);
    if (!data) throw new UserError('Kategorin finns inte', 404);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

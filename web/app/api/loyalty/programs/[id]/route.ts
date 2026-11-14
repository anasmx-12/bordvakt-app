import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { missingLoyalty } from '@/lib/loyalty';

// PATCH /api/loyalty/programs/[id] { active } — pausa eller starta stämpelkortet
export async function PATCH(req: Request, ctx: RouteContext<'/api/loyalty/programs/[id]'>) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    if (typeof body?.active !== 'boolean') throw new UserError('Inget att ändra');
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data, error } = await supabase
      .from('loyalty_programs')
      .update({ active: body.active })
      .eq('id', id)
      .eq('restaurant_id', restaurantId)
      .select('id, label, stamps_needed, menu_item_id, category_id, active')
      .maybeSingle();
    if (error) throw missingLoyalty(error.message);
    if (!data) throw new UserError('Finns inte', 404);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/loyalty/programs/[id] — tar bort kortet (och gästernas stämplar på det)
export async function DELETE(_req: Request, ctx: RouteContext<'/api/loyalty/programs/[id]'>) {
  try {
    const { id } = await ctx.params;
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { error } = await supabase.from('loyalty_programs').delete().eq('id', id).eq('restaurant_id', restaurantId);
    if (error) throw missingLoyalty(error.message);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

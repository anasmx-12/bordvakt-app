import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { cleanItems, missingOrdersTable } from '@/lib/orders';
import { logWaste } from '@/lib/waste';

// POST /api/orders/[id]/returned { remake: boolean } — maten kom tillbaka från bordet.
// Sparas som svinn. remake = köket lagar en ny portion (läggs in som en ny beställning).
export async function POST(req: Request, ctx: RouteContext<'/api/orders/[id]/returned'>) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const remake = body?.remake === true;
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data: order, error } = await supabase
      .from('orders')
      .select('id, table_id, items, status')
      .eq('id', id)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    if (error) throw missingOrdersTable(error.code) ?? new UserError(error.message, 500);
    if (!order) throw new UserError('Beställningen finns inte', 404);
    if (order.status !== 'SERVED' && order.status !== 'COMPLETED') throw new UserError('Maten har inte serverats än', 409);
    const items = cleanItems(order.items);
    await logWaste(supabase, { restaurant_id: restaurantId, table_id: order.table_id, order_id: id, items, reason: 'returned' });
    let created = null;
    if (remake && items.length) {
      const { data, error: insertError } = await supabase
        .from('orders')
        .insert({ restaurant_id: restaurantId, table_id: order.table_id, items, note: 'Ny portion: maten kom tillbaka' })
        .select()
        .single();
      if (insertError) throw new UserError(`Kunde inte lägga in den nya portionen: ${insertError.message}`, 500);
      created = data;
    }
    return Response.json({ order: created });
  } catch (err) {
    return errorResponse(err);
  }
}

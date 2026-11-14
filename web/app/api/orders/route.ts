import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { cleanItems, missingOrdersTable } from '@/lib/orders';

// POST /api/orders — ny beställning kopplad till ett bord. { table_id, items: [{name, qty}], note? }
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const tableId = typeof body?.table_id === 'string' ? body.table_id : '';
    const items = cleanItems(body?.items);
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null;
    if (!tableId) throw new UserError('Välj ett bord');
    if (items.length === 0) throw new UserError('Lägg till minst en rätt');

    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data: table } = await supabase
      .from('tables')
      .select('id')
      .eq('id', tableId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    if (!table) throw new UserError('Bordet finns inte', 404);

    const { data, error } = await supabase
      .from('orders')
      .insert({ restaurant_id: restaurantId, table_id: tableId, items, note })
      .select()
      .single();
    if (error) throw missingOrdersTable(error.code) ?? new UserError(`Kunde inte spara beställningen: ${error.message}`, 500);
    return Response.json(data, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

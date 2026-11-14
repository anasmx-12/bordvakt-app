import { errorResponse, serverSupabase, UserError } from '@/lib/server';
import { cleanItems, missingOrdersTable } from '@/lib/orders';
import { ownedTask } from '@/lib/tasks';
import { after } from 'next/server';
import { logWaste } from '@/lib/waste';

// POST /api/tasks/[id]/kitchen — köket svarar på tappad mat (SOS).
// { action: 'REMAKE' }     = laga en ny portion: bordets senaste beställning läggs in igen
// { action: 'NOT_NEEDED' } = behövs inte
export async function POST(req: Request, ctx: RouteContext<'/api/tasks/[id]/kitchen'>) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const action = body?.action;
    if (action !== 'REMAKE' && action !== 'NOT_NEEDED') throw new UserError('Okänt svar från köket');
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null;

    const supabase = serverSupabase();
    const { task, restaurantId } = await ownedTask(supabase, id);
    if (task.type !== 'EMERGENCY') throw new UserError('Uppgiften är inget SOS');

    const { data, error } = await supabase
      .from('tasks')
      .update({ kitchen_status: action === 'REMAKE' ? 'REMAKING' : 'NOT_NEEDED' })
      .eq('id', id)
      .eq('kitchen_status', 'PENDING')
      .select()
      .maybeSingle();
    if (error) throw new UserError(error.message, 500);
    if (!data) throw new UserError('Köket har redan svarat', 409);

    let order = null;
    if (action === 'REMAKE') {
      // Samma rätter som bordets senaste beställning
      const { data: last, error: lastError } = await supabase
        .from('orders')
        .select('items')
        .eq('table_id', task.table_id)
        .eq('restaurant_id', restaurantId)
        .neq('status', 'CANCELLED')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastError) throw missingOrdersTable(lastError.code) ?? new UserError(lastError.message, 500);
      const items = cleanItems(last?.items);
      if (items.length > 0) {
        const { data: created, error: orderError } = await supabase
          .from('orders')
          .insert({ restaurant_id: restaurantId, table_id: task.table_id, items, note: note ?? 'Ny portion: maten tappades (SOS)' })
          .select()
          .single();
        if (orderError) throw new UserError(`Kunde inte lägga in den nya portionen: ${orderError.message}`, 500);
        order = created;
        // Den tappade portionen räknas som svinn
        after(() => logWaste(serverSupabase(), { restaurant_id: restaurantId, table_id: task.table_id, items, reason: 'remake' }));
      }
    }
    return Response.json({ task: data, order });
  } catch (err) {
    return errorResponse(err);
  }
}

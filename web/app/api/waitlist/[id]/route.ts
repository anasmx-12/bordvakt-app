import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { missingWaitlist, PARTY_FIELDS, WAIT_STATUSES, WaitStatus } from '@/lib/waitlist';

// PATCH /api/waitlist/[id] { status, table_id? }
// NOTIFIED = bordet är klart (gästens länk visar det), SEATED = har fått bord, LEFT = gick, WAITING = ångra
export async function PATCH(req: Request, ctx: RouteContext<'/api/waitlist/[id]'>) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const status = body?.status as WaitStatus;
    if (!WAIT_STATUSES.includes(status)) throw new UserError('Okänd status');
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const row: Record<string, unknown> = { status };
    if (status === 'NOTIFIED') row.notified_at = new Date().toISOString();
    if (status === 'SEATED') {
      row.seated_at = new Date().toISOString();
      if (typeof body?.table_id === 'string') {
        const { data: table } = await supabase.from('tables').select('id').eq('id', body.table_id).eq('restaurant_id', restaurantId).maybeSingle();
        if (!table) throw new UserError('Bordet finns inte', 404);
        row.table_id = table.id;
      }
    }
    if (status === 'WAITING') Object.assign(row, { notified_at: null, seated_at: null, table_id: null });
    const { data, error } = await supabase.from('waitlist').update(row).eq('id', id).eq('restaurant_id', restaurantId).select(PARTY_FIELDS).maybeSingle();
    if (error) throw missingWaitlist(error.message);
    if (!data) throw new UserError('Sällskapet finns inte', 404);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

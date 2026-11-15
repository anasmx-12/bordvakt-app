import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { guestSms, missingWaitlist, PARTY_FIELDS, WAIT_STATUSES, WaitStatus } from '@/lib/waitlist';

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
    let q = supabase.from('waitlist').update(row).eq('id', id).eq('restaurant_id', restaurantId);
    if (status === 'NOTIFIED') q = q.eq('status', 'WAITING'); // besked (och sms) bara en gång
    const { data, error } = await q.select(PARTY_FIELDS).maybeSingle();
    if (error) throw missingWaitlist(error.message);
    if (!data) throw new UserError(status === 'NOTIFIED' ? 'Gästen har redan fått besked, eller finns inte i kön.' : 'Sällskapet finns inte', 404);
    const sms = status === 'NOTIFIED' ? await guestSms(supabase, restaurantId, data, 'ready', new URL(req.url).origin) : null;
    return Response.json({ ...data, sms });
  } catch (err) {
    return errorResponse(err);
  }
}

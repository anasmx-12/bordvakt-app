import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { ORDER_FLOW, OrderStatus } from '@/lib/types';
import { missingOrdersTable } from '@/lib/orders';
import { after } from 'next/server';
import { awardStamps } from '@/lib/loyalty';
import { logWaste } from '@/lib/waste';

const STATUSES: OrderStatus[] = [...ORDER_FLOW, 'CANCELLED'];

// Tillåtna steg. Ett steg bakåt går att göra om någon tryckte fel.
function allowed(from: OrderStatus, to: OrderStatus): boolean {
  if (from === 'COMPLETED' || from === 'CANCELLED') return false;
  // QR-beställning som väntar: personalen godkänner (till köket) eller nekar
  if (from === 'PENDING_APPROVAL') return to === 'RECEIVED' || to === 'CANCELLED';
  if (to === 'CANCELLED') return true;
  const step = ORDER_FLOW.indexOf(to) - ORDER_FLOW.indexOf(from);
  return step === 1 || step === -1 || (to === 'COMPLETED' && step > 0);
}

// PATCH /api/orders/[id] — { status } flyttar beställningen i livscykeln
export async function PATCH(req: Request, ctx: RouteContext<'/api/orders/[id]'>) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const to = body?.status as OrderStatus;
    if (!STATUSES.includes(to)) throw new UserError('Okänd status');

    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data: order, error: readError } = await supabase
      .from('orders')
      .select('status')
      .eq('id', id)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    if (readError) throw missingOrdersTable(readError.code) ?? new UserError(readError.message, 500);
    if (!order) throw new UserError('Beställningen finns inte', 404);
    if (order.status === to) return Response.json(order);
    if (!allowed(order.status, to)) throw new UserError('Beställningen kan inte flyttas dit', 409);

    // .eq på gammal status: om någon annan hann ändra den först blir det inget dubbelsteg
    const { data, error } = await supabase
      .from('orders')
      .update({ status: to })
      .eq('id', id)
      .eq('status', order.status)
      .select()
      .maybeSingle();
    if (error) throw new UserError(error.message, 500);
    if (!data) throw new UserError('Beställningen ändrades precis av någon annan. Försök igen.', 409);
    if (to === 'SERVED' || to === 'COMPLETED') after(() => awardStamps(serverSupabase(), id).catch(() => {}));
    // Maten var redan lagad (eller påbörjad) när beställningen makulerades: räkna som svinn
    if (to === 'CANCELLED' && ['PREPARING', 'READY', 'SERVED'].includes(order.status)) {
      after(() => logWaste(serverSupabase(), { restaurant_id: restaurantId, table_id: data.table_id, order_id: id, items: data.items ?? [], reason: 'cancelled' }));
    }
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { missingMenu, QR_MODES } from '@/lib/menu';
import { QrOrdering } from '@/lib/types';

const CURRENCIES = ['SEK', 'NOK', 'DKK', 'EUR', 'USD', 'GBP', 'CHF', 'PLN', 'TRY', 'AED', 'SAR', 'PKR', 'INR', 'BDT', 'CNY', 'JPY', 'KRW', 'IDR', 'BRL', 'RUB'];

// PATCH /api/menu/settings { qr_ordering?, menu_step_done?, currency? }
export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const row: Record<string, unknown> = {};
    if (body && 'qr_ordering' in body) {
      if (!QR_MODES.includes(body.qr_ordering as QrOrdering)) throw new UserError('Okänt val för QR-beställning');
      row.qr_ordering = body.qr_ordering;
    }
    if (body && 'menu_step_done' in body) row.menu_step_done = body.menu_step_done === true;
    if (body && 'currency' in body) {
      if (!CURRENCIES.includes(body.currency)) throw new UserError('Okänd valuta');
      row.currency = body.currency;
    }
    if (Object.keys(row).length === 0) throw new UserError('Inget att ändra');
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data, error } = await supabase
      .from('restaurants')
      .update(row)
      .eq('id', restaurantId)
      .select('qr_ordering, menu_step_done, currency')
      .single();
    if (error) throw missingMenu(error) ?? new UserError(error.message, 500);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

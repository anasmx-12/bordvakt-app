import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { isEmail } from '@/lib/support';

const FIELDS = 'guests_per_waiter, daily_report, report_email, google_review_url';

const missing012 = (message: string) =>
  /guests_per_waiter|daily_report|report_email|google_review_url/.test(message)
    ? new UserError('Kör supabase/012_growth.sql i Supabase först.', 500)
    : new UserError(message, 500);

// GET/PATCH /api/stats/settings { guests_per_waiter?, daily_report?, report_email?, google_review_url? }
export async function GET() {
  try {
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data, error } = await supabase.from('restaurants').select(FIELDS).eq('id', restaurantId).single();
    if (error) throw missing012(error.message);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const row: Record<string, unknown> = {};
    if (body && 'guests_per_waiter' in body) {
      const n = Number(body.guests_per_waiter);
      if (!Number.isInteger(n) || n < 1 || n > 60) throw new UserError('Gäster per servitör ska vara 1–60');
      row.guests_per_waiter = n;
    }
    if (body && 'daily_report' in body) row.daily_report = body.daily_report === true;
    if (body && 'report_email' in body) {
      const email = String(body.report_email ?? '').trim();
      if (email && !isEmail(email)) throw new UserError('Ogiltig e-postadress');
      row.report_email = email || null;
    }
    if (body && 'google_review_url' in body) {
      const url = String(body.google_review_url ?? '').trim();
      if (url && !/^https:\/\/[^\s]{4,500}$/.test(url)) throw new UserError('Länken ska börja med https://');
      row.google_review_url = url || null;
    }
    if (Object.keys(row).length === 0) throw new UserError('Inget att ändra');
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data, error } = await supabase.from('restaurants').update(row).eq('id', restaurantId).select(FIELDS).single();
    if (error) throw missing012(error.message);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

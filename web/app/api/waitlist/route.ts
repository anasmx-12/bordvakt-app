import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { averageSitting, guestSms, missingWaitlist, PARTY_FIELDS } from '@/lib/waitlist';
import { normalizePhone } from '@/lib/sms';

// GET /api/waitlist — kön just nu (väntar + har fått besked), och hur länge sällskap brukar sitta
export async function GET() {
  try {
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const [{ data, error }, avg] = await Promise.all([
      supabase.from('waitlist').select(PARTY_FIELDS).eq('restaurant_id', restaurantId).in('status', ['WAITING', 'NOTIFIED']).order('created_at'),
      averageSitting(supabase, restaurantId),
    ]);
    if (error) throw missingWaitlist(error.message);
    return Response.json({ parties: data, avg_sitting_min: avg });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/waitlist { name, party_size, phone?, note?, quoted_minutes? } — ställ ett sällskap i kön
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const size = Math.round(Number(body?.party_size));
    if (!name) throw new UserError('Skriv ett namn');
    if (!(size >= 1 && size <= 50)) throw new UserError('Antal gäster ska vara 1–50');
    const phone = typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim().slice(0, 40) : null;
    if (phone && !normalizePhone(phone)) throw new UserError('Telefonnumret ser inte rätt ut. Skriv t.ex. 070-123 45 67, eller lämna fältet tomt.');
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null;
    const quoted = Math.round(Number(body?.quoted_minutes));
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { count } = await supabase.from('waitlist').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).in('status', ['WAITING', 'NOTIFIED']);
    if ((count ?? 0) >= 200) throw new UserError('Kön är full');
    const { data, error } = await supabase
      .from('waitlist')
      .insert({ restaurant_id: restaurantId, name, party_size: size, phone, note, quoted_minutes: quoted > 0 && quoted <= 600 ? quoted : null })
      .select(PARTY_FIELDS)
      .single();
    if (error) throw missingWaitlist(error.message);
    const sms = await guestSms(supabase, restaurantId, data, 'joined', new URL(req.url).origin);
    return Response.json({ ...data, sms }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

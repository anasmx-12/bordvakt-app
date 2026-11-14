import { after } from 'next/server';
import { errorResponse, serverSupabase, UserError } from '@/lib/server';
import { guestTable } from '@/lib/guest';
import { notifyLowReview } from '@/lib/reviews';
import { isOn } from '@/lib/features';

// POST /api/guest/[token]/review { rating: 1–5, comment? }
// Alla betyg sparas för statistiken. Nöjda gäster (4–5) får länken till restaurangens
// Google-recensioner. Missnöjda (1–3) får skriva vad som var fel, och det går bara till ägaren.
export async function POST(req: Request, ctx: RouteContext<'/api/guest/[token]/review'>) {
  try {
    const { token } = await ctx.params;
    const body = await req.json().catch(() => null);
    const rating = Math.round(Number(body?.rating));
    if (!(rating >= 1 && rating <= 5)) throw new UserError('Välj 1–5 stjärnor.');
    const comment = typeof body?.comment === 'string' && body.comment.trim() ? body.comment.trim().slice(0, 1000) : null;

    const supabase = serverSupabase();
    const table = await guestTable(supabase, token, { allowOff: true });
    if (!isOn(table.features, 'reviews')) throw new UserError('Betyg är inte påslaget här.', 403);
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const { count, error: countError } = await supabase
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('table_id', table.table_id)
      .gte('created_at', since);
    if (countError) throw new UserError('Betyg är inte påslaget här.', 503);
    if ((count ?? 0) >= 8) throw new UserError('Tack! Vi har redan fått många betyg från bordet.', 429);

    const { data, error } = await supabase
      .from('reviews')
      .insert({ restaurant_id: table.restaurant_id, table_id: table.table_id, rating, comment })
      .select('id')
      .single();
    if (error) throw new UserError('Kunde inte spara betyget.', 500);
    if (rating <= 2 && comment) after(() => notifyLowReview(table.restaurant_id, table.restaurant_name, table.table_number, rating, comment));
    return Response.json({ id: data.id, google_url: rating >= 4 ? table.google_review_url : null }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/guest/[token]/review { id, comment } — gästen lägger till en kommentar efter betyget
export async function PATCH(req: Request, ctx: RouteContext<'/api/guest/[token]/review'>) {
  try {
    const { token } = await ctx.params;
    const body = await req.json().catch(() => null);
    const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 1000) : '';
    if (typeof body?.id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.id) || !comment) throw new UserError('Skriv något först.');
    const supabase = serverSupabase();
    const table = await guestTable(supabase, token, { allowOff: true });
    const recent = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data, error } = await supabase
      .from('reviews')
      .update({ comment })
      .eq('id', body.id)
      .eq('table_id', table.table_id)
      .is('comment', null)
      .gte('created_at', recent)
      .select('rating')
      .maybeSingle();
    if (error || !data) throw new UserError('Kunde inte spara kommentaren.', 404);
    if (data.rating <= 2) after(() => notifyLowReview(table.restaurant_id, table.restaurant_name, table.table_number, data.rating, comment));
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

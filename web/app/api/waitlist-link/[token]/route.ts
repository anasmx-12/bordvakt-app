import { errorResponse, serverSupabase, UserError } from '@/lib/server';

const TOKEN = /^[a-f0-9]{32}$/;

async function party(token: string) {
  if (!TOKEN.test(token)) throw new UserError('Länken gäller inte', 404);
  const supabase = serverSupabase();
  const { data } = await supabase
    .from('waitlist')
    .select('id, restaurant_id, name, party_size, status, quoted_minutes, created_at, notified_at')
    .eq('token', token)
    .maybeSingle();
  if (!data) throw new UserError('Länken gäller inte', 404);
  return { supabase, data };
}

// GET /api/waitlist-link/[token] — öppen för gästen: plats i kön och om bordet är klart
export async function GET(_req: Request, ctx: RouteContext<'/api/waitlist-link/[token]'>) {
  try {
    const { token } = await ctx.params;
    const { supabase, data } = await party(token);
    const [{ data: r }, { count }] = await Promise.all([
      supabase.from('restaurants').select('name').eq('id', data.restaurant_id).maybeSingle(),
      supabase
        .from('waitlist')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', data.restaurant_id)
        .eq('status', 'WAITING')
        .lt('created_at', data.created_at),
    ]);
    return Response.json(
      {
        restaurant: r?.name ?? '',
        name: data.name,
        party_size: data.party_size,
        status: data.status,
        ahead: count ?? 0,
        quoted_minutes: data.quoted_minutes,
        created_at: data.created_at,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/waitlist-link/[token] { action: 'leave' } — gästen lämnar kön
export async function POST(req: Request, ctx: RouteContext<'/api/waitlist-link/[token]'>) {
  try {
    const { token } = await ctx.params;
    const body = await req.json().catch(() => null);
    if (body?.action !== 'leave') throw new UserError('Okänt val');
    const { supabase, data } = await party(token);
    if (data.status === 'WAITING' || data.status === 'NOTIFIED') {
      await supabase.from('waitlist').update({ status: 'LEFT' }).eq('id', data.id);
    }
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

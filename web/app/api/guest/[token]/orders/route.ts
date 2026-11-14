import { errorResponse, serverSupabase, UserError } from '@/lib/server';
import { guestTable } from '@/lib/guest';
import { CARD_KEY } from '@/lib/loyalty';

const MAX_ORDERS = 5;            // per bord ...
const WINDOW_MIN = 10;           // ... på så här många minuter
const MAX_DISHES = 30;           // rätter per beställning
const ID = /^[0-9a-f-]{36}$/;

// POST /api/guest/[token]/orders { items: [{ id, qty }], note?, card? } (card = stämpelkortets id) — gästen beställer.
// Namn och priser hämtas alltid ur menyn, aldrig från gästens mobil.
export async function POST(req: Request, ctx: RouteContext<'/api/guest/[token]/orders'>) {
  try {
    const { token } = await ctx.params;
    const body = await req.json().catch(() => null);
    const wanted = new Map<string, number>();
    for (const row of Array.isArray(body?.items) ? body.items : []) {
      const qty = Math.round(Number(row?.qty));
      if (typeof row?.id !== 'string' || !ID.test(row.id) || !Number.isFinite(qty) || qty < 1) continue;
      wanted.set(row.id, Math.min(20, (wanted.get(row.id) ?? 0) + qty));
    }
    if (wanted.size === 0) throw new UserError('Kundvagnen är tom.');
    const total = [...wanted.values()].reduce((a, b) => a + b, 0);
    if (total > MAX_DISHES) throw new UserError(`Högst ${MAX_DISHES} rätter per beställning.`);
    const loyaltyKey = typeof body?.card === 'string' && CARD_KEY.test(body.card) ? body.card : null;
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null;

    const supabase = serverSupabase();
    const table = await guestTable(supabase, token);

    const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const { count } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('table_id', table.table_id)
      .eq('source', 'qr')
      .gte('created_at', since);
    if ((count ?? 0) >= MAX_ORDERS) throw new UserError('Många beställningar på kort tid. Vänta en stund eller fråga personalen.', 429);

    const { data: menu, error: menuError } = await supabase
      .from('menu_items')
      .select('id, name, price, available')
      .eq('restaurant_id', table.restaurant_id)
      .in('id', [...wanted.keys()]);
    if (menuError) throw new UserError('Kunde inte läsa menyn', 500);
    const byId = new Map((menu ?? []).map((m) => [m.id, m]));
    const missing = [...wanted.keys()].filter((id) => !byId.get(id)?.available);
    if (missing.length) {
      const names = missing.map((id) => byId.get(id)?.name).filter(Boolean);
      return Response.json(
        { error: `Slut just nu: ${names.join(', ') || 'något i kundvagnen'}.`, sold_out: missing, sold_out_names: names },
        { status: 409 }
      );
    }

    const items = [...wanted].map(([id, qty]) => {
      const m = byId.get(id)!;
      return { name: m.name, qty, price: Number(m.price), menu_item_id: id };
    });
    const { data, error } = await supabase
      .from('orders')
      .insert({
        restaurant_id: table.restaurant_id,
        table_id: table.table_id,
        items,
        note,
        source: 'qr',
        ...(loyaltyKey ? { loyalty_key: loyaltyKey } : {}),
        status: table.qr_ordering === 'approve' ? 'PENDING_APPROVAL' : 'RECEIVED',
      })
      .select('id, status, items, note, created_at')
      .single();
    if (error) throw new UserError('Kunde inte skicka beställningen. Fråga personalen.', 500);
    return Response.json(data, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

// GET /api/guest/[token]/orders?ids=a,b — status för gästens egna beställningar
export async function GET(req: Request, ctx: RouteContext<'/api/guest/[token]/orders'>) {
  try {
    const { token } = await ctx.params;
    const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').filter((id) => ID.test(id)).slice(0, 20);
    if (ids.length === 0) return Response.json([]);
    const supabase = serverSupabase();
    const table = await guestTable(supabase, token);
    const { data } = await supabase
      .from('orders')
      .select('id, status, items, note, created_at')
      .eq('table_id', table.table_id)
      .in('id', ids);
    return Response.json(data ?? [], { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}

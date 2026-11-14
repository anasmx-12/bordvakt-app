import { errorResponse, serverSupabase, UserError } from '@/lib/server';
import { guestTable } from '@/lib/guest';
import { DESSERT, DRINK, insights } from '@/lib/insights';
import { restaurantKey } from '@/lib/loyalty';
import { isOn } from '@/lib/features';

// GET /api/guest/[token] — öppen för gäster: restaurangen, bordet, menyn och det som
// hör till (väntetider, förslag, stämpelkort). Bara det gästen behöver se skickas med.
export async function GET(_req: Request, ctx: RouteContext<'/api/guest/[token]'>) {
  try {
    const { token } = await ctx.params;
    const supabase = serverSupabase();
    const table = await guestTable(supabase, token, { allowOff: true });
    const ordering = table.qr_ordering !== 'off';
    const on = (id: Parameters<typeof isOn>[1]) => isOn(table.features, id);
    const [{ data: categories, error: e1 }, { data: items, error: e2 }, { data: programs }, learned] = await Promise.all([
      supabase.from('menu_categories').select('id, name, position').eq('restaurant_id', table.restaurant_id).order('position'),
      supabase
        .from('menu_items')
        .select('id, category_id, name, description, price, allergens, available, position')
        .eq('restaurant_id', table.restaurant_id)
        .order('position'),
      supabase
        .from('loyalty_programs')
        .select('id, label, stamps_needed, menu_item_id, category_id')
        .eq('restaurant_id', table.restaurant_id)
        .eq('active', true),
      ordering ? insights(supabase, table.restaurant_id) : null,
    ]);
    if (e1 || e2) throw new UserError('Kunde inte läsa menyn', 500);
    const list = (items ?? []).map((i) => ({ ...i, price: Number(i.price), prep_min: on('prep_times') ? (learned?.prepById[i.id] ?? null) : null }));
    const known = new Set(list.map((i) => i.id));
    return Response.json(
      {
        restaurant: table.restaurant_name,
        table: table.table_number,
        currency: table.currency,
        ordering,
        approval: table.qr_ordering === 'approve',
        // Gästerna har ätit klart men inte fått notan: visa desserterna
        dessert_time: on('upsell') && on('dessert') && table.table_status === 'DESSERT_OPPORTUNITY',
        categories: ordering ? categories : [],
        items: ordering ? list : [],
        drink_categories: (categories ?? []).filter((c) => DRINK.test(c.name)).map((c) => c.id),
        dessert_categories: (categories ?? []).filter((c) => DESSERT.test(c.name)).map((c) => c.id),
        pairs: ordering && learned && on('upsell') ? Object.fromEntries(Object.entries(learned.pairs).filter(([id]) => known.has(id))) : {},
        drinks_hint: on('upsell'),
        reviews: on('reviews'),
        popular: learned?.popular.filter((id) => known.has(id)) ?? [],
        loyalty: on('loyalty') ? (programs ?? []) : [],
        card_scope: restaurantKey(table.restaurant_id), // stämpelkortet sparas per restaurang i mobilen
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return errorResponse(err);
  }
}

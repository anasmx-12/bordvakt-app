import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { missingLoyalty } from '@/lib/loyalty';

const ID = /^[0-9a-f-]{36}$/;
const FIELDS = 'id, label, stamps_needed, menu_item_id, category_id, active';

// GET /api/loyalty/programs — ägarens stämpelkort
export async function GET() {
  try {
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data, error } = await supabase.from('loyalty_programs').select(FIELDS).eq('restaurant_id', restaurantId).order('created_at');
    if (error) throw missingLoyalty(error.message);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/loyalty/programs { label, stamps_needed, menu_item_id? | category_id? }
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 80) : '';
    const stamps = Math.round(Number(body?.stamps_needed));
    const item = typeof body?.menu_item_id === 'string' && ID.test(body.menu_item_id) ? body.menu_item_id : null;
    const category = !item && typeof body?.category_id === 'string' && ID.test(body.category_id) ? body.category_id : null;
    if (!label) throw new UserError('Skriv vad gästen får, t.ex. "Var 10:e kaffe gratis".');
    if (!(stamps >= 2 && stamps <= 50)) throw new UserError('Antal stämplar ska vara 2–50.');
    if (!item && !category) throw new UserError('Välj vilken rätt eller kategori som ger stämplar.');
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    // Rätten/kategorin måste vara restaurangens egen
    const own = item
      ? await supabase.from('menu_items').select('id').eq('id', item).eq('restaurant_id', restaurantId).maybeSingle()
      : await supabase.from('menu_categories').select('id').eq('id', category!).eq('restaurant_id', restaurantId).maybeSingle();
    if (!own.data) throw new UserError('Rätten eller kategorin finns inte.', 404);
    const { data, error } = await supabase
      .from('loyalty_programs')
      .insert({ restaurant_id: restaurantId, label, stamps_needed: stamps, menu_item_id: item, category_id: category })
      .select(FIELDS)
      .single();
    if (error) throw missingLoyalty(error.message);
    return Response.json(data, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { cleanItem, missingMenu } from '@/lib/menu';

// POST /api/menu/import { categories: [{ name, items: [{ name, price, description }] }] }
// Lägger in ett (rättat) utkast från "Fota menyn". Kategorier med samma namn återanvänds.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const groups = (Array.isArray(body?.categories) ? body.categories : []).slice(0, 50);
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);

    const { data: existing, error } = await supabase.from('menu_categories').select('id, name, position').eq('restaurant_id', restaurantId);
    if (error) throw missingMenu(error) ?? new UserError(error.message, 500);
    const { count } = await supabase.from('menu_items').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId);
    let position = count ?? 0;
    let catPosition = existing?.length ?? 0;
    const byName = new Map((existing ?? []).map((c) => [c.name.toLowerCase(), c.id]));

    const rows: Record<string, unknown>[] = [];
    for (const group of groups) {
      const name = typeof group?.name === 'string' ? group.name.trim().slice(0, 60) : '';
      const items = (Array.isArray(group?.items) ? group.items : []).map((i: unknown) => {
        try {
          return cleanItem(i);
        } catch {
          return null; // rader utan namn eller pris hoppas över
        }
      }).filter(Boolean) as Record<string, unknown>[];
      if (items.length === 0) continue;
      let categoryId: string | null = null;
      if (name) {
        categoryId = byName.get(name.toLowerCase()) ?? null;
        if (!categoryId) {
          const { data: created, error: e } = await supabase
            .from('menu_categories')
            .insert({ restaurant_id: restaurantId, name, position: catPosition++ })
            .select('id')
            .single();
          if (e) throw new UserError(e.message, 500);
          categoryId = created.id;
          byName.set(name.toLowerCase(), created.id);
        }
      }
      for (const item of items) rows.push({ ...item, category_id: categoryId, restaurant_id: restaurantId, position: position++ });
    }
    if (rows.length === 0) throw new UserError('Inga rätter att lägga in');
    if (position > 500) throw new UserError('Menyn kan ha högst 500 rätter');
    const { error: insertError } = await supabase.from('menu_items').insert(rows);
    if (insertError) throw new UserError(insertError.message, 500);
    return Response.json({ added: rows.length }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

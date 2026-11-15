import { engineLearned } from '@/lib/engine';
import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';

// GET /api/engine/learned — det AI:n har lärt sig om restaurangen (Statistik).
// AI-motorn anger borden med id; här blir de bordsnummer.
export async function GET() {
  try {
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    let learned: Record<string, unknown> | null;
    try {
      learned = await engineLearned(restaurantId);
    } catch (err) {
      if (err instanceof UserError) return Response.json({ online: false });
      throw err;
    }
    if (!learned || learned.loaded === false) return Response.json({ online: Boolean(learned), loaded: false });
    const { data: tables } = await supabase.from('tables').select('id, table_number').eq('restaurant_id', restaurantId);
    const number = new Map((tables ?? []).map((t) => [t.id as string, t.table_number as number]));
    const nums = (ids: unknown) =>
      (Array.isArray(ids) ? ids : [])
        .map((id) => number.get(String(id)))
        .filter((n): n is number => typeof n === 'number')
        .sort((a, b) => a - b);
    const strict = (learned.strict_tables ?? {}) as Record<string, string[]>;
    return Response.json(
      {
        online: true,
        loaded: true,
        prep: Array.isArray(learned.prep) ? learned.prep.slice(0, 12) : [],
        bill_delay_min: learned.bill_delay_min ?? null,
        bill_default_min: learned.bill_default_min ?? 7,
        bill_min_sittings: learned.bill_min_sittings ?? 10,
        dessert_off_tables: nums(learned.dessert_off_tables),
        dessert_off_hours: Array.isArray(learned.dessert_off_hours) ? learned.dessert_off_hours : [],
        careful_tables: nums(learned.careful_tables),
        strict_tables: nums(Object.keys(strict)),
        rush: Boolean(learned.rush),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return errorResponse(err);
  }
}

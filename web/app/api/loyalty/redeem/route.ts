import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';

// POST /api/loyalty/redeem { code } — personalen löser in gästens belöningskod (6 siffror)
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const code = String(body?.code ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) throw new UserError('Koden är 6 siffror.');
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data: rows, error } = await supabase
      .from('loyalty_rewards')
      .select('id, loyalty_cards!inner(loyalty_programs!inner(label, restaurant_id))')
      .eq('code', code)
      .is('redeemed_at', null)
      .eq('loyalty_cards.loyalty_programs.restaurant_id', restaurantId)
      .limit(1);
    if (error) throw new UserError(/loyalty/.test(error.message) ? 'Kör supabase/012_growth.sql i Supabase först.' : error.message, 500);
    const reward = rows?.[0];
    if (!reward) throw new UserError('Koden finns inte eller är redan använd.', 404);
    const { data: done } = await supabase
      .from('loyalty_rewards')
      .update({ redeemed_at: new Date().toISOString() })
      .eq('id', reward.id)
      .is('redeemed_at', null)
      .select('id')
      .maybeSingle();
    if (!done) throw new UserError('Koden är redan använd.', 409);
    const card = reward.loyalty_cards as unknown as { loyalty_programs: { label: string } };
    return Response.json({ label: card.loyalty_programs.label });
  } catch (err) {
    return errorResponse(err);
  }
}

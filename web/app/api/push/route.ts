import { currentRestaurantId, currentUser, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { pushReady } from '@/lib/push';

const LANGS = ['sv', 'en', 'de', 'es', 'fr', 'pt', 'tr', 'ru', 'ar', 'ur', 'hi', 'bn', 'zh', 'ja', 'ko', 'id'];

const missingPush = (message: string) =>
  /push_subscriptions/.test(message) ? new UserError('Kör supabase/012_growth.sql i Supabase först.', 500) : new UserError(message, 500);

function parse(body: unknown) {
  const b = body as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; tables?: unknown; label?: unknown; lang?: unknown } | null;
  const s = b?.subscription;
  if (typeof s?.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000) throw new UserError('Ogiltig mobil');
  if (typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') throw new UserError('Ogiltig mobil');
  const tables = Array.isArray(b?.tables)
    ? [...new Set(b.tables.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 10000))].slice(0, 100)
    : [];
  return {
    endpoint: s.endpoint,
    p256dh: s.keys.p256dh.slice(0, 200),
    auth: s.keys.auth.slice(0, 100),
    tables: tables.length ? tables : null,
    label: typeof b?.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 60) : null,
    lang: typeof b?.lang === 'string' && LANGS.includes(b.lang) ? b.lang : 'sv',
  };
}

// POST /api/push { subscription, tables?: number[], label?, lang? } — slå på larm på den här mobilen
// (samma anrop ändrar "mina bord")
export async function POST(req: Request) {
  try {
    if (!pushReady) throw new UserError('Mobil-larm saknar nycklar (VAPID) i web/.env.local.', 500);
    const row = parse(await req.json().catch(() => null));
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const user = await currentUser();
    const { data, error } = await supabase
      .from('push_subscriptions')
      .upsert({ ...row, restaurant_id: restaurantId, user_id: user?.id ?? null }, { onConflict: 'endpoint' })
      .select('id, tables, label, lang')
      .single();
    if (error) throw missingPush(error.message);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

// GET /api/push?endpoint=… — är den här mobilen påslagen, och vilka bord?
export async function GET(req: Request) {
  try {
    const endpoint = new URL(req.url).searchParams.get('endpoint') ?? '';
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('id, tables, label, lang')
      .eq('restaurant_id', restaurantId)
      .eq('endpoint', endpoint)
      .maybeSingle();
    if (error) throw missingPush(error.message);
    return Response.json({ ready: pushReady, subscription: data });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/push { endpoint } — stäng av larm på den här mobilen
export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (typeof body?.endpoint !== 'string') throw new UserError('Ogiltig mobil');
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { error } = await supabase.from('push_subscriptions').delete().eq('restaurant_id', restaurantId).eq('endpoint', body.endpoint);
    if (error) throw missingPush(error.message);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

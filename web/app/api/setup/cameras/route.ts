import { maskStreamUrl } from '@/lib/cameras';
import { engineReload } from '@/lib/engine';
import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { checkUrl, cleanCamera, LEGACY_BRANDS } from '@/lib/cameraServer';

// GET /api/setup/cameras — kamerorna, med lösenordet dolt
export async function GET() {
  try {
    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const { data: feeds, error } = await supabase
      .from('camera_feeds')
      .select('id, name, brand, status')
      .eq('restaurant_id', restaurantId)
      .order('created_at');
    if (error) throw new UserError(error.message, 500);
    const { data: streams } = await supabase
      .from('camera_streams')
      .select('camera_id, stream_url')
      .in('camera_id', (feeds ?? []).map((f) => f.id));
    const urls = new Map((streams ?? []).map((s) => [s.camera_id, s.stream_url as string]));
    return Response.json(
      (feeds ?? []).map((f) => ({ ...f, address: urls.has(f.id) ? maskStreamUrl(urls.get(f.id)!) : null }))
    );
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/setup/cameras { name, brand, stream_url } — lägger till en kamera
export async function POST(req: Request) {
  try {
    const { name, brand, url } = cleanCamera(await req.json().catch(() => null));
    if (!name) throw new UserError('Ge kameran ett namn, t.ex. "Matsal norr"');
    checkUrl(url);

    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    const insert = (b: string) =>
      supabase
        .from('camera_feeds')
        .insert({ restaurant_id: restaurantId, name, brand: b })
        .select('id, name, brand, status')
        .single();
    let { data: camera, error } = await insert(brand);
    // Databasen känner inte till de nya märkena än (006 inte körd): spara som "Annat märke"
    if (error?.code === '23514' && !LEGACY_BRANDS.includes(brand)) ({ data: camera, error } = await insert('other'));
    if (error || !camera) throw new UserError(`Kunde inte spara kameran: ${error?.message}`, 500);
    const { error: streamError } = await supabase.from('camera_streams').insert({ camera_id: camera.id, stream_url: url });
    if (streamError) {
      await supabase.from('camera_feeds').delete().eq('id', camera.id);
      throw new UserError(`Kunde inte spara kamerans adress: ${streamError.message}`, 500);
    }
    await engineReload(restaurantId);
    return Response.json({ ...camera, address: maskStreamUrl(url) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

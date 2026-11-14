import { enginePost } from '@/lib/engine';
import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 8;

// POST /api/menu/analyze — foton av den tryckta menyn (fälten "photo") -> utkast till meny.
// AI-motorn läser texten med Macens textigenkänning och sorterar den med den lokala AI:n.
// Inget sparas: ägaren rättar utkastet och lägger sedan in det via /api/menu/import.
export async function POST(req: Request) {
  try {
    const restaurantId = await currentRestaurantId(serverSupabase());
    const form = await req.formData().catch(() => null);
    const photos: string[] = [];
    for (const value of form?.getAll('photo') ?? []) {
      if (!(value instanceof File)) continue;
      if (!value.type.startsWith('image/')) throw new UserError('En av filerna är inte en bild');
      if (value.size > MAX_BYTES) throw new UserError('En bild är för stor (max 8 MB)', 413);
      photos.push(Buffer.from(await value.arrayBuffer()).toString('base64'));
    }
    if (photos.length === 0) throw new UserError('Välj minst ett foto av menyn');
    if (photos.length > MAX_PHOTOS) throw new UserError(`Högst ${MAX_PHOTOS} foton åt gången`);

    const { ok, status, data } = await enginePost(restaurantId, '/analyze-menu', JSON.stringify({ photos }), 'application/json', 60_000 + photos.length * 60_000);
    if (status === 404) throw new UserError('AI-motorn är en äldre version. Uppdatera den med: bash install/install-mac.sh, och försök igen.', 502);
    if (!ok) throw new UserError(data.error ?? `AI-motorn svarade med fel (${status})`, status === 422 ? 422 : 502);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

import { sanitizePlan } from '@/lib/floorPlan';
import { enginePost } from '@/lib/engine';
import { PHOTO_VIEWS } from '@/lib/photoViews';
import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 12; // en per vägg och hörn räcker gott
const VIEW_IDS = new Set(PHOTO_VIEWS.map((v) => v.id));

// POST /api/floor-plan/analyze — tar emot foton av matsalen och returnerar ett förslag på planritning.
// Fälten heter "photo:<plats>", t.ex. "photo:wall-entrance" och "photo:corner-far-left"
// (ett foto från varje vägg och varje hörn). Ett ensamt fält "photo" räknas som taget från entrén.
// Bordvakts egen AI (AI.py) gör analysen på den här datorn: gratis, och fotona sparas inte.
export async function POST(req: Request) {
  try {
    const restaurantId = await currentRestaurantId(serverSupabase());
    const form = await req.formData().catch(() => null);
    if (!form) throw new UserError('Inga foton skickades');

    const photos: { view: string; image: string }[] = [];
    for (const [field, value] of form.entries()) {
      const view = field === 'photo' ? 'wall-entrance' : field.startsWith('photo:') ? field.slice(6) : null;
      if (!view || !VIEW_IDS.has(view as never) || !(value instanceof File)) continue;
      if (photos.length >= MAX_PHOTOS) throw new UserError(`Högst ${MAX_PHOTOS} foton åt gången`, 413);
      if (!value.type.startsWith('image/')) throw new UserError('En av filerna är inte en bild');
      if (value.size > MAX_BYTES) throw new UserError('En bild är för stor (max 8 MB)', 413);
      photos.push({ view, image: Buffer.from(await value.arrayBuffer()).toString('base64') });
    }
    if (photos.length === 0) throw new UserError('Inga foton skickades');

    const { ok, status, data: body } = await enginePost(
      restaurantId,
      '/analyze-floor-plan-multi',
      JSON.stringify({ photos }),
      'application/json',
      // Modellen läses in en gång och går sedan igenom fotona ett i taget
      60_000 + photos.length * 20_000
    );
    if (status === 404) {
      throw new UserError('AI-motorn är en äldre version. Uppdatera den med: bash install/install-mac.sh, och försök igen.', 502);
    }
    if (!ok) throw new UserError(body.error ?? `AI-motorn svarade med fel (${status})`, 502);

    const plan = sanitizePlan(body);
    if (plan.tables.length === 0) {
      throw new UserError(
        'AI:n hittade inga bord på fotona. Ta om dem med bättre ljus och så att borden syns, eller lägg till borden för hand.',
        422
      );
    }
    return Response.json({ ...plan, photos_used: photos.length });
  } catch (err) {
    return errorResponse(err);
  }
}

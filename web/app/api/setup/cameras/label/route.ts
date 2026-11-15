import { cameraEngine } from '@/lib/cameraEngine';
import { errorResponse, UserError } from '@/lib/server';

const MAX_BYTES = 8 * 1024 * 1024;

// POST /api/setup/cameras/label (FormData: photo) — Macens textigenkänning läser kamerans etikett
export async function POST(req: Request) {
  try {
    const form = await req.formData().catch(() => null);
    const photo = form?.get('photo');
    if (!(photo instanceof File)) throw new UserError('Välj ett foto av kamerans etikett');
    if (!photo.type.startsWith('image/')) throw new UserError('Filen är inte en bild');
    if (photo.size > MAX_BYTES) throw new UserError('Bilden är för stor (max 8 MB)', 413);
    const base64 = Buffer.from(await photo.arrayBuffer()).toString('base64');
    return await cameraEngine('/read-camera-label', { photo: base64 }, 60_000);
  } catch (err) {
    return errorResponse(err);
  }
}

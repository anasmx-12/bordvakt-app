import { cameraEngine } from '@/lib/cameraEngine';
import { errorResponse, UserError } from '@/lib/server';

// POST /api/setup/cameras/placement { stream_url } — kolla igen hur många bord kameran ser (efter att den flyttats)
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const url = typeof body?.stream_url === 'string' ? body.stream_url.trim() : '';
    if (!/^rtsps?:\/\//i.test(url) || url.length > 500) throw new UserError('Ogiltig kameraadress');
    return await cameraEngine('/camera-placement', { stream_url: url }, 30_000);
  } catch (err) {
    return errorResponse(err);
  }
}

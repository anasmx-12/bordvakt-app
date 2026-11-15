import { pollPairing } from '@/lib/devicePairing';
import { errorResponse } from '@/lib/server';

// POST /api/engine/device/poll { device } — AI-datorn frågar om ägaren har godkänt koden.
// Svarar { status: 'pending' | 'expired' } eller, en enda gång, { status: 'approved', code, restaurant }.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    return Response.json(await pollPairing(body?.device), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}

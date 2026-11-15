import { startPairing } from '@/lib/devicePairing';
import { clientIp, sharedRateLimit } from '@/lib/rateLimit';
import { errorResponse, UserError } from '@/lib/server';

// POST /api/engine/device/start { name } — AI-datorn ber om en kort kod att visa på skärmen.
// Öppen utan inloggning (datorn är inte kopplad än). Koden ger ingen åtkomst förrän ägaren godkänt den.
export async function POST(req: Request) {
  try {
    if (!(await sharedRateLimit(`engine-device-start:${clientIp(req.headers)}`, 5))) {
      throw new UserError('För många försök. Vänta en minut.', 429);
    }
    const body = await req.json().catch(() => ({}));
    return Response.json(await startPairing(body?.name), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}

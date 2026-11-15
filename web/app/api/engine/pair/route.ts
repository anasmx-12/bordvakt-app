import { createPairingCode, hasEngineAccount, ownerRestaurant as owner } from '@/lib/engineAccount';
import { errorResponse } from '@/lib/server';

const ownerRestaurant = async () => (await owner()).restaurantId;

// GET /api/engine/pair: finns det redan en kopplad AI-dator?
export async function GET() {
  try {
    return Response.json({ paired: await hasEngineAccount(await ownerRestaurant()) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/engine/pair: ny kopplingskod (den gamla slutar fungera). Visas bara en gång.
export async function POST() {
  try {
    const code = await createPairingCode(await ownerRestaurant());
    return Response.json({ code }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}

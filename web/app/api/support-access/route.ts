import { ownerRestaurant } from '@/lib/engineAccount';
import { accessState, answerAccess } from '@/lib/supportAccess';
import { errorResponse, UserError } from '@/lib/server';

// GET  /api/support-access — väntande förfrågan och pågående åtkomst (bara ägaren)
// POST /api/support-access { id, action: 'approve' | 'deny' | 'end' }
async function owner() {
  try {
    return await ownerRestaurant();
  } catch (err) {
    if (err instanceof UserError && err.status === 403) return null; // personal: ser inget
    throw err;
  }
}

export async function GET() {
  try {
    const me = await owner();
    if (!me) return Response.json({ pending: null, active: null });
    return Response.json(await accessState(me.restaurantId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const me = await owner();
    if (!me) throw new UserError('Bara ägaren kan svara på supportens förfrågan.', 403);
    const body = await req.json().catch(() => ({}));
    return Response.json(await answerAccess(me.restaurantId, me.userId, body?.id, body?.action));
  } catch (err) {
    return errorResponse(err);
  }
}

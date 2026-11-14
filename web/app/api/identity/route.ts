import { identityOf } from '@/lib/identity';
import { currentUser, errorResponse, UserError } from '@/lib/server';

// GET /api/identity — är e-posten bekräftad, vilket namn har ägaren, och stämmer det med kortet?
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) throw new UserError('Du är inte inloggad.', 401);
    return Response.json({ email: user.email, ...identityOf(user) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}

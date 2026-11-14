import { confirmEmailCode } from '@/lib/identity';
import { errorResponse, serverSupabase, UserError } from '@/lib/server';

// POST /api/signup/verify { email, code } — koden från mejlet bekräftar e-postadressen.
// Kräver ingen inloggning (Supabase kan neka inloggning innan adressen är bekräftad).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const code = typeof body?.code === 'string' ? body.code.replace(/\s/g, '') : '';
    if (!email) throw new UserError('E-postadressen saknas');
    await confirmEmailCode(serverSupabase(), email, code);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

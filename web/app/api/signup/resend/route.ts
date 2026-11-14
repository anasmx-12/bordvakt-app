import { resendEmailCode } from '@/lib/identity';
import { errorResponse, serverSupabase } from '@/lib/server';

// POST /api/signup/resend { email } — ny kod till en adress som väntar på bekräftelse.
// Svarar likadant oavsett om adressen finns, så att ingen kan pröva vilka adresser som har konto.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email) await resendEmailCode(serverSupabase(), email);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

import { sendMail, SUPPORT_EMAIL } from '@/lib/mail';
import { clientIp, sharedRateLimit } from '@/lib/rateLimit';
import { errorResponse, UserError } from '@/lib/server';

// POST /api/demo { namn, restaurang, telefon, epost, webbplats } — "Boka en demo" på landningssidan.
// Öppen utan inloggning. Förfrågan mejlas till supporten (SUPPORT_EMAIL), med kundens adress som svarsadress.
// "webbplats" är ett dolt fält som bara robotar fyller i: då låtsas vi att allt gick bra.

const field = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

export async function POST(req: Request) {
  try {
    if (!(await sharedRateLimit(`demo:${clientIp(req.headers)}`, 3, 600))) {
      throw new UserError('Du har redan skickat flera förfrågningar. Vänta en stund eller ring oss.', 429);
    }
    const body = await req.json().catch(() => ({}));
    if (field(body?.webbplats, 200)) return Response.json({ ok: true });

    const namn = field(body?.namn, 100);
    const restaurang = field(body?.restaurang, 120);
    const telefon = field(body?.telefon, 40);
    const epost = field(body?.epost, 200).toLowerCase();
    if (namn.length < 2 || restaurang.length < 2) throw new UserError('Fyll i namn och restaurang.');
    if (!/^[+\d][\d\s\-()]{5,}$/.test(telefon)) throw new UserError('Kontrollera telefonnumret.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(epost)) throw new UserError('Kontrollera e-postadressen.');
    if (!SUPPORT_EMAIL) throw new UserError('Formuläret är inte igång just nu. Mejla eller ring oss i stället.', 503);

    const result = await sendMail({
      to: SUPPORT_EMAIL,
      replyTo: epost,
      fromName: 'Bordvakt demo',
      subject: `Demoförfrågan: ${restaurang}`,
      text: `Ny förfrågan om demo från landningssidan.\n\nNamn: ${namn}\nRestaurang: ${restaurang}\nTelefon: ${telefon}\nE-post: ${epost}\n\nSvara direkt på det här mejlet för att nå kunden.`,
    });
    if (!result.sent && result.via !== 'log') {
      throw new UserError('Förfrågan kunde inte skickas just nu. Försök igen om en stund.', 502);
    }
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

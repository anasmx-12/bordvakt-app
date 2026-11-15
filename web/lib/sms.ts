import 'server-only';

// Sms till gäster (väntelistan). Skickas via 46elks (svensk sms-tjänst, https://46elks.se).
// Nycklar i .env.local: ELKS_API_USERNAME och ELKS_API_PASSWORD, och valfritt SMS_FROM
// (avsändarnamnet, högst 11 bokstäver/siffror, t.ex. "Bordvakt").
// Utan nycklar skickas inget: sms:et skrivs bara i loggen, så att allt kan provas gratis.

export type SmsResult = 'sent' | 'logged' | 'failed' | 'invalid';

const USER = process.env.ELKS_API_USERNAME;
const PASSWORD = process.env.ELKS_API_PASSWORD;
const FROM = (process.env.SMS_FROM || 'Bordvakt').replace(/[^A-Za-z0-9]/g, '').slice(0, 11) || 'Bordvakt';

/** "070-123 45 67" → "+46701234567". null = inte ett mobilnummer vi kan skicka till. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let n = raw.replace(/[\s\-().\/]/g, '');
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  else if (n.startsWith('0')) n = `+46${n.slice(1)}`;
  else if (/^46\d{9}$/.test(n)) n = `+${n}`;
  if (n.startsWith('+460')) n = `+46${n.slice(4)}`; // "+46 070…"
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}

const mask = (phone: string) => `${phone.slice(0, 5)}•••${phone.slice(-2)}`;

export const smsConfigured = () => Boolean(USER && PASSWORD);

export async function sendSms(to: unknown, message: string): Promise<SmsResult> {
  const phone = normalizePhone(to);
  if (!phone) return 'invalid';
  const text = message.slice(0, 480); // högst tre sms-delar
  if (!USER || !PASSWORD) {
    console.log(`[sms, inte skickat: lägg in ELKS_API_USERNAME/ELKS_API_PASSWORD] till ${mask(phone)}: ${text}`);
    return 'logged';
  }
  try {
    const res = await fetch('https://api.46elks.com/a1/sms', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ from: FROM, to: phone, message: text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return 'sent';
    console.error(`Sms till ${mask(phone)} misslyckades: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return 'failed';
  } catch (err) {
    console.error(`Sms till ${mask(phone)} misslyckades: ${(err as Error).message}`);
    return 'failed';
  }
}

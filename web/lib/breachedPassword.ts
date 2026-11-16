import 'server-only';
import { createHash } from 'crypto';

// Har lösenordet läckt i något känt dataintrång? Frågar Have I Been Pwned med k-anonymitet:
// bara de 5 första tecknen av lösenordets SHA-1 skickas, aldrig lösenordet eller hela hashen.
// Svarar tjänsten inte inom 3 sekunder godkänns lösenordet (registreringen ska inte stoppas av det).

export async function breachedPassword(password: string): Promise<boolean> {
  const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'Bordvakt-password-check' },
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const body = await res.text();
    for (const line of body.split('\n')) {
      const [rest, count] = line.trim().split(':');
      if (rest === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export const BREACHED_MESSAGE =
  'Lösenordet finns i listor över läckta lösenord och är lätt för andra att gissa. Välj ett annat.';

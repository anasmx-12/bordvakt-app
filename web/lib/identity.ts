import 'server-only';
import { promises as dns } from 'dns';
import { createHmac, randomInt } from 'crypto';
import { SupabaseClient, User } from '@supabase/supabase-js';
import { sendMail } from './mail';
import { UserError } from './server';

// Vem kunden är: bekräftad e-post (kod i mejlet) och ett riktigt fullständigt namn,
// som efter betalningen jämförs med namnet på kortet (se lib/cardName.ts).

const MISSING_016 = 'Databasen är inte uppdaterad. Kör supabase/016_identity.sql i Supabase.';
export const missing016 = (error: { code?: string; message?: string } | null) =>
  error && (error.code === 'PGRST205' || /email_codes/.test(error.message ?? '')) ? new UserError(MISSING_016, 500) : null;

// ------------------------------------------------------------ E-postadressen

// Tjänster för tillfälliga engångsadresser
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamailblock.com', 'sharklasers.com', 'grr.la',
  '10minutemail.com', '10minutemail.net', 'temp-mail.org', 'tempmail.com', 'tempmail.net', 'tempmailo.com', 'temp-mail.io',
  'throwawaymail.com', 'yopmail.com', 'yopmail.net', 'yopmail.fr', 'trashmail.com', 'trashmail.de', 'getnada.com', 'nada.email',
  'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'mintemail.com', 'mohmal.com', 'fakeinbox.com', 'emailondeck.com',
  'tempinbox.com', 'spamgourmet.com', 'mailcatch.com', 'mytemp.email', 'burnermail.io', 'moakt.com', 'tmail.ws', 'tmpmail.org',
  'tmpmail.net', 'inboxkitten.com', 'mail.tm', 'mailpoof.com', 'discard.email', 'spambox.us', 'emailfake.com', 'fakemail.net',
  'mailsac.com', 'harakirimail.com', 'tempr.email', 'linshiyouxiang.net', 'byom.de', 'wegwerfmail.de', 'einrot.com',
  'example.com', 'example.org', 'example.net', 'test.com', 'invalid', 'localhost',
]);

/** Kastar ett begripligt fel om adressen inte kan ta emot riktig e-post. */
export async function assertRealEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new UserError('Skriv en giltig e-postadress');
  const domain = email.split('@')[1].toLowerCase();
  const parts = domain.split('.');
  const blocked = parts.some((_, i) => DISPOSABLE.has(parts.slice(i).join('.')));
  if (blocked || domain.endsWith('.invalid') || domain.endsWith('.test') || domain.endsWith('.local')) {
    throw new UserError('Använd din vanliga e-postadress. Tillfälliga adresser fungerar inte.');
  }
  let mx: { exchange: string }[] = [];
  try {
    mx = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ESERVFAIL') {
      throw new UserError(`Domänen ${domain} kan inte ta emot e-post. Kontrollera stavningen.`);
    }
    return; // DNS svarade inte: koden i mejlet avgör i stället
  }
  // "Null MX" (RFC 7505) betyder att domänen uttryckligen inte tar emot e-post
  if (!mx.some((r) => r.exchange && r.exchange !== '.')) {
    throw new UserError(`Domänen ${domain} kan inte ta emot e-post. Kontrollera stavningen.`);
  }
}

// ------------------------------------------------------------ Koden i mejlet

const CODE_MINUTES = 15;
const MAX_TRIES = 5;
const RESEND_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;

type CodeRow = { user_id: string; code_hash: string; expires_at: string; tries: number };

/** Räknar ett försök innan koden jämförs. Med 018 sker det i ett steg i databasen, så att
 *  samtidiga gissningar inte kan hinna före räknaren. */
async function countAttempt(supabase: SupabaseClient, email: string): Promise<CodeRow | 'none' | 'used-up'> {
  const { data, error } = await supabase.rpc('email_code_attempt', { p_email: email, p_max_tries: MAX_TRIES });
  if (!error) {
    if (data?.[0]) return data[0] as CodeRow;
    const { data: exists } = await supabase.from('email_codes').select('user_id').eq('email', email).maybeSingle();
    return exists ? 'used-up' : 'none';
  }
  if (!missingFunction(error)) throw new UserError(error.message, 500);
  // Före 018: läs och räkna upp i två steg
  const { data: row, error: readError } = await supabase
    .from('email_codes')
    .select('user_id, code_hash, expires_at, tries')
    .eq('email', email)
    .maybeSingle();
  if (readError) throw missing016(readError) ?? new UserError(readError.message, 500);
  if (!row) return 'none';
  if (row.tries >= MAX_TRIES) return 'used-up';
  await supabase.from('email_codes').update({ tries: row.tries + 1 }).eq('user_id', row.user_id);
  return row;
}

const missingFunction = (e: { code?: string; message?: string }) =>
  e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? '');

const codeHash = (userId: string, code: string) =>
  createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'bordvakt').update(`email-code:${userId}:${code}`).digest('hex');

/** Skapar en ny kod och mejlar den. `sends` = koder mejlade den senaste timmen (räknas från 018). */
export async function sendEmailCode(
  supabase: SupabaseClient,
  userId: string,
  email: string,
  sends?: { sends: number; sends_since: string }
) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { error } = await supabase.from('email_codes').upsert({
    user_id: userId,
    email: email.toLowerCase(),
    code_hash: codeHash(userId, code),
    expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
    tries: 0,
    sent_at: new Date().toISOString(),
    ...sends,
  });
  if (error) throw missing016(error) ?? new UserError(error.message, 500);
  const result = await sendMail({
    to: email,
    subject: `${code} är din kod till Bordvakt`,
    text:
      `Hej!\n\nDin kod för att bekräfta e-postadressen hos Bordvakt är:\n\n    ${code}\n\n` +
      `Koden gäller i ${CODE_MINUTES} minuter. Har du inte skapat ett konto kan du strunta i det här mejlet.\n\n/ Bordvakt`,
  });
  if (!result.sent && result.via !== 'log') throw new UserError('Kunde inte skicka mejlet med koden. Försök igen om en stund.', 502);
}

/** Skickar en ny kod om adressen väntar på en (svarar likadant oavsett, så att ingen kan pröva adresser). */
export async function resendEmailCode(supabase: SupabaseClient, email: string) {
  // '*': kolumnerna sends/sends_since finns först efter 018
  const { data, error } = await supabase.from('email_codes').select('*').eq('email', email.toLowerCase()).maybeSingle();
  if (error) throw missing016(error) ?? new UserError(error.message, 500);
  if (!data) return;
  if (Date.now() - new Date(data.sent_at).getTime() < RESEND_SECONDS * 1000) {
    throw new UserError('Vänta en minut innan du ber om en ny kod.', 429);
  }
  let sends: { sends: number; sends_since: string } | undefined;
  if (typeof data.sends === 'number') {
    const fresh = Date.now() - new Date(data.sends_since).getTime() > 3_600_000;
    if (!fresh && data.sends >= MAX_SENDS_PER_HOUR) {
      throw new UserError('Du har bett om många koder. Vänta en timme och försök igen.', 429);
    }
    sends = fresh ? { sends: 1, sends_since: new Date().toISOString() } : { sends: data.sends + 1, sends_since: data.sends_since };
  }
  await sendEmailCode(supabase, data.user_id, data.email, sends);
}

/** Kontrollerar koden och bekräftar e-postadressen. */
export async function confirmEmailCode(supabase: SupabaseClient, email: string, code: string) {
  const wrong = new UserError('Fel kod. Kontrollera mejlet och försök igen.');
  if (!/^\d{6}$/.test(code)) throw wrong;
  const tooMany = new UserError('För många felaktiga försök. Be om en ny kod.', 429);
  const row = await countAttempt(supabase, email.toLowerCase());
  if (row === 'none') throw wrong;
  if (row === 'used-up') throw tooMany;
  if (new Date(row.expires_at).getTime() < Date.now()) throw new UserError('Koden har gått ut. Be om en ny kod.', 410);
  if (row.code_hash !== codeHash(row.user_id, code)) throw wrong;
  const { error: confirmError } = await supabase.auth.admin.updateUserById(row.user_id, { email_confirm: true });
  if (confirmError) throw new UserError(`Kunde inte bekräfta adressen: ${confirmError.message}`, 500);
  await supabase.from('email_codes').delete().eq('user_id', row.user_id);
}

// ------------------------------------------------------------ Fullständigt namn

const FAKE_WORDS = /^(test|testar|testsson|asdf|qwerty|abc|xxx|aaa|foo|bar|namn|name|efternamn|förnamn|fornamn|nobody|anonym|anonymous|admin|user|kund|ägare|agare|owner)$/i;

/** Rensar och kontrollerar ett fullständigt namn ("Förnamn Efternamn"). */
export function cleanLegalName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  const bad = new UserError('Skriv ditt fullständiga namn som det står på din legitimation, med för- och efternamn.');
  if (name.length < 5 || name.length > 100) throw bad;
  const words = name.split(' ');
  if (words.length < 2) throw bad;
  for (const w of words) {
    if (!/^\p{L}+(?:['’-]\p{L}+)*\.?$/u.test(w)) throw bad;
  }
  const letters = words.map((w) => w.replace(/[^\p{L}]/gu, ''));
  if (letters.filter((w) => w.length >= 2).length < 2) throw bad;
  // "Test Test", "Asdf Qwerty", "Aaaa Bbbb"
  const fakes = letters.filter((w) => FAKE_WORDS.test(w) || /^(.)\1+$/iu.test(w)).length;
  if (fakes >= 2 || (fakes >= 1 && words.length === 2) || new Set(letters.map((w) => w.toLowerCase())).size === 1) {
    throw new UserError('Det ser inte ut som ett riktigt namn. Skriv ditt namn som det står på din legitimation.');
  }
  return words.map((w) => w.charAt(0).toLocaleUpperCase('sv') + w.slice(1)).join(' ');
}

// ------------------------------------------------------------ Status

export interface Identity {
  email_confirmed: boolean;
  legal_name: string | null;
  /** Namnet på kortet hos Stripe, om det inte stämmer med legal_name */
  card_name_mismatch: string | null;
  /** Får gå vidare till betalningen */
  ready_for_checkout: boolean;
}

export function identityOf(user: User): Identity {
  const meta = user.app_metadata ?? {};
  const legalName = typeof meta.legal_name === 'string' ? meta.legal_name : null;
  const emailConfirmed = Boolean(user.email_confirmed_at);
  return {
    email_confirmed: emailConfirmed,
    legal_name: legalName,
    card_name_mismatch: typeof meta.card_name_mismatch === 'string' ? meta.card_name_mismatch : null,
    ready_for_checkout: emailConfirmed && Boolean(legalName),
  };
}

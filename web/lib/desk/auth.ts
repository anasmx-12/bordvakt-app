import 'server-only';
import { createHash, randomBytes } from 'crypto';
import { serverSupabase, UserError } from '@/lib/server';
import { sendMail } from '@/lib/mail';
import { sharedRateLimit } from '@/lib/rateLimit';
import { audit, DeskContext, supportSite, text } from './gate';

// Inloggning och inbjudningar till supportsajten. Själva lösenordet och koden från
// autentiseringsappen kontrolleras av Supabase på supportsajten (med den publika nyckeln);
// här kontrolleras att kontot är aktiv personal, och allt loggas.

export const INVITE_HOURS = 48;
const hashToken = (token: string) => createHash('sha256').update(`support-invite:${token}`).digest('hex');

/** POST auth/login-limit — högst 8 inloggningsförsök per minut från samma adress (alla servrar). */
export async function loginLimit(ctx: DeskContext) {
  if (!(await sharedRateLimit(`support:auth:${ctx.ip ?? 'okänd'}`, 8))) throw new UserError('För många försök. Vänta en minut.', 429);
  return { ok: true };
}

/** POST auth/login-failed { email } — misslyckat försök, till loggen. */
export async function loginFailed(ctx: DeskContext, input: Record<string, unknown>) {
  await audit(ctx, null, 'login_failed', undefined, { email: text(input.email, 200).toLowerCase() });
  return { ok: true };
}

/** POST auth/login-check — steg 1 klart. Är kontot aktiv personal? */
export async function loginCheck(ctx: DeskContext) {
  if (!ctx.staff) {
    await audit(ctx, null, 'login_failed', undefined, { user: ctx.userId, reason: 'not_active_staff' });
    return { ok: false };
  }
  return { ok: true };
}

/** POST auth/mfa-attempt — högst 5 koder per 5 minuter och konto. */
export async function mfaAttempt(ctx: DeskContext) {
  if (!ctx.staff) throw new UserError('Logga in igen.', 401);
  if (!(await sharedRateLimit(`support-mfa:${ctx.staff.user_id}`, 5, 300))) throw new UserError('För många försök. Vänta 5 minuter.', 429);
  return { ok: true };
}

/** POST auth/mfa-result { ok, firstTime } — resultatet av koden, till loggen. */
export async function mfaResult(ctx: DeskContext, input: Record<string, unknown>) {
  if (!ctx.staff) throw new UserError('Logga in igen.', 401);
  if (input.ok !== true) {
    await audit(ctx, ctx.staff, 'login_failed', undefined, { reason: 'wrong_totp' });
    return { ok: true };
  }
  if (input.firstTime === true) await audit(ctx, ctx.staff, 'mfa_enrolled');
  await audit(ctx, ctx.staff, 'login');
  await serverSupabase().from('support_staff').update({ last_login_at: new Date().toISOString() }).eq('user_id', ctx.staff.user_id);
  return { ok: true };
}

/** POST auth/logout */
export async function logout(ctx: DeskContext) {
  if (ctx.staff) await audit(ctx, ctx.staff, 'logout');
  return { ok: true };
}

/** GET me — den inloggade personalen (aal2 och aktiv, annars 401). */
export async function me(ctx: DeskContext) {
  return { staff: ctx.staff };
}

// ------------------------------------------------------------ Inbjudningar

export async function createInvite(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const db = serverSupabase();
  await db.from('support_invites').delete().eq('user_id', userId);
  const { error } = await db.from('support_invites').insert({
    token_hash: hashToken(token),
    user_id: userId,
    expires_at: new Date(Date.now() + INVITE_HOURS * 3600_000).toISOString(),
  });
  if (error) throw new UserError(`Kunde inte skapa inbjudan: ${error.message}`, 500);
  return `${supportSite()}/valkommen?t=${token}`;
}

async function findInvite(token: unknown) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const db = serverSupabase();
  const { data } = await db.from('support_invites').select('user_id, expires_at').eq('token_hash', hashToken(token)).maybeSingle();
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  const { data: staff } = await db.from('support_staff').select('name, email, active').eq('user_id', data.user_id).maybeSingle();
  if (!staff?.active) return null;
  return { userId: data.user_id as string, name: staff.name as string, email: staff.email as string };
}

/** Mejlar inbjudningslänken. Returnerar länken om mejlet inte gick iväg (då visas den för administratören). */
export async function sendInvite(userId: string, name: string, email: string, reset = false) {
  const link = await createInvite(userId);
  const mail = await sendMail({
    to: email,
    fromName: 'Bordvakt support',
    subject: reset ? 'Välj ett nytt lösenord till Bordvakt support' : 'Du är inbjuden till Bordvakt support',
    text: [
      `Hej ${name.split(' ')[0]}!`,
      '',
      reset
        ? 'En administratör har skickat en länk så att du kan välja ett nytt lösenord till Bordvakt support.'
        : 'Du har fått ett konto på Bordvakt support, där kundtjänsten hanterar ärenden och kunder.',
      '',
      `Välj ditt lösenord här (länken gäller i ${INVITE_HOURS} timmar och kan bara användas en gång):`,
      link,
      '',
      reset ? '' : 'När du loggar in första gången kopplar du en autentiseringsapp (t.ex. Google Authenticator) till kontot.',
      '',
      'Har du inte väntat dig det här mejlet? Strunta i det.',
      '/ Bordvakt',
    ].join('\n'),
  });
  return mail.sent ? null : link;
}

/** Lösenord för personalen: minst 12 tecken och inte uppenbart. */
function checkPassword(password: unknown, email: string): string {
  if (typeof password !== 'string' || password.length < 12) throw new UserError('Lösenordet måste vara minst 12 tecken.');
  if (password.length > 72) throw new UserError('Lösenordet får vara högst 72 tecken.');
  const lower = password.toLowerCase();
  const local = email.split('@')[0].toLowerCase();
  if (new Set(lower).size < 6 || /bordvakt|support|password|lösenord|losenord|123456|qwerty/.test(lower) || (local.length > 3 && lower.includes(local))) {
    throw new UserError('Lösenordet är för lätt att gissa. Välj ett längre och mer ovanligt.');
  }
  return password;
}

/** POST invite/lookup { token } — vem länken gäller (sidan /valkommen). */
export async function inviteLookup(ctx: DeskContext, input: Record<string, unknown>) {
  if (!(await sharedRateLimit(`support:invite:${ctx.ip ?? 'okänd'}`, 20))) throw new UserError('För många försök. Vänta en minut.', 429);
  const invite = await findInvite(input.token);
  return { invite: invite ? { name: invite.name, email: invite.email } : null };
}

/** POST invite/accept { token, password } — ny personal väljer sitt lösenord via länken. */
export async function inviteAccept(ctx: DeskContext, input: Record<string, unknown>) {
  if (!(await sharedRateLimit(`support:invite:${ctx.ip ?? 'okänd'}`, 20))) throw new UserError('För många försök. Vänta en minut.', 429);
  const invite = await findInvite(input.token);
  if (!invite) throw new UserError('Länken har gått ut eller använts redan. Be en administratör om en ny.', 410);
  const password = checkPassword(input.password, invite.email);
  const db = serverSupabase();
  const { error } = await db.auth.admin.updateUserById(invite.userId, { password });
  if (error) throw new UserError(`Kunde inte spara lösenordet: ${error.message}`, 400);
  await db.from('support_invites').delete().eq('user_id', invite.userId);
  await audit(ctx, { user_id: invite.userId, name: invite.name }, 'invite_accept');
  return { ok: true };
}

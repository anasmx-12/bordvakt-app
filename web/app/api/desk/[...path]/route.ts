import { errorResponse, UserError } from '@/lib/server';
import { deskGate, DeskContext, Level } from '@/lib/desk/gate';
import * as auth from '@/lib/desk/auth';
import * as tickets from '@/lib/desk/tickets';
import * as customers from '@/lib/desk/customers';
import * as staff from '@/lib/desk/staff';

// /api/desk/... — supportsajtens enda väg in (se lib/desk/gate.ts).
// Det som inte står i listan nedan finns inte. Varje rad säger vilken behörighet som krävs:
//   key      = bara supportsajtens nyckel (inloggning och inbjudningar, innan någon är inloggad)
//   password = personalkonto med lösenord (steg 1 av inloggningen)
//   staff    = aktiv personal med kod från autentiseringsappen
//   admin    = som staff, och administratör

type Input = Record<string, unknown>;
type Handler = (ctx: DeskContext, req: { url: URL; input: Input }, id: string) => Promise<unknown>;

const ROUTES: [method: string, path: string, level: Level, run: Handler][] = [
  ['POST', 'auth/login-limit', 'key', (c) => auth.loginLimit(c)],
  ['POST', 'auth/login-failed', 'key', (c, r) => auth.loginFailed(c, r.input)],
  ['POST', 'auth/login-check', 'password', (c) => auth.loginCheck(c)],
  ['POST', 'auth/mfa-attempt', 'password', (c) => auth.mfaAttempt(c)],
  ['POST', 'auth/mfa-result', 'password', (c, r) => auth.mfaResult(c, r.input)],
  ['POST', 'auth/logout', 'password', (c) => auth.logout(c)],
  ['POST', 'invite/lookup', 'key', (c, r) => auth.inviteLookup(c, r.input)],
  ['POST', 'invite/accept', 'key', (c, r) => auth.inviteAccept(c, r.input)],

  ['GET', 'me', 'staff', (c) => auth.me(c)],
  ['GET', 'counts', 'staff', () => tickets.newCount()],

  ['GET', 'tickets', 'staff', (c, r) => tickets.listTickets(c, r.url)],
  ['GET', 'tickets/:id', 'staff', (c, r, id) => tickets.getTicket(c, r.url, id)],
  ['POST', 'tickets/:id/reply', 'staff', (c, r, id) => tickets.reply(c, r.input, id)],
  ['POST', 'tickets/:id/slots', 'staff', (c, r, id) => tickets.slots(c, r.input, id)],
  ['POST', 'tickets/:id/status', 'staff', (c, r, id) => tickets.setStatus(c, r.input, id)],

  ['GET', 'customers', 'staff', (c, r) => customers.listCustomers(c, r.url)],
  ['GET', 'customers/:id', 'staff', (c, r, id) => customers.getCustomer(c, r.url, id)],
  ['POST', 'customers/:id/reset-password', 'staff', (c, r, id) => customers.resetPassword(c, r.input, id)],
  ['POST', 'customers/:id/approve-card', 'staff', (c, r, id) => customers.approveCard(c, r.input, id)],
  ['POST', 'customers/:id/trial', 'staff', (c, r, id) => customers.extendTrial(c, r.input, id)],
  ['POST', 'customers/:id/exempt', 'admin', (c, r, id) => customers.exempt(c, r.input, id)],
  ['POST', 'customers/:id/delete', 'admin', (c, r, id) => customers.deleteCustomer(c, r.input, id)],

  ['GET', 'staff', 'admin', () => staff.listStaff()],
  ['POST', 'staff', 'admin', (c, r) => staff.inviteStaff(c, r.input)],
  ['PATCH', 'staff/:id', 'admin', (c, r, id) => staff.updateStaff(c, r.input, id)],
  ['GET', 'log', 'admin', (c, r) => staff.listLog(c, r.url)],
];

function match(method: string, parts: string[]) {
  for (const [m, path, level, run] of ROUTES) {
    if (m !== method) continue;
    const want = path.split('/');
    if (want.length !== parts.length) continue;
    let id = '';
    if (want.every((w, i) => (w === ':id' ? ((id = parts[i]), true) : w === parts[i]))) return { level, run, id };
  }
  return null;
}

async function handle(req: Request, params: Promise<{ path: string[] }>) {
  try {
    const route = match(req.method, (await params).path);
    if (!route) {
      await deskGate(req, 'key'); // utan nyckel: 401, så att ingen kan pröva vilka vägar som finns
      throw new UserError('Finns inte.', 404);
    }
    const ctx = await deskGate(req, route.level);
    let input: Input = {};
    if (req.method !== 'GET') {
      const data = await req.json().catch(() => null);
      if (data && typeof data === 'object' && !Array.isArray(data)) input = data;
    }
    const result = await route.run(ctx, { url: new URL(req.url), input }, route.id);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}

type Ctx = { params: Promise<{ path: string[] }> };
export const GET = (req: Request, { params }: Ctx) => handle(req, params);
export const POST = (req: Request, { params }: Ctx) => handle(req, params);
export const PATCH = (req: Request, { params }: Ctx) => handle(req, params);

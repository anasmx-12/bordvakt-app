import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { hasAccess } from '@/lib/plans';
import { clientIp, rateLimit, sharedRateLimit } from '@/lib/rateLimit';

// Körs före varje sida och API-anrop:
// 1. "/" visar landningssidan (public/landing/index.html). Öppen för alla, liksom
//    inloggning, registrering och Stripes webhook.
// 2. Resten kräver inloggning. Annars skickas man till /login.
// 3. Appen kräver en aktiv prenumeration (eller provperiod). Annars /billing.
// 4. Matsalen och köket öppnas inte förrän installationen är klar.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const VERIFY_EMAIL = '/verifiera-epost';
const PUBLIC = new Set(['/login', '/signup', '/api/signup', '/api/billing/webhook', '/villkor', '/integritet', '/pub-avtal', '/nytt-losenord', '/api/password-reset']);
// Inloggad men utan prenumeration: får välja plan och betala
const BILLING = new Set([
  '/billing',
  '/settings',
  '/api/billing/checkout',
  '/api/billing/sync',
  '/api/billing/portal',
  '/api/billing/cancel',
  '/api/identity',
  '/api/identity/name',
  '/api/billing/check-name',
  '/api/account/password',
]);

// Hur många anrop per minut en adress får göra
const LIMITS: [prefix: string, write: number, read: number][] = [
  ['/api/signup', 5, 30],
  ['/api/password-reset', 5, 30],
  ['/api/account/password', 6, 30],
  ['/api/guest/', 30, 120],
  ['/api/waitlist-link/', 20, 120],
  ['/api/support-link/', 10, 60],
  // Belöningskoden är 6 siffror: håll gissningen långsam
  ['/api/loyalty/redeem', 10, 60],
  // Ny kopplingskod loggar ut AI-datorn, betalning och support skapar saker hos Stripe och i mejl
  ['/api/engine/pair', 5, 60],
  ['/api/billing/', 10, 60],
  ['/api/support', 10, 120],
  ['/api/', 120, 600],
];
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SITE_ORIGIN = (() => {
  try {
    return process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).origin : null;
  } catch {
    return null;
  }
})();

/** Ändringar får bara komma från webbappen själv (skydd mot CSRF: en annan sida som
 *  försöker göra saker i den inloggades namn). */
function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') !== 'cross-site';
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === host || origin === SITE_ORIGIN;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/') && pathname !== '/api/billing/webhook' && !pathname.startsWith('/api/cron/') && !pathname.startsWith('/api/hooks/')) {
    const write = WRITE.has(request.method);
    if (write && !sameOrigin(request)) {
      return Response.json({ error: 'Anropet nekades (fel ursprung).' }, { status: 403 });
    }
    const [prefix, writeLimit, readLimit] = LIMITS.find(([p]) => pathname.startsWith(p))!;
    const key = `${prefix}:${write ? 'w' : 'r'}:${clientIp(request.headers)}`;
    const allowed = rateLimit(key, write ? writeLimit : readLimit) && (!write || prefix === '/api/' || (await sharedRateLimit(key, writeLimit)));
    if (!allowed) {
      return Response.json(
        { error: 'För många försök. Vänta en minut och försök igen.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }
  }

  if (pathname === '/') {
    return NextResponse.rewrite(new URL('/landing/index.html', request.url));
  }
  if (pathname === '/api/billing/webhook') return NextResponse.next();
  // Gästernas beställningssida (QR-koden på bordet): öppen utan inloggning.
  // Rutterna kontrollerar själva QR-koden, prenumerationen och om QR-beställning är på.
  if (pathname.startsWith('/b/') || pathname.startsWith('/api/guest/')) return NextResponse.next();
  // Länken i supportmejlen: kunden svarar utan att logga in (koden i länken är hemlig)
  if (pathname.startsWith('/s/') || pathname.startsWith('/api/support-link/')) return NextResponse.next();
  // Gästernas väntelista-länk (/w/<kod>) och schemaläggarens morgonrapport (har egen nyckel)
  if (pathname.startsWith('/w/') || pathname.startsWith('/api/waitlist-link/') || pathname.startsWith('/api/cron/') || pathname.startsWith('/api/hooks/')) {
    return NextResponse.next();
  }
  // Bekräfta e-post med koden (rutterna kontrollerar själva vem som anropar)
  if (pathname.startsWith('/api/signup/')) return NextResponse.next();
  // Mobil-larmets filer måste nås innan inloggning
  if (pathname === '/sw.js' || pathname === '/manifest.webmanifest') return NextResponse.next();

  // Läser inloggningen ur cookies och förnyar den vid behov
  let response = NextResponse.next({ request });
  if (!SUPABASE_URL || !ANON_KEY) {
    return new Response('NEXT_PUBLIC_SUPABASE_URL och NEXT_PUBLIC_SUPABASE_ANON_KEY saknas i web/.env.local', { status: 500 });
  }
  const supabase = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies) {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const user = (await supabase.auth.getUser().catch(() => null))?.data.user ?? null;

  // Omdirigering som behåller förnyade inloggningscookies
  const redirect = (path: string) => {
    const res = NextResponse.redirect(new URL(path, request.url));
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };
  const isApi = pathname.startsWith('/api/');

  // Supportpersonalens konton (supportsajten) får inte använda kundappen. Loggas ut här
  // (bara i den här webbläsaren, inte på supportsajten) och skickas till inloggningen.
  if (user?.app_metadata?.bordvakt_staff === true) {
    await supabase.auth.signOut({ scope: 'local' });
    if (isApi) {
      const res = NextResponse.json({ error: 'Det här är ett supportkonto. Logga in med ett kundkonto.' }, { status: 403 });
      response.cookies.getAll().forEach((c) => res.cookies.set(c));
      return res;
    }
    return pathname === '/login' ? response : redirect('/login?konto=support');
  }

  if (PUBLIC.has(pathname)) {
    if (user && (pathname === '/login' || pathname === '/signup')) return redirect('/matsal');
    return response;
  }

  // AI-datorns konto (se lib/engineAccount.ts) får inte öppna webbappen
  if (user?.app_metadata?.bordvakt_engine === true) {
    return Response.json({ error: 'Det här kontot är till för AI-datorn.' }, { status: 403 });
  }


  if (!user) {
    if (isApi) return Response.json({ error: 'Du är inte inloggad. Ladda om sidan och logga in.' }, { status: 401 });
    return redirect(`/login?next=${encodeURIComponent(pathname + request.nextUrl.search)}`);
  }

  // E-postadressen måste bekräftas med koden från mejlet innan något annat går att använda
  if (!user.email_confirmed_at) {
    if (pathname === VERIFY_EMAIL || pathname === '/api/identity') return response;
    if (isApi) return Response.json({ error: 'Bekräfta e-postadressen med koden i mejlet först.' }, { status: 403 });
    return redirect(VERIFY_EMAIL);
  }
  if (pathname === VERIFY_EMAIL) return redirect('/billing');

  if (BILLING.has(pathname)) return response;

  // Prenumerationen (läsreglerna ger bara den egna restaurangen)
  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('billing_exempt, subscription_status')
    .maybeSingle();
  // Namnet på kortet stämmer inte med ägarens namn (lib/cardName.ts): rättas på /billing
  if (!hasAccess(restaurant) || user.app_metadata?.card_name_mismatch) {
    if (isApi) return Response.json({ error: 'Prenumerationen är inte aktiv.' }, { status: 402 });
    return redirect('/billing');
  }

  // Matsal och Kök innan installationen är klar: sidan visas suddig med ett meddelande
  // och användaren skickas till installationen (app/components/SetupGate.tsx).
  return response;
}

export const config = {
  // Allt utom Next.js egna filer, landningssidans filer och bilder
  matcher: ['/((?!_next/static|_next/image|landing/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};

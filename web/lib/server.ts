import 'server-only';
import { cookies } from 'next/headers';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

/** Fel som visas för användaren som det är. */
export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const isPlaceholder = (value: string | undefined) => !value || value.includes('DIN_');

/** Supabase med service-nyckeln. Får bara användas på servern.
 *  Går förbi databasens läsregler, så filtrera alltid på restaurangen. */
export function serverSupabase(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (isPlaceholder(key)) {
    throw new UserError('SUPABASE_SERVICE_ROLE_KEY saknas i web/.env.local', 500);
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key!, {
    auth: { persistSession: false },
  });
}

/** Den inloggade användaren (läses ur inloggningens cookies), eller null. */
export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Går inte att sätta cookies här: proxy.ts förnyar inloggningen i stället
        }
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/** Den inloggades restaurang. Alla API-anrop ska bara röra den här restaurangens data. */
export async function currentRestaurantId(supabase: SupabaseClient): Promise<string> {
  const user = await currentUser();
  if (!user) throw new UserError('Du är inte inloggad. Ladda om sidan och logga in.', 401);
  // AI-datorns konto får aldrig använda webbappen
  if (user.app_metadata?.bordvakt_engine === true) throw new UserError('Det här kontot är till för AI-datorn.', 403);
  if (user.app_metadata?.bordvakt_staff === true) throw new UserError('Det här kontot är ett supportkonto.', 403);
  const { data, error } = await supabase
    .from('restaurant_members')
    .select('restaurant_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    if (error.code === 'PGRST205') {
      throw new UserError('Databasen är inte uppdaterad. Kör supabase/005_accounts_and_billing.sql i Supabase.', 500);
    }
    throw new UserError(`Kunde inte läsa restaurangen: ${error.message}`, 500);
  }
  if (!data) throw new UserError('Ditt konto är inte kopplat till någon restaurang.', 403);
  return data.restaurant_id;
}

/** Kastar 404 om raden inte finns eller hör till en annan restaurang. */
export async function assertOwned(
  supabase: SupabaseClient,
  table: 'tables' | 'camera_feeds' | 'orders',
  id: string,
  restaurantId: string,
  notFound: string
) {
  const { data } = await supabase.from(table).select('id').eq('id', id).eq('restaurant_id', restaurantId).maybeSingle();
  if (!data) throw new UserError(notFound, 404);
}

/** Gör om ett fel till ett JSON-svar. */
export function errorResponse(err: unknown) {
  if (err instanceof UserError) return Response.json({ error: err.message }, { status: err.status });
  // Fel från Stripe har en begriplig förklaring: visa den
  const stripeError = err as { type?: string; message?: string; requestId?: string };
  if (typeof stripeError?.type === 'string' && stripeError.type.startsWith('Stripe')) {
    console.error(`Stripe-fel (${stripeError.requestId}): ${stripeError.message}`);
    return Response.json({ error: `Betalningen gick inte att starta: ${stripeError.message}` }, { status: 502 });
  }
  console.error(err);
  return Response.json({ error: 'Något gick fel på servern' }, { status: 500 });
}

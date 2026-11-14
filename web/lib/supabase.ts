import { createBrowserClient } from '@supabase/ssr';

// Webbläsarens klient: anon-nyckeln får bara läsa (se supabase/schema.sql).
// Inloggningen sparas i cookies så att servern (proxy.ts) kan se vem som är inloggad.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

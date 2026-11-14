-- 018: Gränser som gäller för hela webbappen, inte bara en server.
-- Kör i Supabase SQL Editor efter 017. Kan köras flera gånger.
--
-- 1. rate_limits + hit_rate_limit(): räknar försök per adress i databasen. På Vercel körs
--    webbappen på många servrar samtidigt, så en räknare i minnet räcker inte mot den som
--    gissar koder.
-- 2. email_code_attempt(): räknar ett försök med e-postkoden innan koden jämförs, i ett
--    enda steg. Då kan ingen skicka många gissningar samtidigt och hinna före räknaren.
-- 3. email_codes.sends: hur många koder som mejlats den senaste timmen (högst 5).
--
-- Bara webbappens server (service-nyckeln) får använda det här.

-- ------------------------------------------------------------ 1. Försök per adress
create table if not exists public.rate_limits (
  key text primary key,
  count int not null default 0,
  reset_at timestamptz not null
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- true = försöket får göras
create or replace function public.hit_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  insert into rate_limits as r (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update
    set count = case when r.reset_at < now() then 1 else r.count + 1 end,
        reset_at = case when r.reset_at < now() then excluded.reset_at else r.reset_at end
  returning count into n;

  -- Städa bort gamla rader ibland
  if random() < 0.01 then
    delete from rate_limits where reset_at < now() - interval '1 hour';
  end if;
  return n <= p_limit;
end;
$$;
revoke all on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;

-- ------------------------------------------------------------ 2. Ett försök med e-postkoden
-- Räknar upp försöken och returnerar raden, eller ingenting om försöken är slut.
create or replace function public.email_code_attempt(p_email text, p_max_tries int)
returns table (user_id uuid, code_hash text, expires_at timestamptz, tries int)
language sql
security definer
set search_path = public
as $$
  update email_codes c
     set tries = c.tries + 1
   where lower(c.email) = lower(p_email) and c.tries < p_max_tries
  returning c.user_id, c.code_hash, c.expires_at, c.tries;
$$;
revoke all on function public.email_code_attempt(text, int) from public, anon, authenticated;
grant execute on function public.email_code_attempt(text, int) to service_role;

-- ------------------------------------------------------------ 3. Koder per timme
alter table public.email_codes add column if not exists sends int not null default 1;
alter table public.email_codes add column if not exists sends_since timestamptz not null default now();

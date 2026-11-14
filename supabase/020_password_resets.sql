-- 020: Supporten kan skicka en länk till kunden för att välja nytt lösenord.
-- Kör i Supabase SQL Editor efter 019. Kan köras flera gånger.
--
-- Länken gäller i en timme och kan bara användas en gång. Bara en hash av koden sparas.
-- När kunden har valt nytt lösenord loggas kontot ut överallt (revoke_user_sessions).

create table if not exists public.password_resets (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  requested_by uuid references auth.users (id) on delete set null,  -- supportpersonen
  created_at timestamptz not null default now()
);
create index if not exists password_resets_user on public.password_resets (user_id);

alter table public.password_resets enable row level security;
revoke all on public.password_resets from anon, authenticated;

-- Loggar ut ett konto på alla enheter (tar bort inloggningarna och deras förnyelsenycklar)
create or replace function public.revoke_user_sessions(p_user_id uuid)
returns void
language sql
security definer
set search_path = public, auth
as $$
  delete from auth.sessions where user_id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
$$;
revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

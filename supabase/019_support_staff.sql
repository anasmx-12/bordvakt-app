-- 019: Supportsajten (support.bordvakt.se) för Bordvakts kundtjänst.
-- Kör i Supabase SQL Editor efter 018. Kan köras flera gånger.
--
-- Personalens konton är helt skilda från kundernas: de skapas bara via inbjudan, har
-- app_metadata.bordvakt_staff = true och en rad i support_staff. Kundappen nekar dem,
-- och supportsajten nekar alla andra.
-- Allt här läses och skrivs bara av supportsajtens server (service-nyckeln).

-- ------------------------------------------------------------ Personal
create table if not exists public.support_staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  email text not null,
  role text not null default 'agent' check (role in ('agent', 'admin')),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- Inbjudan: länk för att välja lösenord. Bara en hash av koden sparas.
create table if not exists public.support_invites (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists support_invites_user on public.support_invites (user_id);

-- ------------------------------------------------------------ Logg över allt personalen gör
-- Går bara att lägga till rader i, aldrig att ändra eller ta bort (inte ens med service-nyckeln).
create table if not exists public.support_audit (
  id bigint generated always as identity primary key,
  staff_id uuid,
  staff_name text,
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists support_audit_created on public.support_audit (created_at desc);
create index if not exists support_audit_target on public.support_audit (target_type, target_id);

create or replace function public.support_audit_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'support_audit kan inte ändras eller tas bort';
end $$;
drop trigger if exists support_audit_no_change on public.support_audit;
create trigger support_audit_no_change before update or delete on public.support_audit
  for each row execute function public.support_audit_append_only();

-- Vem i supporten som skrev ett svar (visas inte för kunden)
alter table public.support_messages add column if not exists staff_id uuid references auth.users (id) on delete set null;
alter table public.support_messages add column if not exists staff_name text;

-- ------------------------------------------------------------ Sök kund på e-post
create or replace function public.support_find_users(p_query text)
returns table (id uuid, email text)
language sql
security definer
set search_path = public, auth
as $$
  select u.id, u.email::text from auth.users u
   where u.email ilike '%' || replace(replace(p_query, '%', ''), '_', '\_') || '%'
   order by u.email
   limit 25;
$$;
revoke all on function public.support_find_users(text) from public, anon, authenticated;
grant execute on function public.support_find_users(text) to service_role;

-- ------------------------------------------------------------ Bara servern
alter table public.support_staff enable row level security;
alter table public.support_invites enable row level security;
alter table public.support_audit enable row level security;
revoke all on public.support_staff, public.support_invites, public.support_audit from anon, authenticated;

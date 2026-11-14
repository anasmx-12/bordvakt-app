-- 016: Bekräftad e-post (koden i mejlet).
-- Kör i Supabase SQL Editor efter 015. Kan köras flera gånger.
--
-- Tabellerna läses och skrivs bara av webbappens server (service-nyckeln).
-- Inloggade användare och besökare kommer inte åt dem alls.

-- ------------------------------------------------------------ E-postkoder
-- Den 6-siffriga koden som mejlas vid registrering. Bara en hash av koden sparas.
create table if not exists public.email_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  tries int not null default 0,
  sent_at timestamptz not null default now()
);
create index if not exists email_codes_email on public.email_codes (lower(email));

-- ------------------------------------------------------------ Bara servern
alter table public.email_codes enable row level security;
revoke all on public.email_codes from anon, authenticated;

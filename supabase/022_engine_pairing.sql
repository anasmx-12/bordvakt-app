-- 022: Koppla AI-datorn med en kort kod (som när man kopplar en smart-TV).
-- 1. AI-datorn ber webbappen om en kod (t.ex. K7P-4QX) och visar den på skärmen.
-- 2. Ägaren skriver in koden i webbappen: Inställningar → AI-datorn → Koppla dator.
-- 3. AI-datorn hämtar själv sin inloggning, en gång. Ingen hemlighet behöver kopieras.
-- Bara webbappens server (service-nyckeln) läser och skriver tabellen.
-- Kör efter 014_engine_accounts.sql.

create table if not exists public.engine_pairings (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,           -- sha256 av koden som visas (koden själv sparas inte)
  device_hash text not null unique,         -- sha256 av datorns hemliga nyckel
  device_name text,                         -- datorns namn, visas för ägaren innan hen godkänner
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  approved_by uuid,                         -- ägaren som godkände
  approved_at timestamptz,
  claimed_at timestamptz,                   -- datorn har hämtat sin inloggning (bara en gång)
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists engine_pairings_expires_idx on public.engine_pairings (expires_at);

alter table public.engine_pairings enable row level security;
revoke all on public.engine_pairings from anon, authenticated;

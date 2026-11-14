-- Bordvakt 012: Statistik, recensioner, mobil-larm, väntelista, svinn och stämpelkort.
-- Kör i Supabase → SQL Editor EFTER 011. Säker att köra flera gånger.
-- Allt läses av restaurangens egen personal. Skrivningar görs bara av servern och AI-motorn.

-- ---------------------------------------------------------------- Sittningar (statistik, bemanning)
-- AI-motorn sparar varje avslutad sittning: när gästerna kom, när de gick och hur många de var.
create table if not exists public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid references public.tables(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  guests int not null default 1 check (guests between 0 and 50),
  created_at timestamptz not null default now()
);
create index if not exists table_sessions_restaurant_idx on public.table_sessions (restaurant_id, started_at desc);

-- ---------------------------------------------------------------- Inställningar
alter table public.restaurants add column if not exists google_review_url text;
alter table public.restaurants add column if not exists guests_per_waiter int not null default 12;
alter table public.restaurants add column if not exists daily_report boolean not null default true;
alter table public.restaurants add column if not exists report_email text;
alter table public.restaurants add column if not exists last_report_day date;  -- morgonrapporten skickas en gång per dag
-- Funktioner som ägaren har stängt av, t.ex. {"entrance": false}. Saknas = på.
alter table public.restaurants add column if not exists features jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- Recensioner
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid references public.tables(id) on delete set null,
  rating int not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists reviews_restaurant_idx on public.reviews (restaurant_id, created_at desc);

-- ---------------------------------------------------------------- Mobil-larm (Web Push)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  tables int[],          -- "mina bord" (bordsnummer). null = alla bord
  label text,            -- t.ex. "Saras mobil"
  lang text not null default 'sv',  -- larmtexternas språk (mobilens valda språk i appen)
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists push_subscriptions_restaurant_idx on public.push_subscriptions (restaurant_id);

-- ---------------------------------------------------------------- Väntelista (Entré)
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  party_size int not null check (party_size between 1 and 50),
  phone text check (phone is null or char_length(phone) <= 40),
  note text check (note is null or char_length(note) <= 300),
  -- WAITING = väntar, NOTIFIED = bordet är klart (gästen har fått veta), SEATED = har fått bord, LEFT = gick
  status text not null default 'WAITING' check (status in ('WAITING', 'NOTIFIED', 'SEATED', 'LEFT')),
  table_id uuid references public.tables(id) on delete set null,
  quoted_minutes int,
  token text not null default replace(gen_random_uuid()::text, '-', ''),  -- gästens länk /w/<kod>
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  seated_at timestamptz
);
create unique index if not exists waitlist_token_idx on public.waitlist (token);
create index if not exists waitlist_active_idx on public.waitlist (restaurant_id, created_at) where status in ('WAITING', 'NOTIFIED');

-- ---------------------------------------------------------------- Svinn
create table if not exists public.waste (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid references public.tables(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  item_name text not null check (char_length(item_name) between 1 and 80),
  qty int not null default 1 check (qty between 1 and 99),
  price numeric(10, 2),
  -- returned = kom tillbaka med mat, remake = ny portion (t.ex. efter SOS), cancelled = makulerad
  reason text not null check (reason in ('returned', 'remake', 'cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists waste_restaurant_idx on public.waste (restaurant_id, created_at desc);

-- ---------------------------------------------------------------- Stämpelkort
create table if not exists public.loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),         -- t.ex. "Var 10:e kaffe gratis"
  menu_item_id uuid references public.menu_items(id) on delete cascade,    -- stämpel för den här rätten ...
  category_id uuid references public.menu_categories(id) on delete cascade, -- ... eller allt i kategorin
  stamps_needed int not null check (stamps_needed between 2 and 50),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.loyalty_cards (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.loyalty_programs(id) on delete cascade,
  card_key text not null check (char_length(card_key) = 32),  -- slumpat id som bara finns i gästens mobil
  stamps int not null default 0,
  updated_at timestamptz not null default now(),
  unique (program_id, card_key)
);
create table if not exists public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.loyalty_cards(id) on delete cascade,
  code text not null,          -- 6 siffror som gästen visar för personalen
  created_at timestamptz not null default now(),
  redeemed_at timestamptz
);
create index if not exists loyalty_rewards_open_idx on public.loyalty_rewards (code) where redeemed_at is null;
-- Beställningar från QR får gästens stämpelkort med sig. Stämplar ges när beställningen är serverad.
alter table public.orders add column if not exists loyalty_key text;
alter table public.orders add column if not exists stamped boolean not null default false;

-- ---------------------------------------------------------------- Läsregler
do $$
declare t text;
begin
  foreach t in array array['table_sessions', 'reviews', 'push_subscriptions', 'waitlist', 'waste', 'loyalty_programs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read %s" on public.%I', t, t);
    execute format('create policy "read %s" on public.%I for select to authenticated using (restaurant_id = public.my_restaurant_id())', t, t);
  end loop;
end $$;
alter table public.loyalty_cards enable row level security;
alter table public.loyalty_rewards enable row level security;  -- bara servern läser dessa
-- Värdens skärm uppdateras direkt när väntelistan ändras
do $$ begin
  alter publication supabase_realtime add table public.waitlist;
exception when duplicate_object or undefined_object then null;
end $$;

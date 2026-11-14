-- Bordvakt 010: Meny och QR-beställning (valfritt).
-- - Ägaren lägger in menyn i installationen (kategorier och rätter).
-- - Varje bord får en hemlig QR-kod. Gästerna beställer från mobilen via /b/<kod>.
-- - Ägaren väljer: QR av, direkt till köket, eller personalen godkänner först.
-- Kör i Supabase → SQL Editor EFTER 009. Säker att köra flera gånger.

-- ---------------------------------------------------------------- Menyn
create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists menu_categories_restaurant_idx on public.menu_categories (restaurant_id, position);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid references public.menu_categories(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  description text check (description is null or char_length(description) <= 300),
  price numeric(10, 2) not null check (price >= 0 and price < 100000),
  allergens text[] not null default '{}',
  available boolean not null default true,  -- false = slut för i dag
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists menu_items_restaurant_idx on public.menu_items (restaurant_id, category_id, position);

-- Personalen får läsa sin egen meny. Skrivningar görs bara av servern.
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
drop policy if exists "read menu_categories" on public.menu_categories;
create policy "read menu_categories" on public.menu_categories
  for select to authenticated using (restaurant_id = public.my_restaurant_id());
drop policy if exists "read menu_items" on public.menu_items;
create policy "read menu_items" on public.menu_items
  for select to authenticated using (restaurant_id = public.my_restaurant_id());

-- ---------------------------------------------------------------- Inställningar
alter table public.restaurants add column if not exists qr_ordering text not null default 'off';
alter table public.restaurants drop constraint if exists restaurants_qr_ordering_check;
alter table public.restaurants add constraint restaurants_qr_ordering_check
  check (qr_ordering in ('off', 'direct', 'approve'));
-- Ägaren har lagt in menyn eller valt att hoppa över steget
alter table public.restaurants add column if not exists menu_step_done boolean not null default false;
alter table public.restaurants add column if not exists currency text not null default 'SEK';

-- ---------------------------------------------------------------- QR-koder
alter table public.tables add column if not exists qr_token text;
alter table public.tables alter column qr_token set default replace(gen_random_uuid()::text, '-', '');
update public.tables set qr_token = replace(gen_random_uuid()::text, '-', '') where qr_token is null;
create unique index if not exists tables_qr_token_idx on public.tables (qr_token);

-- ---------------------------------------------------------------- Beställningar
alter table public.orders add column if not exists source text not null default 'staff';
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check (source in ('staff', 'qr'));
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in (
  'PENDING_APPROVAL', 'RECEIVED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'
));
create index if not exists orders_qr_recent_idx on public.orders (table_id, created_at desc) where source = 'qr';

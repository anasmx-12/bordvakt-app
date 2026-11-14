-- Bordvakt 003: beställningar per bord + fler sorters inredning på kartan.
-- Kör i Supabase SQL Editor EFTER 002. Kan köras flera gånger.

-- ---------------------------------------------------------------- Inredning
alter table public.floor_plan_elements drop constraint if exists floor_plan_elements_kind_check;
alter table public.floor_plan_elements add constraint floor_plan_elements_kind_check check (kind in (
  'wall', 'bar', 'kitchen', 'entrance', 'window', 'plant', 'pillar', 'counter', 'restroom',
  'sofa', 'decor', 'other'
));

-- ---------------------------------------------------------------- Beställningar
-- Livscykel: RECEIVED (mottagen) -> PREPARING (tillagas) -> READY (klar i köket)
--            -> SERVED (serverad) -> COMPLETED (betald/klar). CANCELLED = makulerad.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null references public.tables(id) on delete cascade,
  -- [{ "name": "Pasta", "qty": 2 }, ...]
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  note text,
  status text not null default 'RECEIVED' check (status in (
    'RECEIVED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  served_at timestamptz,
  completed_at timestamptz
);

create index if not exists orders_active_idx on public.orders (restaurant_id, status)
  where status not in ('COMPLETED', 'CANCELLED');
create index if not exists orders_table_idx on public.orders (table_id, created_at desc);

-- Tidsstämplar sätts automatiskt när statusen ändras
create or replace function public.orders_set_times() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if new.status = 'READY' then new.ready_at := coalesce(new.ready_at, now()); end if;
    if new.status = 'SERVED' then new.served_at := coalesce(new.served_at, now()); end if;
    if new.status in ('COMPLETED', 'CANCELLED') then new.completed_at := coalesce(new.completed_at, now()); end if;
  end if;
  return new;
end $$;

drop trigger if exists orders_set_times on public.orders;
create trigger orders_set_times before update on public.orders
  for each row execute function public.orders_set_times();

-- Personalens skärmar får läsa. Skrivningar görs bara av servern (service-nyckeln).
alter table public.orders enable row level security;
drop policy if exists "read orders" on public.orders;
create policy "read orders" on public.orders for select using (true);

-- Realtime: köket och servitörerna ser ändringar direkt
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

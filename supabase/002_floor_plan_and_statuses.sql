-- Bordvakt steg 2: fler bordsstatusar + planritning
-- Kör i Supabase → SQL Editor EFTER schema.sql. Raderar ingen data.

-- 1. Fler bordsstatusar --------------------------------------------------------
--   AVAILABLE           Ledigt
--   OCCUPIED            Gäster äter / sitter
--   AWAITING_FOOD       Gäster väntar på mat (röd)
--   NEEDS_ATTENTION     Gäst söker kontakt med personal (röd)
--   NEEDS_CLEANING      Gästerna har gått, bordet ska dukas av (röd)
--   DESSERT_OPPORTUNITY Tallrikarna är tomma och gästerna sitter kvar (orange)
alter table public.tables drop constraint if exists tables_status_check;
alter table public.tables add constraint tables_status_check check (status in (
  'AVAILABLE', 'OCCUPIED', 'AWAITING_FOOD', 'NEEDS_ATTENTION', 'NEEDS_CLEANING', 'DESSERT_OPPORTUNITY'
));

alter table public.tasks drop constraint if exists tasks_type_check;
alter table public.tasks add constraint tasks_type_check check (type in (
  'CLEANING', 'SERVICE', 'FOOD_DELIVERY', 'DESSERT'
));

-- 2. Planritning --------------------------------------------------------------
-- Alla koordinater är andelar 0–1 av planritningens bredd/höjd (x,y = övre vänstra hörnet).
create table if not exists public.floor_plans (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null default 'Matsal',
  aspect_ratio real not null default 1.5 check (aspect_ratio between 0.2 and 5), -- bredd / höjd
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Högst en aktiv planritning per restaurang
create unique index if not exists floor_plans_one_active
  on public.floor_plans (restaurant_id) where is_active;

-- Inredning: väggar, bar, kök, entré, fönster, växter m.m.
create table if not exists public.floor_plan_elements (
  id uuid primary key default gen_random_uuid(),
  floor_plan_id uuid not null references public.floor_plans(id) on delete cascade,
  kind text not null check (kind in (
    'wall', 'bar', 'kitchen', 'entrance', 'window', 'plant', 'pillar', 'counter', 'restroom', 'other'
  )),
  label text,
  shape text not null default 'rect' check (shape in ('rect', 'round')),
  x real not null check (x between 0 and 1),
  y real not null check (y between 0 and 1),
  w real not null check (w > 0 and w <= 1),
  h real not null check (h > 0 and h <= 1),
  rotation real not null default 0
);
create index if not exists floor_plan_elements_plan_idx on public.floor_plan_elements (floor_plan_id);

-- Bordens plats på planritningen
alter table public.tables
  add column if not exists floor_plan_id uuid references public.floor_plans(id) on delete set null,
  add column if not exists shape text not null default 'square' check (shape in ('round', 'square', 'rect')),
  add column if not exists seats int check (seats between 1 and 30),
  add column if not exists floor_x real check (floor_x between 0 and 1),
  add column if not exists floor_y real check (floor_y between 0 and 1),
  add column if not exists floor_w real check (floor_w > 0 and floor_w <= 1),
  add column if not exists floor_h real check (floor_h > 0 and floor_h <= 1),
  add column if not exists rotation real not null default 0;

-- Bord som skapas från planritningen har ingen kamera än, så kamerarutan får vara tom
alter table public.tables
  alter column roi_x1 drop not null,
  alter column roi_y1 drop not null,
  alter column roi_x2 drop not null,
  alter column roi_y2 drop not null;

-- Läsrätt för webbläsaren, som för övriga tabeller
alter table public.floor_plans enable row level security;
alter table public.floor_plan_elements enable row level security;
drop policy if exists "read floor_plans" on public.floor_plans;
drop policy if exists "read floor_plan_elements" on public.floor_plan_elements;
create policy "read floor_plans" on public.floor_plans for select using (true);
create policy "read floor_plan_elements" on public.floor_plan_elements for select using (true);

-- 3. Spara en planritning i ett svep (allt eller inget) ------------------------
-- p_plan = { name, aspect_ratio, tables: [{table_number, shape, seats, x, y, w, h, rotation}],
--            elements: [{kind, label, shape, x, y, w, h, rotation}] }
-- Befintliga bord med samma nummer behåller sin kamera, status och historik.
create or replace function public.save_floor_plan(p_restaurant_id uuid, p_plan jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_plan_id uuid;
  e jsonb;
  t jsonb;
begin
  update floor_plans set is_active = false where restaurant_id = p_restaurant_id and is_active;

  insert into floor_plans (restaurant_id, name, aspect_ratio)
  values (p_restaurant_id, coalesce(nullif(p_plan->>'name', ''), 'Matsal'), (p_plan->>'aspect_ratio')::real)
  returning id into v_plan_id;

  for e in select * from jsonb_array_elements(coalesce(p_plan->'elements', '[]'::jsonb)) loop
    insert into floor_plan_elements (floor_plan_id, kind, label, shape, x, y, w, h, rotation)
    values (
      v_plan_id, e->>'kind', nullif(e->>'label', ''), coalesce(e->>'shape', 'rect'),
      (e->>'x')::real, (e->>'y')::real, (e->>'w')::real, (e->>'h')::real,
      coalesce((e->>'rotation')::real, 0)
    );
  end loop;

  -- Bord som inte finns med i den nya ritningen tas bort från kartan (men raderas inte)
  update tables
  set floor_plan_id = null, floor_x = null, floor_y = null, floor_w = null, floor_h = null
  where restaurant_id = p_restaurant_id;

  for t in select * from jsonb_array_elements(coalesce(p_plan->'tables', '[]'::jsonb)) loop
    insert into tables (restaurant_id, table_number, shape, seats, floor_plan_id, floor_x, floor_y, floor_w, floor_h, rotation)
    values (
      p_restaurant_id, (t->>'table_number')::int, coalesce(t->>'shape', 'square'), (t->>'seats')::int,
      v_plan_id, (t->>'x')::real, (t->>'y')::real, (t->>'w')::real, (t->>'h')::real,
      coalesce((t->>'rotation')::real, 0)
    )
    on conflict (restaurant_id, table_number) do update set
      shape = excluded.shape,
      seats = excluded.seats,
      floor_plan_id = excluded.floor_plan_id,
      floor_x = excluded.floor_x,
      floor_y = excluded.floor_y,
      floor_w = excluded.floor_w,
      floor_h = excluded.floor_h,
      rotation = excluded.rotation;
  end loop;

  return v_plan_id;
end;
$$;

-- Bara servern (service-nyckeln) får spara planritningar
revoke execute on function public.save_floor_plan(uuid, jsonb) from public, anon, authenticated;

-- Realtime för planritningen, så att alla skärmar uppdateras när admin sparar
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'floor_plans'
  ) then
    alter publication supabase_realtime add table public.floor_plans;
  end if;
end $$;

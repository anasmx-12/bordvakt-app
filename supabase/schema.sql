-- Bordvakt: databasschema för MVP
-- Kör hela filen i Supabase → SQL Editor.
-- OBS: tar bort befintliga Bordvakt-tabeller (även den gamla "tasks") och skapar om dem.
--
-- Relationer:
--   restaurants 1─n camera_feeds
--   restaurants 1─n tables (bord)
--   camera_feeds 1─n tables   (vilken kamera som ser bordet)
--   tables 1─n tasks

drop table if exists public.tasks cascade;
drop table if exists public.tables cascade;
drop table if exists public.camera_feeds cascade;
drop table if exists public.restaurants cascade;

-- Restauranger
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Kameror. stream_url kan vara en RTSP-adress, eller "0" för datorns webbkamera.
create table public.camera_feeds (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  stream_url text not null,
  status text not null default 'OFFLINE' check (status in ('ONLINE', 'OFFLINE')),
  created_at timestamptz not null default now()
);

-- Bord. roi_* är bordets ruta i kamerabilden, som andelar 0–1 av bildens bredd/höjd
-- (så de fungerar oavsett upplösning).
create table public.tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_number int not null,
  area text not null default 'Matsal',
  camera_id uuid references public.camera_feeds(id) on delete set null,
  roi_x1 real not null check (roi_x1 between 0 and 1),
  roi_y1 real not null check (roi_y1 between 0 and 1),
  roi_x2 real not null check (roi_x2 between 0 and 1),
  roi_y2 real not null check (roi_y2 between 0 and 1),
  status text not null default 'AVAILABLE'
    check (status in ('AVAILABLE', 'OCCUPIED', 'NEEDS_CLEANING', 'NEEDS_ATTENTION')),
  last_updated timestamptz not null default now(),
  check (roi_x2 > roi_x1 and roi_y2 > roi_y1),
  unique (restaurant_id, table_number)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(id) on delete cascade,
  type text not null check (type in ('CLEANING', 'SERVICE')),
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index tables_restaurant_idx on public.tables (restaurant_id);
create index camera_feeds_restaurant_idx on public.camera_feeds (restaurant_id);
create index tasks_status_idx on public.tasks (status);

-- Högst en aktiv uppgift av varje typ per bord
create unique index tasks_one_pending_per_type
  on public.tasks (table_id, type) where status = 'PENDING';

-- Behörighet: webbläsaren (anon-nyckeln) får bara läsa.
-- Python-motorn och Next.js API använder service-nyckeln, som går förbi RLS.
alter table public.restaurants enable row level security;
alter table public.camera_feeds enable row level security;
alter table public.tables enable row level security;
alter table public.tasks enable row level security;

create policy "read restaurants" on public.restaurants for select using (true);
create policy "read camera_feeds" on public.camera_feeds for select using (true);
create policy "read tables" on public.tables for select using (true);
create policy "read tasks" on public.tasks for select using (true);

-- Realtime: skicka ändringar till dashboarden
alter publication supabase_realtime add table public.tables, public.tasks, public.camera_feeds;

-- Ingen exempeldata: restaurang, planritning, kameror och bord skapas i
-- appens installationsguide (/setup). Kör sedan 002, 003 och 004 i ordning.

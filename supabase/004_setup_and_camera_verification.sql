-- Bordvakt 004: obligatorisk installation, kamerakalibrering och
-- statusen "Kameran ser inte bordet". Kör i Supabase SQL Editor EFTER 003.
-- Kan köras flera gånger.

-- ------------------------------------------------- Ny status: CAMERA_BLIND
-- AI:n får aldrig gissa. Om kameran inte tydligt ser bordet blir statusen
-- CAMERA_BLIND ("Kameran ser inte bordet") och camera_issue säger varför.
alter table public.tables drop constraint if exists tables_status_check;
alter table public.tables add constraint tables_status_check check (status in (
  'AVAILABLE', 'OCCUPIED', 'AWAITING_FOOD', 'NEEDS_ATTENTION', 'NEEDS_CLEANING',
  'DESSERT_OPPORTUNITY', 'CAMERA_BLIND'
));
alter table public.tables add column if not exists camera_issue text;
-- Nya bord är okontrollerade tills AI:n har sett dem
alter table public.tables alter column status set default 'CAMERA_BLIND';

-- ------------------------------------------------- Kameror
-- Märke (för rätt RTSP-adress) och typ. Adressen flyttas till en egen tabell
-- som webbläsaren inte kan läsa, eftersom den innehåller kamerans lösenord.
alter table public.camera_feeds add column if not exists brand text not null default 'other';
alter table public.camera_feeds drop constraint if exists camera_feeds_brand_check;
alter table public.camera_feeds add constraint camera_feeds_brand_check check (brand in (
  'axis', 'hikvision', 'dahua', 'hanwha', 'other', 'webcam'
));

create table if not exists public.camera_streams (
  camera_id uuid primary key references public.camera_feeds(id) on delete cascade,
  stream_url text not null
);
alter table public.camera_streams enable row level security;
-- Inga policyer: bara servern (service-nyckeln) kommer åt adresserna.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'camera_feeds' and column_name = 'stream_url'
  ) then
    insert into public.camera_streams (camera_id, stream_url)
      select id, stream_url from public.camera_feeds
      on conflict (camera_id) do update set stream_url = excluded.stream_url;
    update public.camera_feeds set brand = 'webcam' where stream_url ~ '^[0-9]+$';
    alter table public.camera_feeds drop column stream_url;
  end if;
end $$;

-- ------------------------------------------------- Kalibrering
-- Vid kalibreringen sparar AI-motorn hur bordet ser ut i kameran ("ankarbild").
-- Under drift jämförs bilden mot den: matchar den inte syns bordet inte.
create table if not exists public.table_calibrations (
  table_id uuid primary key references public.tables(id) on delete cascade,
  camera_id uuid not null references public.camera_feeds(id) on delete cascade,
  roi_x1 real not null,
  roi_y1 real not null,
  roi_x2 real not null,
  roi_y2 real not null,
  anchor_png text not null,  -- liten gråskalebild, base64
  created_at timestamptz not null default now()
);
alter table public.table_calibrations enable row level security;
-- Inga policyer: bara servern och AI-motorn.

-- Flyttas bordets ruta eller byts kamera måste bordet kalibreras om
create or replace function public.tables_reset_calibration() returns trigger
language plpgsql as $$
begin
  if new.camera_id is distinct from old.camera_id
     or new.roi_x1 is distinct from old.roi_x1 or new.roi_y1 is distinct from old.roi_y1
     or new.roi_x2 is distinct from old.roi_x2 or new.roi_y2 is distinct from old.roi_y2 then
    delete from public.table_calibrations where table_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists tables_reset_calibration on public.tables;
create trigger tables_reset_calibration after update on public.tables
  for each row execute function public.tables_reset_calibration();

-- ------------------------------------------------- Installationens läge
-- Används av webbappens spärr och av AI-motorn. Ger bara antal och nummer,
-- inga hemligheter, så den får anropas med den publika nyckeln.
create or replace function public.setup_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_restaurant restaurants%rowtype;
  v_plan_id uuid;
  v_plan_tables int := 0;
  v_cameras int := 0;
  v_unmapped int[] := '{}';
  v_uncalibrated int[] := '{}';
begin
  select * into v_restaurant from restaurants order by created_at limit 1;
  if v_restaurant.id is null then
    return jsonb_build_object('step', 'restaurant', 'complete', false, 'restaurant_name', null,
      'has_floor_plan', false, 'plan_tables', 0, 'cameras', 0, 'unmapped_tables', '[]'::jsonb,
      'uncalibrated_tables', '[]'::jsonb);
  end if;

  select id into v_plan_id from floor_plans
    where restaurant_id = v_restaurant.id and is_active order by created_at desc limit 1;
  select count(*) into v_cameras from camera_feeds where restaurant_id = v_restaurant.id;

  if v_plan_id is not null then
    select count(*) into v_plan_tables from tables where floor_plan_id = v_plan_id;
    select coalesce(array_agg(table_number order by table_number), '{}') into v_unmapped
      from tables
      where floor_plan_id = v_plan_id
        and (camera_id is null or roi_x1 is null or roi_y1 is null or roi_x2 is null or roi_y2 is null);
    select coalesce(array_agg(t.table_number order by t.table_number), '{}') into v_uncalibrated
      from tables t
      where t.floor_plan_id = v_plan_id
        and not exists (select 1 from table_calibrations c where c.table_id = t.id);
  end if;

  return jsonb_build_object(
    'restaurant_name', v_restaurant.name,
    'has_floor_plan', v_plan_id is not null and v_plan_tables > 0,
    'plan_tables', v_plan_tables,
    'cameras', v_cameras,
    'unmapped_tables', to_jsonb(v_unmapped),
    'uncalibrated_tables', to_jsonb(v_uncalibrated),
    'step', case
      when v_plan_id is null or v_plan_tables = 0 then 'floor_plan'
      when v_cameras = 0 then 'cameras'
      when cardinality(v_uncalibrated) > 0 or cardinality(v_unmapped) > 0 then 'calibrate'
      else 'done' end,
    'complete', v_plan_id is not null and v_plan_tables > 0 and v_cameras > 0
      and cardinality(v_unmapped) = 0 and cardinality(v_uncalibrated) = 0
  );
end $$;

revoke all on function public.setup_status() from public;
grant execute on function public.setup_status() to anon, authenticated, service_role;

-- ------------------------------------------------- Inga exempeldata
-- Exempelborden från schema.sql (som inte finns på någon planritning) tas bort,
-- så att appen bara visar bord som admin själv har ritat upp och kalibrerat.
delete from public.tables where floor_plan_id is null;

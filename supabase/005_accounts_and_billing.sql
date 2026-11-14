-- Bordvakt 005: konton, en egen restaurang per kund, och prenumeration (Stripe).
-- Kör i Supabase SQL Editor EFTER 004. Kan köras flera gånger. Raderar ingen data.
--
-- Efter den här filen:
-- - Varje inloggad användare ser BARA sin egen restaurangs data.
-- - Den publika nyckeln (utan inloggning) kan inte läsa något alls längre.
-- - Servern (service-nyckeln) och AI-motorn går förbi reglerna som förut.

-- ---------------------------------------------------------------- Medlemmar
-- Vilken restaurang en användare hör till. MVP: en restaurang per användare.
create table if not exists public.restaurant_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);
create unique index if not exists restaurant_members_one_per_user on public.restaurant_members (user_id);
create index if not exists restaurant_members_restaurant_idx on public.restaurant_members (restaurant_id);

-- ---------------------------------------------------------------- Prenumeration
-- Fylls i av servern när Stripe meddelar ändringar. Användaren får läsa men inte ändra.
alter table public.restaurants
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,     -- Stripes status: trialing, active, past_due, canceled ...
  add column if not exists plan text check (plan in ('month', 'half_year', 'year')),
  add column if not exists trial_ends_at timestamptz,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  -- true = behöver inte betala (t.ex. er egen restaurang som fanns före den här filen)
  add column if not exists billing_exempt boolean not null default false;

-- Restaurangen som fanns innan konton infördes: gratis, och alla befintliga
-- användare kopplas till den (bara om det finns exakt en restaurang).
do $$
declare
  v_id uuid;
begin
  if (select count(*) from public.restaurants) = 1
     and not exists (select 1 from public.restaurant_members) then
    select id into v_id from public.restaurants;
    update public.restaurants set billing_exempt = true where id = v_id;
    insert into public.restaurant_members (user_id, restaurant_id)
      select u.id, v_id from auth.users u
      on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------- Vem är jag?
-- Den inloggades restaurang. security definer: läser medlemstabellen utan att
-- fastna i dess egna regler.
create or replace function public.my_restaurant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select restaurant_id from restaurant_members where user_id = auth.uid() limit 1
$$;
revoke all on function public.my_restaurant_id() from public;
grant execute on function public.my_restaurant_id() to authenticated, service_role;

-- ---------------------------------------------------------------- Läsregler
-- Förut fick alla läsa allt. Nu: bara den egna restaurangens rader.
alter table public.restaurant_members enable row level security;
drop policy if exists "read own membership" on public.restaurant_members;
create policy "read own membership" on public.restaurant_members
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "read restaurants" on public.restaurants;
create policy "read restaurants" on public.restaurants
  for select to authenticated using (id = public.my_restaurant_id());

drop policy if exists "read camera_feeds" on public.camera_feeds;
create policy "read camera_feeds" on public.camera_feeds
  for select to authenticated using (restaurant_id = public.my_restaurant_id());

drop policy if exists "read tables" on public.tables;
create policy "read tables" on public.tables
  for select to authenticated using (restaurant_id = public.my_restaurant_id());

drop policy if exists "read tasks" on public.tasks;
create policy "read tasks" on public.tasks
  for select to authenticated using (exists (
    select 1 from public.tables t where t.id = tasks.table_id and t.restaurant_id = public.my_restaurant_id()
  ));

drop policy if exists "read floor_plans" on public.floor_plans;
create policy "read floor_plans" on public.floor_plans
  for select to authenticated using (restaurant_id = public.my_restaurant_id());

drop policy if exists "read floor_plan_elements" on public.floor_plan_elements;
create policy "read floor_plan_elements" on public.floor_plan_elements
  for select to authenticated using (exists (
    select 1 from public.floor_plans p where p.id = floor_plan_elements.floor_plan_id
      and p.restaurant_id = public.my_restaurant_id()
  ));

drop policy if exists "read orders" on public.orders;
create policy "read orders" on public.orders
  for select to authenticated using (restaurant_id = public.my_restaurant_id());

-- ---------------------------------------------------------------- Installationens läge
-- Gäller nu en viss restaurang: den inloggades, eller (för servern och AI-motorn)
-- den som anges i p_restaurant_id.
drop function if exists public.setup_status();
create or replace function public.setup_status(p_restaurant_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_restaurant restaurants%rowtype;
  v_id uuid;
  v_plan_id uuid;
  v_plan_tables int := 0;
  v_cameras int := 0;
  v_unmapped int[] := '{}';
  v_uncalibrated int[] := '{}';
begin
  -- Bara servern får fråga om en annan restaurang än sin egen
  v_id := case when auth.role() = 'service_role' then p_restaurant_id else public.my_restaurant_id() end;
  select * into v_restaurant from restaurants where id = v_id;
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

revoke all on function public.setup_status(uuid) from public;
grant execute on function public.setup_status(uuid) to authenticated, service_role;

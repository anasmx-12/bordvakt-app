-- 014: Ett eget, begränsat konto för varje restaurangs AI-dator.
-- Kör i Supabase SQL Editor efter 013. Kan köras flera gånger.
--
-- Förut hade AI-datorn service-nyckeln (som går förbi alla regler och når alla restauranger).
-- Nu loggar den in med ett eget konto (roll 'engine') som bara kan:
--   läsa den egna restaurangen, och skriva bordsstatus, kamerastatus, uppgifter,
--   sittningar, kalibreringar och tunnelns adress. Inget annat.
-- Kontot skapas i webbappen: Inställningar → AI-datorn → Skapa kopplingskod.

-- ------------------------------------------------------------ Rollen 'engine'
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.restaurant_members'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.restaurant_members drop constraint %I', c);
  end loop;
end $$;
alter table public.restaurant_members
  add constraint restaurant_members_role_check check (role in ('owner', 'staff', 'engine'));

create or replace function public.is_engine() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from restaurant_members where user_id = auth.uid() and role = 'engine')
$$;
revoke all on function public.is_engine() from public;
grant execute on function public.is_engine() to authenticated, service_role;

-- Borden i den egna restaurangen (för uppgifter och kalibreringar)
create or replace function public.my_table(p_table_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tables where id = p_table_id and restaurant_id = public.my_restaurant_id())
$$;
revoke all on function public.my_table(uuid) from public;
grant execute on function public.my_table(uuid) to authenticated, service_role;

-- ------------------------------------------------------------ Bara vissa kolumner
-- AI-datorn får ändra några få kolumner. Försöker den ändra något annat stoppas det.
create or replace function public.engine_columns_only() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  allowed text[] := tg_argv;
begin
  if public.is_engine()
     and (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'AI-datorn får inte ändra det här';
  end if;
  return new;
end $$;

drop trigger if exists engine_columns_only on public.tables;
create trigger engine_columns_only before update on public.tables
  for each row execute function public.engine_columns_only('status', 'camera_issue', 'last_updated');

drop trigger if exists engine_columns_only on public.camera_feeds;
create trigger engine_columns_only before update on public.camera_feeds
  for each row execute function public.engine_columns_only('status');

drop trigger if exists engine_columns_only on public.tasks;
create trigger engine_columns_only before update on public.tasks
  for each row execute function public.engine_columns_only('status', 'resolved_at');

drop trigger if exists engine_columns_only on public.restaurants;
create trigger engine_columns_only before update on public.restaurants
  for each row execute function public.engine_columns_only('engine_url');

-- engine_url: servern eller restaurangens egen AI-dator (ersätter regeln i 013)
create or replace function public.guard_engine_url() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.engine_url is distinct from old.engine_url
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role', 'supabase_admin')
     and not public.is_engine() then
    raise exception 'engine_url får bara ändras av AI-motorn';
  end if;
  return new;
end $$;

-- ------------------------------------------------------------ Skrivregler
drop policy if exists "engine update restaurant" on public.restaurants;
create policy "engine update restaurant" on public.restaurants for update to authenticated
  using (public.is_engine() and id = public.my_restaurant_id())
  with check (id = public.my_restaurant_id());

drop policy if exists "engine update tables" on public.tables;
create policy "engine update tables" on public.tables for update to authenticated
  using (public.is_engine() and restaurant_id = public.my_restaurant_id())
  with check (restaurant_id = public.my_restaurant_id());

drop policy if exists "engine update camera_feeds" on public.camera_feeds;
create policy "engine update camera_feeds" on public.camera_feeds for update to authenticated
  using (public.is_engine() and restaurant_id = public.my_restaurant_id())
  with check (restaurant_id = public.my_restaurant_id());

drop policy if exists "engine insert tasks" on public.tasks;
create policy "engine insert tasks" on public.tasks for insert to authenticated
  with check (public.is_engine() and public.my_table(table_id));

drop policy if exists "engine update tasks" on public.tasks;
create policy "engine update tasks" on public.tasks for update to authenticated
  using (public.is_engine() and public.my_table(table_id))
  with check (public.my_table(table_id));

drop policy if exists "engine insert table_sessions" on public.table_sessions;
create policy "engine insert table_sessions" on public.table_sessions for insert to authenticated
  with check (public.is_engine() and restaurant_id = public.my_restaurant_id() and public.my_table(table_id));

drop policy if exists "engine read table_calibrations" on public.table_calibrations;
create policy "engine read table_calibrations" on public.table_calibrations for select to authenticated
  using (public.is_engine() and public.my_table(table_id));

drop policy if exists "engine insert table_calibrations" on public.table_calibrations;
create policy "engine insert table_calibrations" on public.table_calibrations for insert to authenticated
  with check (public.is_engine() and public.my_table(table_id));

drop policy if exists "engine update table_calibrations" on public.table_calibrations;
create policy "engine update table_calibrations" on public.table_calibrations for update to authenticated
  using (public.is_engine() and public.my_table(table_id))
  with check (public.my_table(table_id));

-- Kamerornas adresser (med lösenord) läses bara av den egna AI-datorn, aldrig av webbläsaren
drop policy if exists "engine read camera_streams" on public.camera_streams;
create policy "engine read camera_streams" on public.camera_streams for select to authenticated
  using (
    public.is_engine()
    and exists (select 1 from camera_feeds f where f.id = camera_id and f.restaurant_id = public.my_restaurant_id())
  );

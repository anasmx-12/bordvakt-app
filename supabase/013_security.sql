-- 013: Säker koppling till AI-motorn och extra skydd.
-- Kör i Supabase SQL Editor efter 012.

-- Adressen till restaurangens AI-motor (tunnelns https-adress). Skrivs bara av AI.py.
alter table public.restaurants add column if not exists engine_url text;

-- Bara servern (service-nyckeln) får ändra adressen, aldrig en inloggad användare.
-- Annars skulle någon kunna styra om webbappens anrop till en egen server.
create or replace function public.guard_engine_url() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.engine_url is distinct from old.engine_url
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'engine_url får bara ändras av AI-motorn';
  end if;
  return new;
end $$;

drop trigger if exists guard_engine_url on public.restaurants;
create trigger guard_engine_url before update on public.restaurants
  for each row execute function public.guard_engine_url();

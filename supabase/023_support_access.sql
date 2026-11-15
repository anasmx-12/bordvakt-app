-- 023: Supporten får se kundens app i läsläge, bara när kunden har godkänt det.
-- Supporten ber om åtkomst (med en anledning). Ägaren godkänner i appen (1 timme) eller nekar.
-- Ägaren kan avsluta när som helst. Allt supporten tittar på loggas i support_audit.
-- Bara webbappens server (service-nyckeln) läser och skriver tabellen. Kör efter 019.

create table if not exists public.support_access (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  requested_by uuid,                        -- supportpersonalen (support_staff.user_id)
  requested_by_name text not null,
  reason text not null check (char_length(reason) between 5 and 300),
  requested_at timestamptz not null default now(),
  approved_by uuid,                         -- ägaren som godkände
  approved_at timestamptz,
  expires_at timestamptz,                   -- åtkomsten slutar (sätts när ägaren godkänner)
  ended_at timestamptz                      -- nekad, avslutad av ägaren, eller ersatt
);
create index if not exists support_access_restaurant_idx on public.support_access (restaurant_id, requested_at desc);

alter table public.support_access enable row level security;
revoke all on public.support_access from anon, authenticated;

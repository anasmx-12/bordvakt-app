-- 017: BankID används inte längre (namnet jämförs med kortet i stället, se web/lib/cardName.ts).
-- Tar bort BankID-tabellerna från 016. Kör i Supabase SQL Editor. Kan köras flera gånger.
drop table if exists public.bankid_orders;
drop table if exists public.bankid_identities;

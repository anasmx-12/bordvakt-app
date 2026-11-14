-- 006: fler kameramärken och "mobilen som kamera" i installationen.
-- Kör i Supabase → SQL Editor. Säker att köra flera gånger.
-- Utan den här filen fungerar allt ändå, men nya märken sparas som "other".

alter table public.camera_feeds drop constraint if exists camera_feeds_brand_check;
alter table public.camera_feeds add constraint camera_feeds_brand_check check (brand in (
  'axis', 'hikvision', 'dahua', 'hanwha', 'reolink', 'uniview', 'tplink',
  'foscam', 'amcrest', 'unifi', 'other', 'webcam', 'phone'
));

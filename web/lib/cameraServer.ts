import 'server-only';
import { UserError } from './server';
import { CameraBrand } from './types';

const BRAND_IDS: CameraBrand[] = [
  'axis',
  'hikvision',
  'dahua',
  'hanwha',
  'reolink',
  'uniview',
  'tplink',
  'foscam',
  'amcrest',
  'unifi',
  'other',
  'webcam',
  'phone',
];

/** Märken som fanns innan supabase/006_camera_types.sql. Andra sparas som "other" tills den körts. */
export const LEGACY_BRANDS: CameraBrand[] = ['axis', 'hikvision', 'dahua', 'hanwha', 'other', 'webcam'];

export function cleanCamera(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
  const brand = BRAND_IDS.includes(b.brand as CameraBrand) ? (b.brand as CameraBrand) : 'other';
  const url = typeof b.stream_url === 'string' ? b.stream_url.trim().slice(0, 500) : '';
  return { name, brand, url };
}

export function checkUrl(url: string) {
  if (!url) throw new UserError('Ange kamerans adress');
  if (!/^\d+$/.test(url) && !/^(rtsps?|https?):\/\//i.test(url)) {
    throw new UserError('Adressen ska börja med rtsp://, rtsps:// eller http:// (eller vara ett nummer för webbkamera)');
  }
}

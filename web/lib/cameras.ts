import { CameraBrand } from './types';

/** Vilken sorts kamera: avgör vilka fält som visas i installationen. */
export type CameraKind = 'ip' | 'nvr' | 'usb' | 'phone';
/** Hur bilden hämtas från kameran. */
export type Connection = 'rtsp' | 'rtsps' | 'http' | 'custom';

export interface CameraForm {
  kind: CameraKind;
  brand: CameraBrand;
  connection: Connection;
  ip: string;
  port: string;
  user: string;
  password: string;
  channel: string;
  /** Egen adress (Egen adress / Annan) eller webbkamerans nummer (USB) */
  custom: string;
}

export const KINDS: { id: CameraKind; label: string; hint: string }[] = [
  { id: 'ip', label: 'IP-kamera', hint: 'En nätverkskamera med egen IP-adress, kopplad med kabel eller wifi.' },
  {
    id: 'nvr',
    label: 'Inspelare (NVR/DVR)',
    hint: 'Kamerorna sitter i en inspelningsbox. Ange boxens IP-adress och kamerans kanal.',
  },
  { id: 'usb', label: 'USB-/webbkamera', hint: 'En kamera som sitter i eller är inkopplad i datorn som kör AI-motorn.' },
  {
    id: 'phone',
    label: 'Mobilen som kamera',
    hint: 'En gammal mobil med en IP-kamera-app, t.ex. "IP Webcam" (Android). Appen visar adressen.',
  },
];

interface BrandInfo {
  id: CameraBrand;
  label: string;
  hint: string;
  /** Finns som inspelare (NVR/DVR) */
  nvr?: boolean;
  /** Sökväg för RTSP (och RTSPS). Saknas = bara egen adress. */
  rtsp?: (ch: number) => string;
  /** Sökväg för MJPEG över HTTP, om kameran har det */
  http?: (ch: number) => string;
  rtspPort?: number;
  httpPort?: number;
}

export const BRANDS: BrandInfo[] = [
  {
    id: 'axis',
    label: 'Axis',
    hint: 'Standardanvändare: root.',
    rtsp: () => '/axis-media/media.amp',
    http: () => '/axis-cgi/mjpg/video.cgi',
  },
  {
    id: 'hikvision',
    label: 'Hikvision',
    hint: 'Standardanvändare: admin. Kanal 1 = första kameran.',
    nvr: true,
    rtsp: (ch) => `/Streaming/Channels/${ch}01`,
    http: (ch) => `/ISAPI/Streaming/channels/${ch}02/httpPreview`,
  },
  {
    id: 'dahua',
    label: 'Dahua',
    hint: 'Standardanvändare: admin.',
    nvr: true,
    rtsp: (ch) => `/cam/realmonitor?channel=${ch}&subtype=0`,
    http: (ch) => `/cgi-bin/mjpg/video.cgi?channel=${ch}&subtype=1`,
  },
  {
    id: 'hanwha',
    label: 'Hanwha (Wisenet)',
    hint: 'Standardanvändare: admin.',
    nvr: true,
    rtsp: (ch) => (ch > 1 ? `/${ch - 1}/profile2/media.smp` : '/profile2/media.smp'),
  },
  {
    id: 'reolink',
    label: 'Reolink',
    hint: 'Standardanvändare: admin. Slå på RTSP i appen under Nätverk → Avancerat → Porttjänster.',
    nvr: true,
    rtsp: (ch) => `/h264Preview_${String(ch).padStart(2, '0')}_main`,
  },
  {
    id: 'uniview',
    label: 'Uniview (UNV)',
    hint: 'Standardanvändare: admin.',
    nvr: true,
    rtsp: (ch) => `/unicast/c${ch}/s0/live`,
  },
  {
    id: 'tplink',
    label: 'TP-Link Tapo / VIGI',
    hint: 'Skapa ett "kamerakonto" i Tapo-appen (Avancerade inställningar) och använd det här.',
    rtsp: () => '/stream1',
  },
  {
    id: 'foscam',
    label: 'Foscam',
    hint: 'Port 88 på de flesta modeller.',
    rtsp: () => '/videoMain',
    rtspPort: 88,
  },
  {
    id: 'amcrest',
    label: 'Amcrest',
    hint: 'Standardanvändare: admin.',
    nvr: true,
    rtsp: (ch) => `/cam/realmonitor?channel=${ch}&subtype=0`,
    http: (ch) => `/cgi-bin/mjpg/video.cgi?channel=${ch}&subtype=1`,
  },
  {
    id: 'unifi',
    label: 'Ubiquiti UniFi Protect',
    hint: 'Slå på RTSP för kameran i UniFi Protect och klistra in adressen (rtsps://…:7441/…).',
  },
  { id: 'other', label: 'Annat märke', hint: 'Klistra in kamerans hela adress från manualen eller kamerans app.', nvr: true },
];

export const CONNECTIONS: { id: Connection; label: string; hint: string }[] = [
  { id: 'rtsp', label: 'RTSP (rekommenderas)', hint: 'Fungerar med nästan alla kameror. Bäst bild.' },
  { id: 'rtsps', label: 'RTSPS (krypterad)', hint: 'Som RTSP men krypterad. Måste vara påslaget i kameran.' },
  { id: 'http', label: 'HTTP / MJPEG', hint: 'Enklare och fungerar genom fler nätverk, men sämre bild.' },
  { id: 'custom', label: 'Egen adress', hint: 'Klistra in en färdig adress som börjar med rtsp://, rtsps:// eller http://.' },
];

export const brandInfo = (id: CameraBrand) => BRANDS.find((b) => b.id === id) ?? BRANDS[BRANDS.length - 1];

/** Märken som passar kameratypen. */
export const brandsFor = (kind: CameraKind) => (kind === 'nvr' ? BRANDS.filter((b) => b.nvr) : BRANDS);

/** Anslutningar som märket klarar. "Egen adress" finns alltid. */
export function connectionsFor(brand: CameraBrand): Connection[] {
  const b = brandInfo(brand);
  return CONNECTIONS.map((c) => c.id).filter(
    (c) => c === 'custom' || ((c === 'rtsp' || c === 'rtsps') && b.rtsp) || (c === 'http' && b.http)
  );
}

export function defaultPort(form: Pick<CameraForm, 'kind' | 'brand' | 'connection'>): string {
  if (form.kind === 'phone') return '8080';
  const b = brandInfo(form.brand);
  if (form.connection === 'rtsps') return '322';
  if (form.connection === 'http') return String(b.httpPort ?? 80);
  return String(b.rtspPort ?? 554);
}

/** true när formuläret visar ett fält för en färdig adress i stället för IP, port osv. */
export const usesCustomAddress = (f: CameraForm) =>
  f.kind !== 'usb' && f.kind !== 'phone' && (f.connection === 'custom' || connectionsFor(f.brand).length === 1);

/** Märket som sparas i databasen. */
export const savedBrand = (f: CameraForm): CameraBrand =>
  f.kind === 'usb' ? 'webcam' : f.kind === 'phone' ? 'phone' : f.brand;

/** Bygger kamerans adress. Användare och lösenord kodas så att specialtecken fungerar. */
export function buildStreamUrl(f: CameraForm): string {
  if (f.kind === 'usb') return f.custom.trim() || '0';
  if (usesCustomAddress(f)) return f.custom.trim();

  const ip = f.ip.trim().replace(/^\w+:\/\//, '').replace(/\/.*$/, '');
  if (!ip) return '';
  const auth = f.user ? `${encodeURIComponent(f.user)}:${encodeURIComponent(f.password)}@` : '';
  const host = `${auth}${ip}:${f.port.trim() || defaultPort(f)}`;

  if (f.kind === 'phone') return `http://${host}/video`;

  const ch = Math.max(1, Number(f.channel) || 1);
  const b = brandInfo(f.brand);
  if (f.connection === 'http' && b.http) return `http://${host}${b.http(ch)}`;
  if (b.rtsp) return `${f.connection === 'rtsps' ? 'rtsps' : 'rtsp'}://${host}${b.rtsp(ch)}`;
  return '';
}

/** Döljer lösenordet: rtsp://admin:•••@192.168.1.20:554/... */
export function maskStreamUrl(url: string): string {
  return url.replace(/^(\w+:\/\/[^:/@]+:)[^@]*@/, '$1•••@');
}

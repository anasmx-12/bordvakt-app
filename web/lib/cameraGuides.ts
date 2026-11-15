// Kameraguiden: steg-för-steg per märke, och typerna för svaren från AI-datorn.
// Granska mot tillverkarens manual innan lansering.
// Inga texter här skrivs av AI:n: de är fasta och gäller märket, inte en gissad modell.

import type { CameraBrand } from './types';

export interface CameraGuide {
  brand: CameraBrand;
  /** Appen eller programmet där kameran ställs in */
  app: string;
  /** Hur man hittar kamerans IP-adress */
  findIp: string[];
  /** Hur man slår på video till andra program (RTSP och ONVIF) */
  enableStream: string[];
  /** Användarnamnet som brukar gälla */
  user: string;
  note?: string;
}

const ROUTER = 'Eller öppna routerns sida (ofta 192.168.1.1) och leta i listan över anslutna enheter efter kamerans namn.';

export const CAMERA_GUIDES: Record<CameraBrand, CameraGuide> = {
  hikvision: {
    brand: 'hikvision',
    app: 'Hik-Connect (mobil) eller SADP (dator)',
    findIp: ['Öppna programmet SADP på en dator i samma nät: det listar alla Hikvision-kameror med IP-adress.', ROUTER],
    enableStream: [
      'Öppna kamerans IP-adress i en webbläsare och logga in.',
      'Konfiguration → Nätverk → Avancerade inställningar → Integrationsprotokoll: kryssa i "Aktivera Open Network Video Interface".',
      'Lägg till en ONVIF-användare med samma lösenord, eller använd admin-kontot.',
    ],
    user: 'admin',
    note: 'Lösenordet är det du valde första gången kameran aktiverades. Ibland står en verifieringskod på etiketten: den är inte lösenordet.',
  },
  dahua: {
    brand: 'dahua',
    app: 'DMSS (mobil) eller ConfigTool (dator)',
    findIp: ['Öppna ConfigTool på en dator i samma nät: det listar alla Dahua-kameror.', ROUTER],
    enableStream: [
      'Öppna kamerans IP-adress i en webbläsare och logga in.',
      'Inställningar → Nätverk → Port: kontrollera att RTSP är på (port 554).',
      'Inställningar → Nätverk → Plattformsåtkomst → ONVIF: slå på.',
    ],
    user: 'admin',
  },
  amcrest: {
    brand: 'amcrest',
    app: 'Amcrest View Pro',
    findIp: ['I Amcrest View Pro: tryck på kameran → Enhetsinformation.', ROUTER],
    enableStream: ['Öppna kamerans IP-adress i en webbläsare och logga in.', 'Inställningar → Nätverk → Anslutning: kontrollera att RTSP är på (port 554).'],
    user: 'admin',
  },
  reolink: {
    brand: 'reolink',
    app: 'Reolink-appen',
    findIp: ['I Reolink-appen: tryck på kugghjulet → Info om enheten (eller Nätverksinformation).', ROUTER],
    enableStream: ['Inställningar → Nätverk → Avancerat → Portinställningar.', 'Slå på RTSP och ONVIF och spara.'],
    user: 'admin',
    note: 'Batterikameror (Argus) har ingen RTSP och fungerar inte med Bordvakt. Välj en kamera med ström via kabel.',
  },
  axis: {
    brand: 'axis',
    app: 'AXIS IP Utility (dator)',
    findIp: ['Öppna AXIS IP Utility på en dator i samma nät: det listar alla Axis-kameror.', ROUTER],
    enableStream: ['RTSP är påslaget från början på Axis-kameror.', 'Om ONVIF behövs: System → ONVIF → lägg till en användare.'],
    user: 'root',
  },
  hanwha: {
    brand: 'hanwha',
    app: 'Wisenet Device Manager (dator) eller Wisenet-appen',
    findIp: ['Öppna Wisenet Device Manager på en dator i samma nät.', ROUTER],
    enableStream: ['Öppna kamerans IP-adress i en webbläsare och logga in.', 'Nätverk → RTSP och ONVIF: kontrollera att båda är på.'],
    user: 'admin',
  },
  uniview: {
    brand: 'uniview',
    app: 'EZView (mobil) eller EZTools (dator)',
    findIp: ['Öppna EZTools på en dator i samma nät.', ROUTER],
    enableStream: ['Öppna kamerans IP-adress i en webbläsare och logga in.', 'Inställningar → Nätverk → Port: kontrollera att RTSP är på (554).'],
    user: 'admin',
  },
  tplink: {
    brand: 'tplink',
    app: 'Tapo-appen (Tapo) eller VIGI-appen (VIGI)',
    findIp: ['I appen: tryck på kameran → kugghjulet → Enhetsinformation → IP-adress.'],
    enableStream: [
      'Tapo: kugghjulet → Avancerade inställningar → Kamerakonto. Skapa ett användarnamn och lösenord där.',
      'VIGI: RTSP och ONVIF är påslagna. Logga in med kontot du skapade när kameran installerades.',
    ],
    user: 'kontot från Kamerakonto',
    note: 'Tapo: använd användarnamnet och lösenordet från Kamerakonto, inte ditt TP-Link-konto.',
  },
  foscam: {
    brand: 'foscam',
    app: 'Foscam-appen',
    findIp: ['I Foscam-appen: kameran → Inställningar → Enhetsinformation.', ROUTER],
    enableStream: ['Videoadressen använder port 88 som standard. Den ändras under Nätverk → Port om det behövs.'],
    user: 'admin',
  },
  unifi: {
    brand: 'unifi',
    app: 'UniFi Protect',
    findIp: ['Kamerorna kopplas via UniFi Protect, inte direkt.'],
    enableStream: [
      'UniFi Protect → kameran → Inställningar → Avancerat → RTSP: slå på den högsta kvaliteten.',
      'Kopiera adressen (rtsps://…:7441/…) och klistra in den under "Ange adressen själv".',
    ],
    user: '–',
    note: 'UniFi-kameror hittas inte automatiskt. Använd adressen från Protect.',
  },
  other: {
    brand: 'other',
    app: 'kamerans egen app eller webbsida',
    findIp: [ROUTER, 'Många kameror visar IP-adressen i sin app under Enhetsinformation.'],
    enableStream: ['Leta efter RTSP eller ONVIF i kamerans inställningar och slå på dem.', 'Sök på "kamerans modell RTSP" för att hitta videoadressen i manualen.'],
    user: 'admin',
  },
  webcam: { brand: 'webcam', app: '–', findIp: [], enableStream: ['Koppla in webbkameran i AI-datorn med USB.'], user: '–' },
  phone: { brand: 'phone', app: 'IP Webcam (Android) eller liknande', findIp: ['Appen visar adressen när den startar.'], enableStream: [], user: '–' },
};

export const guideFor = (brand: CameraBrand | null): CameraGuide => CAMERA_GUIDES[brand ?? 'other'] ?? CAMERA_GUIDES.other;

/** Samma som default_user i camera_discovery.py */
export const defaultUser = (brand: CameraBrand | null): string => (brand === 'axis' ? 'root' : 'admin');

// ------------------------------------------------------------- Svar från AI-datorn

export interface FoundCamera {
  ip: string;
  onvif_url: string | null;
  ports: number[];
  brand: CameraBrand | null;
  model: string | null;
}

export type PlacementTip = 'too_dark' | 'blurry' | 'no_tables' | 'few_tables' | 'too_low';

export interface Placement {
  tables_seen: number;
  chairs_seen: number;
  boxes: [number, number, number, number][];
  plan_tables: number;
  tips: PlacementTip[];
}

export interface ConnectedChannel {
  channel: number;
  stream_url: string;
  preview: string | null;
  warning: string | null;
  placement: Placement | null;
}

export type ConnectResult =
  | { ok: true; brand: CameraBrand | null; model: string | null; channels: ConnectedChannel[] }
  | { ok: false; reason: 'auth' | 'no_stream' | 'unreachable'; error: string };

export const TIP_TEXT: Record<PlacementTip, string> = {
  too_dark: 'Bilden är för mörk. Tänd i lokalen eller välj en kamera med bättre mörkerseende.',
  blurry: 'Bilden är suddig. Torka av linsen och kontrollera fokus.',
  no_tables: 'Kameran ser inga bord. Vrid den mot matsalen.',
  few_tables: 'Kameran ser färre än hälften av borden. Sätt den högre eller i ett hörn, eller lägg till en kamera till.',
  too_low: 'Kameran sitter för lågt eller pekar för långt ned. Sätt den högre upp (helst 2,5–3 m) och vinkla ned mot borden.',
};

// ------------------------------------------------------------- Etiketter
// Samma mönster som brand_from_text i camera_discovery.py: modellnumret först, sedan märkesnamnet.

const MODELS: [RegExp, CameraBrand][] = [
  [/DS-?2CD[0-9A-Z-]+|DS-?[0-9A-Z]{2,}-[0-9A-Z-]+/, 'hikvision'],
  [/(?:IPC|HAC|SD|DH)-[A-Z]{2,}[0-9A-Z-]*/, 'dahua'],
  [/RLC-?[0-9A-Z]+|E1 ?(?:PRO|ZOOM|OUTDOOR)?|ARGUS ?[0-9A-Z]*/, 'reolink'],
  [/AXIS [A-Z][0-9]{3,4}[0-9A-Z-]*(?: MK ?I+)?/, 'axis'],
  [/UVC-?[0-9A-Z-]+/, 'unifi'],
  [/(?:TAPO|VIGI) ?C[0-9]{3}[0-9A-Z-]*/, 'tplink'],
  [/(?:XNV|XND|XNO|QNV|QND|QNO|PNM|PNV|PND|ANV|ANO)-?[0-9A-Z-]+/, 'hanwha'],
  [/IPC[0-9]{3}[0-9A-Z-]*/, 'uniview'],
  [/IP[0-9]M-[0-9A-Z-]+/, 'amcrest'],
  [/FI[0-9]{4}[A-Z]*/, 'foscam'],
];
const NAMES: [string, CameraBrand][] = [
  ['HIKVISION', 'hikvision'], ['DAHUA', 'dahua'], ['REOLINK', 'reolink'], ['AXIS', 'axis'], ['UBIQUITI', 'unifi'],
  ['UNIFI', 'unifi'], ['TP-LINK', 'tplink'], ['TAPO', 'tplink'], ['HANWHA', 'hanwha'], ['WISENET', 'hanwha'],
  ['SAMSUNG', 'hanwha'], ['UNIVIEW', 'uniview'], ['UNV', 'uniview'], ['AMCREST', 'amcrest'], ['FOSCAM', 'foscam'],
];

/** Märke och modell från det användaren skrivit. */
export function brandFromText(text: string): { brand: CameraBrand | null; model: string | null } {
  const t = text.replace(/[‐-―−]/g, '-').toUpperCase();
  for (const [pattern, brand] of MODELS) {
    const m = new RegExp(`(?<![0-9A-Z])(?:${pattern.source})`).exec(t);
    if (m) return { brand, model: m[0].trim() };
  }
  for (const [name, brand] of NAMES) {
    if (new RegExp(`(?<![0-9A-Z])${name.replace(/-/g, '\\-')}(?![0-9A-Z])`).test(t)) return { brand, model: null };
  }
  return { brand: null, model: null };
}

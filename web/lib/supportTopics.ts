// Vad ett supportärende kan gälla (delas av appen och servern)
export const SUPPORT_TOPICS = {
  qr: 'QR-koder: skriva ut och sätta upp vid borden',
  cameras: 'Kameror: montering, nätverk eller bild',
  calibrate: 'Kalibrering av borden',
  floor_plan: 'Planritningen',
  menu: 'Menyn',
  billing: 'Betalning och abonnemang',
  other: 'Något annat',
} as const;
export type SupportTopic = keyof typeof SUPPORT_TOPICS;
export const isTopic = (v: unknown): v is SupportTopic => typeof v === 'string' && v in SUPPORT_TOPICS;

export const SUPPORT_STATUS: Record<string, { label: string; chip: string }> = {
  NEW: { label: 'Skickat', chip: 'bg-blue-50 text-blue-800' },
  OPEN: { label: 'Supporten jobbar med det', chip: 'bg-blue-50 text-blue-800' },
  WAITING_CUSTOMER: { label: 'Väntar på ditt svar', chip: 'bg-amber-100 text-amber-900' },
  DATE_PROPOSED: { label: 'Välj en dag', chip: 'bg-violet-100 text-violet-800' },
  SCHEDULED: { label: 'Bokad', chip: 'bg-teal text-white' },
  DONE: { label: 'Klart', chip: 'bg-gray-100 text-gray-600' },
  CLOSED: { label: 'Stängt', chip: 'bg-gray-100 text-gray-500' },
};

// Funktioner som ägaren kan stänga av (Inställningar → Anpassa funktioner).
// Sparas i restaurants.features som { id: true/false }. Saknas ett val gäller standarden:
// allt är på, utom tillvalen (Entré och Statistik) som restaurangen väljer i installationen.

export type FeatureId =
  | 'kitchen'
  | 'entrance'
  | 'stats'
  | 'push'
  | 'sos'
  | 'dessert'
  | 'bill'
  | 'reviews'
  | 'loyalty'
  | 'upsell'
  | 'prep_times'
  | 'waste';

export type Features = Partial<Record<FeatureId, boolean>>;

export interface FeatureInfo {
  id: FeatureId;
  group: 'pages' | 'ai' | 'guests' | 'kitchen';
  title: string;
  text: string;
}

/** Ägarsidan är på svenska, som resten av installationen. */
export const FEATURES: FeatureInfo[] = [
  { id: 'kitchen', group: 'pages', title: 'Kök', text: 'Köksskärmen där köket ser beställningarna. Stäng av om köket inte har någon skärm.' },
  { id: 'entrance', group: 'pages', title: 'Entré (väntelista)', text: 'Kön vid dörren, med QR-kod till gästen och larm när ett bord blir ledigt.' },
  { id: 'stats', group: 'pages', title: 'Statistik och morgonrapport', text: 'Siffror om gäster, väntetider och försäljning, och mejlet kl. 07.' },
  { id: 'push', group: 'pages', title: 'Mobil-larm', text: 'Personalens mobiler plingar även när appen är stängd.' },
  { id: 'sos', group: 'ai', title: 'Akut läge (SOS)', text: 'AI:n larmar när något tappas, spills eller någon ramlar.' },
  { id: 'dessert', group: 'ai', title: 'Dags för dessert', text: 'AI:n säger till när gästerna ätit klart och kan vilja ha dessert eller kaffe.' },
  { id: 'bill', group: 'ai', title: 'Väntar på notan', text: 'AI:n säger till när gästerna troligen vill betala.' },
  { id: 'reviews', group: 'guests', title: 'Betyg från gästerna', text: 'Stjärnor på QR-sidan. Nöjda gäster skickas till Google.' },
  { id: 'loyalty', group: 'guests', title: 'Stämpelkort', text: 'T.ex. var 10:e kaffe gratis.' },
  { id: 'upsell', group: 'guests', title: 'Förslag till gästen', text: 'QR-sidan föreslår dryck, tillbehör och dessert.' },
  { id: 'prep_times', group: 'kitchen', title: 'Matens väntetid', text: '"Ca 12 min" vid rätterna och varning när en beställning är sen.' },
  { id: 'waste', group: 'kitchen', title: 'Svinn', text: 'Knappen "Kom tillbaka" och räkning av mat som slängs.' },
];

export const FEATURE_GROUPS: Record<FeatureInfo['group'], string> = {
  pages: 'Sidor',
  ai: 'AI:ns larm',
  guests: 'För gästerna (QR-sidan)',
  kitchen: 'Kök och servering',
};

export const FEATURE_IDS = FEATURES.map((f) => f.id);

/** Tillval: av tills restaurangen väljer dem (Installation → Tillval). */
export const OPT_IN: FeatureId[] = ['entrance', 'stats'];

export const isOn = (features: Features | null | undefined, id: FeatureId) => {
  const value = features?.[id];
  return value === undefined ? !OPT_IN.includes(id) : value !== false;
};

/** Har restaurangen tagit ställning till alla tillval? */
export const optInChosen = (features: Features | null | undefined) => OPT_IN.every((id) => typeof features?.[id] === 'boolean');

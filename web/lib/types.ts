export type TableStatus =
  | 'AVAILABLE'
  | 'OCCUPIED'
  | 'AWAITING_FOOD'
  | 'NEEDS_ATTENTION'
  | 'NEEDS_CLEANING'
  | 'DESSERT_OPPORTUNITY'
  /** AI:n kan inte bekräfta bordet i kamerabilden: ingen status gissas */
  | 'CAMERA_BLIND'
  /** Akut läge (SOS): en gäst har tappat ett glas eller en tallrik. Ligger kvar tills personalen trycker Klar. */
  | 'EMERGENCY'
  /** Gästerna har ätit klart och vill troligen betala */
  | 'WANTS_BILL';
export type TaskType = 'EMERGENCY' | 'CLEANING' | 'SERVICE' | 'FOOD_DELIVERY' | 'DESSERT' | 'BILL';
export type TableShape = 'round' | 'square' | 'rect';

export interface DiningTable {
  id: string;
  restaurant_id: string;
  table_number: number;
  area: string;
  camera_id: string | null;
  // Bordets ruta i kamerabilden (tom om bordet saknar kamera)
  roi_x1: number | null;
  roi_y1: number | null;
  roi_x2: number | null;
  roi_y2: number | null;
  status: TableStatus;
  /** Varför kameran inte ser bordet (bara när status = CAMERA_BLIND) */
  camera_issue: string | null;
  last_updated: string;
  // Bordets plats på planritningen (tom om bordet inte finns på ritningen)
  floor_plan_id: string | null;
  shape: TableShape;
  seats: number | null;
  floor_x: number | null;
  floor_y: number | null;
  floor_w: number | null;
  floor_h: number | null;
  rotation: number;
}

export interface Task {
  id: string;
  table_id: string;
  type: TaskType;
  status: 'PENDING' | 'COMPLETED';
  created_at: string;
  resolved_at: string | null;
  // Bara för SOS (finns när supabase/008_sos_details.sql är körd)
  /** AI:ns förklaring (svenska, för loggen) */
  detail?: string | null;
  /** Vad som tappades */
  sos_kind?: SosKind | null;
  /** Tecknet som fick AI:n att larma */
  sos_trigger?: SosTrigger | null;
  false_alarm?: boolean;
  /** Kökets svar när mat tappats */
  kitchen_status?: 'PENDING' | 'REMAKING' | 'NOT_NEEDED' | null;
}

export type SosKind = 'drink' | 'food' | 'cutlery' | 'spill';
export type SosTrigger = 'floor' | 'tipped' | 'bend' | 'stand';

export interface CameraFeed {
  id: string;
  restaurant_id: string;
  name: string;
  /** Kameramärke. Adressen (med lösenord) ligger i en tabell som webbläsaren inte kan läsa. */
  brand: CameraBrand;
  status: 'ONLINE' | 'OFFLINE';
}

export type CameraBrand =
  | 'axis'
  | 'hikvision'
  | 'dahua'
  | 'hanwha'
  | 'reolink'
  | 'uniview'
  | 'tplink'
  | 'foscam'
  | 'amcrest'
  | 'unifi'
  | 'other'
  | 'webcam'
  | 'phone';

export type StatusLevel = 'normal' | 'alert' | 'opportunity' | 'request' | 'error';

// Färg och text per bordsstatus. Hela klassnamn så att Tailwind hittar dem.
// Röd = något måste göras nu. Orange = läge att sälja dessert/kaffe.
// Grå randig = kameran ser inte bordet, så AI:n vet ingenting om det.
// box = ruta över videon, tile = bordskartan, chip = liten etikett, table = bordet på planritningen
export const STATUS_STYLE: Record<
  TableStatus,
  { label: string; level: StatusLevel; box: string; tile: string; chip: string; dot: string; table: string }
> = {
  AVAILABLE: {
    label: 'Ledigt',
    level: 'normal',
    box: 'border-emerald-400 bg-emerald-400/10',
    tile: 'border-[#B9DAD4] bg-teal-light',
    chip: 'bg-teal text-white',
    dot: 'bg-teal',
    table: 'border-[#7DBDB4] bg-teal-light text-[#0F5C55]',
  },
  OCCUPIED: {
    label: 'Upptaget',
    level: 'normal',
    box: 'border-blue-400 bg-blue-400/10',
    tile: 'border-blue-200 bg-blue-50',
    chip: 'bg-blue-700 text-white',
    dot: 'bg-blue-700',
    table: 'border-blue-300 bg-blue-50 text-blue-900',
  },
  AWAITING_FOOD: {
    label: 'Väntar på mat',
    level: 'alert',
    box: 'border-red-500 bg-red-500/20',
    tile: 'border-red-300 bg-red-50',
    chip: 'bg-red-600 text-white',
    dot: 'bg-red-600',
    table: 'border-red-600 bg-red-500 text-white',
  },
  NEEDS_ATTENTION: {
    label: 'Söker kontakt',
    level: 'alert',
    box: 'border-red-500 bg-red-500/20 animate-pulse',
    tile: 'border-red-300 bg-red-50',
    chip: 'bg-red-600 text-white',
    dot: 'bg-red-600',
    table: 'border-red-600 bg-red-500 text-white',
  },
  NEEDS_CLEANING: {
    label: 'Behöver dukas av',
    level: 'alert',
    box: 'border-red-500 bg-red-500/20',
    tile: 'border-red-300 bg-red-50',
    chip: 'bg-red-600 text-white',
    dot: 'bg-red-600',
    table: 'border-red-600 bg-red-500 text-white',
  },
  DESSERT_OPPORTUNITY: {
    label: 'Dessertläge',
    level: 'opportunity',
    box: 'border-dessert bg-dessert/20',
    tile: 'border-accent-light bg-dessert-light',
    chip: 'bg-dessert-dark text-white',
    dot: 'bg-dessert-dark',
    table: 'border-dessert-dark bg-dessert text-white',
  },
  WANTS_BILL: {
    label: 'Vill betala',
    level: 'request',
    box: 'border-violet-500 bg-violet-500/20',
    tile: 'border-violet-200 bg-violet-50',
    chip: 'bg-violet-700 text-white',
    dot: 'bg-violet-700',
    table: 'border-violet-700 bg-violet-600 text-white',
  },
  EMERGENCY: {
    label: 'Akut läge (SOS)',
    level: 'alert',
    box: 'border-4 border-red-600 bg-red-600/30 animate-pulse',
    tile: 'border-2 border-red-700 bg-red-100 animate-pulse',
    chip: 'bg-red-800 text-white',
    dot: 'bg-red-800',
    table: 'border-red-900 bg-red-700 text-white ring-4 ring-red-500/60 animate-pulse',
  },
  CAMERA_BLIND: {
    label: 'Kameran ser inte bordet',
    level: 'error',
    box: 'border-dashed border-gray-300 bg-gray-900/40',
    tile: 'border-dashed border-gray-400 bg-[repeating-linear-gradient(45deg,#F3F4F6_0_6px,#E5E7EB_6px_12px)]',
    chip: 'bg-gray-700 text-white',
    dot: 'bg-gray-500',
    table:
      'border-dashed border-gray-500 text-gray-700 bg-[repeating-linear-gradient(45deg,#F3F4F6_0_6px,#E5E7EB_6px_12px)]',
  },
};

// priority: lägre = visas högre upp i "Att göra nu"
export const TASK_STYLE: Record<TaskType, { text: string; chip: string; priority: number }> = {
  EMERGENCY: { text: 'akut läge (SOS)', chip: 'bg-red-800 text-white', priority: -1 },
  SERVICE: { text: 'söker kontakt', chip: 'bg-red-600 text-white', priority: 0 },
  FOOD_DELIVERY: { text: 'väntar på mat', chip: 'bg-red-600 text-white', priority: 1 },
  CLEANING: { text: 'behöver dukas av', chip: 'bg-red-600 text-white', priority: 2 },
  BILL: { text: 'vill betala', chip: 'bg-violet-700 text-white', priority: 3 },
  DESSERT: { text: 'är redo för dessert eller kaffe', chip: 'bg-dessert-dark text-white', priority: 4 },
};

// ------------------------------------------------------------- Beställningar

/** PENDING_APPROVAL = gästen har beställt via QR och personalen ska godkänna först */
export type OrderStatus = 'PENDING_APPROVAL' | 'RECEIVED' | 'PREPARING' | 'READY' | 'SERVED' | 'COMPLETED' | 'CANCELLED';

export interface OrderItem {
  name: string;
  qty: number;
  /** Styckpris från menyn (saknas för fritext) */
  price?: number;
  menu_item_id?: string;
}

export interface Order {
  id: string;
  restaurant_id: string;
  table_id: string;
  items: OrderItem[];
  note: string | null;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
  ready_at: string | null;
  served_at: string | null;
  completed_at: string | null;
  /** staff = personalen skrev in den, qr = gästen beställde via QR-koden */
  source?: 'staff' | 'qr';
}

/** Ordningen i livscykeln (makulerad står utanför). */
export const ORDER_FLOW: OrderStatus[] = ['RECEIVED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED'];

/** Beställningar som fortfarande pågår (visas på bordet och i köket). */
export const isActiveOrder = (o: Order) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED';

export const ORDER_STYLE: Record<OrderStatus, { label: string; chip: string; next?: string }> = {
  PENDING_APPROVAL: { label: 'Väntar på godkännande', chip: 'bg-violet-100 text-violet-800', next: 'Godkänn' },
  RECEIVED: { label: 'Mottagen', chip: 'bg-gray-100 text-gray-700', next: 'Börja laga' },
  PREPARING: { label: 'Tillagas', chip: 'bg-[#FEF3C7] text-[#92400E]', next: 'Klar i köket' },
  READY: { label: 'Klar att servera', chip: 'bg-teal text-white', next: 'Serverad' },
  SERVED: { label: 'Serverad', chip: 'bg-blue-50 text-blue-800', next: 'Avsluta' },
  COMPLETED: { label: 'Avslutad', chip: 'bg-gray-100 text-gray-500' },
  CANCELLED: { label: 'Makulerad', chip: 'bg-gray-100 text-gray-500 line-through' },
};

/** "2× Pasta, Sallad" */
export const orderSummary = (o: Pick<Order, 'items'>, emptyText = 'Tom beställning') =>
  o.items.map((i) => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name)).join(', ') || emptyText;

// ------------------------------------------------------------------- Meny

export type QrOrdering = 'off' | 'direct' | 'approve';

export interface MenuCategory {
  id: string;
  restaurant_id: string;
  name: string;
  position: number;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  allergens: string[];
  /** false = slut för i dag */
  available: boolean;
  position: number;
}

/** Allergener som kan märkas på en rätt (nycklar till texterna allergen.*) */
export const ALLERGENS = ['gluten', 'lactose', 'milk', 'egg', 'nuts', 'peanuts', 'fish', 'shellfish', 'soy', 'celery', 'mustard', 'sesame'] as const;

/** "149 kr" / "€12.50" i restaurangens valuta */
export function formatPrice(amount: number, currency = 'SEK', locale = 'sv-SE') {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

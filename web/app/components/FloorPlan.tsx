'use client';

import { useRef } from 'react';
import { m as motion } from 'framer-motion';
import { BellRing, CameraOff, ChefHat } from 'lucide-react';
import { ElementKind, PlanElement } from '@/lib/floorPlan';
import { STATUS_STYLE, TableShape, TableStatus } from '@/lib/types';
import { useT } from '@/lib/i18n';

export interface FloorPlanTable {
  key: string;
  table_number: number;
  shape: TableShape;
  seats: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** Utelämnas i admin-läget. Visas bara om live är true. */
  status?: TableStatus;
  live?: boolean;
  /** Kameran ser inte bordet (eller bevakningen är avstängd): ingen status visas */
  blind?: boolean;
  /** Förklaring som visas när man håller över bordet */
  issue?: string | null;
  /** Beställningar som köket har gjort klara (servitören ska hämta) */
  readyOrders?: number;
  /** Beställningar som tas emot eller lagas just nu */
  cookingOrders?: number;
}

interface Props {
  aspectRatio: number;
  tables: FloorPlanTable[];
  /** key behövs bara om inredningen ska gå att välja och flytta (admin) */
  elements: (PlanElement & { key?: string })[];
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  /** Om satt kan borden dras runt. Får nya x/y (0–1) för bordets övre vänstra hörn. */
  onMove?: (key: string, x: number, y: number) => void;
  /** Samma som onMove, fast för inredning */
  onMoveElement?: (key: string, x: number, y: number) => void;
}

// Utseende per typ av inredning
const ELEMENT_STYLE: Record<ElementKind, string> = {
  wall: 'bg-ink/85',
  window: 'bg-sky-200 border border-sky-300',
  bar: 'bg-[#E9DCCB] border border-[#C9AE8C] text-[#6B4F2E]',
  counter: 'bg-[#E9DCCB] border border-[#C9AE8C] text-[#6B4F2E]',
  kitchen: 'bg-gray-200 border border-gray-300 text-gray-600 bg-[repeating-linear-gradient(45deg,transparent_0_6px,rgba(0,0,0,.05)_6px_12px)]',
  entrance: 'border-2 border-dashed border-accent text-accent-dark bg-[#FDF1EA]',
  plant: 'bg-emerald-200 border border-emerald-300 text-emerald-800',
  pillar: 'bg-gray-400',
  restroom: 'bg-gray-100 border border-gray-300 text-gray-600',
  sofa: 'bg-[#DDD3C6] border border-[#B9AA98] text-[#5E4B37]',
  decor: 'bg-[#F1E6F3] border border-[#D6BEDC] text-[#6B3F75]',
  other: 'bg-gray-100 border border-dashed border-gray-300 text-gray-500',
};

const pct = (v: number) => `${v * 100}%`;

interface Chair {
  left: string;
  top: string;
  rotate: number;
}

/** Var stolarna står runt bordet (mittpunkter, relativt bordets ruta). */
function chairPositions(shape: TableShape, seats: number | null): Chair[] {
  const n = Math.max(0, Math.min(12, seats ?? 0));
  if (n === 0) return [];
  const out = '9px'; // avstånd från bordskanten till stolens mitt

  if (shape === 'round') {
    return Array.from({ length: n }, (_, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const cos = Math.cos(angle).toFixed(3);
      const sin = Math.sin(angle).toFixed(3);
      return {
        left: `calc(50% + ${cos} * (50% + ${out}))`,
        top: `calc(50% + ${sin} * (50% + ${out}))`,
        rotate: (angle * 180) / Math.PI + 90,
      };
    });
  }

  const chairs: Chair[] = [];
  const top = (k: number) => {
    for (let i = 0; i < k; i++) chairs.push({ left: pct((i + 0.5) / k), top: `calc(0% - ${out})`, rotate: 0 });
  };
  const bottom = (k: number) => {
    for (let i = 0; i < k; i++) chairs.push({ left: pct((i + 0.5) / k), top: `calc(100% + ${out})`, rotate: 0 });
  };
  const left = () => chairs.push({ left: `calc(0% - ${out})`, top: '50%', rotate: 90 });
  const right = () => chairs.push({ left: `calc(100% + ${out})`, top: '50%', rotate: 90 });

  if (shape === 'square' && n <= 4) {
    // En stol per sida
    [() => top(1), () => bottom(1), left, right].slice(0, n).forEach((add) => add());
    return chairs;
  }
  // Långbord: stolar längs långsidorna, och på kortsidorna om det är många
  let ends = shape === 'rect' && n >= 6 ? 2 : 0;
  if ((n - ends) % 2 === 1) ends = Math.min(2, ends + 1);
  const sides = n - ends;
  top(Math.ceil(sides / 2));
  bottom(Math.floor(sides / 2));
  if (ends >= 1) left();
  if (ends >= 2) right();
  return chairs;
}

export default function FloorPlan({ aspectRatio, tables, elements, selectedKey, onSelect, onMove, onMoveElement }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tr = useT();

  function handleDragEnd(key: string, node: HTMLElement, move?: (key: string, x: number, y: number) => void) {
    const container = containerRef.current;
    if (!container || !move) return;
    const c = container.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    move(key, (r.left - c.left) / c.width, (r.top - c.top) / c.height);
  }

  return (
    <div
      onClick={() => onSelect?.(null)}
      className="relative w-full overflow-hidden rounded-[14px] border border-line bg-paper-soft bg-[linear-gradient(#EEECE6_1px,transparent_1px),linear-gradient(90deg,#EEECE6_1px,transparent_1px)] bg-[size:24px_24px]"
      style={{ aspectRatio }}
    >
      {/* Marginal inuti ramen så att stolar vid kanten syns */}
      <div ref={containerRef} className="absolute inset-3 sm:inset-4">
      {elements.map((el, i) => {
        // Etikett bara om objektet är stort nog (inte på tunna väggar och fönster)
        const showLabel = el.w > 0.04 && el.h > 0.04 && (el.w > 0.07 || el.h > 0.07);
        const editable = Boolean(onMoveElement && el.key);
        const selected = editable && el.key === selectedKey;
        return (
          <motion.div
            key={editable ? `${el.key}-${el.x}-${el.y}` : i}
            title={el.label}
            drag={editable}
            dragMomentum={false}
            dragConstraints={containerRef}
            dragElastic={0}
            onDragEnd={(e) => el.key && handleDragEnd(el.key, e.target as HTMLElement, onMoveElement)}
            onClick={
              editable
                ? (e) => {
                    e.stopPropagation();
                    onSelect?.(selected ? null : el.key!);
                  }
                : undefined
            }
            className={`absolute flex items-center justify-center overflow-hidden text-[10px] font-semibold uppercase tracking-[0.06em] ${
              el.shape === 'round' ? 'rounded-full' : 'rounded-[4px]'
            } ${ELEMENT_STYLE[el.kind]} ${editable ? 'cursor-grab touch-none active:cursor-grabbing' : ''} ${
              selected ? 'z-10 ring-4 ring-ink/80 ring-offset-1' : ''
            }`}
            style={{
              left: pct(el.x),
              top: pct(el.y),
              width: pct(el.w),
              height: pct(el.h),
              rotate: `${el.rotation}deg`,
            }}
          >
            {showLabel && <span className="pointer-events-none truncate px-1">{el.label}</span>}
          </motion.div>
        );
      })}

      {tables.map((t) => {
        const style = t.blind ? STATUS_STYLE.CAMERA_BLIND : t.live && t.status ? STATUS_STYLE[t.status] : null;
        const selected = t.key === selectedKey;
        const rounded = t.shape === 'round' ? 'rounded-full' : 'rounded-[10px]';
        const seated = Boolean(
          !t.blind && t.live && t.status && !['AVAILABLE', 'NEEDS_CLEANING', 'CAMERA_BLIND'].includes(t.status)
        );
        return (
          <motion.button
            // Ny nyckel efter flytt nollställer dragets förskjutning
            key={`${t.key}-${t.x}-${t.y}`}
            type="button"
            drag={Boolean(onMove)}
            dragMomentum={false}
            dragConstraints={containerRef}
            dragElastic={0}
            onDragEnd={(e) => handleDragEnd(t.key, e.target as HTMLElement, onMove)}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(selected ? null : t.key);
            }}
            aria-label={`${tr('common.table', { n: t.table_number })}${style ? `: ${tr(`status.${t.blind ? 'CAMERA_BLIND' : t.status!}`)}` : ''}${t.readyOrders ? `, ${tr('map.foodReadyAria')}` : ''}`}
            title={t.blind ? `${tr('status.CAMERA_BLIND')}${t.issue ? `: ${t.issue}` : ''}` : undefined}
            className={`absolute flex flex-col items-center justify-center border-2 transition-colors duration-500 ${rounded} ${
              style ? style.table : 'border-gray-300 bg-white text-ink'
            } ${selected ? 'z-10 ring-4 ring-ink/80 ring-offset-2 ring-offset-paper-soft' : ''} ${
              onMove ? 'cursor-grab touch-none active:cursor-grabbing' : ''
            }`}
            style={{ left: pct(t.x), top: pct(t.y), width: pct(t.w), height: pct(t.h), rotate: t.rotation }}
            whileHover={onMove ? undefined : { scale: 1.05 }}
            whileTap={onMove ? undefined : { scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            {/* En ring sveper ut när bordets status ändras */}
            {!onMove && t.live && <span key={`${t.status}-${t.blind}`} className={`pointer-events-none absolute inset-0 animate-status-flash ${rounded}`} />}
            {/* Pulserande sken när bordet behöver något */}
            {style?.level === 'alert' && (
              <span className={`pointer-events-none absolute -inset-1 animate-ping bg-red-500/30 ${rounded}`} />
            )}
            {style?.level === 'request' && (
              <span className={`pointer-events-none absolute -inset-1.5 live-dot bg-violet-500/30 ${rounded}`} />
            )}
            {style?.level === 'opportunity' && (
              <span className={`pointer-events-none absolute -inset-1.5 live-dot bg-dessert/30 ${rounded}`} />
            )}
            {/* Stolar runt bordet. Fyllda när det sitter gäster. */}
            {chairPositions(t.shape, t.seats).map((c, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={`pointer-events-none absolute h-[8px] w-[17px] rounded-[3px] border-[1.5px] ${
                  seated ? 'border-[#8C96A3] bg-[#B4BCC6]' : 'border-[#CFCBC0] bg-white'
                }`}
                style={{ left: c.left, top: c.top, transform: `translate(-50%, -50%) rotate(${c.rotate}deg)` }}
              />
            ))}
            {/* Kameran ser inte bordet */}
            {t.blind && (
              <span className="pointer-events-none absolute -bottom-2.5 -right-2.5 z-20 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gray-700 text-white shadow-md">
                <CameraOff className="h-3.5 w-3.5" strokeWidth={2.4} />
              </span>
            )}
            {/* Maten är klar i köket: servitören ska hämta den */}
            {(t.readyOrders ?? 0) > 0 && (
              <span className="pointer-events-none absolute -right-4 -top-3.5 z-20 flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-white bg-teal px-2 py-1 text-[11px] font-bold leading-none text-white shadow-md">
                <BellRing className="h-3 w-3 animate-[wiggle_1s_ease-in-out_infinite]" strokeWidth={2.5} />
                <span className="hidden sm:inline">{tr('map.legendFoodReady')}</span>
                {(t.readyOrders ?? 0) > 1 && <span>{t.readyOrders}</span>}
              </span>
            )}
            {!(t.readyOrders ?? 0) && (t.cookingOrders ?? 0) > 0 && (
              <span
                title={tr('order.PREPARING')}
                className="pointer-events-none absolute -right-2 -top-2 z-20 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[#FEF3C7] text-[#92400E] shadow-sm"
              >
                <ChefHat className="h-3 w-3" strokeWidth={2.4} />
              </span>
            )}
            <span className="relative font-display text-sm font-bold leading-none sm:text-base">{t.table_number}</span>
            {t.seats && (
              <span className="relative mt-0.5 hidden max-w-full truncate px-0.5 text-[10px] leading-none opacity-75 sm:block">
                {tr('panel.seats', { n: t.seats })}
              </span>
            )}
          </motion.button>
        );
      })}
      </div>
    </div>
  );
}

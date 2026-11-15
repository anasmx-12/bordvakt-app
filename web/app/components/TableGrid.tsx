'use client';

import { m as motion } from 'framer-motion';
import { CameraOff } from 'lucide-react';
import { DiningTable, STATUS_STYLE, TableStatus } from '@/lib/types';
import SectionLabel from './SectionLabel';
import { useT } from '@/lib/i18n';

interface Props {
  tables: DiningTable[];
  /** Bord vars kamera ger bild och analyseras just nu */
  liveTableIds: Set<string>;
  /** Visas i stället för kartan när inget bord kan bevakas */
  problem: string | null;
  selectedTableId: string | null;
  onSelectTable: (id: string | null) => void;
  readyByTable?: Map<string, number>;
}

export default function TableGrid({ tables, liveTableIds, problem, selectedTableId, onSelectTable, readyByTable }: Props) {
  const t = useT();
  // Räkna bara bord som faktiskt bevakas, annars blir siffrorna fel
  const counts = tables.reduce<Partial<Record<TableStatus, number>>>((acc, row) => {
    if (liveTableIds.has(row.id)) acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="flex flex-col gap-2.5">
      <SectionLabel>{t('dash.mapTitle')}</SectionLabel>

      {tables.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white py-8 text-center text-sm text-muted">
          {t('grid.noTables')}
        </p>
      ) : liveTableIds.size === 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-[#F3C9B0] bg-[#FDF1EA] p-4">
          <CameraOff className="mt-0.5 h-5 w-5 flex-none text-accent-dark" strokeWidth={1.8} />
          <div>
            <p className="font-display font-bold text-ink">{t('grid.cantLoad')}</p>
            <p className="text-sm text-accent-dark">{problem}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {tables.map((table) => {
              const live = liveTableIds.has(table.id);
              const style = STATUS_STYLE[table.status];
              const selected = table.id === selectedTableId;
              return (
                <motion.button
                  key={table.id}
                  layout
                  onClick={() => onSelectTable(selected ? null : table.id)}
                  className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors duration-500 ${
                    live ? style.tile : 'border-dashed border-line bg-white'
                  } ${selected ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper-soft' : ''}`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span
                      className={`font-display text-xl font-bold leading-none tracking-[-0.02em] ${
                        live ? '' : 'text-gray-400'
                      }`}
                    >
                      {table.table_number}
                    </span>
                    {live && (
                      <motion.span
                        key={table.status}
                        initial={{ scale: 0.4, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className={`h-2.5 w-2.5 rounded-full ${style.dot} ${
                          table.status === 'NEEDS_ATTENTION' || table.status === 'EMERGENCY' ? 'live-dot' : ''
                        }`}
                      />
                    )}
                  </div>
                  <span className="text-[11px] font-medium leading-tight text-body">
                    {live ? t(`status.${table.status}`) : t('grid.noImage')}
                  </span>
                  {(readyByTable?.get(table.id) ?? 0) > 0 && (
                    <span className="rounded-full bg-teal px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                      {t('map.legendFoodReady')}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>

          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
            {(Object.keys(STATUS_STYLE) as TableStatus[]).map((status) => (
              <li key={status} className="flex items-center gap-1.5 text-xs text-muted">
                <span className={`h-2 w-2 rounded-full ${STATUS_STYLE[status].dot}`} />
                {t(`status.${status}`)}
                <span className="font-semibold text-ink">{counts[status] ?? 0}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

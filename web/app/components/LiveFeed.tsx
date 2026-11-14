'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { CameraOff, Loader2, RefreshCw } from 'lucide-react';
import { CameraFeed, DiningTable, STATUS_STYLE } from '@/lib/types';
import { EngineStatus, streamUrl } from '@/lib/useEngineStatus';
import { useT } from '@/lib/i18n';

interface Props {
  cameras: CameraFeed[];
  tables: DiningTable[];
  engine: EngineStatus | null;
  /** true tills kameror och bord har hämtats */
  loading?: boolean;
  liveTableIds: Set<string>;
  selectedTableId: string | null;
  onSelectTable: (id: string | null) => void;
}

export default function LiveFeed({
  cameras,
  tables,
  engine,
  loading,
  liveTableIds,
  selectedTableId,
  onSelectTable,
}: Props) {
  const t = useT();
  const [activeId, setActiveId] = useState<string | null>(null);
  // Byts vid "Försök igen" så att webbläsaren öppnar flödet på nytt
  const [attempt, setAttempt] = useState(0);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const camera = cameras.find((c) => c.id === activeId) ?? cameras[0];
  // Bara bord som har en ruta i den här kamerans bild
  const cameraTables = tables.filter(
    (
      t,
    ): t is DiningTable & {
      roi_x1: number;
      roi_y1: number;
      roi_x2: number;
      roi_y2: number;
    } => t.camera_id === camera?.id && t.roi_x1 !== null && t.roi_y1 !== null && t.roi_x2 !== null && t.roi_y2 !== null,
  );
  const online = Boolean(camera && engine?.cameras[camera.id]?.online);
  // Nyckeln ändras när kameran kommer tillbaka, så att bilden laddas om automatiskt
  const streamKey = `${camera?.id}-${attempt}-${online}`;

  let problem: { text: string; spinner?: boolean; retry?: boolean } | null = null;
  if (!camera && loading) problem = { text: t('common.loading'), spinner: true };
  else if (!camera)
    problem = {
      text: t('feed.noCamera'),
    };
  else if (!engine) problem = { text: t('feed.connecting'), spinner: true };
  else if (!engine.reachable)
    problem = {
      text: t('feed.engineOff'),
    };
  else if (!online)
    problem = {
      text:
        camera.brand === 'webcam'
          ? t('feed.webcamNoImage')
          : t('feed.noImage'),
    };
  else if (failedKey === streamKey) problem = { text: t('feed.videoFailed'), retry: true };

  return (
    <section className="flex flex-col gap-3">
      {cameras.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {cameras.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`btn btn-sm ${c.id === camera?.id ? 'btn-primary' : 'btn-secondary'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="relative overflow-hidden rounded-[14px] bg-ink">
        {problem || !camera ? (
          <Placeholder
            text={problem?.text ?? ''}
            spinner={problem?.spinner}
            onRetry={problem?.retry ? () => setAttempt((a) => a + 1) : undefined}
          />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- MJPEG-flöde, kan inte optimeras */}
            <img
              key={streamKey}
              src={streamUrl(engine, camera.id, `&k=${attempt}`) ?? undefined}
              alt={t('feed.alt', { name: camera.name })}
              onError={() => setFailedKey(streamKey)}
              className="block h-auto w-full"
            />

            {/* Bordsrutor ritas i procent av bilden, så de följer med när bilden skalas */}
            {cameraTables.map((table) => {
              const live = liveTableIds.has(table.id);
              const style = STATUS_STYLE[table.status];
              const selected = table.id === selectedTableId;
              return (
                <motion.button
                  key={table.id}
                  layout
                  onClick={() => onSelectTable(selected ? null : table.id)}
                  aria-label={`${t('common.table', { n: table.table_number })}${live ? `: ${t(`status.${table.status}`)}` : ''}`}
                  className={`absolute rounded-[10px] border-2 transition-colors duration-500 ${
                    live ? style.box : 'border-dashed border-white/60'
                  } ${selected ? 'ring-4 ring-white/80' : ''}`}
                  style={{
                    left: `${table.roi_x1 * 100}%`,
                    top: `${table.roi_y1 * 100}%`,
                    width: `${(table.roi_x2 - table.roi_x1) * 100}%`,
                    height: `${(table.roi_y2 - table.roi_y1) * 100}%`,
                  }}
                >
                  <span
                    className={`absolute left-1.5 top-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold shadow ${
                      live ? style.chip : 'bg-ink/70 text-white'
                    }`}
                  >
                    {live ? (
                      <>
                        <span className="font-display font-bold">{table.table_number}</span>
                        {t(`status.${table.status}`)}
                      </>
                    ) : (
                      <>{t('common.table', { n: table.table_number })}</>
                    )}
                  </span>
                </motion.button>
              );
            })}

            <div className="absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-ink/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
              <span className="live-dot h-[7px] w-[7px] rounded-full bg-accent-light" />
              {camera.name}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Placeholder({ text, spinner, onRetry }: { text: string; spinner?: boolean; onRetry?: () => void }) {
  const t = useT();
  const Icon = spinner ? Loader2 : CameraOff;
  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-3 p-6 text-center">
      <Icon className={`h-7 w-7 text-accent-light ${spinner ? 'animate-spin' : ''}`} strokeWidth={1.8} />
      <p className="max-w-sm text-sm text-gray-300">{text}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn btn-secondary">
          <RefreshCw className="h-4 w-4" /> {t('common.tryAgain')}
        </button>
      )}
    </div>
  );
}

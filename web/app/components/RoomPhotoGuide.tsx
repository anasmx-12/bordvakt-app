'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Camera, Check, ChevronLeft, ChevronRight, DoorOpen, ImageUp, Loader2, SkipForward, Sparkles, X } from 'lucide-react';
import { PHOTO_VIEWS, PhotoViewId } from '@/lib/photoViews';
import { shrinkImage } from '@/lib/shrinkImage';

export type RoomPhotos = Partial<Record<PhotoViewId, Blob>>;

interface Props {
  busy: boolean;
  onAnalyze: (photos: RoomPhotos) => void;
  onError: (message: string | null) => void;
}

/** AI:n ber om ett foto från mitten av varje vägg och från varje hörn, ett i taget. */
export default function RoomPhotoGuide({ busy, onAnalyze, onError }: Props) {
  const [photos, setPhotos] = useState<Partial<Record<PhotoViewId, { blob: Blob; url: string }>>>({});
  const [skipped, setSkipped] = useState<Set<PhotoViewId>>(new Set());
  const [index, setIndex] = useState(0);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Släpp förhandsbilderna ur minnet när sidan stängs
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const view = PHOTO_VIEWS[index];
  const current = photos[view.id];
  const taken = PHOTO_VIEWS.filter((v) => photos[v.id]).length;
  const missing = PHOTO_VIEWS.filter((v) => !photos[v.id] && !skipped.has(v.id));

  /** Nästa plats som saknar foto, efter den nuvarande */
  function nextMissing(from: number, have: typeof photos, skip: Set<PhotoViewId>) {
    for (let step = 1; step <= PHOTO_VIEWS.length; step++) {
      const i = (from + step) % PHOTO_VIEWS.length;
      const v = PHOTO_VIEWS[i];
      if (!have[v.id] && !skip.has(v.id)) return i;
    }
    return from;
  }

  async function onChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // samma fil ska kunna väljas igen
    if (!file) return;
    onError(null);
    try {
      const blob = await shrinkImage(file);
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      const next = { ...photos, [view.id]: { blob, url } };
      const nextSkipped = new Set(skipped);
      nextSkipped.delete(view.id);
      setPhotos(next);
      setSkipped(nextSkipped);
      setIndex(nextMissing(index, next, nextSkipped));
    } catch (err) {
      onError((err as Error).message);
    }
  }

  function skip() {
    const nextSkipped = new Set(skipped).add(view.id);
    setSkipped(nextSkipped);
    setIndex(nextMissing(index, photos, nextSkipped));
  }

  function remove() {
    const next = { ...photos };
    delete next[view.id];
    setPhotos(next);
  }

  function analyze() {
    const out: RoomPhotos = {};
    for (const v of PHOTO_VIEWS) if (photos[v.id]) out[v.id] = photos[v.id]!.blob;
    onAnalyze(out);
  }

  const move = (delta: number) => setIndex((i) => (i + delta + PHOTO_VIEWS.length) % PHOTO_VIEWS.length);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-body">
        För att rita en bra karta behöver AI:n se matsalen från alla håll. Ta <strong>ett foto från mitten av varje vägg</strong>{' '}
        och <strong>ett från varje hörn</strong>, totalt 8 foton.
      </p>

      {/* Karta över rummet: var man ska stå */}
      <div className="flex items-start gap-3">
        <div
          className="relative m-3 aspect-square w-[120px] flex-none rounded-lg border-2 border-ink/70 bg-white"
          aria-label="Var du ska stå"
          role="img"
        >
          {/* Entrén */}
          <DoorOpen className="absolute bottom-3 left-1/2 h-4 w-4 -translate-x-1/2 text-muted" />
          <span className="absolute bottom-[26px] left-1/2 -translate-x-1/2 text-[9px] font-semibold uppercase text-muted">
            Entré
          </span>
          {PHOTO_VIEWS.map((v, i) => {
            const active = i === index;
            const done = Boolean(photos[v.id]);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={v.title}
                title={v.title}
                className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-white shadow transition-transform ${
                  active ? 'z-10 scale-125 bg-accent' : done ? 'bg-teal' : skipped.has(v.id) ? 'bg-gray-300' : 'bg-gray-500'
                }`}
                style={{ left: `${v.x * 100}%`, top: `${v.y * 100}%` }}
              >
                {done && !active ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : (
                  <ArrowUp className="h-3 w-3" strokeWidth={3} style={{ transform: `rotate(${v.angle}deg)` }} />
                )}
              </button>
            );
          })}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="eyebrow">
            Foto {index + 1} av {PHOTO_VIEWS.length}
          </p>
          <p className="font-display text-[16px] font-bold leading-snug">{view.title}</p>
          <p className="text-sm text-body">{view.instruction}</p>
          <p className="text-xs text-muted">Håll mobilen på bredden och få med så mycket av rummet som möjligt.</p>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[14px] border border-line bg-paper-soft">
        {current ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- lokal förhandsbild (blob) */}
            <img src={current.url} alt={view.title} className="block aspect-[4/3] w-full object-cover" />
            <button
              type="button"
              onClick={remove}
              aria-label="Ta bort fotot"
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-ink/70 text-white hover:bg-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 p-6 text-center text-muted">
            <Camera className="h-8 w-8" strokeWidth={1.6} />
            <p className="text-sm">{skipped.has(view.id) ? 'Överhoppad. Du kan ta fotot ändå.' : 'Inget foto än'}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => cameraInput.current?.click()} className="btn btn-primary min-h-11">
          <Camera className="h-4 w-4" /> {current ? 'Ta om' : 'Ta foto'}
        </button>
        <button type="button" onClick={() => fileInput.current?.click()} className="btn btn-secondary min-h-11">
          <ImageUp className="h-4 w-4" /> Välj bild
        </button>
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onChosen} />
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={onChosen} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => move(-1)} className="btn btn-ghost btn-sm" aria-label="Föregående plats">
          <ChevronLeft className="h-4 w-4" /> Föregående
        </button>
        {!current && (
          <button type="button" onClick={skip} className="btn btn-ghost btn-sm" title="T.ex. om väggen är blockerad">
            <SkipForward className="h-4 w-4" /> Hoppa över
          </button>
        )}
        <button type="button" onClick={() => move(1)} className="btn btn-ghost btn-sm" aria-label="Nästa plats">
          Nästa <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Alla 8 foton */}
      <div className="grid grid-cols-4 gap-1.5">
        {PHOTO_VIEWS.map((v, i) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setIndex(i)}
            title={v.title}
            className={`relative aspect-[4/3] overflow-hidden rounded-md border-2 ${
              i === index ? 'border-accent' : 'border-transparent'
            } bg-paper`}
          >
            {photos[v.id] ? (
              // eslint-disable-next-line @next/next/no-img-element -- lokal förhandsbild (blob)
              <img src={photos[v.id]!.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-[10px] font-semibold text-muted">
                {v.id.startsWith('wall') ? 'Vägg' : 'Hörn'}
              </span>
            )}
          </button>
        ))}
      </div>

      <button type="button" onClick={analyze} disabled={taken === 0 || busy} className="btn btn-lg btn-accent">
        {busy ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" /> AI:n ritar upp lokalen…
          </>
        ) : (
          <>
            <Sparkles className="h-5 w-5" /> Skapa planritning med AI ({taken} {taken === 1 ? 'foto' : 'foton'})
          </>
        )}
      </button>
      {busy ? (
        <p className="text-center text-xs text-muted">Det kan ta upp till en minut med många foton.</p>
      ) : (
        taken > 0 &&
        missing.length > 0 && (
          <p className="text-center text-xs text-accent-dark">
            {missing.length} {missing.length === 1 ? 'foto saknas' : 'foton saknas'}. Ju fler foton, desto bättre karta.
          </p>
        )
      )}

      <ul className="flex flex-col gap-1.5 text-[13px] text-body">
        <li>· Bra ljus och så få personer i bild som möjligt.</li>
        <li>· Fotona analyseras av AI:n på den här datorn och sparas inte.</li>
        <li>· Ett bord som syns på flera foton räknas bara en gång. Kontrollera ändå kartan innan du sparar.</li>
      </ul>
    </div>
  );
}

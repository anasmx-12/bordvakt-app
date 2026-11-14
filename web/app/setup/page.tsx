'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, Check, CheckCircle2, Circle, Loader2, Plug, Trash2, XCircle } from 'lucide-react';
import AppShell from '../components/AppShell';
import Banner from '../components/Banner';
import FloorPlan from '../components/FloorPlan';
import FloorPlanEditor from '../components/FloorPlanEditor';
import SectionLabel from '../components/SectionLabel';
import MenuStep from './MenuStep';
import ExtrasStep from './ExtrasStep';
import { optInChosen } from '@/lib/features';
import SupportLink from '../components/SupportLink';
import { LifeBuoy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  brandInfo,
  brandsFor,
  buildStreamUrl,
  CameraForm,
  CameraKind,
  Connection,
  CONNECTIONS,
  connectionsFor,
  defaultPort,
  KINDS,
  savedBrand,
  usesCustomAddress,
} from '@/lib/cameras';
import { CameraBrand, DiningTable } from '@/lib/types';
import { streamUrl, useEngineStatus } from '@/lib/useEngineStatus';
import { ActiveFloorPlan, useFloorPlan } from '@/lib/useFloorPlan';

type Step = 'restaurant' | 'floor_plan' | 'cameras' | 'calibrate' | 'menu' | 'extras' | 'done';

interface SetupStatus {
  step: Step;
  complete: boolean;
  restaurant_name: string | null;
  has_floor_plan: boolean;
  plan_tables: number;
  cameras: number;
  unmapped_tables: number[];
  uncalibrated_tables: number[];
}

interface CameraRow {
  id: string;
  name: string;
  brand: CameraBrand;
  status: string;
  address: string | null;
}

const STEPS: { id: Step; label: string }[] = [
  { id: 'restaurant', label: 'Restaurang' },
  { id: 'floor_plan', label: 'Planritning' },
  { id: 'cameras', label: 'Kameror' },
  { id: 'calibrate', label: 'Kalibrering' },
  { id: 'menu', label: 'Meny (valfritt)' },
  { id: 'extras', label: 'Tillval' },
  { id: 'done', label: 'Klart' },
];
const stepIndex = (s: Step) => STEPS.findIndex((x) => x.id === s);
/** Steget att stå på: när allt annat är klart kommer menyn och tillvalen innan "Klart". */
const current = (s: SetupStatus, menuDone: boolean, extrasDone = true): Step =>
  s.complete ? (!menuDone ? 'menu' : !extrasDone ? 'extras' : 'done') : s.step;
/** Steg som går att öppna när som helst (de är valfria) */
const ALWAYS_OPEN: Step[] = ['menu', 'extras'];

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Fel (${res.status})`);
  return body as T;
}
const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

// Installationsguiden. Matsalen och köket är spärrade tills allt här är klart,
// och AI:n bevakar ingenting förrän varje bord är kalibrerat mot en kamera.
export default function SetupWizard() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  // Menysteget är valfritt: det räknas inte in i databasens "klar", bara här i guiden
  const [menuDone, setMenuDone] = useState(true);
  // Tillvalen (Entré, Statistik) är besvarade
  const [extrasDone, setExtrasDone] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('setup_status');
    if (error) {
      setDbError(
        error.code === 'PGRST202' || error.code === 'PGRST205'
          ? 'Databasen är inte uppdaterad. Kör filerna i mappen supabase/ (schema.sql, 002, 003 och 004) i Supabase → SQL Editor och ladda om sidan.'
          : `Kunde inte läsa installationen: ${error.message}`
      );
      return null;
    }
    setDbError(null);
    // Saknas kolumnen (010 inte körd) räknas menysteget som klart, men går att öppna
    const { data: r } = await supabase.from('restaurants').select('*').maybeSingle();
    const done = r ? r.menu_step_done !== false : true;
    // Saknas kolumnen features (012 inte körd) stoppar tillvalen inte guiden
    const extras = !r || !('features' in r) || optInChosen(r.features);
    setMenuDone(done);
    setExtrasDone(extras);
    setStatus(data as SetupStatus);
    return { ...(data as SetupStatus), menuDone: done, extrasDone: extras };
  }, []);

  // Starta på det steg som behöver göras (eller ?step=... från en länk)
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const s = await refresh();
      if (cancelled || !s) return;
      const wanted = new URLSearchParams(window.location.search).get('step') as Step | null;
      const now = current(s, s.menuDone, s.extrasDone);
      const start = wanted && (ALWAYS_OPEN.includes(wanted) || (stepIndex(wanted) >= 0 && stepIndex(wanted) <= stepIndex(now))) ? wanted : now;
      setStep(start);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [refresh]);

  async function advance() {
    const s = await refresh();
    if (s) setStep(current(s, s.menuDone, s.extrasDone));
  }

  const reached = status ? stepIndex(current(status, menuDone, extrasDone)) : 0;

  return (
    <AppShell
      title="Installation"
      subtitle={
        <>
          Matsalen öppnas när planritningen är klar och varje bord är kalibrerat mot en kamera. AI:n visar bara status
          för bord som kameran faktiskt ser.
        </>
      }
      actions={
        <Link href="/setup/support" className="btn btn-secondary">
          <LifeBuoy className="h-4 w-4" /> Kontakta Bordvakt support
        </Link>
      }
    >
        {dbError && (
          <div className="mb-5">
            <Banner role="alert" title="Databasen behöver uppdateras">
              {dbError}
            </Banner>
          </div>
        )}

        {status && step && (
          <>
            <nav aria-label="Steg" className="card mb-5 overflow-x-auto px-3 py-3 sm:px-5">
              <ol className="flex min-w-max items-center">
                {STEPS.map((s, i) => {
                  const done =
                    s.id === 'menu'
                      ? menuDone && status.complete
                      : s.id === 'extras'
                        ? extrasDone && status.complete
                        : i < reached || (s.id === 'done' && status.complete);
                  const active = s.id === step;
                  const clickable = i <= reached || ALWAYS_OPEN.includes(s.id); // valfria steg kan göras när som helst
                  return (
                    <li key={s.id} className="flex items-center">
                      {i > 0 && (
                        <span
                          aria-hidden="true"
                          className={`mx-1 h-0.5 w-6 rounded-full sm:mx-2 sm:w-10 ${i <= reached ? 'bg-teal' : 'bg-line'}`}
                        />
                      )}
                      <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => setStep(s.id)}
                        aria-current={active ? 'step' : undefined}
                        className={`flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold transition-colors enabled:hover:bg-paper disabled:cursor-not-allowed ${
                          active ? 'text-ink' : done ? 'text-[#0F5C55]' : 'text-muted'
                        }`}
                      >
                        <span
                          className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[13px] font-bold ${
                            active
                              ? 'bg-ink text-white'
                              : done
                                ? 'bg-teal text-white'
                                : 'border border-line bg-white text-muted'
                          }`}
                        >
                          {done && !active ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
                        </span>
                        {s.label}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            {/* Varje steg glider in när man byter */}
            <div key={step} className="animate-rise">
            {step === 'restaurant' && <RestaurantStep status={status} onDone={advance} />}
            {step === 'floor_plan' && <FloorPlanEditor onSaved={advance} />}
            {step === 'cameras' && <CamerasStep onDone={advance} />}
            {step === 'calibrate' && <CalibrateStep status={status} onChange={refresh} onDone={advance} />}
            {step === 'menu' && <MenuStep onDone={advance} />}
            {step === 'extras' && <ExtrasStep onDone={advance} />}
            {step === 'done' && <DoneStep status={status} onGoTo={setStep} />}
            </div>
          </>
        )}
        {!status && !dbError && (
          <div className="flex justify-center py-20 text-muted">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}
    </AppShell>
  );
}

// ------------------------------------------------------------------ Steg 1

function RestaurantStep({ status, onDone }: { status: SetupStatus; onDone: () => void }) {
  const [name, setName] = useState(status.restaurant_name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/setup/restaurant', json('POST', { name }));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex max-w-[520px] flex-col gap-4 card p-5">
      <SectionLabel>1 · Restaurangens namn</SectionLabel>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={80}
        placeholder="T.ex. Trattoria Bella"
        aria-label="Restaurangens namn"
        className="field min-h-12 text-[15px]"
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={!name.trim() || busy}
        className="btn btn-lg btn-primary self-start"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Spara och fortsätt
      </button>
    </form>
  );
}

// ------------------------------------------------------------------ Steg 3

const EMPTY_FORM: CameraForm = {
  kind: 'ip',
  brand: 'axis',
  connection: 'rtsp',
  ip: '',
  port: '554',
  user: '',
  password: '',
  channel: '1',
  custom: '',
};

function CamerasStep({ onDone }: { onDone: () => void }) {
  const engine = useEngineStatus();
  const [cameras, setCameras] = useState<CameraRow[] | null>(null);
  const [name, setName] = useState('');
  const [form, setForm] = useState<CameraForm>(EMPTY_FORM);
  const [test, setTest] = useState<{ url: string; preview: string | null; warning: string | null } | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCameras(await api<CameraRow[]>('/api/setup/cameras'));
    } catch (err) {
      setError((err as Error).message);
      setCameras([]);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const url = buildStreamUrl(form);
  const tested = test?.url === url;
  const brand = brandInfo(form.brand);
  const set = (patch: Partial<CameraForm>) => setForm((f) => ({ ...f, ...patch }));
  const kind = KINDS.find((k) => k.id === form.kind)!;
  const brands = brandsFor(form.kind);
  const connections = connectionsFor(form.brand);
  const customAddress = usesCustomAddress(form);

  // Byter typ, märke eller anslutning: välj en anslutning som fungerar och rätt standardport
  function change(patch: Partial<Pick<CameraForm, 'kind' | 'brand' | 'connection'>>) {
    setForm((f) => {
      const next = { ...f, ...patch, custom: patch.connection === 'custom' ? f.custom : '' };
      if (!brandsFor(next.kind).some((b) => b.id === next.brand)) next.brand = brandsFor(next.kind)[0].id;
      const allowed = connectionsFor(next.brand);
      if (!allowed.includes(next.connection)) next.connection = allowed[0];
      next.port = defaultPort(next);
      return next;
    });
  }

  async function runTest() {
    setBusy('test');
    setError(null);
    setTest(null);
    try {
      const r = await api<{ preview: string | null; warning: string | null }>(
        '/api/setup/cameras/test',
        json('POST', { stream_url: url })
      );
      setTest({ url, preview: r.preview, warning: r.warning });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    setError(null);
    try {
      await api('/api/setup/cameras', json('POST', { name, brand: savedBrand(form), stream_url: url }));
      setName('');
      setForm(EMPTY_FORM);
      setTest(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(camera: CameraRow) {
    if (!confirm(`Ta bort kameran "${camera.name}"? Borden den ser måste då kalibreras mot en annan kamera.`)) return;
    try {
      await api(`/api/setup/cameras/${camera.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const input = 'field';

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <section className="flex flex-col gap-3 self-start card p-5">
        <SectionLabel>3 · Kameror</SectionLabel>
        <p className="text-sm text-body">
          Lägg till alla kameror som ser matsalen. Tillsammans måste de se <strong>varje bord</strong>.
        </p>
        <SupportLink topic="cameras">Behöver kamerorna monteras eller kopplas in på plats?</SupportLink>
        <p className="text-[13px] text-body">
          Gästerna ska få veta om kamerorna.{' '}
          <Link href="/setup/skylt" className="font-semibold underline">Skriv ut en skylt och få en integritetstext</Link>
        </p>
        {cameras === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        ) : cameras.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">Inga kameror än.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cameras.map((c) => {
              const online = engine?.cameras[c.id]?.online;
              return (
                <li key={c.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                  <Camera className="h-5 w-5 flex-none text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{c.name}</p>
                    <p className="truncate text-xs text-muted">{c.address ?? 'Ingen adress'}</p>
                  </div>
                  <span
                    className={`flex items-center gap-1.5 text-xs font-semibold ${online ? 'text-teal' : 'text-muted'}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${online ? 'live-dot bg-teal' : 'bg-gray-300'}`} />
                    {online ? 'Ger bild' : 'Ingen bild'}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    aria-label={`Ta bort ${c.name}`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          onClick={onDone}
          disabled={!cameras?.length}
          className="btn btn-lg btn-primary mt-2"
        >
          Fortsätt till kalibrering
        </button>
      </section>

      <section className="flex flex-col gap-3 card p-5">
        <SectionLabel>Lägg till kamera</SectionLabel>
        <label className="field-label">
          Namn
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="T.ex. Matsal norr" className={input} />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="field-label mb-2">Typ av kamera</legend>
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                aria-pressed={form.kind === k.id}
                onClick={() => change({ kind: k.id as CameraKind })}
                className={`min-h-11 rounded-lg border px-3 py-2 text-start text-[14px] font-semibold transition-colors ${
                  form.kind === k.id ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-ink'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <span className="text-xs font-normal text-muted">{kind.hint}</span>
        </fieldset>

        {(form.kind === 'ip' || form.kind === 'nvr') && (
          <>
            <label className="field-label">
              Märke
              <select
                value={form.brand}
                onChange={(e) => change({ brand: e.target.value as CameraBrand })}
                className={`${input} bg-white`}
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-muted">{brand.hint}</span>
            </label>

            {connections.length > 1 && (
              <label className="field-label">
                Anslutning
                <select
                  value={form.connection}
                  onChange={(e) => change({ connection: e.target.value as Connection })}
                  className={`${input} bg-white`}
                >
                  {CONNECTIONS.filter((c) => connections.includes(c.id)).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs font-normal text-muted">
                  {CONNECTIONS.find((c) => c.id === form.connection)?.hint}
                </span>
              </label>
            )}
          </>
        )}

        {form.kind === 'usb' ? (
          <label className="field-label">
            Kamerans nummer
            <input
              value={form.custom}
              onChange={(e) => set({ custom: e.target.value })}
              placeholder="0"
              inputMode="numeric"
              className={input}
            />
            <span className="text-xs font-normal text-muted">0 = datorns inbyggda kamera, 1 = nästa kamera osv.</span>
          </label>
        ) : customAddress ? (
          <label className="field-label">
            Kamerans adress
            <input
              value={form.custom}
              onChange={(e) => set({ custom: e.target.value })}
              placeholder={
                form.brand === 'unifi'
                  ? 'rtsps://192.168.1.1:7441/abc123?enableSrtp'
                  : 'rtsp://användare:lösenord@192.168.1.20:554/...'
              }
              className={input}
            />
          </label>
        ) : (
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <label className="field-label">
              {form.kind === 'nvr' ? 'Inspelarens IP-adress' : form.kind === 'phone' ? 'Mobilens IP-adress' : 'IP-adress'}
              <input value={form.ip} onChange={(e) => set({ ip: e.target.value })} placeholder="192.168.1.20" className={input} />
            </label>
            <label className="field-label">
              Port
              <input value={form.port} onChange={(e) => set({ port: e.target.value })} inputMode="numeric" className={input} />
            </label>
            <label className={`field-label ${form.kind === 'phone' ? 'col-span-2' : ''}`}>
              Användare{form.kind === 'phone' && ' (om appen kräver det)'}
              <input value={form.user} onChange={(e) => set({ user: e.target.value })} autoComplete="off" className={input} />
            </label>
            {form.kind !== 'phone' && (
              <label className="field-label">
                Kanal
                <input value={form.channel} onChange={(e) => set({ channel: e.target.value })} inputMode="numeric" className={input} />
              </label>
            )}
            <label className="field-label col-span-2">
              Lösenord
              <input
                type="password"
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                autoComplete="new-password"
                className={input}
              />
            </label>
            {form.kind === 'nvr' && (
              <p className="col-span-2 text-xs text-muted">Kanal = kamerans nummer i inspelaren (1, 2, 3 …).</p>
            )}
            {url && (
              <p className="col-span-2 truncate text-xs text-muted" title="Adressen som används">
                Adress: <code>{url.replace(/:[^:@/]*@/, ':•••@')}</code>
              </p>
            )}
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {tested && test && (
          <div className="flex flex-col gap-2">
            {test.preview && (
              // eslint-disable-next-line @next/next/no-img-element -- förhandsbild från AI-motorn
              <img src={test.preview} alt="Förhandsbild från kameran" className="w-full rounded-xl border border-line" />
            )}
            <p className={`text-sm font-semibold ${test.warning ? 'text-accent-dark' : 'text-teal'}`}>
              {test.warning ? `Ansluten, men: ${test.warning}` : 'Anslutningen fungerar.'}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={runTest}
            disabled={!url || busy !== null}
            className="btn btn-secondary min-h-11"
          >
            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} Testa anslutning
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!tested || !name.trim() || busy !== null}
            title={!tested ? 'Testa anslutningen först' : undefined}
            className="btn btn-accent min-h-11"
          >
            {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />} Spara kamera
          </button>
        </div>
        <p className="text-xs text-muted">
          Adressen och lösenordet sparas bara på servern och visas aldrig i webbläsaren igen.
        </p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Steg 4

interface Roi {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function CalibrateStep({
  status,
  onChange,
  onDone,
}: {
  status: SetupStatus;
  onChange: () => Promise<SetupStatus | null>;
  onDone: () => void;
}) {
  const { plan } = useFloorPlan();
  const engine = useEngineStatus();
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState<string>('');
  const [roi, setRoi] = useState<Roi | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const loadTables = useCallback(async (planId: string) => {
    const { data } = await supabase.from('tables').select('*').eq('floor_plan_id', planId).order('table_number');
    setTables((data ?? []) as DiningTable[]);
    return (data ?? []) as DiningTable[];
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api<CameraRow[]>('/api/setup/cameras').then(setCameras).catch(() => setCameras([]));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const uncalibrated = new Set(status.uncalibrated_tables);
  const select = useCallback(
    (t: DiningTable, fallbackCamera?: string) => {
      setSelectedId(t.id);
      setCameraId(t.camera_id ?? fallbackCamera ?? '');
      setRoi(
        t.roi_x1 !== null && t.roi_y1 !== null && t.roi_x2 !== null && t.roi_y2 !== null
          ? { x1: t.roi_x1, y1: t.roi_y1, x2: t.roi_x2, y2: t.roi_y2 }
          : null
      );
      setMessage(null);
    },
    []
  );

  // Välj första okalibrerade bordet när allt har laddats
  const planId = plan?.id;
  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const list = await loadTables(planId);
      if (cancelled) return;
      const first = list.find((t) => status.uncalibrated_tables.includes(t.table_number)) ?? list[0];
      if (first) select(first, cameras[0]?.id);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Bara när planritningen byts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const selected = tables.find((t) => t.id === selectedId) ?? null;
  const cameraOnline = Boolean(cameraId && engine?.cameras[cameraId]?.online);

  async function calibrate() {
    if (!selected || !cameraId || !roi) return;
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/setup/calibrate', json('POST', { table_id: selected.id, camera_id: cameraId, roi }));
      const s = await onChange();
      const list = planId ? await loadTables(planId) : tables;
      setMessage({ ok: true, text: `Bord ${selected.table_number} är kalibrerat. AI:n känner nu igen bordet i kameran.` });
      const next = list.find((t) => s?.uncalibrated_tables.includes(t.table_number));
      if (next) setTimeout(() => select(next, cameraId), 900);
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
      if (planId) await loadTables(planId);
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  if (plan === undefined) {
    return <Loader2 className="h-6 w-6 animate-spin text-muted" />;
  }
  if (!plan) return <p className="text-body">Gör klart planritningen först.</p>;

  const otherRois = tables.filter(
    (t) => t.id !== selectedId && t.camera_id === cameraId && t.roi_x1 !== null
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <section className="flex flex-col gap-3 self-start card p-5">
        <SectionLabel>4 · Kalibrera varje bord</SectionLabel>
        <p className="text-sm text-body">
          Välj ett bord, välj kameran som ser det och rita en ruta runt bordet i kamerabilden. Ta med stolarna.
        </p>
        <SupportLink topic="calibrate">Vill ni att vi kalibrerar borden åt er?</SupportLink>
        <PlanPicker plan={plan} tables={tables} selectedId={selectedId} uncalibrated={uncalibrated} onSelect={(t) => select(t, cameraId || cameras[0]?.id)} />
        <ul className="grid grid-cols-3 gap-1.5">
          {tables.map((t) => {
            const ok = !uncalibrated.has(t.table_number);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => select(t, cameraId || cameras[0]?.id)}
                  className={`flex w-full items-center gap-1.5 rounded-lg border px-2 py-2 text-sm font-semibold ${
                    t.id === selectedId ? 'border-ink bg-paper' : 'border-line'
                  }`}
                >
                  {ok ? <CheckCircle2 className="h-4 w-4 text-teal" /> : <Circle className="h-4 w-4 text-gray-400" />}
                  Bord {t.table_number}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-muted">
          {status.uncalibrated_tables.length === 0
            ? 'Alla bord är kalibrerade.'
            : `${status.uncalibrated_tables.length} av ${status.plan_tables} bord kvar.`}
        </p>
        <button
          type="button"
          onClick={onDone}
          disabled={!status.complete}
          className="btn btn-lg btn-primary"
        >
          Fortsätt
        </button>
      </section>

      <section className="flex flex-col gap-3 card p-5">
        {!selected ? (
          <p className="text-body">Välj ett bord.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl font-bold">Bord {selected.table_number}</h2>
              <select
                value={cameraId}
                onChange={(e) => {
                  setCameraId(e.target.value);
                  setRoi(null);
                }}
                aria-label="Kamera som ser bordet"
                className="field min-h-10 w-auto font-semibold"
              >
                <option value="">Välj kamera…</option>
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {cameraId ? (
              <RoiDrawer
                key={`${cameraId}-${selected.id}`}
                cameraId={cameraId}
                online={cameraOnline}
                engineReachable={engine?.reachable ?? null}
                roi={roi}
                others={otherRois}
                onChange={setRoi}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
                Välj kameran som ser bord {selected.table_number}.
              </p>
            )}

            {message && (
              <p
                role="status"
                className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
                  message.ok ? 'bg-teal-light text-[#0F5C55]' : 'bg-red-50 text-red-700'
                }`}
              >
                {message.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" /> : <XCircle className="mt-0.5 h-4 w-4 flex-none" />}
                {message.text}
              </p>
            )}

            <button
              type="button"
              onClick={calibrate}
              disabled={!roi || !cameraOnline || busy}
              className="btn btn-lg btn-accent self-start"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Spara och kalibrera bord {selected.table_number}
            </button>
            <p className="text-xs text-muted">
              Se till att bordet syns tydligt och att ingen står framför det. AI:n sparar hur bordet ser ut och
              varnar senare om kameran flyttas, täcks över eller inte längre ser bordet.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

/** Liten planritning där man ser vilket bord som är valt. */
function PlanPicker({
  plan,
  tables,
  selectedId,
  uncalibrated,
  onSelect,
}: {
  plan: ActiveFloorPlan;
  tables: DiningTable[];
  selectedId: string | null;
  uncalibrated: Set<number>;
  onSelect: (t: DiningTable) => void;
}) {
  return (
    <FloorPlan
      aspectRatio={plan.aspect_ratio}
      elements={plan.elements}
      selectedKey={selectedId}
      onSelect={(key) => {
        const t = tables.find((x) => x.id === key);
        if (t) onSelect(t);
      }}
      tables={tables
        .filter((t) => t.floor_x !== null && t.floor_y !== null && t.floor_w !== null && t.floor_h !== null)
        .map((t) => ({
          key: t.id,
          table_number: t.table_number,
          shape: t.shape,
          seats: t.seats,
          x: t.floor_x!,
          y: t.floor_y!,
          w: t.floor_w!,
          h: t.floor_h!,
          rotation: t.rotation ?? 0,
          blind: uncalibrated.has(t.table_number),
          issue: uncalibrated.has(t.table_number) ? 'Inte kalibrerat' : null,
        }))}
    />
  );
}

/** Live-bild från kameran där man drar en ruta runt bordet. */
function RoiDrawer({
  cameraId,
  online,
  engineReachable,
  roi,
  others,
  onChange,
}: {
  cameraId: string;
  online: boolean;
  engineReachable: boolean | null;
  roi: Roi | null;
  others: DiningTable[];
  onChange: (roi: Roi | null) => void;
}) {
  const engine = useEngineStatus();
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<Roi | null>(null);

  const point = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const toRoi = (a: { x: number; y: number }, b: { x: number; y: number }): Roi => ({
    x1: Math.min(a.x, b.x),
    y1: Math.min(a.y, b.y),
    x2: Math.max(a.x, b.x),
    y2: Math.max(a.y, b.y),
  });

  if (engineReachable === false) {
    return (
      <p className="rounded-xl bg-[#FDF1EA] p-6 text-sm text-accent-dark">
        AI-motorn svarar inte, så kamerabilden kan inte visas. Kontrollera att AI-datorn är påslagen och har internet.
      </p>
    );
  }
  if (!online) {
    return (
      <div className="flex aspect-video items-center justify-center gap-2 rounded-xl bg-ink text-sm text-gray-300">
        <Loader2 className="h-4 w-4 animate-spin" /> Väntar på bild från kameran…
      </div>
    );
  }

  const shown = drag ?? roi;
  return (
    <div
      ref={box}
      className="relative aspect-video w-full cursor-crosshair touch-none select-none overflow-hidden rounded-xl bg-ink"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = point(e);
        setDrag(toRoi(start.current, start.current));
      }}
      onPointerMove={(e) => {
        if (start.current) setDrag(toRoi(start.current, point(e)));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const r = toRoi(start.current, point(e));
        start.current = null;
        setDrag(null);
        if (r.x2 - r.x1 > 0.03 && r.y2 - r.y1 > 0.03) onChange(r);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- MJPEG-flöde från AI-motorn */}
      <img
        src={streamUrl(engine, cameraId) ?? undefined}
        alt="Kamerabild"
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-fill"
      />
      {others.map((t) => (
        <div
          key={t.id}
          className="pointer-events-none absolute border-2 border-dashed border-white/60 bg-white/10"
          style={{
            left: `${t.roi_x1! * 100}%`,
            top: `${t.roi_y1! * 100}%`,
            width: `${(t.roi_x2! - t.roi_x1!) * 100}%`,
            height: `${(t.roi_y2! - t.roi_y1!) * 100}%`,
          }}
        >
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[11px] font-bold text-white">
            Bord {t.table_number}
          </span>
        </div>
      ))}
      {shown && (
        <div
          className="pointer-events-none absolute border-[3px] border-accent bg-accent/15"
          style={{
            left: `${shown.x1 * 100}%`,
            top: `${shown.y1 * 100}%`,
            width: `${(shown.x2 - shown.x1) * 100}%`,
            height: `${(shown.y2 - shown.y1) * 100}%`,
          }}
        />
      )}
      {!shown && (
        <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm font-semibold text-white drop-shadow">
          Dra med musen eller fingret runt bordet
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Steg 5

function DoneStep({ status, onGoTo }: { status: SetupStatus; onGoTo: (s: Step) => void }) {
  if (!status.complete) {
    return (
      <section className="flex max-w-[620px] flex-col gap-3 card p-5">
        <SectionLabel>Nästan klart</SectionLabel>
        <ul className="flex flex-col gap-1 text-sm text-body">
          {!status.has_floor_plan && <li>· Planritningen saknas.</li>}
          {status.cameras === 0 && <li>· Ingen kamera är upplagd.</li>}
          {status.uncalibrated_tables.length > 0 && (
            <li>· Bord som inte är kalibrerade: {status.uncalibrated_tables.join(', ')}.</li>
          )}
        </ul>
        <button
          type="button"
          onClick={() => onGoTo(status.step)}
          className="btn btn-lg btn-primary self-start"
        >
          Gör klart
        </button>
      </section>
    );
  }
  return (
    <section className="flex max-w-[620px] flex-col items-start gap-3 rounded-xl border border-[#B9DAD4] bg-teal-light p-6">
      <CheckCircle2 className="h-10 w-10 text-teal" />
      <h2 className="font-display text-2xl font-bold">Allt är klart</h2>
      <p className="text-[#1F3B38]">
        {status.restaurant_name} har {status.plan_tables} bord och {status.cameras} kamera(or). Alla bord är
        kalibrerade och AI:n bevakar dem nu.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/matsal" className="btn btn-lg btn-primary">
          Öppna matsalen
        </Link>
        <button type="button" onClick={() => onGoTo('menu')} className="btn btn-lg btn-secondary">
          Meny och QR-beställning
        </button>
        <Link href="/setup/skylt" className="btn btn-lg btn-secondary">
          Skylt om kamerorna
        </Link>
      </div>
    </section>
  );
}

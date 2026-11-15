'use client';

import { useState } from 'react';
import { Camera, Check, Loader2, Radar, RefreshCw, Video } from 'lucide-react';
import { brandInfo } from '@/lib/cameras';
import { ConnectResult, ConnectedChannel, defaultUser, FoundCamera, guideFor, Placement } from '@/lib/cameraGuides';
import type { CameraBrand } from '@/lib/types';
import PlacementView from './PlacementView';

async function post<T>(url: string, body?: unknown): Promise<{ status: number; data: T & { error?: string } }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    data: await res.json().catch(() => ({ error: 'Oväntat svar från servern' })),
  };
}

const label = (c: { brand: CameraBrand | null; model: string | null }) =>
  [c.brand ? brandInfo(c.brand).label : null, c.model].filter(Boolean).join(' ') || 'Okänd kamera';

/** "Hitta mina kameror": AI-datorn söker i nätet, ägaren skriver lösenordet, adressen hittas automatiskt. */
export default function CameraFinder({ existing, onSaved }: { existing: number; onSaved: () => Promise<void> }) {
  const [found, setFound] = useState<FoundCamera[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null); // IP som kopplas

  async function search() {
    setSearching(true);
    setError(null);
    setOpen(null);
    try {
      const { status, data } = await post<{ cameras: FoundCamera[] }>('/api/setup/cameras/discover');
      if (status >= 400) throw new Error(data.error ?? 'Sökningen misslyckades');
      setFound(data.cameras);
      if (data.cameras.length === 1) setOpen(data.cameras[0].ip);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 card p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-paper">
          <Radar className="h-5 w-5" />
        </span>
        <div>
          <h3 className="font-display text-lg font-bold">Hitta mina kameror</h3>
          <p className="text-sm text-body">
            AI-datorn letar efter kameror i restaurangens nät. Du behöver bara kamerans lösenord, adressen hittas
            automatiskt.
          </p>
        </div>
      </div>
      <button type="button" onClick={search} disabled={searching} className="btn btn-lg btn-primary">
        {searching ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : found ? (
          <RefreshCw className="h-4 w-4" />
        ) : (
          <Radar className="h-4 w-4" />
        )}
        {searching ? 'Söker i nätet… (cirka 10 sekunder)' : found ? 'Sök igen' : 'Hitta mina kameror'}
      </button>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {found && found.length === 0 && (
        <p className="rounded-xl border border-dashed border-line p-4 text-sm text-body">
          Inga kameror hittades. Kontrollera att kamerorna har ström och sitter i samma nät (samma router eller switch)
          som AI-datorn. Hittar du ändå inte kameran: fota etiketten nedan, så visar vi hur du hittar den.
        </p>
      )}

      {found && found.length > 0 && (
        <ul className="flex flex-col gap-2">
          {found.map((cam) => (
            <li key={cam.ip} className="rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setOpen(open === cam.ip ? null : cam.ip)}
                aria-expanded={open === cam.ip}
                className="flex min-h-12 w-full items-center gap-3 p-3 text-start"
              >
                <Camera className="h-5 w-5 flex-none text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{label(cam)}</span>
                  <span className="block text-xs text-muted">
                    {cam.ip}
                    {!cam.onvif_url && ' · svarar på video'}
                  </span>
                </span>
                <span className="btn btn-secondary btn-sm">Koppla</span>
              </button>
              {open === cam.ip && <ConnectForm camera={cam} existing={existing} onSaved={onSaved} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConnectForm({
  camera,
  existing,
  onSaved,
}: {
  camera: FoundCamera;
  existing: number;
  onSaved: () => Promise<void>;
}) {
  const [username, setUsername] = useState(defaultUser(camera.brand));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'connect' | 'save' | null>(null);
  const [error, setError] = useState<{ text: string; auth: boolean } | null>(null);
  const [result, setResult] = useState<Extract<ConnectResult, { ok: true }> | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState<Set<number>>(new Set()); // sparas aldrig två gånger
  const [names, setNames] = useState<Record<number, string>>({});
  const guide = guideFor(camera.brand);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy('connect');
    setError(null);
    setResult(null);
    try {
      const { status, data } = await post<ConnectResult>('/api/setup/cameras/connect', {
        ip: camera.ip,
        username,
        password,
        brand: camera.brand,
        onvif_url: camera.onvif_url,
      });
      if (status === 422 && 'reason' in data) {
        setError({ text: data.error, auth: data.reason === 'auth' });
        return;
      }
      if (status >= 400 || !data.ok) throw new Error(data.error ?? 'Kunde inte koppla kameran');
      setResult(data);
      setChosen(new Set(data.channels.map((c) => c.channel)));
      setNames(Object.fromEntries(data.channels.map((c, i) => [c.channel, `Kamera ${existing + i + 1}`])));
    } catch (err) {
      setError({ text: (err as Error).message, auth: false });
    } finally {
      setBusy(null);
    }
  }

  async function recheck(channel: ConnectedChannel) {
    const { status, data } = await post<{
      preview: string | null;
      warning: string | null;
      placement: Placement | null;
    }>('/api/setup/cameras/placement', { stream_url: channel.stream_url });
    if (status >= 400) {
      setError({
        text: data.error ?? 'Kunde inte hämta en ny bild',
        auth: false,
      });
      return;
    }
    setResult(
      (r) =>
        r && {
          ...r,
          channels: r.channels.map((c) => (c.channel === channel.channel ? { ...c, ...data } : c)),
        },
    );
  }

  async function save() {
    if (!result) return;
    setBusy('save');
    setError(null);
    let any = false;
    try {
      for (const c of result.channels.filter((c) => chosen.has(c.channel) && !saved.has(c.channel))) {
        const res = await fetch('/api/setup/cameras', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: names[c.channel]?.trim() || `Kamera ${c.channel}`,
            brand: result.brand ?? 'other',
            stream_url: c.stream_url,
          }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Kunde inte spara kameran');
        any = true;
        setSaved((s) => new Set(s).add(c.channel));
      }
    } catch (err) {
      setError({ text: (err as Error).message, auth: false });
    } finally {
      if (any) await onSaved();
      setBusy(null);
    }
  }

  const many = (result?.channels.length ?? 0) > 1;
  const left = [...chosen].filter((ch) => !saved.has(ch)).length;

  return (
    <div className="flex flex-col gap-3 border-t border-line-soft p-3">
      {!result && (
        <form onSubmit={connect} className="grid gap-2 sm:grid-cols-2">
          <label className="field-label">
            Användarnamn
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              className="field"
            />
          </label>
          <label className="field-label">
            Kamerans lösenord
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              aria-invalid={error?.auth || undefined}
              className={`field ${error?.auth ? 'border-red-500' : ''}`}
            />
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">
              {error.text}
              {error.auth && guide.note && <span className="mt-1 block text-xs">{guide.note}</span>}
            </p>
          )}
          <button type="submit" disabled={busy !== null || !username} className="btn btn-accent sm:col-span-2">
            {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
            {busy === 'connect' ? 'Letar efter videon…' : 'Koppla kameran'}
          </button>
          <p className="text-xs text-muted sm:col-span-2">
            Lösenordet är det som sattes när kameran installerades, i {guide.app}. Det sparas bara på servern.
          </p>
        </form>
      )}

      {result && (
        <>
          <p className="flex items-center gap-2 text-sm font-semibold text-teal">
            <Check className="h-4 w-4" /> {label(result)} är kopplad
            {many && ` · ${result.channels.length} kameror`}
          </p>
          {result.channels.map((c) => (
            <div key={c.channel} className="flex flex-col gap-2 rounded-lg border border-line-soft p-3">
              <div className="flex flex-wrap items-center gap-2">
                {saved.has(c.channel) ? (
                  <Check className="h-5 w-5 text-teal" aria-label="Sparad" />
                ) : (
                  many && (
                    <input
                      type="checkbox"
                      checked={chosen.has(c.channel)}
                      onChange={(e) =>
                        setChosen((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(c.channel);
                          else next.delete(c.channel);
                          return next;
                        })
                      }
                      aria-label={`Spara kanal ${c.channel}`}
                      className="h-5 w-5"
                    />
                  )
                )}
                <input
                  value={names[c.channel] ?? ''}
                  onChange={(e) => setNames((n) => ({ ...n, [c.channel]: e.target.value }))}
                  aria-label="Kamerans namn"
                  placeholder="T.ex. Matsal norr"
                  disabled={saved.has(c.channel)}
                  className="field min-w-0 flex-1"
                />
              </div>
              <PlacementView
                preview={c.preview}
                placement={c.placement}
                warning={c.warning}
                onRecheck={() => recheck(c)}
              />
            </div>
          ))}
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error.text}
            </p>
          )}
          {left === 0 && saved.size > 0 ? (
            <p className="flex items-center gap-2 rounded-lg bg-teal-light p-3 text-sm font-semibold">
              <Check className="h-4 w-4 text-teal" />{' '}
              {many ? 'Sparade. De syns nu i listan över kameror.' : 'Sparad. Den syns nu i listan över kameror.'}
            </p>
          ) : (
            <button
              type="button"
              onClick={save}
              disabled={busy !== null || left === 0}
              className="btn btn-lg btn-accent"
            >
              {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}
              {many ? `Spara ${left} kameror` : 'Spara kameran'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

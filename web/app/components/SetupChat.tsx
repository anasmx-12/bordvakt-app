'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import { AnimatePresence, m as motion } from 'framer-motion';
import { ArrowUp, Check, Copy, RotateCcw, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useEngineStatus } from '@/lib/useEngineStatus';
import { useSettings } from '@/lib/settings';
import { Key, LANGUAGES, TFunction, useTranslate } from '@/lib/i18n';
import type { Language } from '@/lib/settings';
import Vakti, { VaktiMood } from './Vakti';

type Step = 'restaurant' | 'floor_plan' | 'cameras' | 'calibrate' | 'done';
const STEPS: Step[] = ['restaurant', 'floor_plan', 'cameras', 'calibrate'];

interface SetupStatus {
  step: Step;
  complete: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const ENGINE_COMMAND = 'launchctl kickstart -k gui/$(id -u)/se.bordvakt.engine';
const SEEN_KEY = 'bordvakt-vakti-seen';
const LANG_KEY = 'bordvakt-vakti-lang'; // chattens eget språk (standard: appens språk)
const QUICK: Key[] = ['chat.q.camera', 'chat.q.noImage', 'chat.q.calibrate'];

/** Modellen skriver ibland **fetstil**: visa bara texten. */
const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '');

const noSubscribe = () => () => {};

/** Vakti: Bordvakts AI som hjälper användaren att få igång appen.
 *  Öppnar sig själv efter inloggning när installationen inte är klar.
 *  Knapparna väljs av appen utifrån installationens läge, inte av AI:n. */
export default function SetupChat() {
  const pathname = usePathname();
  const gated = pathname === '/matsal' || pathname === '/kitchen';
  const settings = useSettings();
  const [chosen, setChosen] = useState<Language | null>(null);
  const language = chosen ?? settings.language;
  const t: TFunction = useTranslate(language);
  const engine = useEngineStatus();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [cameraNames, setCameraNames] = useState<Map<string, string>>(new Map());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const [{ data }, { data: cams }] = await Promise.all([
      supabase.rpc('setup_status'),
      supabase.from('camera_feeds').select('id,name'),
    ]);
    if (data) setStatus(data as SetupStatus);
    setCameraNames(new Map(((cams ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])));
    return data as SetupStatus | null;
  }, []);

  // Läs läget direkt, sedan var 30:e sekund. Öppna själv första gången om installationen inte är klar.
  useEffect(() => {
    let alive = true;
    const first = setTimeout(() => {
      const saved = localStorage.getItem(LANG_KEY) as Language | null;
      if (saved && LANGUAGES.some((l) => l.code === saved)) setChosen(saved);
      load().then((s) => {
        if (alive && s && !s.complete && !gated && !sessionStorage.getItem(SEEN_KEY)) {
          sessionStorage.setItem(SEEN_KEY, '1');
          setOpen(true);
        }
      });
    }, 0);
    const timer = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, gated]);

  // Problem som gör att appen inte fungerar just nu
  const engineOff = engine !== null && !engine.reachable;
  const offline = useMemo(
    () =>
      engine?.reachable
        ? Object.entries(engine.cameras)
            .filter(([, c]) => !c.online)
            .map(([id]) => cameraNames.get(id) ?? '?')
        : [],
    [engine, cameraNames]
  );
  const hasProblem = engineOff || offline.length > 0;
  const stepsLeft = status && !status.complete ? Math.max(1, STEPS.length - STEPS.indexOf(status.step)) : 0;

  const dot = hasProblem ? 'bg-red-600' : status && !status.complete ? 'bg-accent' : null;
  // Platsen i toppfältet på mobilen. SetupChat ligger i AppShell, så platsen finns redan.
  const slot = useSyncExternalStore(
    noSubscribe,
    () => document.getElementById('vakti-slot'),
    () => null
  );
  const mood: VaktiMood = busy ? 'thinking' : hasProblem ? 'worried' : status?.complete ? 'happy' : 'idle';

  // Vaktis första meddelande räknas fram av appen: det stämmer alltid
  const greeting = useMemo(() => {
    if (!status) return t('chat.greetLoading');
    if (!status.complete) {
      return `${t('chat.greet', { n: stepsLeft })} ${status.step !== 'done' ? t(`chat.next.${status.step}`) : ''}`;
    }
    if (!hasProblem) return t('chat.greetDone');
    const problems = [
      engineOff ? t('chat.problem.engineOff') : null,
      ...offline.map((name) => t('chat.problem.camera', { name })),
    ].filter(Boolean);
    return `${t('chat.greetProblem')}\n${problems.map((p) => `• ${p}`).join('\n')}`;
  }, [status, stepsLeft, hasProblem, engineOff, offline, t]);

  // Knappar som tar användaren rätt
  const actions = useMemo(() => {
    const list: { href: string; label: string }[] = [];
    if (status && !status.complete && status.step !== 'done') {
      list.push({ href: `/setup?step=${status.step}`, label: t(`chat.go.${status.step}`) });
    }
    if (offline.length > 0 && !list.some((a) => a.href.endsWith('cameras'))) {
      list.push({ href: '/setup?step=cameras', label: t('chat.go.cameras') });
    }
    return list;
  }, [status, offline, t]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const history: Message[] = [...messages, { role: 'user', content: question }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    const reply = (content: string) =>
      setMessages((prev) => [...prev.slice(0, -1), { role: 'assistant', content }]);

    try {
      abortRef.current = new AbortController();
      const res = await fetch('/api/setup-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, language }),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        const step = status?.complete ? 'done' : (status?.step ?? 'restaurant');
        reply(
          data.fallback
            ? `${t('chat.fallback')}\n${engineOff ? t('chat.problem.engineOff') : t(`chat.tip.${step}`)}`
            : (data.error ?? t('chat.error'))
        );
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        reply(answer);
      }
      if (!answer.trim()) reply(t('chat.error'));
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) reply(t('chat.error'));
    } finally {
      setBusy(false);
      load(); // läget kan ha ändrats medan användaren läste
    }
  }

  async function copyCommand() {
    await navigator.clipboard?.writeText(ENGINE_COMMAND).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      {/* Mobil: en liten knapp i toppfältet (AppShell), bubblan i hörnet skulle täcka knapparna */}
      {slot &&
        createPortal(
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={t('chat.open')}
            aria-expanded={open}
            title={t('chat.open')}
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white"
          >
            <Vakti mood={mood} size={32} />
            {dot && <span className={`absolute -end-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white ${dot}`} />}
          </button>,
          slot
        )}

      {/* Bubblan i hörnet (dator) */}
      <AnimatePresence>
        {!open && (
          <motion.button
            type="button"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            onClick={() => setOpen(true)}
            aria-label={t('chat.open')}
            title={t('chat.open')}
            className="fixed bottom-6 end-6 z-50 hidden h-16 w-16 items-center justify-center rounded-full border border-line bg-white shadow-[0_12px_28px_-10px_rgba(15,20,25,.45)] lg:flex"
          >
            <Vakti mood={mood} size={52} />
            {dot && <span className={`absolute end-1 top-1 h-3.5 w-3.5 rounded-full border-2 border-white ${dot}`} />}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chattfönstret */}
      <AnimatePresence>
        {open && (
          <motion.section
            role="dialog"
            aria-label={t('chat.title')}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            className="fixed inset-x-3 bottom-20 z-50 flex max-h-[min(640px,75vh)] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_48px_-16px_rgba(15,20,25,.5)] sm:inset-x-auto sm:end-6 sm:w-[400px] lg:bottom-6"
          >
            <header className="flex items-center gap-3 border-b border-line-soft bg-paper px-4 py-3">
              <Vakti mood={mood} size={48} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-display text-[17px] font-bold leading-tight">{t('chat.title')}</span>
                <span className="truncate text-[12px] text-muted">{t('chat.subtitle')}</span>
              </div>
              <select
                value={language}
                onChange={(e) => {
                  const next = e.target.value as Language;
                  setChosen(next);
                  localStorage.setItem(LANG_KEY, next);
                }}
                aria-label={t('chat.language')}
                title={t('chat.language')}
                className="h-9 max-w-[7.5rem] rounded-lg border border-line bg-white px-2 text-[13px] font-semibold text-body"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    abortRef.current?.abort();
                    setMessages([]);
                  }}
                  aria-label={t('chat.restart')}
                  title={t('chat.restart')}
                  className="btn btn-ghost btn-icon"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('common.close')}
                className="btn btn-ghost btn-icon"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div ref={listRef} aria-live="polite" className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
              <Bubble role="assistant">{greeting}</Bubble>

              {(actions.length > 0 || engineOff) && (
                <div className="flex flex-col gap-2 ps-1">
                  {actions.map((a) => (
                    <Link
                      key={a.href}
                      href={a.href}
                      onClick={() => setOpen(window.innerWidth >= 640)}
                      className="btn btn-primary btn-sm self-start"
                    >
                      {a.label}
                    </Link>
                  ))}
                  {engineOff && (
                    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-paper p-2.5">
                      <span className="text-[12px] text-body">{t('chat.engineCmd')}</span>
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-ink px-2 py-1 text-[12px] text-white">
                          {ENGINE_COMMAND}
                        </code>
                        <button type="button" onClick={copyCommand} className="btn btn-secondary btn-sm">
                          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          {copied ? t('chat.copied') : t('chat.copy')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <Link
                href="/setup/support"
                onClick={() => setOpen(window.innerWidth >= 640)}
                className="self-start ps-1 text-[13px] font-semibold text-body underline underline-offset-2 hover:text-ink"
              >
                {t('chat.support')}
              </Link>

              {messages.map((m, i) => (
                <Bubble key={i} role={m.role}>
                  {m.content ? plain(m.content) : <TypingDots />}
                </Bubble>
              ))}

              {messages.length === 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {QUICK.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => send(t(key))}
                      className="rounded-full border border-line bg-white px-3 py-1.5 text-[13px] font-semibold text-body hover:border-ink hover:text-ink"
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex items-end gap-2 border-t border-line-soft p-3"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                maxLength={1500}
                placeholder={t('chat.placeholder')}
                aria-label={t('chat.placeholder')}
                className="max-h-28 min-h-10 flex-1 resize-none rounded-lg border border-line bg-white px-3 py-2 text-[15px] outline-none focus:border-ink"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-label={t('chat.send')}
                className="btn btn-primary btn-icon h-10 w-10 disabled:opacity-40"
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}

function Bubble({ role, children }: { role: Message['role']; children: React.ReactNode }) {
  const mine = role === 'user';
  return (
    <div
      className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${
        mine ? 'self-end rounded-ee-md bg-ink text-white' : 'self-start rounded-es-md bg-paper text-ink'
      }`}
    >
      {children}
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="…">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="live-dot h-1.5 w-1.5 rounded-full bg-muted"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}

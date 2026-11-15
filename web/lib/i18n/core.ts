// Översättning utan React: används både i appen och på servern (t.ex. mobil-larm).
import type { Language } from '../settings';
import sv, { Dict, Key } from './sv';

// Bara svenska följer med från början. De andra språken hämtas när de behövs (loadLanguage),
// så att ingen behöver ladda ner alla 16 språken.
type Other = Exclude<Language, 'sv'>;
const LOADERS: Record<Other, () => Promise<{ default: Dict }>> = {
  en: () => import('./en'),
  zh: () => import('./zh'),
  hi: () => import('./hi'),
  es: () => import('./es'),
  ar: () => import('./ar'),
  fr: () => import('./fr'),
  bn: () => import('./bn'),
  pt: () => import('./pt'),
  ru: () => import('./ru'),
  ur: () => import('./ur'),
  id: () => import('./id'),
  de: () => import('./de'),
  ja: () => import('./ja'),
  tr: () => import('./tr'),
  ko: () => import('./ko'),
};

const DICTS: Partial<Record<Language, Dict>> = { sv };
const pending = new Map<Language, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

/** Hämtar språket (en gång). Tills det är hämtat visas texterna på svenska. */
export function loadLanguage(lang: Language): Promise<void> {
  if (DICTS[lang] || !(lang in LOADERS)) return Promise.resolve();
  let p = pending.get(lang);
  if (!p) {
    p = LOADERS[lang as Other]()
      .then((m) => {
        DICTS[lang] = m.default;
        version += 1;
        listeners.forEach((l) => l());
      })
      .catch(() => {
        pending.delete(lang); // t.ex. tappad uppkoppling: försök igen nästa gång
      });
    pending.set(lang, p);
  }
  return p;
}

/** För React: sidan ritas om när ett språk har hämtats. */
export function subscribeLanguages(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const languagesVersion = () => version;

export function translate(lang: Language, key: Key, vars?: Record<string, string | number>): string {
  const text = DICTS[lang]?.[key] ?? sv[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m)) : text;
}

'use client';

import { useSyncExternalStore } from 'react';

// Inställningar sparas per enhet (webbläsare), så att varje platta eller mobil
// kan ha sitt eget språk, tema och ljud.

export type Theme = 'light' | 'dark' | 'system';
export type Accent = 'orange' | 'blue' | 'green' | 'purple' | 'graphite';
export type TextSize = 'normal' | 'large' | 'xlarge';
export type StartPage = '/matsal' | '/kitchen';
export type Language =
  | 'sv' | 'en' | 'zh' | 'hi' | 'es' | 'ar' | 'fr' | 'bn'
  | 'pt' | 'ru' | 'ur' | 'id' | 'de' | 'ja' | 'tr' | 'ko';

export interface Settings {
  theme: Theme;
  accent: Accent;
  textSize: TextSize;
  reduceMotion: boolean;
  language: Language;
  startPage: StartPage;
  sound: boolean;
  vibration: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  accent: 'orange',
  textSize: 'normal',
  reduceMotion: false,
  language: 'sv',
  startPage: '/matsal',
  sound: true,
  vibration: true,
};

const KEY = 'bordvakt:settings';
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function read(): Settings {
  if (cache) return cache;
  let stored: Partial<Settings> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    // Ljudvalet sparades förr för sig
    if (stored.sound === undefined && localStorage.getItem('bordvakt:sound') === 'off') stored.sound = false;
  } catch {
    // Trasig eller blockerad lagring: använd standard
  }
  cache = { ...DEFAULT_SETTINGS, ...stored };
  return cache;
}

export function updateSettings(patch: Partial<Settings>) {
  cache = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Privat läge: gäller bara tills sidan stängs
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Ändringar i en annan flik
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Enhetens inställningar. På servern (och första renderingen) används standard. */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_SETTINGS);
}

/** Läser inställningarna utanför React (t.ex. vid inloggning). */
export const getSettings = () => (typeof window === 'undefined' ? DEFAULT_SETTINGS : read());

/** Språk som skrivs från höger till vänster */
export const RTL_LANGUAGES: Language[] = ['ar', 'ur'];

/** Körs i <head> innan sidan ritas, så att tema och språk inte blinkar fel. */
export const APPLY_SETTINGS_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem('${KEY}')||'{}'),d=document.documentElement;
var t=s.theme||'light';if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
d.dataset.theme=t;d.dataset.accent=s.accent||'orange';d.dataset.textSize=s.textSize||'normal';
d.dataset.motion=s.reduceMotion?'reduce':'full';var l=s.language||'sv';d.lang=l;d.dir=(l==='ar'||l==='ur')?'rtl':'ltr';}catch(e){}})();`;

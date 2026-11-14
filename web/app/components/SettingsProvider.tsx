'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { MotionConfig } from 'framer-motion';
import { RTL_LANGUAGES, useSettings } from '@/lib/settings';

function subscribeDark(cb: () => void) {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** Lägger enhetens inställningar på <html> (tema, färg, textstorlek, språk, riktning). */
export default function SettingsProvider({ children }: { children: React.ReactNode }) {
  const s = useSettings();
  const systemDark = useSyncExternalStore(
    subscribeDark,
    () => matchMedia('(prefers-color-scheme: dark)').matches,
    () => false
  );

  useEffect(() => {
    const d = document.documentElement;
    d.dataset.theme = s.theme === 'system' ? (systemDark ? 'dark' : 'light') : s.theme;
    d.dataset.accent = s.accent;
    d.dataset.textSize = s.textSize;
    d.dataset.motion = s.reduceMotion ? 'reduce' : 'full';
    d.lang = s.language;
    d.dir = RTL_LANGUAGES.includes(s.language) ? 'rtl' : 'ltr';
  }, [s, systemDark]);

  return <MotionConfig reducedMotion={s.reduceMotion ? 'always' : 'user'}>{children}</MotionConfig>;
}

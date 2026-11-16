'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { m as motion } from 'framer-motion';
import { useFeatures } from '@/lib/useFeatures';
import type { FeatureId } from '@/lib/features';
import { BarChart3, ChefHat, DoorOpen, LayoutGrid, LogOut, Map as MapIcon, Settings2, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useEngineStatus } from '@/lib/useEngineStatus';
import { useT, type Key } from '@/lib/i18n';
import Logo from './Logo';
import Photo from './Photo';
import SetupChat from './SetupChat';
import SetupGate from './SetupGate';
import SupportAccessBanner from './SupportAccessBanner';

// Sidor som inte fungerar förrän installationen är klar
const NEEDS_SETUP = new Set(['/matsal', '/kitchen']);

async function signOut() {
  await supabase.auth.signOut();
  // Landningssidan är vanlig HTML (public/landing), inte en Next.js-sida: ladda om helt
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign('/');
}

const LINKS: { href: string; label: Key; icon: typeof LayoutGrid; desktopOnly?: boolean; feature?: FeatureId }[] = [
  { href: '/matsal', label: 'nav.dining', icon: LayoutGrid },
  { href: '/kitchen', label: 'nav.kitchen', icon: ChefHat, feature: 'kitchen' },
  { href: '/entre', label: 'nav.entrance', icon: DoorOpen, feature: 'entrance' },
  { href: '/statistik', label: 'nav.stats', icon: BarChart3, feature: 'stats' },
  { href: '/admin/floor-plan', label: 'nav.floorPlan', icon: MapIcon, desktopOnly: true },
  { href: '/setup', label: 'nav.setup', icon: Settings2 },
  { href: '/settings', label: 'nav.settings', icon: SlidersHorizontal },
];

interface Props {
  title: string;
  subtitle?: React.ReactNode;
  /** Knappar och indikatorer till höger om rubriken */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/** Ramen runt varje sida: meny till vänster på dator, flikrad längst ned på mobil. */
export default function AppShell({ title, subtitle, actions, children }: Props) {
  const pathname = usePathname();
  const engine = useEngineStatus();
  const t = useT();
  const { on, loaded } = useFeatures();
  const links = LINKS.filter((l) => !l.feature || on(l.feature));
  const mobileLinks = links.filter((l) => !l.desktopOnly);
  // Sidan hör till en funktion som ägaren stängt av
  const pageFeature = LINKS.find((l) => l.href === pathname)?.feature;
  const pageOff = loaded && pageFeature !== undefined && !on(pageFeature);

  const engineState =
    engine === null
      ? { text: t('engine.checking'), dot: 'bg-gray-300' }
      : !engine.reachable
        ? { text: t('engine.off'), dot: 'bg-red-500' }
        : !engine.setupComplete
          ? { text: t('engine.waitingSetup'), dot: 'bg-dessert' }
          : engine.aiEnabled
            ? { text: t('engine.on'), dot: 'bg-teal live-dot' }
            : { text: t('engine.paused'), dot: 'bg-dessert' };

  return (
    <div className="flex min-h-screen w-full">
      {/* Sidomeny (dator) */}
      <aside className="sticky top-0 hidden h-screen w-[232px] flex-none flex-col border-r border-line bg-[linear-gradient(180deg,#0B2B45,#071F33)] lg:flex">
        <Link href="/matsal" aria-label={t('nav.toDining')} className="px-5 pb-6 pt-5">
          <Logo />
        </Link>
        <nav aria-label={t('nav.menu')} className="flex flex-col gap-0.5 px-3">
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-[14px] font-semibold transition-colors ${
                  active ? 'text-white' : 'text-body hover:bg-white/[.04] hover:text-ink'
                }`}
              >
                {/* Den mörka markeringen glider till den valda sidan */}
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    className="absolute inset-0 rounded-lg before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-coral before:shadow-[0_0_10px_#FC734D] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-accent)_30%,#0B1B26),color-mix(in_srgb,var(--color-accent)_14%,#07131B))] shadow-[inset_0_1px_0_rgba(255,255,255,.08),inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_40%,transparent),0_8px_20px_-10px_color-mix(in_srgb,var(--color-accent)_60%,transparent)]"
                  />
                )}
                <Icon
                  key={active ? 'on' : 'off'}
                  className={`relative h-[18px] w-[18px] transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-6 ${active ? 'icon-bounce text-accent-light drop-shadow-[0_0_6px_var(--color-accent)]' : ''}`}
                  strokeWidth={2}
                />
                <span className="relative">{t(label)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3 border-t border-line-soft p-4">
          <div className="flex items-center gap-2.5 rounded-lg bg-paper px-3 py-2.5">
            <span className={`h-2 w-2 flex-none rounded-full ${engineState.dot}`} />
            <span className="text-[13px] font-semibold text-ink">{engineState.text}</span>
          </div>
          <p className="flex items-start gap-2 text-[12px] leading-snug text-muted">
            <ShieldCheck className="mt-px h-4 w-4 flex-none text-teal" />
            {t('privacy.short')}
          </p>
          <button type="button" onClick={signOut} className="btn btn-ghost btn-sm justify-start">
            <LogOut className="h-4 w-4" /> {t('nav.logout')}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toppfält (mobil och surfplatta) */}
        <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-white/90 px-4 py-3 lg:hidden">
          <Link href="/matsal" aria-label={t('nav.toDining')}>
            <Logo />
          </Link>
          <span className="flex items-center gap-3 text-[12px] font-semibold text-muted">
            <span className="flex items-center gap-2" title={engineState.text}>
              <span aria-hidden className={`h-2 w-2 rounded-full ${engineState.dot}`} />
              <span className="sr-only sm:not-sr-only">{engineState.text}</span>
            </span>
            {/* Vakti visas här på mobilen (SetupChat), så att bubblan inte täcker knapparna */}
            <span id="vakti-slot" className="flex" />
            <button
              type="button"
              onClick={signOut}
              aria-label={t('nav.logout')}
              title={t('nav.logout')}
              className="btn btn-ghost btn-icon"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </span>
        </div>

        <main className="app-zoom mx-auto w-full max-w-[1320px] flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
          <SupportAccessBanner />
          <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 lg:mb-6">
            <div className="min-w-0">
              <h1 className="font-display text-[26px] font-bold leading-tight tracking-[-0.02em] sm:text-[30px]">
                {title}
              </h1>
              {subtitle && <p className="mt-1 max-w-[720px] text-[15px] text-body">{subtitle}</p>}
            </div>
            {/* Sidans knappar hör till funktionen: döljs när den är avstängd */}
            {actions && !pageOff && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </header>
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {pageOff ? <FeatureOff /> : children}
          </motion.div>
        </main>
      </div>

      {/* Flikrad (mobil och surfplatta) */}
      <nav
        aria-label={t('nav.menu')}
        style={{ gridTemplateColumns: `repeat(${mobileLinks.length}, minmax(0, 1fr))` }}
        className="fixed inset-x-0 bottom-0 z-40 grid border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {mobileLinks.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`relative flex min-h-[60px] flex-col items-center justify-center gap-1 px-0.5 text-center text-[10.5px] font-semibold leading-tight transition-colors sm:text-[11px] ${
                active ? 'text-accent' : 'text-muted'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="tab-active"
                  transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  className="absolute inset-x-3 top-0 h-[3px] rounded-b-full bg-[linear-gradient(90deg,var(--color-accent),#FC734D)] shadow-[0_2px_10px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]"
                />
              )}
              <motion.span animate={{ scale: active ? 1.12 : 1, y: active ? -1 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }}>
                <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
              </motion.span>
              {t(label)}
            </Link>
          );
        })}
      </nav>

      {/* Vakti: hjälper användaren att få igång appen */}
      <SetupChat />
      {NEEDS_SETUP.has(pathname) && <SetupGate />}
    </div>
  );
}

/** Visas i stället för en sida som ägaren har stängt av. */
function FeatureOff() {
  const t = useT();
  return (
    <div className="card flex max-w-[560px] flex-col items-start gap-3 overflow-hidden p-6">
      <Photo src="/photos/sauce.jpg" alt="" className="-mx-6 -mt-6 mb-2 h-40 w-[calc(100%+3rem)]" position="center 40%" />
      <h2 className="font-display text-xl font-bold">{t('off.title')}</h2>
      <p className="text-body">{t('off.text')}</p>
      <Link href="/settings/funktioner" className="btn btn-secondary">
        {t('off.link')}
      </Link>
    </div>
  );
}

'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, m as motion } from 'framer-motion';
import { ArrowLeft, Check, Clock, Minus, Plus, ShoppingBag } from 'lucide-react';
import { cardKey, GuestCard, GuestReview } from './Extras';
import { Key, LANGUAGES, TFunction, useTranslate } from '@/lib/i18n';
import type { Language } from '@/lib/settings';
import { formatPrice, OrderItem, OrderStatus } from '@/lib/types';

// Gästernas beställningssida. Öppnas från QR-koden på bordet, utan inloggning.
// Allt går via /api/guest/<kod>, som kontrollerar koden och hämtar priserna ur menyn.

interface GuestItem {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  allergens: string[];
  available: boolean;
  /** Ungefär så många minuter brukar rätten ta i köket */
  prep_min: number | null;
}
interface GuestMenu {
  restaurant: string;
  table: number;
  currency: string;
  approval: boolean;
  /** false = QR-beställning är av: sidan visar bara betyg och stämpelkort */
  ordering: boolean;
  dessert_time: boolean;
  categories: { id: string; name: string }[];
  items: GuestItem[];
  drink_categories: string[];
  dessert_categories: string[];
  pairs: Record<string, string[]>;
  popular: string[];
  loyalty: { id: string }[];
  card_scope: string;
  /** Ägaren har slagit på betyg / förslag (Anpassa funktioner) */
  reviews: boolean;
  drinks_hint: boolean;
}
interface GuestOrder {
  id: string;
  status: OrderStatus;
  items: OrderItem[];
  created_at: string;
}

const LANG_KEY = 'bordvakt-guest-lang';
const ordersKey = (token: string) => `bordvakt-guest-orders-${token}`;
const KEEP_MS = 4 * 3600_000; // gästens beställningar visas i 4 timmar

function phoneLanguage(): Language {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved && LANGUAGES.some((l) => l.code === saved)) return saved as Language;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag.slice(0, 2).toLowerCase();
    if (LANGUAGES.some((l) => l.code === code)) return code as Language;
  }
  return 'en';
}

function savedOrders(token: string): { id: string; at: number }[] {
  try {
    const list = JSON.parse(localStorage.getItem(ordersKey(token)) ?? '[]') as { id: string; at: number }[];
    return list.filter((o) => Date.now() - o.at < KEEP_MS);
  } catch {
    return [];
  }
}

export default function GuestOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [lang, setLang] = useState<Language>('en');
  const t: TFunction = useTranslate(lang);
  const [menu, setMenu] = useState<GuestMenu | null>(null);
  const [problem, setProblem] = useState<Key | null>(null);
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [view, setView] = useState<'menu' | 'cart' | 'sent'>('menu');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<GuestOrder[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/guest/${token}`, { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) {
      setProblem(res?.status === 404 ? 'guest.invalid' : res?.status === 403 ? 'guest.off' : 'guest.error');
      return;
    }
    setProblem(null);
    setMenu(await res.json());
  }, [token]);

  const loadOrders = useCallback(async () => {
    const ids = savedOrders(token).map((o) => o.id);
    if (ids.length === 0) return;
    const res = await fetch(`/api/guest/${token}/orders?ids=${ids.join(',')}`, { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setOrders(((await res.json()) as GuestOrder[]).sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }, [token]);

  useEffect(() => {
    const first = setTimeout(() => {
      setLang(phoneLanguage());
      load();
      loadOrders();
    }, 0);
    // Statusen på beställningarna och vad som är slut uppdateras medan gästen sitter kvar
    const timer = setInterval(() => {
      loadOrders();
      if (document.visibilityState === 'visible') load();
    }, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, loadOrders]);

  const byId = useMemo(() => new Map((menu?.items ?? []).map((i) => [i.id, i])), [menu]);
  const count = [...cart.values()].reduce((a, b) => a + b, 0);
  const total = [...cart].reduce((sum, [id, qty]) => sum + (byId.get(id)?.price ?? 0) * qty, 0);
  const price = (amount: number) => formatPrice(amount, menu?.currency, lang);

  const sections = useMemo(() => {
    if (!menu) return [];
    const list = menu.categories.map((c) => ({ id: c.id, name: c.name, items: menu.items.filter((i) => i.category_id === c.id) }));
    const known = new Set(menu.categories.map((c) => c.id));
    const other = menu.items.filter((i) => !i.category_id || !known.has(i.category_id));
    if (other.length) list.push({ id: 'other', name: t('guest.other'), items: other });
    return list.filter((s) => s.items.length > 0);
  }, [menu, t]);

  // Förslag i kundvagnen: det som brukar beställas ihop med det gästen valt, och dryck om det saknas
  const suggestions = useMemo(() => {
    if (!menu || cart.size === 0) return [];
    const inCart = new Set(cart.keys());
    const ok = (id: string) => !inCart.has(id) && byId.get(id)?.available;
    const picks: { id: string; drink: boolean }[] = [];
    for (const id of inCart) for (const p of menu.pairs[id] ?? []) if (ok(p) && !picks.some((x) => x.id === p)) picks.push({ id: p, drink: false });
    const drinks = new Set(menu.drink_categories);
    const hasDrink = [...inCart].some((id) => drinks.has(byId.get(id)?.category_id ?? ''));
    if (!hasDrink && drinks.size && menu.drinks_hint) {
      const drink = menu.popular.find((id) => ok(id) && drinks.has(byId.get(id)?.category_id ?? '')) ?? menu.items.find((i) => ok(i.id) && drinks.has(i.category_id ?? ''))?.id;
      if (drink && !picks.some((x) => x.id === drink)) picks.unshift({ id: drink, drink: true });
    }
    return picks.slice(0, 3);
  }, [menu, cart, byId]);

  function change(id: string, delta: number) {
    setCart((prev) => {
      const next = new Map(prev);
      const qty = Math.min(20, (next.get(id) ?? 0) + delta);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });
  }

  async function send() {
    if (count === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/guest/${token}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [...cart].map(([id, qty]) => ({ id, qty })),
          note,
          card: menu?.loyalty.length ? cardKey(menu.card_scope, true) : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && Array.isArray(body.sold_out)) {
          setError(t('guest.soldOutNames', { list: (body.sold_out_names ?? []).join(', ') }));
          load();
        } else {
          setError(t(res.status === 429 ? 'guest.tooMany' : res.status === 404 ? 'guest.invalid' : res.status === 403 ? 'guest.off' : 'guest.error'));
        }
        return;
      }
      localStorage.setItem(ordersKey(token), JSON.stringify([...savedOrders(token), { id: body.id, at: Date.now() }]));
      setOrders((prev) => [body as GuestOrder, ...prev]);
      setCart(new Map());
      setNote('');
      setView('sent');
    } catch {
      setError(t('guest.error'));
    } finally {
      setSending(false);
    }
  }

  const rtl = lang === 'ar' || lang === 'ur';

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} lang={lang} className="min-h-dvh bg-paper text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          {view !== 'menu' ? (
            <button type="button" onClick={() => setView('menu')} aria-label={t('guest.back')} className="btn btn-ghost btn-icon">
              <ArrowLeft className={`h-5 w-5 ${rtl ? 'rotate-180' : ''}`} />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg font-bold leading-tight">{menu?.restaurant ?? 'Bordvakt'}</p>
            {menu && <p className="text-[13px] text-muted">{t('guest.table', { n: menu.table })}</p>}
          </div>
          <select
            value={lang}
            onChange={(e) => {
              setLang(e.target.value as Language);
              localStorage.setItem(LANG_KEY, e.target.value);
            }}
            aria-label="Language"
            className="h-10 max-w-[8rem] rounded-lg border border-line bg-white px-2 text-[14px] font-semibold"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        {view === 'menu' && sections.length > 1 && (
          <nav className="mx-auto flex max-w-xl gap-2 overflow-x-auto px-4 pb-3">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#cat-${s.id}`}
                className="flex min-h-10 flex-none items-center rounded-full border border-line bg-white px-4 text-[14px] font-semibold text-body active:bg-paper"
              >
                {s.name}
              </a>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-xl px-4 pb-32 pt-4">
        {problem && <p className="card p-5 text-center text-[15px] text-body">{t(problem)}</p>}
        {!menu && !problem && <p className="py-16 text-center text-muted">{t('guest.loading')}</p>}

        {menu && !menu.ordering && (
          <div className="flex flex-col gap-4">
            <p className="card p-5 text-center text-[15px] text-body">{t('guest.orderAtStaff')}</p>
            {menu.loyalty.length > 0 && <GuestCard token={token} scope={menu.card_scope} t={t} />}
            {menu.reviews && <GuestReview token={token} t={t} />}
          </div>
        )}

        {menu && menu.ordering && view === 'menu' && (
          <>
            {orders.length > 0 && <OrderStatusList orders={orders} t={t} />}
            {menu.dessert_time && menu.dessert_categories.some((c) => sections.some((s) => s.id === c)) && (
              <a
                href={`#cat-${menu.dessert_categories.find((c) => sections.some((s) => s.id === c))}`}
                className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-dessert-light p-4 text-[15px] font-semibold text-dessert-dark"
              >
                {t('guest.dessertTitle')}
                <span className="btn btn-secondary btn-sm">{t('guest.dessertShow')}</span>
              </a>
            )}
            {sections.length === 0 && <p className="card p-5 text-center text-body">{t('guest.emptyMenu')}</p>}
            {sections.map((s) => (
              <section key={s.id} id={`cat-${s.id}`} className="scroll-mt-32 pb-4">
                <h2 className="eyebrow mb-2 mt-2">{s.name}</h2>
                <ul className="stagger flex flex-col gap-2">
                  {s.items.map((item) => {
                    const qty = cart.get(item.id) ?? 0;
                    return (
                      <li key={item.id} className={`card flex gap-3 p-3.5 transition-shadow duration-200 ${item.available ? '' : 'opacity-55'} ${qty > 0 ? 'shadow-[0_0_0_2px_var(--color-accent)]' : ''}`}>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold leading-snug">{item.name}</p>
                          {item.description && <p className="mt-0.5 text-[13px] text-body">{item.description}</p>}
                          {item.allergens.length > 0 && (
                            <p className="mt-1 text-[12px] text-muted">
                              {t('guest.allergens', {
                                list: item.allergens.map((a) => t(`allergen.${a}` as Key)).join(', '),
                              })}
                            </p>
                          )}
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 font-semibold tabular-nums">
                            {price(item.price)}
                            {item.prep_min ? (
                              <span className="inline-flex items-center gap-1 text-[12px] font-normal text-muted">
                                <Clock className="h-3.5 w-3.5" /> {t('guest.prep', { n: item.prep_min })}
                              </span>
                            ) : null}
                          </p>
                        </div>
                        <div className="flex flex-none items-end">
                          {!item.available ? (
                            <span className="rounded-full bg-paper px-2.5 py-1 text-[12px] font-semibold text-muted">
                              {t('guest.soldOut')}
                            </span>
                          ) : qty === 0 ? (
                            <button type="button" onClick={() => change(item.id, 1)} className="btn btn-secondary btn-sm">
                              <Plus className="h-4 w-4" /> {t('guest.add')}
                            </button>
                          ) : (
                            <Stepper qty={qty} name={item.name} t={t} onChange={(d) => change(item.id, d)} />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {menu.loyalty.length > 0 && <GuestCard token={token} scope={menu.card_scope} t={t} />}
            {menu.reviews && <GuestReview token={token} t={t} />}
          </>
        )}

        {menu && menu.ordering && view === 'cart' && (
          <section className="flex flex-col gap-3">
            <h1 className="font-display text-2xl font-bold">{t('guest.cart')}</h1>
            <ul className="card flex flex-col divide-y divide-line-soft">
              {[...cart].map(([id, qty]) => {
                const item = byId.get(id);
                if (!item) return null;
                return (
                  <li key={id} className="flex items-center gap-3 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{item.name}</p>
                      <p className="text-[13px] tabular-nums text-muted">{price(item.price * qty)}</p>
                    </div>
                    <Stepper qty={qty} name={item.name} t={t} onChange={(d) => change(id, d)} />
                  </li>
                );
              })}
            </ul>
            {suggestions.length > 0 && (
              <div className="flex flex-col gap-2">
                <h2 className="eyebrow">{t(suggestions[0].drink && suggestions.length === 1 ? 'guest.suggestDrink' : 'guest.suggest')}</h2>
                {suggestions.map(({ id }) => {
                  const item = byId.get(id)!;
                  return (
                    <div key={id} className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-white px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{item.name}</p>
                        <p className="text-[13px] tabular-nums text-muted">{price(item.price)}</p>
                      </div>
                      <button type="button" onClick={() => change(id, 1)} className="btn btn-secondary btn-sm">
                        <Plus className="h-4 w-4" /> {t('guest.add')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder={t('guest.note')}
              aria-label={t('guest.note')}
              className="field resize-none"
            />
            <div className="flex items-center justify-between px-1 text-lg font-bold">
              <span>{t('guest.total')}</span>
              <span className="tabular-nums">{price(total)}</span>
            </div>
            <p className="px-1 text-[13px] text-muted">{t('guest.payInfo')}</p>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-800">
                {error}
              </p>
            )}
            <button type="button" onClick={send} disabled={count === 0 || sending} className="btn btn-primary btn-lg w-full">
              {sending ? t('guest.sending') : t('guest.send')}
            </button>
          </section>
        )}

        {menu && menu.ordering && view === 'sent' && (
          <section className="flex flex-col items-center gap-4 py-6 text-center">
            <motion.span
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-teal text-white"
            >
              <Check className="h-8 w-8" strokeWidth={3} />
            </motion.span>
            <p className="font-display text-xl font-bold">{t(menu.approval ? 'guest.sentApprove' : 'guest.sent')}</p>
            <p className="text-[14px] text-muted">{t('guest.payInfo')}</p>
            <div className="w-full text-start">
              <OrderStatusList orders={orders} t={t} />
            </div>
            <button type="button" onClick={() => setView('menu')} className="btn btn-secondary btn-lg">
              {t('guest.orderMore')}
            </button>
          </section>
        )}
      </main>

      {/* Kundvagnen längst ned */}
      <AnimatePresence>
        {menu && menu.ordering && view === 'menu' && count > 0 && (
          <motion.div
            initial={{ y: 80 }}
            animate={{ y: 0 }}
            exit={{ y: 80 }}
            className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]"
          >
            <button type="button" onClick={() => setView('cart')} className="btn btn-primary btn-lg mx-auto flex w-full max-w-xl justify-between">
              <span className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5" />
                {t('guest.cartCount', { n: count })}
              </span>
              <span className="tabular-nums">{price(total)}</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stepper({ qty, name, t, onChange }: { qty: number; name: string; t: TFunction; onChange: (delta: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-white">
      <button type="button" onClick={() => onChange(-1)} aria-label={t('guest.fewer', { name })} className="flex h-11 w-11 items-center justify-center">
        <Minus className="h-4 w-4" />
      </button>
      <span key={qty} className="animate-pop w-6 text-center font-bold tabular-nums">{qty}</span>
      <button type="button" onClick={() => onChange(1)} aria-label={t('guest.more', { name })} className="flex h-11 w-11 items-center justify-center">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function OrderStatusList({ orders, t }: { orders: GuestOrder[]; t: TFunction }) {
  if (orders.length === 0) return null;
  return (
    <section className="mb-4 flex flex-col gap-2">
      <h2 className="eyebrow">{t('guest.yourOrders')}</h2>
      {orders.map((o) => (
        <div key={o.id} className="card flex items-center justify-between gap-3 p-3">
          <p className="min-w-0 truncate text-[14px]">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</p>
          <span
            className={`flex-none rounded-full px-2.5 py-1 text-[12px] font-semibold ${
              o.status === 'CANCELLED'
                ? 'bg-red-50 text-red-800'
                : o.status === 'READY'
                  ? 'bg-teal text-white'
                  : o.status === 'PENDING_APPROVAL'
                    ? 'bg-violet-100 text-violet-800'
                    : 'bg-paper text-body'
            }`}
          >
            {t(`guest.status.${o.status}`)}
          </span>
        </div>
      ))}
    </section>
  );
}

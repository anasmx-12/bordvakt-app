// Bordvakts prenumerationer. Används både i webbläsaren (prislistan) och på servern (Stripe).

export type PlanId = 'month' | 'half_year' | 'year';

export interface Plan {
  id: PlanId;
  label: string;
  /** Pris i kronor per betalning */
  price: number;
  /** Antal månader en betalning gäller */
  months: number;
  /** Text efter priset, t.ex. "/ månad" */
  per: string;
  note?: string;
}

export const PLANS: Plan[] = [
  { id: 'month', label: 'Månad', price: 1500, months: 1, per: '/ månad' },
  { id: 'half_year', label: '6 månader', price: 8500, months: 6, per: '/ 6 månader', note: 'Spara 500 kr' },
  { id: 'year', label: 'År', price: 15000, months: 12, per: '/ år', note: 'Spara 3 000 kr' },
];

export const TRIAL_DAYS = 7;

export const isPlanId = (v: unknown): v is PlanId => PLANS.some((p) => p.id === v);
export const planById = (id: string | null | undefined) => PLANS.find((p) => p.id === id) ?? null;

export const kr = (n: number) => `${n.toLocaleString('sv-SE')} kr`;

/** Prenumerationer som ger tillgång till appen. past_due = kortet nekades, Stripe försöker igen. */
export const ACTIVE_STATUSES = ['trialing', 'active', 'past_due'];

export function hasAccess(r: { billing_exempt?: boolean | null; subscription_status?: string | null } | null) {
  return Boolean(r && (r.billing_exempt || (r.subscription_status && ACTIVE_STATUSES.includes(r.subscription_status))));
}

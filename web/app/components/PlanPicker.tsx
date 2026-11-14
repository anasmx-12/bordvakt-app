'use client';

import { Check } from 'lucide-react';
import { kr, PlanId, PLANS } from '@/lib/plans';

interface Props {
  value: PlanId;
  onChange: (plan: PlanId) => void;
}

/** Tre planer att välja mellan (radioknappar som kort). */
export default function PlanPicker({ value, onChange }: Props) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="field-label mb-1.5">Välj plan</legend>
      {PLANS.map((plan) => {
        const selected = plan.id === value;
        return (
          <label
            key={plan.id}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border-[1.5px] px-4 py-3 transition-colors ${
              selected ? 'border-ink bg-paper' : 'border-line hover:border-muted'
            }`}
          >
            <input
              type="radio"
              name="plan"
              value={plan.id}
              checked={selected}
              onChange={() => onChange(plan.id)}
              className="sr-only"
            />
            <span
              aria-hidden
              className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-[1.5px] ${
                selected ? 'border-ink bg-ink text-white' : 'border-muted'
              }`}
            >
              {selected && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold text-ink">{plan.label}</span>
              {plan.note && <span className="text-[13px] font-semibold text-teal">{plan.note}</span>}
            </span>
            <span className="text-right">
              <span className="font-display text-lg font-bold text-ink">{kr(plan.price)}</span>
              <span className="block text-[12px] text-muted">{plan.per}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

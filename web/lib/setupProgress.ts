// Installationens steg: ordning, namn och ungefärlig tid. Inga @/-importer (testas med node --test).

export type SetupStepId = 'restaurant' | 'floor_plan' | 'cameras' | 'calibrate' | 'menu' | 'extras' | 'done';

export const SETUP_STEPS: { id: SetupStepId; label: string; minutes: number }[] = [
  { id: 'restaurant', label: 'Restaurang', minutes: 2 },
  { id: 'floor_plan', label: 'Planritning', minutes: 5 },
  { id: 'cameras', label: 'Kameror', minutes: 10 },
  { id: 'calibrate', label: 'Kalibrering', minutes: 5 },
  { id: 'menu', label: 'Meny (valfritt)', minutes: 5 },
  { id: 'extras', label: 'Tillval', minutes: 2 },
  { id: 'done', label: 'Klart', minutes: 0 },
];

/** Steg X av Y, för mobilens rad överst. */
export function progress(step: SetupStepId) {
  const i = SETUP_STEPS.findIndex((s) => s.id === step);
  const s = SETUP_STEPS[Math.max(0, i)];
  return { index: Math.max(0, i) + 1, total: SETUP_STEPS.length, label: s.label, minutes: s.minutes };
}

/** Antal klara steg av de fyra som krävs innan Matsalen öppnas. */
export function requiredDone(step: string): number {
  const i = ['restaurant', 'floor_plan', 'cameras', 'calibrate', 'done'].indexOf(step);
  return i < 0 ? 0 : i;
}

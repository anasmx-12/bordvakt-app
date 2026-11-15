// Kön för tryck som görs utan uppkoppling. Bara säkra "klar"-tryck köas: en uppgift klar
// (eventuellt falsklarm) och en beställning serverad. Inga @/-importer (testas med node --test).

export type QueuedAction = { kind: 'task'; id: string; falseAlarm?: boolean } | { kind: 'serve'; id: string };
export type Queued = QueuedAction & { at: number };
/** ok = skickat, gone = finns inte längre eller redan gjort, retry = försök igen senare */
export type SendResult = 'ok' | 'gone' | 'retry';

/** Ett tryck som väntat längre än så här skickas inte: läget i matsalen har hunnit ändras. */
export const MAX_AGE_MS = 15 * 60_000;

const same = (a: QueuedAction, b: QueuedAction) => a.kind === b.kind && a.id === b.id;

/** Lägger till ett tryck. Ett tidigare tryck på samma sak ersätts. */
export function enqueue(list: Queued[], action: QueuedAction, now: number): Queued[] {
  return [...list.filter((x) => !same(x, action)), { ...action, at: now }];
}

/** Bara tryck som inte är för gamla. */
export function fresh(list: Queued[], now: number): Queued[] {
  return list.filter((x) => now - x.at <= MAX_AGE_MS);
}

/** Skickar i ordning. Stannar vid första som ska försökas igen och returnerar det som är kvar. */
export async function drain(list: Queued[], send: (a: Queued) => Promise<SendResult>, now: number): Promise<Queued[]> {
  const queue = fresh(list, now);
  for (let i = 0; i < queue.length; i++) {
    let result: SendResult;
    try {
      result = await send(queue[i]);
    } catch {
      result = 'retry';
    }
    if (result === 'retry') return queue.slice(i);
  }
  return [];
}

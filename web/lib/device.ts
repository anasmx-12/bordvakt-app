// Den här enheten: hur appen läggs på hemskärmen, och om skärmen ska hållas vaken.
// Inga @/-importer (testas med node --test).

export type InstallMethod = 'installed' | 'prompt' | 'ios' | 'other';

/** installed = redan på hemskärmen, prompt = webbläsaren har en installationsknapp, ios = steg för Safari */
export function installMethod(d: { ua: string; standalone: boolean; canPrompt: boolean; touchPoints: number }): InstallMethod {
  if (d.standalone) return 'installed';
  if (d.canPrompt) return 'prompt';
  // iPad i Safari säger att den är en Mac, men har pekskärm
  const ios = /iPhone|iPad|iPod/.test(d.ua) || (/Macintosh/.test(d.ua) && d.touchPoints > 1);
  return ios ? 'ios' : 'other';
}

/** Från början vaken bara på installerade surfplattor: en mobil i fickan ska inte laddas ur. */
export function wakeDefault(d: { standalone: boolean; width: number }): boolean {
  return d.standalone && d.width >= 768;
}

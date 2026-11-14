// Översättning utan React: används både i appen och på servern (t.ex. mobil-larm).
import type { Language } from '../settings';
import sv, { Dict, Key } from './sv';
import en from './en';
import zh from './zh';
import hi from './hi';
import es from './es';
import ar from './ar';
import fr from './fr';
import bn from './bn';
import pt from './pt';
import ru from './ru';
import ur from './ur';
import id from './id';
import de from './de';
import ja from './ja';
import tr from './tr';
import ko from './ko';


const DICTS: Record<Language, Dict> = { sv, en, zh, hi, es, ar, fr, bn, pt, ru, ur, id, de, ja, tr, ko };

export function translate(lang: Language, key: Key, vars?: Record<string, string | number>): string {
  const text = DICTS[lang]?.[key] ?? sv[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m)) : text;
}

import 'server-only';
import { UserError } from './server';

// Lösenord som testas först när någon försöker gissa
const COMMON = /^(password|passw0rd|lösenord|losenord|qwerty|qwertyuiop|asdfghjkl|abc123|letmein|welcome|välkommen|valkommen|admin|restaurang|bordvakt|iloveyou|sommar|vinter)\d*[!.]?$/i;

export function weakPassword(password: string, email: string, restaurant: string) {
  const p = password.toLowerCase();
  if (COMMON.test(p)) return true;
  if (/^(.)\1+$/.test(p) || /^(0123456789|1234567890|9876543210)/.test(p) || /^\d+$/.test(p)) return true;
  const name = email.split('@')[0];
  if (name.length >= 4 && p.includes(name)) return true;
  const shop = restaurant.toLowerCase().replace(/\s+/g, '');
  return shop.length >= 4 && p.replace(/\s+/g, '').includes(shop);
}

/** Kontrollerar ett nytt lösenord (registrering och nytt lösenord via supportens länk). */
export function checkNewPassword(password: unknown, email: string, restaurant = ''): string {
  if (typeof password !== 'string' || password.length < 10) throw new UserError('Lösenordet måste ha minst 10 tecken');
  if (password.length > 72) throw new UserError('Lösenordet får ha högst 72 tecken');
  if (weakPassword(password, email, restaurant)) {
    throw new UserError('Lösenordet är för lätt att gissa. Välj något längre som inte innehåller e-postadressen eller restaurangens namn.');
  }
  return password;
}

// Skapar den första administratören (eller skickar en ny länk till en befintlig).
//   npm run create-support-admin -- "Förnamn Efternamn" din@epost.se
// Frågar efter namn och e-post och skriver ut en länk där personen väljer sitt lösenord.
// Körs i webbappen (web/), som har nyckeln till databasen. Supportsajten har den inte.
// Kräver att supabase/019_support_staff.sql är körd och att web/.env.local är ifylld.
import { createInterface } from 'node:readline/promises';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Fyll i NEXT_PUBLIC_SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY i web/.env.local först.');
  process.exit(1);
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// Namn och e-post kan ges direkt: npm run create-support-admin -- "Anna Lindqvist" anna@exempel.se
let [name = '', email = ''] = process.argv.slice(2);
if (!name || !email) {
  if (!process.stdin.isTTY) {
    console.error('Skriv så här: npm run create-support-admin -- "Förnamn Efternamn" din@epost.se');
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  name ||= await rl.question('Förnamn och efternamn: ');
  email ||= await rl.question('E-post (en egen adress, inte ett kundkonto): ');
  rl.close();
}
name = name.trim();
email = email.trim().toLowerCase();
if (name.split(' ').length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Skriv både förnamn och efternamn, och en giltig e-post.');
  process.exit(1);
}

let userId;
const { data: existing } = await db.from('support_staff').select('user_id').eq('email', email).maybeSingle();
if (existing) {
  userId = existing.user_id;
  await db.from('support_staff').update({ role: 'admin', active: true }).eq('user_id', userId);
  console.log('Kontot finns redan: det blir administratör och får en ny länk.');
} else {
  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomBytes(36).toString('base64url'),
    app_metadata: { bordvakt_staff: true },
    user_metadata: { name },
  });
  if (error) {
    console.error(/already/i.test(error.message) ? 'Adressen används redan av ett annat konto (t.ex. ett kundkonto). Använd en annan.' : error.message);
    process.exit(1);
  }
  userId = data.user.id;
  const { error: e2 } = await db.from('support_staff').insert({ user_id: userId, name, email, role: 'admin' });
  if (e2) {
    await db.auth.admin.deleteUser(userId);
    console.error(/support_staff/.test(e2.message) ? 'Kör supabase/019_support_staff.sql i Supabase först.' : e2.message);
    process.exit(1);
  }
}

const token = randomBytes(32).toString('base64url');
await db.from('support_invites').delete().eq('user_id', userId);
await db.from('support_invites').insert({
  token_hash: createHash('sha256').update(`support-invite:${token}`).digest('hex'),
  user_id: userId,
  expires_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
});
await db.from('support_audit').insert({ staff_id: null, staff_name: 'Terminal (create-admin)', action: 'staff_invite', target_type: 'staff', target_id: userId, detail: { name, email, role: 'admin' } });
const site = (env.SUPPORT_SITE_URL || 'http://localhost:3001').replace(/\/$/, '');
console.log(`\nKlart! Öppna länken för att välja lösenord (gäller i 48 timmar, en gång):\n\n  ${site}/valkommen?t=${token}\n`);

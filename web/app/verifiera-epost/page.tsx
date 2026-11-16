'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import EmailCodeForm from '../components/EmailCodeForm';
import Logo from '../components/Logo';

// Inloggad men e-postadressen är inte bekräftad (proxy.ts skickar hit).

async function signOut() {
  await supabase.auth.signOut();
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign('/');
}

export default function VerifyEmailPage() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
  }, []);

  return (
    <main className="aurora-bg flex min-h-screen flex-1 items-center justify-center px-4 py-12">
      <div className="stagger flex w-full max-w-[440px] flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Bordvakt – till startsidan">
            <Logo />
          </Link>
          <button type="button" onClick={signOut} className="btn btn-ghost btn-sm">
            <LogOut className="h-4 w-4" /> Logga ut
          </button>
        </div>
        <div className="card flex flex-col gap-5 p-6 sm:p-8">
          <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">Bekräfta din e-post</h1>
          {email === null ? (
            <div className="skeleton h-40 rounded-lg" />
          ) : (
            <EmailCodeForm
              email={email}
              onVerified={() => {
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.assign('/billing');
              }}
            />
          )}
        </div>
      </div>
    </main>
  );
}

import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';
import Logo from '../components/Logo';
import Banner from '../components/Banner';
import { findReset } from '@/lib/passwordReset';
import NewPasswordForm from './NewPasswordForm';

export const metadata = { title: 'Nytt lösenord · Bordvakt', robots: { index: false } };

export default function NewPassword({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-paper px-4 py-12">
      <div className="stagger flex w-full max-w-[420px] flex-col gap-6">
        <Link href="/" aria-label="Bordvakt – till startsidan" className="self-center">
          <Logo />
        </Link>
        <Suspense fallback={<section className="card h-[260px]" />}>
          <ResetCard searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

/** Kollar länken. Ligger i <Suspense> så att sidans ram kan visas direkt. */
async function ResetCard({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  await connection();
  const { t } = await searchParams;
  const reset = await findReset(t);
  return (
    <section className="card flex flex-col gap-5 p-6 sm:p-8">
      {reset ? (
        <>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">Välj nytt lösenord</h1>
            <p className="mt-1 text-[15px] text-body">För {reset.email}. Du loggas ut på alla enheter och loggar sedan in med det nya lösenordet.</p>
          </div>
          <NewPasswordForm token={t!} email={reset.email} />
        </>
      ) : (
        <>
          <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">Länken fungerar inte</h1>
          <Banner>Länken har gått ut eller har redan använts. Den gäller i en timme. Kontakta Bordvakts support för en ny.</Banner>
          <Link href="/login" className="btn btn-secondary self-start">
            Till inloggningen
          </Link>
        </>
      )}
    </section>
  );
}

import Link from 'next/link';
import { COMPANY, companyReady } from '@/lib/company';

// Gemensam layout för villkor, integritetspolicy och PUB-avtal.
export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex max-w-[760px] flex-col gap-5 p-6 pb-16">
      <nav className="flex flex-wrap gap-4 text-sm font-semibold text-muted">
        <Link href="/" className="hover:text-ink">Bordvakt</Link>
        <Link href="/villkor" className="hover:text-ink">Villkor</Link>
        <Link href="/integritet" className="hover:text-ink">Integritet</Link>
        <Link href="/pub-avtal" className="hover:text-ink">PUB-avtal</Link>
      </nav>
      {!companyReady() && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          Utkast: företagsuppgifterna är inte ifyllda (web/lib/company.ts) och texten är inte granskad av en jurist.
        </p>
      )}
      <h1 className="font-display text-3xl font-bold">{title}</h1>
      <p className="text-sm text-muted">Senast uppdaterad {COMPANY.updated}</p>
      <div className="legal flex flex-col gap-3 text-[15px] leading-relaxed text-body">{children}</div>
    </main>
  );
}

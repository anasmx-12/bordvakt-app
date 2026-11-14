'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Banner from '../components/Banner';

export default function NewPasswordForm({ token, email }: { token: string; email: string }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) return setError('Lösenorden är inte likadana.');
    setBusy(true);
    setError(null);
    const res = await fetch('/api/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setError(data.error ?? 'Kunde inte spara lösenordet.');
    else setDone(true);
  }

  if (done) {
    return (
      <div className="animate-rise flex flex-col gap-4">
        <p className="flex items-center gap-2 font-semibold text-teal">
          <CheckCircle2 className="h-5 w-5" /> Lösenordet är bytt.
        </p>
        <Link href="/login" className="btn btn-primary btn-lg">
          Logga in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && <Banner role="alert">{error}</Banner>}
      <input type="email" value={email} autoComplete="username" readOnly hidden />
      <label className="field-label">
        Nytt lösenord
        <input type="password" required minLength={10} maxLength={72} autoComplete="new-password" placeholder="Minst 10 tecken" value={password} onChange={(e) => setPassword(e.target.value)} className="field min-h-12 text-[16px]" />
      </label>
      <label className="field-label">
        Samma lösenord igen
        <input type="password" required autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className="field min-h-12 text-[16px]" />
      </label>
      <button type="submit" disabled={busy || password.length < 10} className="btn btn-primary btn-lg">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Spara nytt lösenord
      </button>
    </form>
  );
}

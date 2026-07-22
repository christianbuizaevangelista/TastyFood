import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiError } from '../api/client';

// Public "where is my application" page. The tracking code alone is short
// enough to be guessed, so the email address on the application is asked for
// too — the pair is what opens the private tracker link.

export default function Track() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const { data } = await api.post<{ token: string }>('/public/apply/lookup', {
        code: code.trim(),
        email: email.trim(),
      });
      navigate(`/apply/status/${data.token}`);
    } catch (e2) {
      setErr(apiError(e2));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-brand-600 px-4 py-10 text-white">
        <div className="mx-auto max-w-md">
          <img src="/tasty-food-splash.png" alt="Tasty Food" className="mb-4 h-12 w-auto" />
          <h1 className="text-3xl font-bold">Track your application</h1>
          <p className="mt-2 text-green-50">
            Enter the tracking code from your confirmation email to see where your application is.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-md px-4 py-10">
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-100 bg-white p-7 shadow-sm">
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Tracking code *</label>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-3 text-center text-lg font-bold uppercase tracking-widest outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="TF-XXXX-XXXX"
              autoComplete="off"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Email address *</label>
            <input
              type="email"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="the address you applied with"
              required
            />
            <p className="mt-1 text-xs text-slate-400">
              We ask for this so nobody else can look up your application with just the code.
            </p>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-brand-600 px-6 py-3.5 font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? 'Looking…' : 'Track my application'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Lost your code? Check the email we sent when you applied — or{' '}
          <a href="/apply" className="font-semibold text-brand-600 hover:underline">
            start a new application
          </a>
          .
        </p>
      </div>
    </div>
  );
}

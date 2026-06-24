import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiError } from '../api/client';
import { Alert } from '../components/ui';

const QUICK = [
  { label: 'Principal', email: 'principal@tasty.test' },
  { label: 'Provincial', email: 'provincial1@tasty.test' },
  { label: 'City', email: 'city1@tasty.test' },
  { label: 'Reseller', email: 'reseller1@tasty.test' },
];

export default function Login() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('principal@tasty.test');
  const [password, setPassword] = useState('Password123!');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-600 to-brand-800 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-100 bg-white p-1">
            <img src="/tasty-food-logo.png" alt="Tasty Food" className="h-full w-full object-contain" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900">Tasty Food Manufacturing Inc.</div>
            <div className="text-xs text-slate-500">Distribution Management System (DMS)</div>
          </div>
        </div>
        <h1 className="mb-1 text-xl font-bold text-slate-900">Distribution Portal</h1>
        <p className="mb-5 text-sm text-slate-500">Sign in to manage your distribution network.</p>

        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </div>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 border-t border-slate-100 pt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Demo logins (password: Password123!)
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <button
                key={q.email}
                type="button"
                onClick={() => setEmail(q.email)}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-600"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

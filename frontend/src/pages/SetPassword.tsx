import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiError } from '../api/client';
import { Alert, Spinner } from '../components/ui';

export default function SetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [info, setInfo] = useState<{ name: string; email: string; orgName: string } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadErr('Missing invite token.');
      setLoading(false);
      return;
    }
    api
      .get(`/auth/invite/${token}`)
      .then(({ data }) => setInfo(data))
      .catch((err) => setLoadErr(apiError(err)))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await api.post('/auth/accept-invite', { token, password });
      setDone(true);
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
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold-500 text-2xl font-black text-brand-900">
            JP
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900">Juan Palaman</div>
            <div className="text-xs text-slate-500">Tasty Food Manufacturing Inc.</div>
          </div>
        </div>

        {loading ? (
          <Spinner />
        ) : loadErr ? (
          <>
            <Alert>{loadErr}</Alert>
            <p className="mt-4 text-sm text-slate-500">
              Ask your administrator to resend your invite, then{' '}
              <Link to="/login" className="text-brand-600 underline">go to sign in</Link>.
            </p>
          </>
        ) : done ? (
          <div className="space-y-4">
            <Alert kind="success">Your password has been set. You can now sign in.</Alert>
            <Link to="/login" className="btn-primary block w-full text-center">Go to sign in</Link>
          </div>
        ) : (
          <>
            <h1 className="mb-1 text-xl font-bold text-slate-900">Set your password</h1>
            <p className="mb-5 text-sm text-slate-500">
              Hi {info?.name}, set a password to access <strong>{info?.orgName}</strong> ({info?.email}).
            </p>
            {error && <div className="mb-4"><Alert>{error}</Alert></div>}
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="label">New password</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div>
                <label className="label">Confirm password</label>
                <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>
              <button className="btn-primary w-full" disabled={busy}>
                {busy ? 'Saving…' : 'Set password & continue'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

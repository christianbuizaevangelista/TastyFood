import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiError } from '../api/client';
import { Alert, Spinner } from '../components/ui';

// Distributor portal Terms & Conditions shown on the set-password page. This is
// a starting draft for the owner to review and edit — the signed Distributorship
// Agreement remains the governing contract; these terms cover portal use and
// restate the key commitments so acceptance is informed.
const TERMS: { heading: string; body: string }[] = [
  {
    heading: '1. Distributorship Agreement',
    body: 'By accepting these terms you confirm that you have read, understood, and agree to be bound by the Tasty Food Manufacturing Inc. Distributorship Agreement for your appointed tier (Provincial, City, or Reseller). These portal terms supplement — and do not replace — that signed agreement, which remains the governing contract between you and the Company.',
  },
  {
    heading: '2. Security bond & initial order',
    body: 'You acknowledge the capital requirements for your tier: a Provincial distributor posts a ₱100,000 refundable security bond plus a ₱100,000 initial order; a City distributor a ₱30,000 refundable security bond plus a ₱30,000 initial order; a Reseller a ₱5,000 minimum initial order. The security bond is refundable strictly under the terms of the partnership agreement.',
  },
  {
    heading: '3. Assigned territory',
    body: 'Your account operates within the territory assigned to you by the Company. You agree to service your assigned area in good faith and not to divert orders outside the distribution structure. The Company may adjust territory assignments in line with the agreement.',
  },
  {
    heading: '4. Pricing & product handling',
    body: 'You agree to observe the Company’s suggested pricing and to store, handle, and sell Tasty Food products in accordance with the Company’s GMP standards and any product guidance provided, preserving product quality and the Tasty Food brand.',
  },
  {
    heading: '5. Portal & account use',
    body: 'Your login is personal to your account. You are responsible for keeping your password confidential and for all activity under your account. Information accessed through this portal — pricing, network, and customer data — is confidential and must be used only to operate your Tasty Food distributorship.',
  },
  {
    heading: '6. Data privacy',
    body: 'The Company processes your details to administer your distributorship in line with the Data Privacy Act of 2012 (RA 10173). You may raise data concerns to the Company at any time.',
  },
  {
    heading: '7. Termination',
    body: 'Either party may end the distributorship as provided in the Distributorship Agreement. On termination, portal access is withdrawn and any bond is settled according to the agreement.',
  },
];

export default function SetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [info, setInfo] = useState<{ name: string; email: string; orgName: string } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
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
    if (!accepted) return setError('Please accept the Terms & Conditions to continue.');
    setBusy(true);
    try {
      await api.post('/auth/accept-invite', { token, password, acceptedTerms: true });
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
          <img src="/tasty-food-splash.png" alt="Tasty Food" className="h-12 w-auto object-contain" />
          <div>
            <div className="text-lg font-bold text-slate-900">Tasty Food Manufacturing Inc.</div>
            <div className="text-xs text-slate-500">Distribution Management System (DMS)</div>
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
              <label className="flex items-start gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                <span>
                  I have read and accept the{' '}
                  <button
                    type="button"
                    onClick={() => setShowTerms(true)}
                    className="font-semibold text-brand-600 underline"
                  >
                    Terms &amp; Conditions
                  </button>
                  .
                </span>
              </label>
              <button className="btn-primary w-full" disabled={busy || !accepted}>
                {busy ? 'Saving…' : 'Set password & continue'}
              </button>
            </form>
          </>
        )}
      </div>

      {showTerms && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowTerms(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-bold text-slate-900">Distributor Terms &amp; Conditions</h2>
              <button
                type="button"
                onClick={() => setShowTerms(false)}
                className="text-2xl leading-none text-slate-400 hover:text-slate-600"
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-6 py-5 text-sm text-slate-600">
              {TERMS.map((t) => (
                <div key={t.heading}>
                  <h3 className="mb-1 font-semibold text-slate-800">{t.heading}</h3>
                  <p>{t.body}</p>
                </div>
              ))}
            </div>
            <div className="border-t px-6 py-4">
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => {
                  setAccepted(true);
                  setShowTerms(false);
                }}
              >
                I accept
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

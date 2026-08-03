import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiError } from '../api/client';
import { Alert, Spinner } from '../components/ui';
import { PRIVACY_POLICY } from './privacyPolicy';

// Documents a new distributor must acknowledge before their account is
// activated. The two manuals open as PDFs (served from /docs); the Privacy
// Policy opens in a modal.
type AckKey = 'operationsManual' | 'codeOfConduct' | 'privacyPolicy' | 'legallyBound';

export default function SetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [info, setInfo] = useState<{ name: string; email: string; orgName: string } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acks, setAcks] = useState<Record<AckKey, boolean>>({
    operationsManual: false,
    codeOfConduct: false,
    privacyPolicy: false,
    legallyBound: false,
  });
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const allAccepted = Object.values(acks).every(Boolean);
  const setAck = (k: AckKey, v: boolean) => setAcks((prev) => ({ ...prev, [k]: v }));

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
    if (!allAccepted) return setError('Please tick all four items to continue.');
    setBusy(true);
    try {
      await api.post('/auth/accept-invite', { token, password, acknowledgements: acks });
      setDone(true);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  // A checkbox row whose label may contain a document link.
  const AckRow = ({ k, children }: { k: AckKey; children: React.ReactNode }) => (
    <label className="flex items-start gap-2 text-sm text-slate-600">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        checked={acks[k]}
        onChange={(e) => setAck(k, e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );

  const docLink = 'font-semibold text-brand-600 underline';

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

              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Before you continue, please review and accept:
                </p>
                <AckRow k="operationsManual">
                  I have read and understood the{' '}
                  <a href="/docs/distributor-operations-manual.pdf" target="_blank" rel="noopener noreferrer" className={docLink}>
                    Distributor Operations Manual
                  </a>.
                </AckRow>
                <AckRow k="codeOfConduct">
                  I have read and understood the{' '}
                  <a href="/docs/distributor-code-of-conduct.pdf" target="_blank" rel="noopener noreferrer" className={docLink}>
                    Distributor Code of Conduct
                  </a>.
                </AckRow>
                <AckRow k="privacyPolicy">
                  I have read and understood the{' '}
                  <button type="button" onClick={() => setShowPrivacy(true)} className={docLink}>
                    Privacy Policy
                  </button>.
                </AckRow>
                <AckRow k="legallyBound">I agree to be legally bound by the above documents.</AckRow>
              </div>

              <button className="btn-primary w-full" disabled={busy || !allAccepted}>
                {busy ? 'Saving…' : 'Set password & continue'}
              </button>
            </form>
          </>
        )}
      </div>

      {showPrivacy && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowPrivacy(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Privacy Policy</h2>
                <p className="text-xs text-slate-400">
                  {PRIVACY_POLICY.code} · v{PRIVACY_POLICY.version} · Effective {PRIVACY_POLICY.effective}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPrivacy(false)}
                className="text-2xl leading-none text-slate-400 hover:text-slate-600"
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-6 py-5 text-sm text-slate-600">
              {PRIVACY_POLICY.sections.map((s) => (
                <div key={s.heading}>
                  <h3 className="mb-1 font-semibold text-slate-800">{s.heading}</h3>
                  {s.paras?.map((p, i) => (
                    <p key={i} className="mb-1">{p}</p>
                  ))}
                  {s.bullets && (
                    <ul className="ml-5 list-disc space-y-0.5">
                      {s.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <div className="border-t px-6 py-4">
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => {
                  setAck('privacyPolicy', true);
                  setShowPrivacy(false);
                }}
              >
                I have read and understood the Privacy Policy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

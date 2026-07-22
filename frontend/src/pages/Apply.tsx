import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, apiError } from '../api/client';
import AddressPicker, { AddressParts } from '../components/AddressPicker';

// Public distributorship application (no login). Reached from the thank-you
// email after an orientation, or straight from an ad.

type Tier = 'PROVINCIAL' | 'CITY' | 'RESELLER';

const TIERS: { value: Tier; label: string; territory: string; entry: string; blurb: string }[] = [
  {
    value: 'PROVINCIAL', label: 'Provincial Distributor', territory: 'Province-wide',
    entry: '20% off SRP', blurb: 'Buy straight from the factory and supply the cities under you.',
  },
  {
    value: 'CITY', label: 'City Distributor', territory: 'City or municipality',
    entry: '15% off SRP', blurb: 'Cover one city and supply the resellers working in it.',
  },
  {
    value: 'RESELLER', label: 'Reseller', territory: 'Your own area',
    entry: '8% off SRP', blurb: 'Sell in your barangay, online, or through your own store.',
  },
];

export default function Apply() {
  const [params] = useSearchParams();
  const ref = params.get('ref') ?? undefined;

  const [formsAvailable, setFormsAvailable] = useState<string[]>([]);
  const [done, setDone] = useState<{ token: string; code: string; formAvailable: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    tier: '' as '' | Tier,
    name: '', email: '', phone: '',
    address: '', barangay: '', city: '', province: '',
    businessName: '', hasStore: false, experience: '', capital: '', targetArea: '', note: '',
    website: '',
  });
  const set = (k: keyof typeof f, v: unknown) => setF((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    api
      .get<{ formsAvailable: string[] }>('/public/apply/config')
      .then(({ data }) => setFormsAvailable(data.formsAvailable ?? []))
      .catch(() => setFormsAvailable([]));
  }, []);

  function onParts(p: AddressParts) {
    setF((prev) => ({
      ...prev,
      province: p.province ?? '',
      city: p.city ?? '',
      barangay: p.barangay ?? '',
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.tier) {
      setErr('Please choose which level you are applying for.');
      return;
    }
    if (!f.targetArea.trim()) {
      setErr("Please tell us which area you want to cover.");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post<{ token: string; code: string; formAvailable: boolean }>('/public/apply', {
        ...f,
        tier: f.tier,
        capital: f.capital ? Number(f.capital) : undefined,
        ref,
      });
      setDone({ token: data.token, code: data.code, formAvailable: data.formAvailable });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Confirmation --------------------------------------------------------
  if (done) {
    const tier = TIERS.find((t) => t.value === f.tier);
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-12">
        <div className="mx-auto max-w-lg overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">
              ✓
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Application received</h1>
            <p className="mt-2 text-slate-600">
              Thank you, {f.name.split(' ')[0]}. We're reviewing your application to become a{' '}
              <strong>{tier?.label}</strong> and we've emailed a copy to {f.email}.
            </p>

            {done.code && (
              <div className="mt-6 rounded-xl border-2 border-dashed border-brand-500 px-5 py-4">
                <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Your tracking code
                </div>
                <div className="mt-1 text-2xl font-bold tracking-widest text-brand-700">{done.code}</div>
                <p className="mt-2 text-xs text-slate-500">
                  Write this down. You can check your progress any time at{' '}
                  <a href="/track" className="font-semibold text-brand-600 hover:underline">
                    /track
                  </a>{' '}
                  with this code and your email address. It's in your email too.
                </p>
              </div>
            )}

            {done.formAvailable && (
              <a
                href={`/api/public/apply/${done.token}/form`}
                className="mt-6 inline-block rounded-xl bg-brand-600 px-6 py-3 font-bold text-white transition hover:bg-brand-700"
              >
                Download the {tier?.label} form
              </a>
            )}

            <div className="mt-6 rounded-xl bg-slate-50 p-5 text-left text-sm text-slate-600">
              <div className="mb-2 font-semibold text-slate-800">What happens next</div>
              <ol className="list-decimal space-y-1 pl-5">
                <li>We check whether your area is still open.</li>
                <li>We invite you to a short meeting — Zoom or at our office.</li>
                <li>You sign, place your first order, and we onboard you.</li>
              </ol>
            </div>

            <a
              href={`/apply/status/${done.token}`}
              className="mt-6 inline-block text-sm font-semibold text-brand-600 hover:underline"
            >
              Track your application and request a meeting →
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ---- Form ----------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-brand-600 px-4 py-10 text-white">
        <div className="mx-auto max-w-2xl">
          <img src="/tasty-food-splash.png" alt="Tasty Food" className="mb-4 h-12 w-auto" />
          <h1 className="text-3xl font-bold">Apply to become a distributor</h1>
          <p className="mt-2 text-green-50">
            About five minutes. We'll confirm whether your area is still open and send you the
            official form for the level you pick.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-10">
        {err && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
        )}

        <form onSubmit={submit} className="space-y-6">
          <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="mb-1 font-bold text-slate-800">Which level are you applying for? *</h2>
            <p className="mb-4 text-xs text-slate-500">
              Not sure? Pick the closest — we'll talk it through at the meeting.
            </p>
            <div className="space-y-2">
              {TIERS.map((t) => {
                const picked = f.tier === t.value;
                return (
                  <label
                    key={t.value}
                    className={`flex cursor-pointer gap-3 rounded-lg border px-4 py-3 transition ${
                      picked ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio" name="tier" value={t.value} checked={picked}
                      onChange={() => set('tier', t.value)} className="mt-1 h-4 w-4 accent-brand-600"
                    />
                    <span className="flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-800">{t.label}</span>
                        <span className="text-xs font-medium text-brand-700">{t.entry}</span>
                      </span>
                      <span className="block text-sm text-slate-500">{t.blurb}</span>
                      <span className="block text-xs text-slate-400">Territory: {t.territory}</span>
                      {formsAvailable.includes(t.value) && (
                        <span className="mt-1 inline-block text-xs text-green-600">
                          Official form sent on submission
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="font-bold text-slate-800">About you</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Full name *</label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={f.name} onChange={(e) => set('name', e.target.value)} required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Mobile number *</label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={f.phone} onChange={(e) => set('phone', e.target.value)} required placeholder="0917 123 4567"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email address *</label>
              <input
                type="email"
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                value={f.email} onChange={(e) => set('email', e.target.value)} required
              />
              <p className="mt-1 text-xs text-slate-400">We send the form and your meeting details here.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Where are you based? *</label>
              <AddressPicker onChange={(a) => set('address', a)} onParts={onParts} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Area you want to cover *</label>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                value={f.targetArea} onChange={(e) => set('targetArea', e.target.value)} required
                placeholder="e.g. Tanza and Naic, or the whole of Cavite"
              />
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="font-bold text-slate-800">Your business</h2>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Business name (if any)</label>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                value={f.businessName} onChange={(e) => set('businessName', e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox" className="h-4 w-4 accent-brand-600"
                checked={f.hasStore} onChange={(e) => set('hasStore', e.target.checked)}
              />
              I already have a store, warehouse, or selling space
            </label>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Capital you're ready to invest</label>
              <input
                type="number" min={0} step={1000}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                value={f.capital} onChange={(e) => set('capital', e.target.value)} placeholder="in pesos"
              />
              <p className="mt-1 text-xs text-slate-400">A rough figure is fine — it helps us suggest the right level.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Selling experience</label>
              <textarea
                rows={3}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                value={f.experience} onChange={(e) => set('experience', e.target.value)}
                placeholder="What have you sold before, and where?"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Anything else we should know?</label>
              <textarea
                rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                value={f.note} onChange={(e) => set('note', e.target.value)}
              />
            </div>
          </section>

          {/* Honeypot — hidden from real users; bots fill it and get filtered. */}
          <input
            type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
            className="hidden" value={f.website} onChange={(e) => set('website', e.target.value)}
          />

          <button
            type="submit" disabled={submitting}
            className="w-full rounded-xl bg-brand-600 px-6 py-3.5 font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {submitting ? 'Sending your application…' : 'Submit my application'}
          </button>
          <p className="text-center text-xs text-slate-400">
            We'll only use your details to process this application and contact you about it.
          </p>
        </form>
      </div>
    </div>
  );
}

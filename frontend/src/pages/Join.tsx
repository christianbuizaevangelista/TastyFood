import { useEffect, useState } from 'react';
import { api, apiError } from '../api/client';

// Public recruitment landing page (no login). Ads point here; visitors register
// for the Zoom orientation and become leads in the configured funnel.

interface Webinar {
  id: string;
  title: string;
  headline: string | null;
  description: string | null;
  scheduledAt: string | null;
}
interface Zoom {
  link: string | null;
  meetingId: string | null;
  passcode: string | null;
  scheduledAt: string | null;
  title: string;
}

const INTERESTS = [
  { value: 'PROVINCIAL', label: 'Provincial Distributor', hint: 'Cover an entire province' },
  { value: 'CITY', label: 'City Distributor', hint: 'Cover a city or municipality' },
  { value: 'RESELLER', label: 'Reseller', hint: 'Sell within your area' },
  { value: 'RETAIL', label: 'Retail Distributor', hint: 'Supply your own store' },
  { value: 'UNSURE', label: 'Not sure yet', hint: "I'd like to learn more first" },
];

const BENEFITS = [
  { icon: '📈', title: 'Earn with real margins', body: 'Distributor pricing is discounted off SRP, so every box you move has built-in profit.' },
  { icon: '🗺️', title: 'Your own territory', body: 'Distributors are assigned a province, city, or area — you build your market, not compete for it.' },
  { icon: '📦', title: 'Products people rebuy', body: 'Tasty Food products are everyday items with steady demand and repeat orders.' },
  { icon: '💻', title: 'A system that runs it', body: 'Order online, track your stock and sales, and see your performance in one dashboard.' },
  { icon: '🤝', title: 'We support you', body: 'Product training, marketing materials, and a team you can reach when you need help.' },
  { icon: '🚀', title: 'Start at your level', body: 'Begin as a reseller or go straight to city or provincial — whatever fits your capital.' },
];

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  });
}

export default function Join() {
  const [webinar, setWebinar] = useState<Webinar | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    name: '', email: '', phone: '', city: '', province: '', interest: 'UNSURE', message: '', website: '',
  });
  const set = (k: keyof typeof f, v: string) => setF((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    api
      .get<{ webinar: Webinar | null }>('/public/webinar')
      .then(({ data }) => setWebinar(data.webinar))
      .catch(() => setWebinar(null))
      .finally(() => setLoading(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const { data } = await api.post<{ zoom: Zoom | null }>('/public/webinar/register', f);
      setZoom(data.zoom);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setSubmitting(false);
    }
  }

  const when = formatWhen(webinar?.scheduledAt ?? null);

  // ---- Confirmation screen -------------------------------------------------
  if (zoom) {
    const zWhen = formatWhen(zoom.scheduledAt);
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-12">
        <div className="mx-auto max-w-lg rounded-2xl bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">
            ✓
          </div>
          <h1 className="text-2xl font-bold text-slate-900">You're registered!</h1>
          <p className="mt-2 text-slate-600">
            Your slot for <strong>{zoom.title}</strong> is reserved. We've also emailed these details to you.
          </p>

          <div className="mt-6 rounded-xl bg-slate-50 p-5 text-left">
            {zWhen && (
              <div className="mb-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">When</div>
                <div className="font-semibold text-slate-800">{zWhen}</div>
                <div className="text-xs text-slate-500">Philippine time</div>
              </div>
            )}
            {zoom.meetingId && (
              <div className="mb-2 text-sm">
                <span className="text-slate-400">Meeting ID: </span>
                <span className="font-medium text-slate-800">{zoom.meetingId}</span>
              </div>
            )}
            {zoom.passcode && (
              <div className="text-sm">
                <span className="text-slate-400">Passcode: </span>
                <span className="font-medium text-slate-800">{zoom.passcode}</span>
              </div>
            )}
            {!zoom.link && !zoom.meetingId && (
              <p className="text-sm text-slate-500">
                We'll email you the Zoom link before the session starts.
              </p>
            )}
          </div>

          {zoom.link && (
            <a
              href={zoom.link}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-block w-full rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white transition hover:bg-brand-700"
            >
              Join the Zoom orientation
            </a>
          )}
          <p className="mt-4 text-xs text-slate-400">
            Please join a few minutes early. See you there!
          </p>
        </div>
      </div>
    );
  }

  // ---- Landing page --------------------------------------------------------
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <header className="bg-brand-600 px-4 py-14 text-white">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white p-1.5">
              <img src="/tasty-food-splash.png" alt="Tasty Food" className="h-full w-full object-contain" />
            </div>
            <span className="text-sm font-semibold">Tasty Food Manufacturing Inc.</span>
          </div>

          <h1 className="max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">
            {webinar?.headline || 'Build your own food distribution business'}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-green-50">
            {webinar?.description ||
              'Join our free online orientation and find out how to become an official Tasty Food distributor in your area — the products, the pricing, the territory, and how much you can earn.'}
          </p>

          {when && (
            <div className="mt-6 inline-flex flex-wrap items-center gap-2 rounded-xl bg-white/15 px-4 py-3">
              <span className="text-xl">📅</span>
              <div>
                <div className="text-xs uppercase tracking-wide text-green-100">Next orientation</div>
                <div className="font-semibold">{when}</div>
              </div>
            </div>
          )}

          <div className="mt-8">
            <a href="#register" className="inline-block rounded-xl bg-white px-7 py-3 font-bold text-brand-700 transition hover:bg-green-50">
              Reserve my free slot →
            </a>
            <p className="mt-2 text-sm text-green-100">Free to attend · Online via Zoom · No obligation</p>
          </div>
        </div>
      </header>

      {/* Benefits */}
      <section className="px-4 py-14">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-bold text-slate-900">Why distribute Tasty Food?</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-slate-500">
            We're looking for partners across the Philippines — from resellers to provincial distributors.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((b) => (
              <div key={b.title} className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="text-2xl">{b.icon}</div>
                <h3 className="mt-3 font-bold text-slate-800">{b.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What you'll learn */}
      <section className="bg-slate-50 px-4 py-14">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold text-slate-900">What we'll cover in the orientation</h2>
          <ul className="mt-6 space-y-3">
            {[
              'The Tasty Food product line, pricing, and which items move fastest',
              'The distributor levels — provincial, city, reseller, retail — and what each requires',
              'Your discount per level and how your margin is computed',
              'How territories are assigned so you are not competing with the person next door',
              'Starting capital, ordering, delivery, and payment terms',
              'A live walkthrough of the system you will use to order and track sales',
              'Open Q&A — bring your questions',
            ].map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-0.5 font-bold text-brand-600">✓</span>
                <span className="text-slate-700">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Registration form */}
      <section id="register" className="px-4 py-14">
        <div className="mx-auto max-w-lg">
          <h2 className="text-center text-2xl font-bold text-slate-900">Reserve your free slot</h2>
          <p className="mt-2 text-center text-slate-500">
            Fill this out and we'll send the Zoom details straight to your email.
          </p>

          {loading ? (
            <p className="mt-8 text-center text-sm text-slate-400">Loading…</p>
          ) : !webinar ? (
            <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-800">
              <p className="font-semibold">No orientation is open right now.</p>
              <p className="mt-1 text-sm">Please check back soon — we run these regularly.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-4 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              {err && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Full name *</label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={f.name} onChange={(e) => set('name', e.target.value)} required placeholder="Juan Dela Cruz"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Email *</label>
                <input
                  type="email"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={f.email} onChange={(e) => set('email', e.target.value)} required placeholder="juan@email.com"
                />
                <p className="mt-1 text-xs text-slate-400">We'll send your Zoom link here.</p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Mobile number *</label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={f.phone} onChange={(e) => set('phone', e.target.value)} required placeholder="0917 123 4567"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">City / Municipality</label>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    value={f.city} onChange={(e) => set('city', e.target.value)} placeholder="Tagaytay"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Province</label>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    value={f.province} onChange={(e) => set('province', e.target.value)} placeholder="Cavite"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">I'm interested in becoming a…</label>
                <select
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={f.interest} onChange={(e) => set('interest', e.target.value)}
                >
                  {INTERESTS.map((i) => (
                    <option key={i.value} value={i.value}>{i.label} — {i.hint}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Questions or message (optional)</label>
                <textarea
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={f.message} onChange={(e) => set('message', e.target.value)}
                  placeholder="Anything you'd like us to cover?"
                />
              </div>

              {/* Honeypot — hidden from real users; bots fill it and get filtered. */}
              <input
                type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                className="hidden" value={f.website} onChange={(e) => set('website', e.target.value)}
              />

              <button
                type="submit" disabled={submitting}
                className="w-full rounded-xl bg-brand-600 px-6 py-3 font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                {submitting ? 'Reserving your slot…' : 'Reserve my free slot'}
              </button>
              <p className="text-center text-xs text-slate-400">
                We'll only use your details to contact you about this orientation.
              </p>
            </form>
          )}
        </div>
      </section>

      <footer className="border-t border-slate-100 px-4 py-8 text-center text-sm text-slate-400">
        © {new Date().getFullYear()} Tasty Food Manufacturing Inc. · All rights reserved
      </footer>
    </div>
  );
}

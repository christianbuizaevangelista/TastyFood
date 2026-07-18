import { useEffect, useState } from 'react';
import { api, apiError } from '../api/client';

// Public recruitment landing page (no login). Ads point here; visitors register
// for the Zoom orientation and become leads in the configured funnel.
// All figures/claims below come from the company's own partnership deck —
// including its qualifiers (FDA LTO "in process", illustrative earnings).

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
  { value: 'PROVINCIAL', label: 'Provincial Distributor', hint: 'province-wide territory' },
  { value: 'CITY', label: 'City Distributor', hint: 'city / municipality' },
  { value: 'RESELLER', label: 'Reseller', hint: 'store, online seller, agent' },
  { value: 'RETAIL', label: 'Retail Distributor', hint: 'supply my own store' },
  { value: 'UNSURE', label: "I'm not sure yet", hint: 'help me choose' },
];

const CREDENTIALS = [
  { value: '2015', label: 'Building since' },
  { value: '28+', label: 'Provinces reached' },
  { value: 'GMP', label: 'Compliant production' },
  { value: '16', label: 'Active distributors' },
];

const MARKET = [
  { value: '₱8.5B', label: 'Annual peanut butter category size' },
  { value: '4.4%', label: 'Compound annual growth rate' },
  { value: '60%', label: 'Filipino household penetration' },
];

const PACKAGES = [
  {
    name: 'Reseller',
    territory: 'Assigned exclusive area',
    retail: '8%',
    foodservice: '6%',
    entry: '₱5,000',
    entryLabel: 'minimum initial order',
    featured: false,
    gets: ['Starter bundle of best sellers', 'Exclusive rights to your area', 'Free access to the DMS'],
  },
  {
    name: 'City Distributor',
    territory: 'City / municipality',
    retail: '15%',
    foodservice: '11%',
    entry: '₱30,000',
    entryLabel: 'refundable security bond',
    featured: false,
    gets: ['City-wide exclusive territory', 'Supply resellers in your city', 'Free access to the DMS'],
  },
  {
    name: 'Provincial Distributor',
    territory: 'Province-wide',
    retail: '20%',
    foodservice: '15%',
    entry: '₱100,000',
    entryLabel: 'refundable security bond',
    featured: true,
    gets: ['Province-wide exclusive territory', 'Buy directly from the factory', 'Free access to the DMS'],
  },
];

const EARNINGS = [
  { stage: 'Starter', detail: '10 resellers, each doing ₱10,000 a month', profit: '₱7,000' },
  { stage: 'Growing', detail: '20 resellers, each doing ₱30,000 a month', profit: '₱42,000' },
  { stage: 'Established', detail: '50 resellers, each doing ₱50,000 a month', profit: '₱175,000' },
];

const REASONS = [
  { icon: '💰', title: 'Healthy margins', body: 'Tiered trade discounts designed to protect partner profit at every level of the channel.' },
  { icon: '🗺️', title: 'Territory protection', body: 'Exclusive coverage for qualified distributors — no channel conflict in your area.' },
  { icon: '🥜', title: 'Fast-moving products', body: 'Everyday food with steady household demand and strong repeat purchase.' },
  { icon: '🤝', title: 'Full partner support', body: 'Marketing materials, product training, and a dedicated account officer for every partner.' },
];

const SUPPORT = [
  { title: 'Marketing materials', items: ['Free social media marketing', 'Free use of booth', 'Free tarpaulin, brochure, and ID', 'Free starter kit worth ₱1,200 (distributors)'] },
  { title: 'Free exclusive training', items: ['Product orientation', 'Sales training', 'Personal development', 'Distribution Management System (DMS)'] },
  { title: 'Dedicated team support', items: ['Regular meetings', 'Monthly performance review', 'Sales & marketing planning', 'Access to the DMS'] },
];

const PRODUCTS = [
  { tag: 'RETAIL', name: 'JuanPalaman', detail: 'Creamy & Choco · 250g / 500g / 675g', note: 'Shelf-ready, strong household repeat purchase' },
  { tag: 'FOODSERVICE', name: "Cielo's", detail: 'Classic & Unsweetened · bulk 1–20kg', note: 'Trusted by commercial kitchens' },
  { tag: 'WELLNESS', name: "Cielo's with Stevia", detail: 'Classic & Unsweetened · stevia-sweetened', note: 'Fits wellness-focused demand' },
];

const STEPS = [
  { n: 1, title: 'Attend the orientation', body: 'Join the free Zoom session and get the full picture — no commitment.' },
  { n: 2, title: 'Submit application', body: 'Fill out the partner application form and we check territory availability.' },
  { n: 3, title: 'Short interview', body: 'We align on goals, territory, and commitment.' },
  { n: 4, title: 'Sign & first order', body: 'Review and sign the agreement, place your initial order, and get onboarded.' },
];

const FAQ = [
  { q: 'How much capital do I need to start?', a: 'A reseller starts with a ₱5,000 minimum initial order. City distributors post a ₱30,000 refundable security bond, and provincial distributors ₱100,000 — both refundable under the terms of the partnership agreement.' },
  { q: 'Is the territory really exclusive?', a: 'Yes. Qualified distributors are assigned an exclusive coverage area, and the channel is structured so provincial, city, and reseller levels do not compete with each other in the same territory.' },
  { q: 'What if my area is already taken?', a: 'Join the orientation anyway — we check territory availability live and can discuss nearby areas or a different partner level that still fits you.' },
  { q: 'Do I need an existing business?', a: 'No. Resellers only need a valid ID and basic business information. Many of our partners started as home sellers or small store owners.' },
  { q: 'How do I track my orders and sales?', a: 'Every partner gets free access to the Tasty Food Distribution Management System — order online, track your stock and sales, and see your performance in one dashboard.' },
  { q: 'Is the orientation really free?', a: 'Yes, completely free and online via Zoom. There is no obligation to sign up afterwards.' },
];

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  });
}

function Section({ id, className = '', children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`px-4 py-16 ${className}`}>
      <div className="mx-auto max-w-5xl">{children}</div>
    </section>
  );
}

function Heading({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <div className="mb-10 text-center">
      {eyebrow && (
        <div className="mb-2 text-xs font-bold uppercase tracking-widest text-brand-600">{eyebrow}</div>
      )}
      <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h2>
      {sub && <p className="mx-auto mt-3 max-w-2xl text-slate-500">{sub}</p>}
    </div>
  );
}

export default function Join() {
  const [webinar, setWebinar] = useState<Webinar | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
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
              <p className="text-sm text-slate-500">We'll email you the Zoom link before the session starts.</p>
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
          <p className="mt-4 text-xs text-slate-400">Please join a few minutes early. See you there!</p>

          <div className="mt-6 border-t border-slate-100 pt-5 text-left text-sm text-slate-500">
            <p className="font-semibold text-slate-700">Questions before then?</p>
            <p className="mt-1">📞 +63 946 236 3897</p>
            <p>✉️ tastyfoodmanufacturinginc@gmail.com</p>
          </div>
        </div>
      </div>
    );
  }

  // ---- Landing page --------------------------------------------------------
  return (
    <div className="min-h-screen bg-white">
      {/* Sticky bar keeps the CTA reachable from anywhere on a long page */}
      <div className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 p-1">
              <img src="/tasty-food-splash.png" alt="Tasty Food" className="h-full w-full object-contain" />
            </div>
            <span className="text-sm font-bold text-slate-800">Tasty Food</span>
          </div>
          <a href="#register" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-700">
            Reserve free slot
          </a>
        </div>
      </div>

      {/* Hero */}
      <header className="bg-brand-600 px-4 py-16 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider">
            Distributor &amp; Reseller Partnership Program
          </div>
          <h1 className="max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">
            {webinar?.headline || 'Build your own food distribution business'}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-green-50">
            {webinar?.description ||
              'Tasty Food is expanding across the Philippines and looking for distribution partners. Join our free online orientation to see the products, the margins, and whether your territory is still open.'}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a href="#register" className="rounded-xl bg-white px-7 py-3.5 font-bold text-brand-700 shadow-sm transition hover:bg-green-50">
              Reserve my free slot →
            </a>
            <div className="text-sm text-green-100">
              Free to attend · Online via Zoom · No obligation
            </div>
          </div>

          {when && (
            <div className="mt-8 inline-flex flex-wrap items-center gap-3 rounded-xl bg-white/15 px-5 py-4">
              <span className="text-2xl">📅</span>
              <div>
                <div className="text-xs uppercase tracking-wide text-green-100">Next orientation</div>
                <div className="text-lg font-bold">{when}</div>
                <div className="text-xs text-green-100">Philippine time</div>
              </div>
            </div>
          )}

          {/* Credibility bar */}
          <div className="mt-12 grid grid-cols-2 gap-6 border-t border-white/20 pt-8 sm:grid-cols-4">
            {CREDENTIALS.map((c) => (
              <div key={c.label}>
                <div className="text-2xl font-bold">{c.value}</div>
                <div className="text-xs text-green-100">{c.label}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-green-100/80">
            Founded 2015 · Incorporated 2017 · GMP-compliant production · FDA LTO in process
          </p>
        </div>
      </header>

      {/* Market opportunity */}
      <Section className="bg-slate-50">
        <Heading
          eyebrow="The opportunity"
          title="A ₱8.5-billion category that Filipinos buy every week"
          sub="Peanut butter is in 6 of every 10 Filipino households — and it's the fastest-growing spread segment in the country."
        />
        <div className="grid gap-6 sm:grid-cols-3">
          {MARKET.map((m) => (
            <div key={m.label} className="rounded-2xl bg-white p-7 text-center shadow-sm">
              <div className="text-3xl font-bold text-brand-600">{m.value}</div>
              <div className="mt-2 text-sm text-slate-500">{m.label}</div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">
          Philippine peanut butter market, 2026 projections. Source: Statista Market Insights.
        </p>
      </Section>

      {/* Earnings — the strongest motivator, kept with its disclaimer */}
      <Section>
        <Heading
          eyebrow="What you could earn"
          title="Sample monthly earnings — City Distributor"
          sub="Your income grows with the reseller network you build underneath you."
        />
        <div className="grid gap-6 sm:grid-cols-3">
          {EARNINGS.map((e, i) => (
            <div
              key={e.stage}
              className={`rounded-2xl border p-7 ${
                i === 2 ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400">{e.stage}</div>
              <div className={`mt-3 text-3xl font-bold ${i === 2 ? 'text-brand-700' : 'text-slate-900'}`}>
                {e.profit}
              </div>
              <div className="text-xs text-slate-500">estimated monthly profit</div>
              <p className="mt-4 border-t border-slate-200 pt-4 text-sm text-slate-600">{e.detail}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-xs text-slate-400">
          Illustrative figures based on sample volumes and trade discount. Actual earnings depend on SRP,
          order mix, and operating costs.
        </p>
      </Section>

      {/* Packages */}
      <Section className="bg-slate-50">
        <Heading
          eyebrow="Partner levels"
          title="Start at the level that fits your capital"
          sub="Discounts are off SRP. Final terms are set in your signed partnership agreement."
        />
        <div className="grid gap-6 lg:grid-cols-3">
          {PACKAGES.map((p) => (
            <div
              key={p.name}
              className={`relative rounded-2xl bg-white p-7 shadow-sm ${
                p.featured ? 'ring-2 ring-brand-500' : 'border border-slate-200'
              }`}
            >
              {p.featured && (
                <div className="absolute -top-3 left-7 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold text-white">
                  Most chosen
                </div>
              )}
              <h3 className="text-lg font-bold text-slate-900">{p.name}</h3>
              <p className="text-sm text-slate-500">{p.territory}</p>

              <div className="mt-5 flex items-baseline gap-2">
                <span className="text-4xl font-bold text-brand-600">{p.retail}</span>
                <span className="text-sm text-slate-500">retail discount</span>
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {p.foodservice} on foodservice (Cielo's institutional)
              </div>

              <div className="mt-5 rounded-lg bg-slate-50 px-4 py-3">
                <div className="text-lg font-bold text-slate-800">{p.entry}</div>
                <div className="text-xs text-slate-500">{p.entryLabel}</div>
              </div>

              <ul className="mt-5 space-y-2">
                {p.gets.map((g) => (
                  <li key={g} className="flex gap-2 text-sm text-slate-600">
                    <span className="font-bold text-brand-600">✓</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          Also required: a monthly target quota, regular meeting attendance, and full commitment to your territory.
        </p>
      </Section>

      {/* Why partner */}
      <Section>
        <Heading eyebrow="Why partner with us" title="Built so partners actually make money" />
        <div className="grid gap-6 sm:grid-cols-2">
          {REASONS.map((r) => (
            <div key={r.title} className="flex gap-4 rounded-2xl border border-slate-100 p-6">
              <div className="text-3xl">{r.icon}</div>
              <div>
                <h3 className="font-bold text-slate-800">{r.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">{r.body}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Products */}
      <Section className="bg-slate-50">
        <Heading
          eyebrow="What you'll sell"
          title="Three peanut butter lines, available now"
          sub="Rich roasted-peanut taste · no preservatives added · 12-month shelf life at ambient storage."
        />
        <div className="grid gap-6 sm:grid-cols-3">
          {PRODUCTS.map((p) => (
            <div key={p.name} className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="inline-block rounded bg-brand-50 px-2 py-1 text-xs font-bold tracking-wider text-brand-700">
                {p.tag}
              </div>
              <h3 className="mt-3 text-lg font-bold text-slate-900">{p.name}</h3>
              <p className="mt-1 text-sm text-slate-600">{p.detail}</p>
              <p className="mt-2 text-xs text-slate-400">{p.note}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          Coming soon: spreads, condiments, snacks, and beverages.
        </p>
      </Section>

      {/* Support */}
      <Section>
        <Heading eyebrow="You won't be on your own" title="What every partner gets, free" />
        <div className="grid gap-6 sm:grid-cols-3">
          {SUPPORT.map((s) => (
            <div key={s.title} className="rounded-2xl border border-slate-100 p-6">
              <h3 className="font-bold text-slate-800">{s.title}</h3>
              <ul className="mt-3 space-y-2">
                {s.items.map((i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-600">
                    <span className="font-bold text-brand-600">✓</span>
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {/* Proof */}
      <Section className="bg-slate-50">
        <Heading eyebrow="Real partners, real territories" title="Distributors already growing with us" />
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            { name: 'Pax & Found Sales Distributor Inc.', area: 'Albay distribution partnership' },
            { name: 'Uphigh Distributor Inc.', area: 'Batangas, Oriental & Occidental Mindoro' },
            { name: 'M.E. Shopping Center', area: 'JuanPalaman on shelves in Tuguegarao, Cagayan' },
          ].map((p) => (
            <div key={p.name} className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="text-2xl">🤝</div>
              <h3 className="mt-3 font-bold text-slate-800">{p.name}</h3>
              <p className="mt-1 text-sm text-slate-500">{p.area}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Process */}
      <Section>
        <Heading eyebrow="How it works" title="From orientation to your first order" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-slate-100 p-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 font-bold text-white">
                {s.n}
              </div>
              <h3 className="mt-4 font-bold text-slate-800">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{s.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* FAQ — answers the objections that stop people from registering */}
      <Section className="bg-slate-50">
        <Heading eyebrow="Before you ask" title="Common questions" />
        <div className="mx-auto max-w-3xl space-y-3">
          {FAQ.map((item, i) => (
            <div key={item.q} className="overflow-hidden rounded-xl bg-white shadow-sm">
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="font-semibold text-slate-800">{item.q}</span>
                <span className="shrink-0 text-slate-400">{openFaq === i ? '−' : '+'}</span>
              </button>
              {openFaq === i && (
                <p className="border-t border-slate-100 px-5 py-4 text-sm leading-relaxed text-slate-600">
                  {item.a}
                </p>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Registration form */}
      <Section id="register">
        <div className="mx-auto max-w-lg">
          <Heading
            title="Reserve your free slot"
            sub="Fill this out and we'll send the Zoom details straight to your email. We'll also check if your territory is still open."
          />

          {loading ? (
            <p className="text-center text-sm text-slate-400">Loading…</p>
          ) : !webinar ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-800">
              <p className="font-semibold">No orientation is open for registration right now.</p>
              <p className="mt-1 text-sm">
                We run these regularly — please check back soon, or contact us at +63 946 236 3897.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-100 bg-white p-7 shadow-sm">
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
              <p className="-mt-2 text-xs text-slate-400">
                Tell us your area so we can check territory availability before the session.
              </p>

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
                className="w-full rounded-xl bg-brand-600 px-6 py-3.5 font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                {submitting ? 'Reserving your slot…' : 'Reserve my free slot'}
              </button>
              <p className="text-center text-xs text-slate-400">
                Free · No obligation · We'll only use your details to contact you about this orientation.
              </p>
            </form>
          )}
        </div>
      </Section>

      {/* Footer */}
      <footer className="bg-slate-900 px-4 py-12 text-slate-300">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white p-1">
                  <img src="/tasty-food-splash.png" alt="Tasty Food" className="h-full w-full object-contain" />
                </div>
                <span className="font-bold text-white">Tasty Food Manufacturing Inc.</span>
              </div>
              <p className="mt-3 text-sm italic text-slate-400">"Where Quality Meets Taste"</p>
              <p className="mt-3 max-w-sm text-sm text-slate-400">
                A Philippine food manufacturer specializing in peanut butter, spreads, and foodservice products.
              </p>
            </div>
            <div className="text-sm">
              <h3 className="font-bold text-white">Talk to us</h3>
              <p className="mt-3">📞 +63 946 236 3897</p>
              <p className="mt-1">✉️ tastyfoodmanufacturinginc@gmail.com</p>
              <p className="mt-1">📍 171 Purok 5, Brgy. Banay Banay, Amadeo, Cavite</p>
              <p className="mt-1 text-slate-400">Mon–Sat, 8AM–5PM</p>
            </div>
          </div>
          <div className="mt-10 border-t border-slate-800 pt-6 text-xs text-slate-500">
            © {new Date().getFullYear()} Tasty Food Manufacturing Inc. · All rights reserved
          </div>
        </div>
      </footer>
    </div>
  );
}

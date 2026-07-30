import { useEffect, useState } from 'react';
import { api, apiError } from '../api/client';
import { initPixel, track } from '../lib/pixel';

// Public recruitment landing page (no login). Ads point here; visitors register
// for the Zoom orientation and become leads in the configured funnel.
// Figures and photos come from the company's own partnership deck — including
// its qualifiers ("FDA LTO in process", illustrative earnings disclaimer).

interface Webinar {
  id: string;
  title: string;
  headline: string | null;
  description: string | null;
  scheduledAt: string | null;
  sessions?: WebinarSession[];
}
interface WebinarSession {
  id: string;
  scheduledAt: string;
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

// Capital band — the single most useful qualifier. It screens serious partners
// from the casual "pang-benta-benta" crowd and tells us which tier fits them.
const CAPITAL = [
  { value: '', label: 'Select your ready capital…' },
  { value: 'Below ₱5,000', label: 'Below ₱5,000' },
  { value: '₱5,000 – ₱30,000', label: '₱5,000 – ₱30,000 (Reseller)' },
  { value: '₱30,000 – ₱100,000', label: '₱30,000 – ₱100,000 (City)' },
  { value: '₱100,000 and up', label: '₱100,000 and up (Provincial)' },
];

const CREDENTIALS = [
  { value: '2015', label: 'Building since' },
  { value: '28+', label: 'Provinces reached' },
  { value: 'GMP', label: 'Implementation' },
  { value: '16', label: 'Active distributors' },
];

const MARKET = [
  { value: '₱8.5B', label: 'Annual category size' },
  { value: '4.4%', label: 'Yearly growth rate' },
  { value: '60%', label: 'Of Filipino households' },
];

const PRODUCTS = [
  { img: '/img/product-retail.jpg', tag: 'Retail', name: 'JuanPalaman', detail: 'Creamy & Choco · 250g / 500g / 675g' },
  { img: '/img/product-foodservice.jpg', tag: 'Foodservice', name: "Cielo's", detail: 'Classic & Unsweetened · bulk 1–20kg' },
  { img: '/img/product-wellness.jpg', tag: 'Wellness', name: "Cielo's with Stevia", detail: 'Classic & Unsweetened · stevia' },
];

const PACKAGES = [
  {
    name: 'Reseller', territory: 'Assigned territory',
    retail: '8%', foodservice: '6%', entry: '₱5,000', entryLabel: 'minimum initial order', featured: false,
    gets: ['Starter bundle of best sellers', 'Rights to your assigned area', 'Free access to the DMS'],
  },
  {
    name: 'City Distributor', territory: 'City / municipality',
    retail: '15%', foodservice: '11%', entry: '₱30,000', entryLabel: 'security bond + ₱30,000 initial order', featured: false,
    gets: ['City-wide assigned territory', 'Supply resellers in your city', 'Free access to the DMS'],
  },
  {
    name: 'Provincial Distributor', territory: 'Province-wide',
    retail: '20%', foodservice: '15%', entry: '₱100,000', entryLabel: 'security bond + ₱100,000 initial order', featured: true,
    gets: ['Province-wide assigned territory', 'Buy directly from the factory', 'Free access to the DMS'],
  },
];

const EARNINGS = [
  { stage: 'Starter', detail: '10 resellers × ₱10,000 a month', profit: '₱7,000' },
  { stage: 'Growing', detail: '20 resellers × ₱30,000 a month', profit: '₱42,000' },
  { stage: 'Established', detail: '50 resellers × ₱50,000 a month', profit: '₱175,000' },
];

const PROOF = [
  { img: '/img/partners-signed.jpg', caption: 'Newly signed distribution partners' },
  { img: '/img/agreement.jpg', caption: 'Partnership signing with Uphigh Distributor Inc.' },
  { img: '/img/shelf.jpg', caption: 'JuanPalaman on shelves — M.E. Shopping Center, Tuguegarao' },
];

const REASONS = [
  { icon: '💰', title: 'Healthy margins', body: 'Tiered discounts that protect your profit at every level.' },
  { icon: '🗺️', title: 'Assigned territory', body: 'Your own assigned coverage area — no channel conflict.' },
  { icon: '🥜', title: 'Fast-moving products', body: 'Everyday food with steady demand and repeat purchase.' },
  { icon: '🤝', title: 'Full partner support', body: 'Materials, training, and a dedicated account officer.' },
];

const SUPPORT = [
  'Free social media marketing',
  'Free tarpaulin, brochure & ID',
  'Free booth use',
  'Starter kit worth ₱1,200',
  'Product & sales training',
  'Monthly performance review',
  'Dedicated account officer',
  'Free access to the DMS',
];

const STEPS = [
  { n: 1, title: 'Attend the orientation', body: 'Free Zoom session — no commitment.' },
  { n: 2, title: 'Submit application', body: 'We check your territory availability.' },
  { n: 3, title: 'Short interview', body: 'Align on goals and territory.' },
  { n: 4, title: 'Sign & first order', body: 'Sign, order, and get onboarded.' },
];

const FAQ = [
  { q: 'How much capital do I need to start?', a: 'A reseller starts with a ₱5,000 minimum initial order. A City distributor posts a ₱30,000 refundable security bond plus a ₱30,000 initial order; a Provincial distributor a ₱100,000 refundable security bond plus a ₱100,000 initial order. The security bond is refundable under the terms of the partnership agreement.' },
  { q: 'Is a territory assigned to me?', a: 'Yes. Qualified distributors are assigned a coverage area, and the channel is structured so provincial, city, and reseller levels do not compete with each other in the same assigned territory.' },
  { q: 'What if my area is already taken?', a: 'Join the orientation anyway — we check territory availability live and can discuss nearby areas or a different partner level that still fits you.' },
  { q: 'Who is this partnership for?', a: 'Serious individuals and business owners ready to invest in and run their own distribution territory — with the capital for the security bond and initial order, and the commitment to grow sales in their area. A City or Provincial distributorship is a real business partnership, not a sideline.' },
  { q: 'How do I track my orders and sales?', a: 'Every partner gets free access to the Tasty Food Distribution Management System — order online, track stock and sales, and see your performance in one dashboard.' },
  { q: 'Is the orientation really free?', a: 'Yes, completely free and online via Zoom. There is no obligation to sign up afterwards.' },
];

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Manila',
  });
}

// Split for the schedule picker, where the day and the time read better on
// separate lines than in one long sentence.
function whenParts(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  const opts = { timeZone: 'Asia/Manila' } as const;
  return {
    day: d.toLocaleDateString('en-PH', { ...opts, weekday: 'long', month: 'long', day: 'numeric' }),
    time: d.toLocaleTimeString('en-PH', { ...opts, hour: 'numeric', minute: '2-digit' }),
  };
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
      {eyebrow && <div className="mb-2 text-xs font-bold uppercase tracking-widest text-brand-600">{eyebrow}</div>}
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
    name: '', email: '', phone: '', city: '', province: '', interest: 'UNSURE', capital: '', message: '', website: '',
    sessionId: '',
  });
  const set = (k: keyof typeof f, v: string) => setF((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    api
      .get<{ webinar: Webinar | null }>('/public/webinar')
      .then(({ data }) => {
        setWebinar(data.webinar);
        // Pre-select the soonest slot — most people take it, and an empty
        // radio group reads like an unanswered question.
        const first = data.webinar?.sessions?.[0];
        if (first) setF((prev) => ({ ...prev, sessionId: first.id }));
      })
      .catch(() => setWebinar(null))
      .finally(() => setLoading(false));
  }, []);

  // Meta Pixel: a prospect landed on the recruitment page. Ad campaigns pointing
  // here can optimise toward and retarget from this.
  useEffect(() => {
    initPixel();
    track('ViewContent', { content_category: 'JuanPalaman recruitment' });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if ((webinar?.sessions?.length ?? 0) > 0 && !f.sessionId) {
      setErr('Please choose a schedule for the orientation.');
      return;
    }
    if (!f.capital) {
      setErr('Please tell us how much capital you are ready to invest.');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post<{ zoom: Zoom | null }>('/public/webinar/register', f);
      // The recruitment conversion: someone registered for the orientation. This
      // is the event Facebook should optimise these ads toward — not CONTENT_VIEW.
      track('CompleteRegistration', { content_name: 'Webinar registration', status: true });
      setZoom(data.zoom);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setSubmitting(false);
    }
  }

  const sessions = webinar?.sessions ?? [];
  // The headline date is the soonest slot on offer; the single scheduledAt is
  // the fallback for a webinar set up before schedules existed.
  const when = formatWhen(sessions[0]?.scheduledAt ?? webinar?.scheduledAt ?? null);

  // ---- Confirmation screen -------------------------------------------------
  if (zoom) {
    const zWhen = formatWhen(zoom.scheduledAt);
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-12">
        <div className="mx-auto max-w-lg overflow-hidden rounded-2xl bg-white shadow-sm">
          <img src="/img/partners-signed.jpg" alt="" className="h-40 w-full object-cover" />
          <div className="p-8 text-center">
            <div className="mx-auto mb-4 -mt-16 flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-green-100 text-3xl">
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
                href={zoom.link} target="_blank" rel="noreferrer"
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
      </div>
    );
  }

  // ---- Landing page --------------------------------------------------------
  return (
    <div className="min-h-screen bg-white">
      {/* Sticky bar keeps the CTA reachable from anywhere on a long page */}
      <div className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <img src="/tasty-food-splash.png" alt="Tasty Food" className="h-8 w-auto object-contain" />
          <div className="flex items-center gap-3 sm:gap-5">
            {/* People coming back to check on an application are not reading the
                page again — they need this before anything else on it. */}
            <a
              href="/track"
              className="whitespace-nowrap text-sm font-semibold text-slate-600 transition hover:text-brand-700"
            >
              Track application
            </a>
            <a href="#register" className="whitespace-nowrap rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-700">
              Reserve free slot
            </a>
          </div>
        </div>
      </div>

      {/* Hero — text on the left, real retail-shelf proof on the right */}
      <header className="bg-brand-600 px-4 py-14 text-white">
        <div className="mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-2">
          <div>
            <div className="mb-4 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider">
              Distributorship Opportunity
            </div>
            <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
              {webinar?.headline || 'Run your own Tasty Food distributorship'}
            </h1>
            <p className="mt-4 text-lg text-green-50">
              {webinar?.description ||
                'A real distribution business with your own protected territory — not a sideline. For partners ready to invest and build. Join the free orientation to see the margins, the numbers, and whether your area is still open.'}
            </p>
            {/* Capital stated up front — it qualifies serious partners and lets the
                casual "pang-benta-benta" crowd self-select out before inquiring. */}
            <div className="mt-5 flex flex-wrap gap-2 text-sm">
              <span className="rounded-lg bg-white/15 px-3 py-1.5"><b>Reseller</b> · from ₱5,000</span>
              <span className="rounded-lg bg-white/15 px-3 py-1.5"><b>City</b> · ₱30,000 bond + ₱30,000 order</span>
              <span className="rounded-lg bg-white/20 px-3 py-1.5 ring-1 ring-white/40"><b>Provincial</b> · ₱100,000 bond + ₱100,000 order</span>
            </div>

            {when && (
              <div className="mt-6 inline-flex items-center gap-3 rounded-xl bg-white/15 px-4 py-3">
                <span className="text-2xl">📅</span>
                <div>
                  <div className="text-xs uppercase tracking-wide text-green-100">Next orientation</div>
                  <div className="font-bold">{when}</div>
                  {sessions.length > 1 && (
                    <div className="text-xs text-green-100">
                      +{sessions.length - 1} more schedule{sessions.length > 2 ? 's' : ''} to choose from
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mt-7">
              <a href="#register" className="inline-block rounded-xl bg-white px-7 py-3.5 font-bold text-brand-700 shadow-sm transition hover:bg-green-50">
                Reserve my free slot →
              </a>
            </div>
            <p className="mt-3 text-sm text-green-100">Free · Online via Zoom · No obligation</p>
          </div>

          <div className="relative">
            <img
              src="/img/shelf.jpg"
              alt="JuanPalaman peanut butter on grocery shelves"
              className="h-72 w-full rounded-2xl object-cover shadow-lg lg:h-[420px]"
              loading="eager"
            />
            <div className="absolute bottom-3 left-3 right-3 rounded-lg bg-black/55 px-3 py-2 text-xs text-white backdrop-blur-sm">
              Our products on retail shelves — M.E. Shopping Center, Tuguegarao
            </div>
          </div>
        </div>

        {/* Credibility strip */}
        <div className="mx-auto mt-12 grid max-w-5xl grid-cols-2 gap-6 border-t border-white/20 pt-8 sm:grid-cols-4">
          {CREDENTIALS.map((c) => (
            <div key={c.label}>
              <div className="text-2xl font-bold">{c.value}</div>
              <div className="text-xs text-green-100">{c.label}</div>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-4 max-w-5xl text-xs text-green-100/80">
          Founded 2015 · Incorporated 2017 · GMP Implementation · FDA LTO in process
        </p>
      </header>

      {/* Market opportunity */}
      <Section className="bg-slate-50">
        <Heading eyebrow="The opportunity" title="A ₱8.5-billion category Filipinos buy every week" />
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

      {/* Products — photo-led */}
      <Section>
        <Heading
          eyebrow="What you'll sell"
          title="Three peanut butter lines, available now"
          sub="Rich roasted-peanut taste · no preservatives added · 12-month shelf life."
        />
        <div className="grid gap-6 sm:grid-cols-3">
          {PRODUCTS.map((p) => (
            <div key={p.name} className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
              <img src={p.img} alt={p.name} className="h-56 w-full bg-slate-50 object-contain p-4" loading="lazy" />
              <div className="border-t border-slate-100 p-5">
                <div className="text-xs font-bold uppercase tracking-wider text-brand-600">{p.tag}</div>
                <h3 className="mt-1 text-lg font-bold text-slate-900">{p.name}</h3>
                <p className="mt-1 text-sm text-slate-500">{p.detail}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          Coming soon: spreads, condiments, snacks, and beverages.
        </p>
      </Section>

      {/* Earnings */}
      <Section className="bg-slate-50">
        <Heading
          eyebrow="What you could earn"
          title="Sample monthly earnings — City Distributor"
          sub="Your income grows with the reseller network you build underneath you."
        />
        <div className="grid gap-6 sm:grid-cols-3">
          {EARNINGS.map((e, i) => (
            <div key={e.stage} className={`rounded-2xl border p-7 ${i === 2 ? 'border-brand-500 bg-white' : 'border-slate-200 bg-white'}`}>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400">{e.stage}</div>
              <div className={`mt-3 text-3xl font-bold ${i === 2 ? 'text-brand-700' : 'text-slate-900'}`}>{e.profit}</div>
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
      <Section>
        <Heading
          eyebrow="Partner levels"
          title="Start at the level that fits your capital"
          sub="Discounts are off SRP. Final terms are set in your signed partnership agreement."
        />
        <div className="grid gap-6 lg:grid-cols-3">
          {PACKAGES.map((p) => (
            <div
              key={p.name}
              className={`relative rounded-2xl bg-white p-7 ${p.featured ? 'ring-2 ring-brand-500' : 'border border-slate-200'}`}
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
              <div className="mt-1 text-sm text-slate-500">{p.foodservice} on foodservice</div>
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
          Also required: a monthly target quota, regular meeting attendance, and commitment to your territory.
        </p>
      </Section>

      {/* Proof — real partners, real photos */}
      <Section className="bg-slate-50">
        <Heading eyebrow="Real partners, real territories" title="Distributors already growing with us" />
        <div className="grid gap-6 sm:grid-cols-3">
          {PROOF.map((p) => (
            <figure key={p.img} className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <img src={p.img} alt={p.caption} className="aspect-[4/3] w-full object-cover" loading="lazy" />
              <figcaption className="p-4 text-sm text-slate-600">{p.caption}</figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          Partners in Albay, Batangas, Oriental &amp; Occidental Mindoro, Cagayan, and more.
        </p>
      </Section>

      {/* Founders — photo + short story */}
      <Section>
        <div className="grid items-center gap-10 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <img
              src="/img/founders.jpg"
              alt="Mr. Christian and Ms. Evelyn Evangelista, owners of Tasty Food Manufacturing Inc."
              className="w-full rounded-2xl object-cover shadow-sm"
              loading="lazy"
            />
          </div>
          <div className="lg:col-span-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-brand-600">Our story</div>
            <h2 className="text-2xl font-bold text-slate-900">From a family dream to a national manufacturer</h2>
            <p className="mt-4 text-slate-600">
              Tasty Food began in 2015 as <strong>Cielo's Peanut Butter</strong>, a small Cavite venture built by a
              hardworking couple — starting with motorcycle deliveries and unlabeled containers.
            </p>
            <p className="mt-3 text-slate-600">
              In 2017 it incorporated as Tasty Food Manufacturing Inc., expanding into contract manufacturing,
              private labeling, and nationwide distribution.
            </p>
            <p className="mt-4 border-l-4 border-brand-500 pl-4 italic text-slate-600">
              "What began as a family's dream has grown into a vision of becoming one of the country's leading
              food manufacturers."
            </p>
            <p className="mt-3 text-sm font-semibold text-slate-700">
              Mr. Christian &amp; Ms. Evelyn Evangelista
              <span className="block font-normal text-slate-400">Owners, Tasty Food Manufacturing Inc.</span>
            </p>
          </div>
        </div>
      </Section>

      {/* Why partner + support, condensed into one section */}
      <Section className="bg-slate-50">
        <Heading eyebrow="Why partner with us" title="Built so partners actually make money" />
        <div className="grid gap-5 sm:grid-cols-2">
          {REASONS.map((r) => (
            <div key={r.title} className="flex gap-4 rounded-2xl bg-white p-6 shadow-sm">
              <div className="text-3xl">{r.icon}</div>
              <div>
                <h3 className="font-bold text-slate-800">{r.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{r.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl bg-white p-7 shadow-sm">
          <h3 className="text-center font-bold text-slate-800">Every partner gets, free:</h3>
          <div className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            {SUPPORT.map((s) => (
              <div key={s} className="flex gap-2 text-sm text-slate-600">
                <span className="font-bold text-brand-600">✓</span>
                <span>{s}</span>
              </div>
            ))}
          </div>
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
              <p className="mt-1 text-sm text-slate-500">{s.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* FAQ */}
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
                <p className="border-t border-slate-100 px-5 py-4 text-sm leading-relaxed text-slate-600">{item.a}</p>
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
            sub="We'll send the Zoom details to your email and check if your territory is still open."
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
              {err && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

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

              {sessions.length > 0 && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Pick a schedule *
                  </label>
                  <p className="mb-2 text-xs text-slate-500">
                    The orientation runs several times — choose whichever is most convenient.
                  </p>
                  <div className="space-y-2">
                    {sessions.map((s) => {
                      const p = whenParts(s.scheduledAt);
                      const picked = f.sessionId === s.id;
                      return (
                        <label
                          key={s.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition ${
                            picked ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="radio" name="sessionId" value={s.id} checked={picked}
                            onChange={() => set('sessionId', s.id)}
                            className="h-4 w-4 accent-brand-600"
                          />
                          <span>
                            <span className="block font-semibold text-slate-800">{p.day}</span>
                            <span className="block text-sm text-slate-500">{p.time} · Philippine time</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

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
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  How much capital are you ready to invest? <span className="text-brand-600">*</span>
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={f.capital} onChange={(e) => set('capital', e.target.value)} required
                >
                  {CAPITAL.map((c) => (
                    <option key={c.value} value={c.value} disabled={c.value === ''}>{c.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">This helps us match you to the right distributorship level.</p>
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
              <img src="/tasty-food-splash.png" alt="Tasty Food" className="h-11 w-auto object-contain" />
              <div className="mt-3 font-bold text-white">Tasty Food Manufacturing Inc.</div>
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

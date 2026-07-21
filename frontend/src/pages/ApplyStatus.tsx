import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, apiError } from '../api/client';

// Public application tracker (no login). The link lives in the applicant's
// confirmation email; the token in the URL is what stands in for an account.

interface Appointment {
  kind: 'ZOOM' | 'OFFICE_VISIT';
  status: string;
  requestedAt: string;
  confirmedAt: string | null;
  zoomLink: string | null;
  location: string | null;
  note: string | null;
}
interface Application {
  name: string;
  tier: string;
  status: string;
  submittedAt: string;
  formAvailable: boolean;
  appointments: Appointment[];
}

const TIER_LABEL: Record<string, string> = {
  PROVINCIAL: 'Provincial Distributor',
  CITY: 'City Distributor',
  RESELLER: 'Reseller',
  RETAIL: 'Retail Distributor',
};
const STATUS_COPY: Record<string, { label: string; body: string; tone: string }> = {
  SUBMITTED: {
    label: 'Received',
    body: 'We have your application and will review it shortly.',
    tone: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  REVIEWING: {
    label: 'Under review',
    body: 'We are checking whether your area is still open. We will be in touch soon.',
    tone: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  APPROVED: {
    label: 'Approved',
    body: 'Congratulations — your application has been approved. We will contact you about signing and your first order.',
    tone: 'bg-green-50 text-green-700 border-green-200',
  },
  REJECTED: {
    label: 'Not proceeding',
    body: 'We are not able to move forward with this application right now. Reply to our email if you would like to discuss it.',
    tone: 'bg-slate-100 text-slate-600 border-slate-200',
  },
};
const APPT_COPY: Record<string, string> = {
  REQUESTED: 'Waiting for us to confirm',
  CONFIRMED: 'Confirmed',
  RESCHEDULED: 'We proposed a different time',
  DECLINED: 'Declined',
  COMPLETED: 'Done',
  NO_SHOW: 'Missed',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Manila',
  });
}
// <input type="datetime-local"> wants local time, and we never want a past slot.
function minLocal(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function ApplyStatus() {
  const { token = '' } = useParams();
  const [app, setApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ kind: 'ZOOM' as 'ZOOM' | 'OFFICE_VISIT', requestedAt: '', altRequestedAt: '', note: '' });
  const set = (k: keyof typeof f, v: string) => setF((prev) => ({ ...prev, [k]: v }));

  function load() {
    api
      .get<Application>(`/public/apply/${token}`)
      .then(({ data }) => setApp(data))
      .catch(() => setApp(null))
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.requestedAt) {
      setErr('Please pick a date and time.');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/public/apply/${token}/appointment`, {
        kind: f.kind,
        requestedAt: new Date(f.requestedAt).toISOString(),
        altRequestedAt: f.altRequestedAt ? new Date(f.altRequestedAt).toISOString() : null,
        note: f.note || undefined,
      });
      setF({ kind: 'ZOOM', requestedAt: '', altRequestedAt: '', note: '' });
      load();
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  }
  if (!app) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-bold text-slate-800">We can't find that application</h1>
          <p className="mt-2 text-sm text-slate-500">
            Check the link in your confirmation email, or reply to it and we'll help.
          </p>
        </div>
      </div>
    );
  }

  const status = STATUS_COPY[app.status] ?? STATUS_COPY.SUBMITTED;
  const pending = app.appointments.find((a) => a.status === 'REQUESTED');
  const confirmed = app.appointments.find((a) => a.status === 'CONFIRMED');
  const closed = app.status === 'APPROVED' || app.status === 'REJECTED';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-brand-600 px-4 py-8 text-white">
        <div className="mx-auto max-w-lg">
          <img src="/tasty-food-splash.png" alt="Tasty Food" className="mb-3 h-10 w-auto" />
          <h1 className="text-2xl font-bold">Your application</h1>
          <p className="text-sm text-green-50">
            {TIER_LABEL[app.tier] ?? app.tier} · submitted {when(app.submittedAt)}
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-lg space-y-5 px-4 py-8">
        <div className={`rounded-xl border p-5 ${status.tone}`}>
          <div className="text-xs font-bold uppercase tracking-wide">{status.label}</div>
          <p className="mt-1 text-sm">{status.body}</p>
        </div>

        {app.formAvailable && (
          <a
            href={`/api/public/apply/${token}/form`}
            className="block rounded-xl border border-slate-200 bg-white p-5 text-center font-semibold text-brand-700 shadow-sm transition hover:bg-slate-50"
          >
            ⬇ Download your application form
          </a>
        )}

        {confirmed && (
          <div className="rounded-xl border border-green-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-green-700">Your meeting is confirmed</div>
            <div className="mt-1 font-semibold text-slate-800">
              {when(confirmed.confirmedAt ?? confirmed.requestedAt)}
            </div>
            <div className="text-sm text-slate-500">
              {confirmed.kind === 'ZOOM' ? 'Over Zoom' : 'At our office'}
            </div>
            {confirmed.zoomLink && (
              <a
                href={confirmed.zoomLink}
                className="mt-3 inline-block rounded-lg bg-brand-600 px-5 py-2.5 font-bold text-white"
              >
                Join the Zoom meeting
              </a>
            )}
            {confirmed.location && <p className="mt-2 text-sm text-slate-600">{confirmed.location}</p>}
            {confirmed.note && <p className="mt-2 text-sm text-slate-500">{confirmed.note}</p>}
          </div>
        )}

        {pending && (
          <div className="rounded-xl border border-amber-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-amber-700">
              {APPT_COPY[pending.status]}
            </div>
            <div className="mt-1 font-semibold text-slate-800">{when(pending.requestedAt)}</div>
            <div className="text-sm text-slate-500">
              {pending.kind === 'ZOOM' ? 'Over Zoom' : 'At our office'}
            </div>
            <p className="mt-2 text-sm text-slate-500">
              We'll email you as soon as this is confirmed.
            </p>
          </div>
        )}

        {!pending && !confirmed && !closed && (
          <form onSubmit={request} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="font-bold text-slate-800">Ask for a meeting</h2>
              <p className="text-sm text-slate-500">
                Tell us when suits you. We'll confirm it, or suggest a nearby time.
              </p>
            </div>

            {err && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {(['ZOOM', 'OFFICE_VISIT'] as const).map((k) => (
                <label
                  key={k}
                  className={`cursor-pointer rounded-lg border px-3 py-3 text-center text-sm transition ${
                    f.kind === k ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-slate-200'
                  }`}
                >
                  <input
                    type="radio" name="kind" className="sr-only"
                    checked={f.kind === k} onChange={() => set('kind', k)}
                  />
                  {k === 'ZOOM' ? '💻 Over Zoom' : '🏢 Visit the office'}
                </label>
              ))}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Preferred date &amp; time *</label>
              <input
                type="datetime-local" min={minLocal()}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                value={f.requestedAt} onChange={(e) => set('requestedAt', e.target.value)} required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">A second choice (optional)</label>
              <input
                type="datetime-local" min={minLocal()}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                value={f.altRequestedAt} onChange={(e) => set('altRequestedAt', e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-400">Giving a second option usually gets you confirmed faster.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Anything to add?</label>
              <textarea
                rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                value={f.note} onChange={(e) => set('note', e.target.value)}
              />
            </div>

            <button
              type="submit" disabled={saving}
              className="w-full rounded-xl bg-brand-600 px-6 py-3 font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? 'Sending…' : 'Request this meeting'}
            </button>
            <p className="text-center text-xs text-slate-400">All times are Philippine time.</p>
          </form>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState, KpiCard } from '../components/ui';
import { peso, num, dateTime } from '../lib/format';

type Tier = 'PROVINCIAL' | 'CITY' | 'RESELLER' | 'RETAIL';
type Status = 'SUBMITTED' | 'REVIEWING' | 'APPROVED' | 'REJECTED';

const TIERS: Tier[] = ['PROVINCIAL', 'CITY', 'RESELLER', 'RETAIL'];
const TIER_LABEL: Record<Tier, string> = {
  PROVINCIAL: 'Provincial Distributor',
  CITY: 'City Distributor',
  RESELLER: 'Reseller',
  RETAIL: 'Retail Distributor',
};
const STATUS_STYLE: Record<Status, string> = {
  SUBMITTED: 'bg-blue-100 text-blue-700',
  REVIEWING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-slate-100 text-slate-500',
};
const APPT_STYLE: Record<string, string> = {
  REQUESTED: 'bg-amber-100 text-amber-700',
  CONFIRMED: 'bg-green-100 text-green-700',
  DECLINED: 'bg-slate-100 text-slate-500',
  COMPLETED: 'bg-indigo-100 text-indigo-700',
  NO_SHOW: 'bg-red-100 text-red-700',
};

interface Appointment {
  id: string;
  kind: 'ZOOM' | 'OFFICE_VISIT';
  status: string;
  requestedAt: string;
  altRequestedAt: string | null;
  confirmedAt: string | null;
  zoomLink: string | null;
  location: string | null;
  note: string | null;
  outcome: string | null;
  applicantAnswer: string | null;
}
interface Attachment {
  id: string;
  label: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}
interface Application {
  id: string;
  tier: Tier;
  name: string;
  email: string;
  phone: string;
  address: string | null;
  city: string | null;
  province: string | null;
  businessName: string | null;
  hasStore: boolean;
  experience: string | null;
  capital: number | null;
  targetArea: string | null;
  note: string | null;
  status: Status;
  reviewNote: string | null;
  createdAt: string;
  formSubmittedAt: string | null;
  attachments: Attachment[];
  appointments: Appointment[];
}
interface Summary {
  total: number; submitted: number; reviewing: number; approved: number; rejected: number;
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// <input type="datetime-local"> needs local time, so the UTC ISO from the API
// has to be shifted before it round-trips.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function Applications() {
  const [status, setStatus] = useState<'' | Status>('');
  const [tier, setTier] = useState<'' | Tier>('');
  const [area, setArea] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (tier) qs.set('tier', tier);
  if (area.trim()) qs.set('area', area.trim());
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);

  const { data, loading, error, refetch } = useFetch<{ applications: Application[]; summary: Summary }>(
    `/marketing/applications${qs.toString() ? `?${qs}` : ''}`
  );
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function review(a: Application, next: Status) {
    setErr(null);
    let note: string | null = null;
    if (next === 'REJECTED') {
      note = prompt('Why are you not proceeding? (the applicant is not shown this)') ?? null;
      if (note === null) return;
    }
    try {
      await api.patch(`/marketing/applications/${a.id}`, { status: next, reviewNote: note });
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  // Fetched as a blob rather than linked directly, so the request carries the
  // session and the file never needs a public URL.
  async function downloadAttachment(a: Application, f: Attachment) {
    setErr(null);
    try {
      const res = await api.get(`/marketing/applications/${a.id}/attachments/${f.id}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = f.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setErr(apiError(e));
    }
  }

  async function remove(a: Application) {
    if (!confirm(`Delete ${a.name}'s application?`)) return;
    setErr(null);
    try {
      await api.delete(`/marketing/applications/${a.id}`);
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  const filtersOn = !!(status || tier || area.trim() || from || to);
  const apps = data?.applications ?? [];

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div>
      <PageHeader
        title="Applications"
        subtitle="People who applied online to become distributors"
      />

      {err && <Alert>{err}</Alert>}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Awaiting review" value={num(data?.summary.submitted ?? 0)} accent="text-blue-600" />
        <KpiCard label="Under review" value={num(data?.summary.reviewing ?? 0)} accent="text-amber-600" />
        <KpiCard label="Approved" value={num(data?.summary.approved ?? 0)} accent="text-green-600" />
        <KpiCard label="Not proceeding" value={num(data?.summary.rejected ?? 0)} />
      </div>

      <div className="card mb-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="">All statuses</option>
            <option value="SUBMITTED">Awaiting review</option>
            <option value="REVIEWING">Under review</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Not proceeding</option>
          </select>
          <select className="input" value={tier} onChange={(e) => setTier(e.target.value as any)}>
            <option value="">Applying for anything</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>{TIER_LABEL[t]}</option>
            ))}
          </select>
          <input className="input" placeholder="Area — city or province" value={area} onChange={(e) => setArea(e.target.value)} />
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <span className="shrink-0">From</span>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <span className="shrink-0">To</span>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        {filtersOn && (
          <button
            className="mt-2 text-xs text-brand-600 hover:underline"
            onClick={() => { setStatus(''); setTier(''); setArea(''); setFrom(''); setTo(''); }}
          >
            Clear filters
          </button>
        )}
      </div>

      {apps.length === 0 ? (
        <EmptyState>
          {filtersOn ? 'No applications match those filters.' : 'No one has applied online yet.'}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {apps.map((a) => {
            const pending = a.appointments.find((p) => p.status === 'REQUESTED');
            const open = openId === a.id;
            return (
              <div key={a.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="font-semibold text-slate-800 hover:text-brand-700"
                        onClick={() => setOpenId(open ? null : a.id)}
                      >
                        {a.name}
                      </button>
                      <span className={`badge ${STATUS_STYLE[a.status]}`}>{a.status.toLowerCase()}</span>
                      <span className="badge bg-brand-50 text-brand-700">{TIER_LABEL[a.tier]}</span>
                      {pending && <span className="badge bg-amber-100 text-amber-700">meeting requested</span>}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {[a.city, a.province].filter(Boolean).join(', ') || '—'} · {a.phone} · {a.email}
                    </div>
                    <div className="text-xs text-slate-400">applied {dateTime(a.createdAt)}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {a.status === 'SUBMITTED' && (
                      <button className="btn-secondary text-xs" onClick={() => review(a, 'REVIEWING')}>
                        Start review
                      </button>
                    )}
                    {a.status !== 'APPROVED' && (
                      <button className="btn-primary text-xs" onClick={() => review(a, 'APPROVED')}>
                        Approve
                      </button>
                    )}
                    {a.status !== 'REJECTED' && (
                      <button className="btn-secondary text-xs text-red-600" onClick={() => review(a, 'REJECTED')}>
                        Decline
                      </button>
                    )}
                    <button
                      className="btn-secondary px-2 text-xs"
                      title="Delete this application"
                      onClick={() => remove(a)}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                      <Detail label="Area they want">{a.targetArea || '—'}</Detail>
                      <Detail label="Business">{a.businessName || '—'}{a.hasStore ? ' · has a store' : ''}</Detail>
                      <Detail label="Capital ready">{a.capital ? peso(a.capital) : '—'}</Detail>
                      <Detail label="Address">{a.address || '—'}</Detail>
                      <Detail label="Experience" wide>{a.experience || '—'}</Detail>
                      {a.note && <Detail label="Their note" wide>{a.note}</Detail>}
                      {a.reviewNote && <Detail label="Your note" wide>{a.reviewNote}</Detail>}
                    </dl>

                    <div className="mt-5">
                      <h4 className="mb-2 text-sm font-semibold text-slate-700">
                        Documents they sent
                        {a.formSubmittedAt && (
                          <span className="ml-2 text-xs font-normal text-slate-400">
                            first received {dateTime(a.formSubmittedAt)}
                          </span>
                        )}
                      </h4>
                      {a.attachments.length === 0 ? (
                        <p className="text-sm text-slate-400">
                          They haven't sent their filled-in form yet.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {a.attachments.map((f) => (
                            <li key={f.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                              <span className="font-medium text-slate-700">{f.label}</span>
                              <button
                                className="text-brand-600 hover:underline"
                                onClick={() => downloadAttachment(a, f)}
                              >
                                {f.fileName}
                              </button>
                              <span className="text-xs text-slate-400">
                                {fmtSize(f.size)} · {dateTime(f.createdAt)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="mt-5">
                      <h4 className="mb-2 text-sm font-semibold text-slate-700">Meetings</h4>
                      {a.appointments.length === 0 ? (
                        <p className="text-sm text-slate-400">They haven't asked for a meeting yet.</p>
                      ) : (
                        <div className="space-y-3">
                          {a.appointments.map((p) => (
                            <AppointmentRow key={p.id} appt={p} onDone={refetch} onError={setErr} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Detail({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-slate-700">{children}</dd>
    </div>
  );
}

function AppointmentRow({
  appt,
  onDone,
  onError,
}: {
  appt: Appointment;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [when, setWhen] = useState(toLocalInput(appt.requestedAt));
  const [zoomLink, setZoomLink] = useState(appt.zoomLink ?? '');
  const [location, setLocation] = useState(appt.location ?? '');
  const [note, setNote] = useState('');

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api.patch(`/marketing/applications/appointments/${appt.id}`, body);
      setConfirming(false);
      onDone();
    } catch (e) {
      onError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  const isZoom = appt.kind === 'ZOOM';

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge ${APPT_STYLE[appt.status] ?? 'bg-slate-100 text-slate-600'}`}>
          {appt.status.replace('_', ' ').toLowerCase()}
        </span>
        <span className="text-sm font-medium text-slate-700">{isZoom ? '💻 Zoom' : '🏢 Office visit'}</span>
        <span className="text-sm text-slate-500">
          {dateTime(appt.confirmedAt ?? appt.requestedAt)}
        </span>
      </div>
      {appt.altRequestedAt && appt.status === 'REQUESTED' && (
        <div className="mt-1 text-xs text-slate-500">or {dateTime(appt.altRequestedAt)}</div>
      )}
      {appt.note && <div className="mt-1 text-xs italic text-slate-500">“{appt.note}”</div>}
      {appt.applicantAnswer && (
        <div
          className={`mt-2 inline-block rounded px-2 py-1 text-xs font-semibold ${
            appt.applicantAnswer === 'YES'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {appt.applicantAnswer === 'YES' ? '✓ they confirmed they are coming' : '✕ they said they cannot make it'}
        </div>
      )}
      {appt.outcome && <div className="mt-1 text-xs text-slate-600">Outcome: {appt.outcome}</div>}

      {appt.status === 'REQUESTED' && !confirming && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary text-xs" disabled={busy} onClick={() => setConfirming(true)}>
            Confirm meeting
          </button>
          <button
            className="btn-secondary text-xs text-red-600"
            disabled={busy}
            onClick={() => {
              const reason = prompt('Tell them why (optional) — they can then pick another time:');
              if (reason === null) return;
              act({ action: 'DECLINE', note: reason || null });
            }}
          >
            Can't make it
          </button>
        </div>
      )}

      {confirming && (
        <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
          <div>
            <label className="label">Date &amp; time</label>
            <input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
            <p className="mt-1 text-xs text-slate-400">
              Change it and they're told clearly that the time moved.
            </p>
          </div>
          {isZoom ? (
            <div>
              <label className="label">Zoom link</label>
              <input className="input" value={zoomLink} onChange={(e) => setZoomLink(e.target.value)} placeholder="leave blank to use your standing Zoom room" />
            </div>
          ) : (
            <div>
              <label className="label">Where</label>
              <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="leave blank to use the office address" />
            </div>
          )}
          <div>
            <label className="label">Note to them (optional)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button
              className="btn-primary text-xs"
              disabled={busy}
              onClick={() =>
                act({
                  action: 'CONFIRM',
                  confirmedAt: new Date(when).toISOString(),
                  zoomLink: isZoom ? zoomLink || null : null,
                  location: isZoom ? null : location || null,
                  note: note || null,
                })
              }
            >
              {busy ? 'Sending…' : 'Confirm and email them'}
            </button>
            <button className="btn-secondary text-xs" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}

      {appt.status === 'CONFIRMED' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="btn-secondary text-xs"
            disabled={busy}
            onClick={() => {
              const outcome = prompt('How did it go?');
              if (outcome === null) return;
              act({ action: 'COMPLETE', outcome: outcome || null });
            }}
          >
            Mark as done
          </button>
          <button
            className="btn-secondary text-xs text-red-600"
            disabled={busy}
            onClick={() => act({ action: 'NO_SHOW', outcome: 'Did not show up' })}
          >
            Didn't show
          </button>
        </div>
      )}
    </div>
  );
}

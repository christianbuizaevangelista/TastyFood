import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, apiError } from '../api/client';

// Public application tracker (no login). The link lives in the applicant's
// confirmation email; the token in the URL is what stands in for an account.

interface Appointment {
  id: string;
  kind: 'ZOOM' | 'OFFICE_VISIT';
  status: string;
  requestedAt: string;
  confirmedAt: string | null;
  applicantAnswer: string | null;
  zoomLink: string | null;
  location: string | null;
  note: string | null;
}
interface Slot { start: string; end: string; label: string }
interface Office { address: string; mapsUrl: string }

interface Attachment {
  id: string;
  label: string;
  fileName: string;
  size: number;
  createdAt: string;
}
interface Application {
  name: string;
  code: string | null;
  tier: string;
  status: string;
  submittedAt: string;
  formAvailable: boolean;
  formSubmittedAt: string | null;
  attachments: Attachment[];
  appointments: Appointment[];
}

// Meetings run on weekdays only, in three fixed windows.
const WEEKDAY_HINT = 'Monday to Friday only';
const MAX_FILES = 5;
const MAX_BYTES = 3 * 1024 * 1024;

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type StepState = 'done' | 'current' | 'pending' | 'stopped';
interface Step {
  title: string;
  detail: string;
  at: string | null;
  state: StepState;
}

// The whole journey, read off the timestamps the app already records — the same
// idea as a courier's tracking page: what has happened, what is happening now,
// and what is still ahead. A step never claims a date it does not have.
function buildTimeline(app: Application): Step[] {
  const confirmed = app.appointments.find((a) => a.status === 'CONFIRMED');
  const completed = app.appointments.find((a) => a.status === 'COMPLETED');
  const requested = app.appointments.find((a) => a.status === 'REQUESTED');
  const declined = app.appointments.find((a) => a.status === 'DECLINED');
  const rejected = app.status === 'REJECTED';
  const approved = app.status === 'APPROVED';

  // Once a decision is made, everything before it is history.
  const step = (done: boolean, current: boolean): StepState =>
    done ? 'done' : rejected ? 'stopped' : current ? 'current' : 'pending';

  const meetingDone = !!completed;
  const meetingSet = !!confirmed || meetingDone;

  return [
    {
      title: 'Application received',
      detail: 'We have your details.',
      at: app.submittedAt,
      state: 'done',
    },
    {
      title: 'Form returned',
      detail: app.formSubmittedAt
        ? `${app.attachments.length} document${app.attachments.length === 1 ? '' : 's'} received.`
        : 'Send us your filled-in form to move forward.',
      at: app.formSubmittedAt,
      state: step(!!app.formSubmittedAt, !app.formSubmittedAt),
    },
    {
      title: meetingDone ? 'Meeting done' : meetingSet ? 'Meeting scheduled' : 'Meeting',
      detail: meetingDone
        ? 'Thank you for your time.'
        : confirmed
        ? `Confirmed for ${when(confirmed.confirmedAt ?? confirmed.requestedAt)}.`
        : requested
        ? 'You asked for a time — we are confirming it.'
        : declined
        ? 'That time did not work. Please pick another.'
        : 'We will meet over Zoom or at our office.',
      at: meetingDone ? null : confirmed?.confirmedAt ?? null,
      state: step(meetingSet || meetingDone, !!app.formSubmittedAt && !meetingSet),
    },
    {
      title: rejected ? 'Not proceeding' : approved ? 'Approved' : 'Decision',
      detail: rejected
        ? 'We are not able to move forward this time.'
        : approved
        ? 'Welcome aboard — we will be in touch about signing.'
        : 'We confirm your territory and come back to you.',
      at: null,
      state: rejected ? 'stopped' : approved ? 'done' : meetingDone ? 'current' : 'pending',
    },
  ];
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
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
// The earliest bookable day: tomorrow, so nobody books an hour from now.
function minDate(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
// Midday is used deliberately: reading the day at midnight risks landing on the
// wrong side of the date in another timezone.
function isWeekend(ymd: string): boolean {
  const day = new Date(`${ymd}T12:00:00+08:00`).getUTCDay();
  return day === 0 || day === 6;
}
// A Manila wall-clock slot on a given day, as a real instant. +08:00 is fixed —
// the Philippines has no daylight saving.
function slotInstant(ymd: string, start: string): string {
  return new Date(`${ymd}T${start}:00+08:00`).toISOString();
}

export default function ApplyStatus() {
  const { token = '' } = useParams();
  const [app, setApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [params, setParams] = useSearchParams();
  const confirmId = params.get('confirm');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [office, setOffice] = useState<Office | null>(null);
  const [f, setF] = useState({ kind: 'ZOOM' as 'ZOOM' | 'OFFICE_VISIT', date: '', slot: '', note: '' });
  const set = (k: keyof typeof f, v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [label, setLabel] = useState('Application form');

  function load() {
    api
      .get<Application>(`/public/apply/${token}`)
      .then(({ data }) => setApp(data))
      .catch(() => setApp(null))
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  // The bookable windows and the office pin come from the server, so the rules
  // live in one place rather than being repeated here.
  useEffect(() => {
    api
      .get<{ slots: Slot[]; office: Office }>('/public/apply/config')
      .then(({ data }) => {
        setSlots(data.slots ?? []);
        setOffice(data.office ?? null);
      })
      .catch(() => undefined);
  }, []);

  async function upload(file: File | null) {
    if (!file) return;
    setUploadErr(null);
    if (file.size > MAX_BYTES) {
      setUploadErr('That file is over 3 MB. Please send a smaller scan or photo.');
      return;
    }
    setUploading(true);
    try {
      await api.post(`/public/apply/${token}/upload`, {
        label,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataBase64: await fileToBase64(file),
      });
      setLabel('Application form');
      load();
    } catch (e) {
      setUploadErr(apiError(e));
    } finally {
      setUploading(false);
    }
  }

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.date || !f.slot) {
      setErr('Please pick a day and a time.');
      return;
    }
    if (isWeekend(f.date)) {
      setErr('Meetings are held Monday to Friday only. Please pick a weekday.');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/public/apply/${token}/appointment`, {
        kind: f.kind,
        requestedAt: slotInstant(f.date, f.slot),
        note: f.note || undefined,
      });
      setF({ kind: 'ZOOM', date: '', slot: '', note: '' });
      load();
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setSaving(false);
    }
  }

  // The morning-of email links here with ?confirm=<id>; that is what turns the
  // card below on. Answering is a POST from a button, never a link in the mail —
  // inbox scanners follow links, and a scanner answering "yes" would leave the
  // Principal waiting for someone who is not coming.
  async function respond(appointmentId: string, answer: 'YES' | 'NO') {
    setErr(null);
    setSaving(true);
    try {
      await api.post(`/public/apply/${token}/appointment/${appointmentId}/respond`, { answer });
      setParams({}, { replace: true });
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
  const timeline = buildTimeline(app);
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
          {app.code && (
            <p className="mt-2 text-sm text-green-50">
              Tracking code <span className="font-bold tracking-widest text-white">{app.code}</span>
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-lg space-y-5 px-4 py-8">
        <div className={`rounded-xl border p-5 ${status.tone}`}>
          <div className="text-xs font-bold uppercase tracking-wide">{status.label}</div>
          <p className="mt-1 text-sm">{status.body}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-bold text-slate-800">Progress</h2>
          <ol className="relative">
            {timeline.map((s, i) => {
              const last = i === timeline.length - 1;
              const dot =
                s.state === 'done'
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : s.state === 'current'
                  ? 'border-brand-600 bg-white text-brand-700'
                  : s.state === 'stopped'
                  ? 'border-slate-300 bg-slate-200 text-slate-500'
                  : 'border-slate-200 bg-white text-slate-300';
              return (
                <li key={s.title} className="flex gap-3 pb-6 last:pb-0">
                  <div className="flex flex-col items-center">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${dot}`}
                      aria-hidden="true"
                    >
                      {s.state === 'done' ? '✓' : s.state === 'stopped' ? '—' : i + 1}
                    </span>
                    {!last && (
                      <span
                        className={`mt-1 w-0.5 flex-1 ${
                          s.state === 'done' ? 'bg-brand-600' : 'bg-slate-200'
                        }`}
                      />
                    )}
                  </div>
                  <div className={`flex-1 pt-0.5 ${s.state === 'pending' ? 'opacity-60' : ''}`}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span
                        className={`font-semibold ${
                          s.state === 'current' ? 'text-brand-700' : 'text-slate-800'
                        }`}
                      >
                        {s.title}
                      </span>
                      {s.state === 'current' && (
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                          now
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">{s.detail}</p>
                    {s.at && <p className="text-xs text-slate-400">{when(s.at)}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {/* The form round-trip: download it, fill it in, send it back. Both
            halves sit together so the second step is impossible to miss. */}
        {!closed && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-800">Your application form</h2>

            <ol className="mt-3 space-y-4">
              {app.formAvailable && (
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                    1
                  </span>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-700">Download and fill it in</div>
                    <a
                      href={`/api/public/apply/${token}/form`}
                      className="mt-2 inline-block rounded-lg border-2 border-brand-600 px-4 py-2 text-sm font-bold text-brand-700 transition hover:bg-brand-50"
                    >
                      ⬇ Download the form
                    </a>
                  </div>
                </li>
              )}

              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                  {app.formAvailable ? 2 : 1}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-700">Send it back to us</div>
                  <p className="text-xs text-slate-500">
                    Upload the filled-in form — a clear photo or scan is fine. You can also attach a
                    valid ID or business permit.
                  </p>

                  {uploadErr && (
                    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {uploadErr}
                    </div>
                  )}

                  {app.attachments.length < MAX_FILES ? (
                    <div className="mt-3 space-y-2">
                      <select
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
                        value={label} onChange={(e) => setLabel(e.target.value)}
                      >
                        <option>Application form</option>
                        <option>Valid ID</option>
                        <option>Business permit</option>
                        <option>Proof of address</option>
                        <option>Other document</option>
                      </select>
                      <label className="block">
                        <span className="sr-only">Choose a file</span>
                        <input
                          type="file" disabled={uploading}
                          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv"
                          onChange={(e) => {
                            upload(e.target.files?.[0] ?? null);
                            e.target.value = '';
                          }}
                          className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:bg-brand-700 disabled:opacity-60"
                        />
                      </label>
                      <p className="text-xs text-slate-400">
                        PDF, photo or Office file · up to 3 MB · {MAX_FILES - app.attachments.length} left
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      You've sent the maximum of {MAX_FILES} files. Reply to our email if you need to send more.
                    </p>
                  )}

                  {uploading && <p className="mt-2 text-sm text-brand-700">Uploading…</p>}

                  {app.attachments.length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                      {app.attachments.map((a) => (
                        <li key={a.id} className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="min-w-0">
                            <span className="text-green-600">✓</span>{' '}
                            <span className="font-medium text-slate-700">{a.label}</span>{' '}
                            <span className="truncate text-xs text-slate-400">{a.fileName}</span>
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">{fmtSize(a.size)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            </ol>

            {app.formSubmittedAt && (
              <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
                Received — your application is now with us for review.
              </p>
            )}
          </div>
        )}

        {/* The morning-of email lands here. Asking on the page rather than by
            reply means the answer is recorded, not sitting in a no-reply inbox. */}
        {confirmed && confirmId === confirmed.id && !confirmed.applicantAnswer && (
          <div className="rounded-xl border-2 border-brand-500 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-800">Are you still coming today?</h2>
            <p className="mt-1 text-sm text-slate-500">
              {when(confirmed.confirmedAt ?? confirmed.requestedAt)} ·{' '}
              {confirmed.kind === 'ZOOM' ? 'over Zoom' : 'at our office'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="flex-1 rounded-xl bg-brand-600 px-5 py-3 font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
                disabled={saving}
                onClick={() => respond(confirmed.id, 'YES')}
              >
                Yes, I'll be there
              </button>
              <button
                className="flex-1 rounded-xl border-2 border-slate-300 px-5 py-3 font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                disabled={saving}
                onClick={() => respond(confirmed.id, 'NO')}
              >
                I can't make it
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-slate-400">
              Either answer is fine — we would much rather know than wait.
            </p>
          </div>
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
            {confirmed.kind === 'OFFICE_VISIT' && office && (
              <div className="mt-3">
                <p className="text-sm text-slate-600">{confirmed.location || office.address}</p>
                <a
                  href={office.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block rounded-lg border-2 border-brand-600 px-5 py-2.5 font-bold text-brand-700 transition hover:bg-brand-50"
                >
                  📍 Open in Google Maps
                </a>
              </div>
            )}
            {confirmed.note && <p className="mt-2 text-sm text-slate-500">{confirmed.note}</p>}
            {confirmed.applicantAnswer && (
              <p
                className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                  confirmed.applicantAnswer === 'YES'
                    ? 'bg-green-50 text-green-800'
                    : 'bg-amber-50 text-amber-800'
                }`}
              >
                {confirmed.applicantAnswer === 'YES'
                  ? "You told us you're coming — see you then."
                  : "You told us you can't make it. We'll be in touch to rearrange."}
              </p>
            )}
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
              <label className="mb-1 block text-sm font-medium text-slate-700">Which day? *</label>
              <input
                type="date" min={minDate()}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                value={f.date} onChange={(e) => set('date', e.target.value)} required
              />
              <p className="mt-1 text-xs text-slate-400">{WEEKDAY_HINT}.</p>
              {f.date && isWeekend(f.date) && (
                <p className="mt-1 text-xs font-medium text-amber-600">
                  That is a weekend — please pick a day from Monday to Friday.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">What time? *</label>
              <div className="space-y-2">
                {slots.map((s) => {
                  const picked = f.slot === s.start;
                  return (
                    <label
                      key={s.start}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition ${
                        picked ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio" name="slot" value={s.start} checked={picked}
                        onChange={() => set('slot', s.start)} className="h-4 w-4 accent-brand-600"
                      />
                      <span className="font-medium text-slate-800">{s.label}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-slate-400">All times are Philippine time.</p>
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

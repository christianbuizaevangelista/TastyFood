import { useEffect, useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, KpiCard } from '../components/ui';
import { num, date } from '../lib/format';

// Principal's control panel for the public recruitment landing page at /join.

interface Registration {
  id: string;
  name: string;
  email: string;
  phone: string;
  city: string | null;
  province: string | null;
  interest: string;
  message: string | null;
  leadId: string | null;
  attended: boolean;
  createdAt: string;
  session: { id: string; scheduledAt: string } | null;
}
interface Webinar {
  id: string;
  title: string;
  headline: string | null;
  description: string | null;
  scheduledAt: string | null;
  zoomLink: string | null;
  zoomMeetingId: string | null;
  zoomPasscode: string | null;
  isActive: boolean;
  funnelId: string | null;
  funnel: { id: string; name: string } | null;
  registrations: Registration[];
  sessions: WebinarSession[];
}
interface WebinarSession {
  id: string;
  scheduledAt: string;
  zoomLink: string | null;
  zoomMeetingId: string | null;
  zoomPasscode: string | null;
  isActive: boolean;
}
interface Summary { total: number; attended: number; converted: number }
interface Funnel { id: string; name: string }

const INTEREST_LABEL: Record<string, string> = {
  PROVINCIAL: 'Provincial', CITY: 'City', RESELLER: 'Reseller', RETAIL: 'Retail', UNSURE: 'Not sure',
};

// <input type="datetime-local"> needs "YYYY-MM-DDTHH:mm" in LOCAL time, so the
// UTC ISO string from the API has to be shifted before it round-trips.
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export default function LandingPage() {
  const { data, loading, error, refetch } = useFetch<{ webinar: Webinar | null; summary: Summary | null }>(
    '/marketing/webinar'
  );
  const funnels = useFetch<{ funnels: Funnel[] }>('/marketing/funnels');
  const [f, setF] = useState({
    title: '', headline: '', description: '', scheduledAt: '',
    zoomLink: '', zoomMeetingId: '', zoomPasscode: '', isActive: true, funnelId: '',
  });
  // Draft rows for the schedule editor. `id` is absent on a row that has not
  // been saved yet; the API takes the whole list and syncs to it.
  type SessionRow = { id?: string; scheduledAt: string; zoomLink: string; zoomMeetingId: string; zoomPasscode: string };
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const setSession = (i: number, k: keyof SessionRow, v: string) =>
    setSessions((prev) => prev.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: unknown) => setF((prev) => ({ ...prev, [k]: v }));

  // Seed the form once the saved configuration arrives.
  useEffect(() => {
    const w = data?.webinar;
    if (!w) return;
    setF({
      title: w.title ?? '',
      headline: w.headline ?? '',
      description: w.description ?? '',
      scheduledAt: toLocalInput(w.scheduledAt),
      zoomLink: w.zoomLink ?? '',
      zoomMeetingId: w.zoomMeetingId ?? '',
      zoomPasscode: w.zoomPasscode ?? '',
      isActive: w.isActive,
      funnelId: w.funnelId ?? '',
    });
    setSessions(
      (w.sessions ?? []).map((s) => ({
        id: s.id,
        scheduledAt: toLocalInput(s.scheduledAt),
        zoomLink: s.zoomLink ?? '',
        zoomMeetingId: s.zoomMeetingId ?? '',
        zoomPasscode: s.zoomPasscode ?? '',
      }))
    );
    // Re-seeding on the session ids too matters: after a save, rows that were
    // new now have ids, and without picking them up the next save would create
    // duplicates instead of updating them.
  }, [data?.webinar?.id, (data?.webinar?.sessions ?? []).map((s) => s.id).join(',')]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setNote(null);
    const rows = sessions.filter((s) => s.scheduledAt);
    if (rows.length === 0) {
      setErr('Add at least one schedule for the orientation.');
      return;
    }
    setSaving(true);
    // datetime-local has no timezone; treat it as the browser's local time.
    const iso = (v: string) => new Date(v).toISOString();
    const sorted = [...rows].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    try {
      await api.put('/marketing/webinar', {
        title: f.title,
        headline: f.headline || null,
        description: f.description || null,
        // The headline date stays in step with the soonest schedule, so older
        // reads of `scheduledAt` never show a stale time.
        scheduledAt: iso(sorted[0].scheduledAt),
        sessions: sorted.map((s) => ({
          ...(s.id ? { id: s.id } : {}),
          scheduledAt: iso(s.scheduledAt),
          zoomLink: s.zoomLink || null,
          zoomMeetingId: s.zoomMeetingId || null,
          zoomPasscode: s.zoomPasscode || null,
          isActive: true,
        })),
        zoomLink: f.zoomLink || null,
        zoomMeetingId: f.zoomMeetingId || null,
        zoomPasscode: f.zoomPasscode || null,
        isActive: f.isActive,
        funnelId: f.funnelId || null,
      });
      setNote('Landing page updated.');
      refetch();
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setSaving(false);
    }
  }

  // Ticking attendance emails the thank-you straight away, and that cannot be
  // unsent — so it is confirmed once and then locked.
  async function markAttended(r: Registration) {
    if (r.attended) return;
    if (!confirm(`Mark ${r.name} as having attended? This emails them the thank-you and cannot be undone.`)) return;
    setErr(null);
    try {
      await api.patch(`/marketing/webinar/registrations/${r.id}`, { attended: true });
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  async function delRegistration(r: Registration) {
    if (!confirm(`Remove ${r.name}'s registration? This does not delete any lead already created from it.`)) return;
    setErr(null);
    try {
      await api.delete(`/marketing/webinar/registrations/${r.id}`);
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  async function exportCsv() {
    setErr(null);
    try {
      const res = await api.get('/marketing/webinar/registrations.csv', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'webinar-registrations.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(apiError(e));
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  const w = data?.webinar ?? null;
  const s = data?.summary;
  const landingUrl = `${location.origin}/join`;

  return (
    <div>
      <PageHeader
        title="Landing Page"
        subtitle="The public sign-up page your ads point to"
        action={
          <a href="/join" target="_blank" rel="noreferrer" className="btn-secondary">
            View live page ↗
          </a>
        }
      />

      {err && <Alert>{err}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}

      {/* The URL to paste into ads */}
      <div className="card mb-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your landing page URL</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-800">{landingUrl}</code>
          <button
            className="btn-secondary text-xs"
            onClick={() => {
              navigator.clipboard?.writeText(landingUrl);
              setNote('Link copied.');
            }}
          >
            Copy
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Point your Facebook ad here. Anyone who registers is saved below
          {w?.funnel ? <> and added to the <strong>{w.funnel.name}</strong> funnel</> : null}.
        </p>
      </div>

      {s && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <KpiCard label="Registrations" value={num(s.total)} accent="text-brand-600" />
          <KpiCard label="Attended" value={num(s.attended)} hint="marked present" accent="text-green-600" />
          <KpiCard label="Added to funnel" value={num(s.converted)} hint="became leads" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Configuration */}
        <form onSubmit={save} className="card space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">Orientation details</h2>

          <div>
            <label className="label">Title *</label>
            <input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} required
              placeholder="Tasty Food Distributor Orientation" />
          </div>
          <div>
            <label className="label">Headline (big text on the page)</label>
            <input className="input" value={f.headline} onChange={(e) => set('headline', e.target.value)}
              placeholder="Build your own food distribution business" />
          </div>
          <div>
            <label className="label">Intro paragraph</label>
            <textarea className="input" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)}
              placeholder="Join our free online orientation…" />
          </div>
          <div className="border-t border-slate-100 pt-3">
            <label className="label">Schedules</label>
            <p className="mb-2 text-xs text-slate-400">
              Offer several dates and times — visitors pick the one that suits them.
              Leave the Zoom fields blank to use the default meeting below.
            </p>
            <div className="space-y-2">
              {sessions.map((s, i) => (
                <div key={s.id ?? `new-${i}`} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="datetime-local" className="input flex-1" value={s.scheduledAt}
                      onChange={(e) => setSession(i, 'scheduledAt', e.target.value)}
                    />
                    <button
                      type="button" title="Remove this schedule"
                      className="btn-secondary px-2 py-1 text-xs text-red-600"
                      onClick={() => setSessions((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <input
                      className="input col-span-3 text-xs" placeholder="Own Zoom link (optional)"
                      value={s.zoomLink} onChange={(e) => setSession(i, 'zoomLink', e.target.value)}
                    />
                    <input
                      className="input col-span-2 text-xs" placeholder="Meeting ID"
                      value={s.zoomMeetingId} onChange={(e) => setSession(i, 'zoomMeetingId', e.target.value)}
                    />
                    <input
                      className="input text-xs" placeholder="Passcode"
                      value={s.zoomPasscode} onChange={(e) => setSession(i, 'zoomPasscode', e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button" className="btn-secondary mt-2 w-full text-sm"
              onClick={() =>
                setSessions((prev) => [...prev, { scheduledAt: '', zoomLink: '', zoomMeetingId: '', zoomPasscode: '' }])
              }
            >
              + Add a schedule
            </button>
            <p className="mt-1 text-xs text-slate-400">
              Shown to visitors in Philippine time. Removing a schedule keeps the people who signed up for it.
            </p>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <label className="label">Zoom link</label>
            <input className="input" value={f.zoomLink} onChange={(e) => set('zoomLink', e.target.value)}
              placeholder="https://zoom.us/j/1234567890" />
            <p className="mt-1 text-xs text-slate-400">
              Only revealed after someone registers — never shown on the public page.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Meeting ID</label>
              <input className="input" value={f.zoomMeetingId} onChange={(e) => set('zoomMeetingId', e.target.value)} />
            </div>
            <div>
              <label className="label">Passcode</label>
              <input className="input" value={f.zoomPasscode} onChange={(e) => set('zoomPasscode', e.target.value)} />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <label className="label">Send registrations to funnel</label>
            <select className="input" value={f.funnelId} onChange={(e) => set('funnelId', e.target.value)}>
              <option value="">— use the first active funnel —</option>
              {(funnels.data?.funnels ?? []).map((fn) => (
                <option key={fn.id} value={fn.id}>{fn.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Every sign-up becomes a lead in the first stage of this funnel. Leave it unset and
              we use your first active funnel, creating one if you have none — a registration
              is never dropped.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} />
            Page is live and accepting registrations
          </label>
          {!f.isActive && (
            <p className="text-xs text-amber-600">
              Visitors will see “no orientation is open right now” instead of the form.
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={saving}>
            {saving ? 'Saving…' : w ? 'Save changes' : 'Create landing page'}
          </button>
        </form>

        {/* Registrations */}
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Registrations</h2>
            {w && w.registrations.length > 0 && (
              <button className="btn-secondary text-xs" onClick={exportCsv}>Export CSV</button>
            )}
          </div>

          {!w || w.registrations.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              No registrations yet. Share your landing page link to start collecting sign-ups.
            </div>
          ) : (
            <div className="max-h-[540px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-100">
                    <th className="th">Name</th>
                    <th className="th">Interest</th>
                    <th className="th text-center">Attended</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody>
                  {w.registrations.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50">
                      <td className="td">
                        <div className="font-medium text-slate-800">{r.name}</div>
                        <div className="text-xs text-slate-400">{r.email}</div>
                        <div className="text-xs text-slate-400">
                          {r.phone}
                          {(r.city || r.province) && ` · ${[r.city, r.province].filter(Boolean).join(', ')}`}
                        </div>
                        {r.message && <div className="mt-1 text-xs italic text-slate-500">“{r.message}”</div>}
                        <div className="mt-0.5 text-xs text-slate-300">{date(r.createdAt)}</div>
                      </td>
                      <td className="td">
                        <span className="badge bg-slate-100 text-slate-600">
                          {INTEREST_LABEL[r.interest] ?? r.interest}
                        </span>
                        {r.session && (
                          <div className="mt-1 text-xs text-slate-500">{date(r.session.scheduledAt)}</div>
                        )}
                        {r.leadId && <div className="mt-1 text-xs text-green-600">in funnel</div>}
                      </td>
                      <td className="td text-center">
                        {r.attended ? (
                          <span
                            className="badge bg-green-100 text-green-700"
                            title="Recorded — the thank-you email has been sent"
                          >
                            ✓ attended
                          </span>
                        ) : (
                          <input type="checkbox" checked={false} onChange={() => markAttended(r)} />
                        )}
                      </td>
                      <td className="td text-right">
                        <button
                          className="btn-secondary px-2 py-1 text-xs text-red-600"
                          title="Remove this registration"
                          onClick={() => delRegistration(r)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

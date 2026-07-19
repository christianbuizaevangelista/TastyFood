import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, KpiCard } from '../components/ui';
import { num, date } from '../lib/format';

// Distributors raise concerns with the Principal; the Principal reads and
// answers them here. Same route, different view depending on who you are.

interface Ticket {
  id: string;
  senderName: string;
  position: string;
  phone: string | null;
  email: string;
  message: string;
  status: 'OPEN' | 'RESOLVED';
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
  org?: { id: string; name: string; type: string };
}
interface Identity {
  senderName: string;
  position: string;
  phone: string | null;
  email: string;
  orgName: string;
}

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-700',
  RESOLVED: 'bg-green-100 text-green-700',
};

// A field the sender can see but not change — it comes from their account.
function LockedField({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
        <span className="text-slate-300">🔒</span>
        {value ? <span>{value}</span> : <span className="italic text-slate-400">{hint ?? 'Not set'}</span>}
      </div>
    </div>
  );
}

export default function Concerns() {
  const { user } = useAuth();
  return user?.role === 'PRINCIPAL' ? <PrincipalInbox /> : <RaiseConcern />;
}

// ---------------------------------------------------------------------------
// Distributor view
// ---------------------------------------------------------------------------
function RaiseConcern() {
  const { data, loading, error, refetch } = useFetch<{ identity: Identity; tickets: Ticket[] }>('/support/me');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.post('/support', { message: message.trim() });
      setMessage('');
      setSent(true);
      refetch();
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const id = data!.identity;

  return (
    <div>
      <PageHeader
        title="Concerns & Issues"
        subtitle="Send a concern straight to Tasty Food Manufacturing Inc."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <form onSubmit={submit} className="card space-y-3">
          {err && <Alert>{err}</Alert>}
          {sent && !err && <Alert kind="success">Sent. We'll get back to you.</Alert>}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LockedField label="Name" value={id.senderName} />
            <LockedField label="Position" value={id.position} />
            <LockedField label="CP number" value={id.phone} hint="No contact number on file" />
            <LockedField label="Email address" value={id.email} />
          </div>
          <p className="-mt-1 text-xs text-slate-400">
            These come from your account and are sent as-is so we know who to contact.
            {!id.phone && ' Add your contact number in Account settings so we can call you back.'}
          </p>

          <div>
            <label className="label">Your concern or issue *</label>
            <textarea
              className="input"
              rows={6}
              value={message}
              onChange={(e) => { setMessage(e.target.value); setSent(false); }}
              placeholder="Tell us what happened, and what you need help with…"
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={busy || !message.trim()}>
            {busy ? 'Sending…' : 'Send to Tasty Food'}
          </button>
        </form>

        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Your previous concerns</h2>
          {data!.tickets.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">You haven't raised anything yet.</p>
          ) : (
            <ul className="max-h-[520px] space-y-3 overflow-y-auto">
              {data!.tickets.map((t) => (
                <li key={t.id} className="rounded-lg border border-slate-100 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className={`badge ${STATUS_STYLE[t.status]}`}>{t.status}</span>
                    <span className="text-xs text-slate-400">{date(t.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{t.message}</p>
                  {t.reply && (
                    <div className="mt-2 rounded-lg border-l-4 border-brand-500 bg-brand-50 px-3 py-2">
                      <div className="text-xs font-semibold text-brand-700">Tasty Food replied</div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{t.reply}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Principal view
// ---------------------------------------------------------------------------
function PrincipalInbox() {
  const [filter, setFilter] = useState<'' | 'OPEN' | 'RESOLVED'>('');
  const { data, loading, error, refetch } = useFetch<{
    tickets: Ticket[];
    summary: { total: number; open: number; resolved: number };
  }>(`/support${filter ? `?status=${filter}` : ''}`, [filter]);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(t: Ticket, body: Record<string, unknown>) {
    setErr(null);
    setBusyId(t.id);
    try {
      await api.patch(`/support/${t.id}`, body);
      refetch();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const s = data!.summary;

  return (
    <div>
      <PageHeader
        title="Concerns & Issues"
        subtitle="What your distributors have raised"
        action={
          <select className="input w-40" value={filter} onChange={(e) => setFilter(e.target.value as any)}>
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        }
      />

      {err && <Alert>{err}</Alert>}

      <div className="mb-6 grid grid-cols-3 gap-4">
        <KpiCard label="Total" value={num(s.total)} />
        <KpiCard label="Open" value={num(s.open)} accent={s.open ? 'text-amber-600' : 'text-slate-900'} />
        <KpiCard label="Resolved" value={num(s.resolved)} accent="text-green-600" />
      </div>

      {data!.tickets.length === 0 ? (
        <div className="card py-10 text-center text-sm text-slate-400">Nothing here.</div>
      ) : (
        <div className="space-y-4">
          {data!.tickets.map((t) => (
            <div key={t.id} className="card">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-800">
                    {t.senderName}
                    <span className="ml-2 text-sm font-normal text-slate-500">{t.org?.name}</span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {t.position}
                    {t.phone && ` · 📞 ${t.phone}`}
                    {` · ✉️ ${t.email}`}
                  </div>
                </div>
                <div className="text-right">
                  <span className={`badge ${STATUS_STYLE[t.status]}`}>{t.status}</span>
                  <div className="mt-1 text-xs text-slate-400">{date(t.createdAt)}</div>
                </div>
              </div>

              <p className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{t.message}</p>

              <div className="mt-3">
                <label className="label">Your reply</label>
                <textarea
                  className="input"
                  rows={2}
                  value={replies[t.id] ?? t.reply ?? ''}
                  onChange={(e) => setReplies((r) => ({ ...r, [t.id]: e.target.value }))}
                  placeholder="Reply to this concern…"
                />
                {t.repliedAt && <p className="mt-1 text-xs text-slate-400">Last replied {date(t.repliedAt)}</p>}
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <button
                    className="btn-secondary text-xs"
                    disabled={busyId === t.id || !(replies[t.id] ?? t.reply ?? '').trim()}
                    onClick={() => save(t, { reply: (replies[t.id] ?? t.reply ?? '').trim() })}
                  >
                    {busyId === t.id ? 'Saving…' : 'Send reply'}
                  </button>
                  <button
                    className="btn-secondary text-xs"
                    disabled={busyId === t.id}
                    onClick={() => save(t, { status: t.status === 'OPEN' ? 'RESOLVED' : 'OPEN' })}
                  >
                    {t.status === 'OPEN' ? 'Mark resolved' : 'Reopen'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState } from '../components/ui';
import { dateTime } from '../lib/format';
import { Org } from '../types';

interface Referral {
  id: string;
  name: string;
  address: string;
  cpNumber: string;
  note?: string | null;
  createdAt: string;
  toOrg?: { id: string; name: string; type: string };
  fromOrg?: { id: string; name: string };
}

export default function Referrals() {
  const { user } = useAuth();
  const isPrincipal = user!.role === 'PRINCIPAL';
  const { data, loading, error, refetch } = useFetch<{ referrals: Referral[] }>('/referrals');
  const [showNew, setShowNew] = useState(false);

  const referrals = data?.referrals ?? [];

  return (
    <div>
      <PageHeader
        title="Referrals"
        subtitle={
          isPrincipal
            ? 'Refer leads/customers to your distributors and resellers'
            : 'Leads and customers referred to you by Tasty Food'
        }
        action={
          isPrincipal ? (
            <button className="btn-primary" onClick={() => setShowNew(true)}>+ New referral</button>
          ) : null
        }
      />

      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : referrals.length === 0 ? (
        <EmptyState>
          {isPrincipal ? 'No referrals sent yet.' : 'No referrals yet. New leads from Tasty Food will appear here.'}
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {referrals.map((r) => (
            <div key={r.id} className="card py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800">{r.name}</div>
                  <div className="text-sm text-slate-500">📍 {r.address}</div>
                  <div className="text-sm text-slate-500">📞 {r.cpNumber}</div>
                  {r.note && <div className="mt-1 text-sm text-slate-600">📝 {r.note}</div>}
                </div>
                <div className="shrink-0 text-right text-xs text-slate-400">
                  {isPrincipal && r.toOrg && (
                    <div className="mb-1 font-semibold text-brand-700">→ {r.toOrg.name}</div>
                  )}
                  {dateTime(r.createdAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <NewReferral
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function NewReferral({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const orgs = useFetch<{ orgs: Org[] }>('/orgs');
  const [form, setForm] = useState({ toOrgId: '', name: '', address: '', cpNumber: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ sent: boolean; orgName: string } | null>(null);

  const set = (k: keyof typeof form) => (e: any) => setForm({ ...form, [k]: e.target.value });

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      const { data } = await api.post('/referrals', {
        toOrgId: form.toOrgId,
        name: form.name.trim(),
        address: form.address.trim(),
        cpNumber: form.cpNumber.trim(),
        note: form.note.trim() || undefined,
      });
      setDone({ sent: !!data.invite?.sent, orgName: data.toOrg?.name ?? 'the account' });
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  const valid = form.toOrgId && form.name.trim() && form.address.trim() && form.cpNumber.trim();

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold">New referral</h2>
        <p className="mb-4 text-xs text-slate-500">The account you choose gets an email with the lead's details.</p>
        {err && <div className="mb-3"><Alert>{err}</Alert></div>}

        {done ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="text-sm font-semibold text-green-800">Referral sent 🎉</div>
            <p className="mt-1 text-xs text-green-700">
              {done.sent
                ? `An email was sent to ${done.orgName} with the lead's details.`
                : `Saved and visible to ${done.orgName}, but the email could not be delivered.`}
            </p>
            <div className="mt-4 flex justify-end">
              <button className="btn-primary" onClick={onCreated}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className="label">Refer to</label>
                <select className="input" value={form.toOrgId} onChange={set('toOrgId')}>
                  <option value="">{orgs.loading ? 'Loading…' : 'Select an account…'}</option>
                  {(orgs.data?.orgs ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.contactName || o.name} ({o.type})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Name</label>
                <input className="input" value={form.name} onChange={set('name')} placeholder="Lead/customer name" />
              </div>
              <div>
                <label className="label">Complete address</label>
                <input className="input" value={form.address} onChange={set('address')} />
              </div>
              <div>
                <label className="label">CP number</label>
                <input className="input" value={form.cpNumber} onChange={set('cpNumber')} placeholder="09xxxxxxxxx" />
              </div>
              <div>
                <label className="label">Note (optional)</label>
                <textarea className="input" rows={2} value={form.note} onChange={set('note')} />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" disabled={busy || !valid} onClick={submit}>
                {busy ? 'Sending…' : 'Send referral'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState } from '../components/ui';
import { peso } from '../lib/format';

interface Dist {
  id: string;
  name: string;
  type: string;
  segment?: string;
  charges: number;
  payments: number;
  balance: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function DistributorFinancials() {
  const { data, loading, error, refetch } = useFetch<{ distributors: Dist[] }>('/accounting/distributor-financials');
  const [selected, setSelected] = useState<Dist | null>(null);

  const distributors = data?.distributors ?? [];

  return (
    <div>
      <PageHeader title="Distributor Financials" subtitle="Accounts Receivable per distributor — charges, payments, and balance owed" />

      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : distributors.length === 0 ? (
        <EmptyState>No accounts-receivable activity yet. On-account sales (POS) will appear here.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">Distributor</th>
                <th className="th text-right">Charges</th>
                <th className="th text-right">Payments</th>
                <th className="th text-right">Balance owed</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {distributors.map((d) => (
                <tr key={d.id} className="border-b border-slate-50">
                  <td className="td">
                    <button className="text-left font-medium text-brand-700 hover:underline" onClick={() => setSelected(d)}>{d.name}</button>
                    <div className="text-xs text-slate-400">{d.segment === 'RETAIL' ? 'Retail Distributor' : d.type}</div>
                  </td>
                  <td className="td text-right">{peso(d.charges)}</td>
                  <td className="td text-right text-green-600">{peso(d.payments)}</td>
                  <td className={`td text-right font-semibold ${d.balance > 0 ? 'text-red-600' : 'text-slate-700'}`}>{peso(d.balance)}</td>
                  <td className="td text-right"><button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setSelected(d)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <Statement dist={selected} onClose={() => { setSelected(null); refetch(); }} />}
    </div>
  );
}

interface Sale { id: string; number: string; total: number; createdAt: string }
interface Payment { id: string; amount: number; date: string; note?: string | null }

function Statement({ dist, onClose }: { dist: Dist; onClose: () => void }) {
  const { data, loading, error, refetch } = useFetch<{ distributor: Dist; sales: Sale[]; payments: Payment[]; charges: number; paid: number; balance: number }>(
    `/accounting/distributor-financials/${dist.id}`
  );
  const [showPay, setShowPay] = useState(false);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">{dist.name}</h2>
          <div className="text-right">
            <div className="text-xs text-slate-400">Balance owed</div>
            <div className={`text-xl font-bold ${(data?.balance ?? 0) > 0 ? 'text-red-600' : 'text-slate-800'}`}>{peso(data?.balance ?? 0)}</div>
          </div>
        </div>

        <div className="my-3">
          <button className="btn-primary text-xs" onClick={() => setShowPay(true)}>+ Record Payment</button>
        </div>

        {loading ? (
          <Spinner />
        ) : error ? (
          <Alert>{error}</Alert>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-400">Charges (on-account sales)</div>
              {(data?.sales.length ?? 0) === 0 ? (
                <div className="text-sm text-slate-400">None</div>
              ) : (
                <div className="space-y-1">
                  {data!.sales.map((s) => (
                    <div key={s.id} className="flex justify-between border-b border-slate-50 py-1 text-sm">
                      <span className="font-mono text-xs text-slate-500">{s.number} <span className="text-slate-400">· {new Date(s.createdAt).toLocaleDateString()}</span></span>
                      <span>{peso(s.total)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-1 text-sm font-semibold"><span>Total charges</span><span>{peso(data!.charges)}</span></div>
                </div>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-400">Payments</div>
              {(data?.payments.length ?? 0) === 0 ? (
                <div className="text-sm text-slate-400">None</div>
              ) : (
                <div className="space-y-1">
                  {data!.payments.map((p) => (
                    <div key={p.id} className="flex justify-between border-b border-slate-50 py-1 text-sm">
                      <span className="text-xs text-slate-500">{new Date(p.date).toLocaleDateString()}{p.note ? ` · ${p.note}` : ''}</span>
                      <span className="text-green-600">{peso(p.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-1 text-sm font-semibold"><span>Total paid</span><span className="text-green-600">{peso(data!.paid)}</span></div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>

      {showPay && <RecordPayment distId={dist.id} onClose={() => setShowPay(false)} onSaved={() => { setShowPay(false); refetch(); }} />}
    </div>
  );
}

function RecordPayment({ distId, onClose, onSaved }: { distId: string; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) return setErr('Enter an amount.');
    setBusy(true);
    try {
      await api.post(`/accounting/distributor-financials/${distId}/payments`, { amount: amt, date, note: note || undefined });
      onSaved();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">Record Payment</h2>
        {err && <div className="mb-3"><Alert>{err}</Alert></div>}
        <label className="label">Amount (₱)</label>
        <input type="number" min={0} step="0.01" className="input mb-3" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <label className="label">Date</label>
        <input type="date" className="input mb-3" value={date} onChange={(e) => setDate(e.target.value)} />
        <label className="label">Note (optional)</label>
        <input className="input mb-4" value={note} onChange={(e) => setNote(e.target.value)} placeholder="OR / reference no." />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

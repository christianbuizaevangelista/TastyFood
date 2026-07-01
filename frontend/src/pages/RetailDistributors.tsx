import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState } from '../components/ui';
import { peso } from '../lib/format';

interface Dist {
  id: string;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  balance?: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function RetailDistributors() {
  const { data, loading, error, refetch } = useFetch<{ distributors: Dist[] }>('/accounting/retail');
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Dist | null>(null);

  const distributors = data?.distributors ?? [];

  return (
    <div>
      <PageHeader
        title="Retail Distributors"
        subtitle="Separate retail segment — financial transactions per distributor"
        action={<button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add distributor</button>}
      />

      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : distributors.length === 0 ? (
        <EmptyState>No retail distributors yet.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">Name</th>
                <th className="th">Contact</th>
                <th className="th text-right">Balance (owed)</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {distributors.map((d) => (
                <tr key={d.id} className="border-b border-slate-50">
                  <td className="td">
                    <button className="text-left font-medium text-brand-700 hover:underline" onClick={() => setSelected(d)}>{d.name}</button>
                    {d.address && <div className="text-xs text-slate-400">{d.address}</div>}
                  </td>
                  <td className="td text-xs">
                    {d.contactPerson && <div>{d.contactPerson}</div>}
                    {d.phone && <div className="text-slate-400">{d.phone}</div>}
                  </td>
                  <td className={`td text-right font-semibold ${(d.balance ?? 0) > 0 ? 'text-red-600' : 'text-slate-700'}`}>{peso(d.balance ?? 0)}</td>
                  <td className="td text-right">
                    <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setSelected(d)}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddDist onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); refetch(); }} />}
      {selected && <DistDetail dist={selected} onClose={() => { setSelected(null); refetch(); }} />}
    </div>
  );
}

function AddDist({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', contactPerson: '', phone: '', address: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: any) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setErr(null);
    if (!form.name.trim()) return setErr('Name is required.');
    setBusy(true);
    try {
      await api.post('/accounting/retail', {
        name: form.name.trim(),
        contactPerson: form.contactPerson || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        notes: form.notes || undefined,
      });
      onSaved();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Add retail distributor" onClose={onClose}>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <label className="label">Name</label>
      <input className="input mb-3" value={form.name} onChange={set('name')} />
      <label className="label">Contact person</label>
      <input className="input mb-3" value={form.contactPerson} onChange={set('contactPerson')} />
      <label className="label">Phone</label>
      <input className="input mb-3" value={form.phone} onChange={set('phone')} />
      <label className="label">Address</label>
      <input className="input mb-3" value={form.address} onChange={set('address')} />
      <label className="label">Notes</label>
      <textarea className="input mb-4" rows={2} value={form.notes} onChange={set('notes')} />
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add'}</button>
      </div>
    </Modal>
  );
}

interface Txn {
  id: string;
  date: string;
  type: string;
  description?: string | null;
  reference?: string | null;
  charge: number;
  payment: number;
  balance: number;
}

function DistDetail({ dist, onClose }: { dist: Dist; onClose: () => void }) {
  const { data, loading, error, refetch } = useFetch<{ distributor: Dist; transactions: Txn[]; balance: number }>(`/accounting/retail/${dist.id}`);
  const [showTx, setShowTx] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function exportCsv() {
    setErr(null);
    try {
      const res = await api.get(`/accounting/retail/${dist.id}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dist.name}_transactions.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setErr(apiError(e));
    }
  }

  async function importCsv(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const text = await file.text();
      const { data } = await api.post(`/accounting/retail/${dist.id}/import`, { csv: text });
      alert(`Imported ${data.imported} transaction(s).`);
      refetch();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function delTx(txId: string) {
    if (!confirm('Delete this transaction?')) return;
    try {
      await api.delete(`/accounting/retail/${dist.id}/transactions/${txId}`);
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  const txns = data?.transactions ?? [];

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">{dist.name}</h2>
            <p className="text-xs text-slate-500">{dist.contactPerson} {dist.phone ? `· ${dist.phone}` : ''}</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">Balance owed</div>
            <div className={`text-xl font-bold ${(data?.balance ?? 0) > 0 ? 'text-red-600' : 'text-slate-800'}`}>{peso(data?.balance ?? 0)}</div>
          </div>
        </div>

        {err && <div className="my-3"><Alert>{err}</Alert></div>}

        <div className="my-3 flex flex-wrap gap-2">
          <button className="btn-primary text-xs" onClick={() => setShowTx(true)}>+ Add transaction</button>
          <button className="btn-ghost text-xs" onClick={exportCsv}>⬇ Export CSV</button>
          <label className="btn-ghost cursor-pointer text-xs">
            {busy ? 'Importing…' : '⬆ Import CSV'}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ''; }} />
          </label>
        </div>

        {loading ? (
          <Spinner />
        ) : error ? (
          <Alert>{error}</Alert>
        ) : txns.length === 0 ? (
          <EmptyState>No transactions yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="td">Date</th><th className="td">Type</th><th className="td">Description</th>
                  <th className="td text-right">Charge</th><th className="td text-right">Payment</th><th className="td text-right">Balance</th><th></th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50">
                    <td className="td text-xs">{new Date(t.date).toLocaleDateString()}</td>
                    <td className="td text-xs">{t.type}</td>
                    <td className="td text-xs">{t.description}{t.reference ? <span className="text-slate-400"> · {t.reference}</span> : ''}</td>
                    <td className="td text-right">{t.charge ? peso(t.charge) : ''}</td>
                    <td className="td text-right text-green-600">{t.payment ? peso(t.payment) : ''}</td>
                    <td className="td text-right font-medium">{peso(t.balance)}</td>
                    <td className="td text-right"><button className="text-xs text-red-600 hover:underline" onClick={() => delTx(t.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>

      {showTx && <AddTx distId={dist.id} onClose={() => setShowTx(false)} onSaved={() => { setShowTx(false); refetch(); }} />}
    </div>
  );
}

function AddTx({ distId, onClose, onSaved }: { distId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ date: today(), type: 'SALE', description: '', reference: '', amount: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isPayment = form.type === 'PAYMENT';

  async function save() {
    setErr(null);
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return setErr('Enter an amount.');
    setBusy(true);
    try {
      await api.post(`/accounting/retail/${distId}/transactions`, {
        date: form.date,
        type: form.type,
        description: form.description || undefined,
        reference: form.reference || undefined,
        charge: isPayment ? 0 : amt,
        payment: isPayment ? amt : 0,
      });
      onSaved();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Add transaction" onClose={onClose}>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="SALE">Sale / Charge (they owe)</option>
            <option value="PAYMENT">Payment (they paid)</option>
            <option value="ADJUSTMENT">Adjustment</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">{isPayment ? 'Payment amount' : 'Charge amount'} (₱)</label>
          <input type="number" min={0} step="0.01" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </div>
        <div className="col-span-2">
          <label className="label">Description</label>
          <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="col-span-2">
          <label className="label">Reference (optional)</label>
          <input className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="DR / invoice no." />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

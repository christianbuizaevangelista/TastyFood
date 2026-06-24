import { FormEvent, useMemo, useState } from 'react';
import { api, apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState } from '../components/ui';
import { peso, dateTime } from '../lib/format';
import { Customer } from '../types';

export default function Customers() {
  const { user } = useAuth();
  const { data, loading, error, refetch } = useFetch<{ customers: Customer[] }>('/customers');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<null | Partial<Customer>>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const list = data?.customers ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => [c.name, c.phone, c.address, c.owner?.name].some((v) => v && v.toLowerCase().includes(q)));
  }, [list, query]);

  const mine = (c: Customer) => c.owner?.id === user!.org.id;

  async function remove(c: Customer) {
    if (!confirm(`Tanggalin si ${c.name}?`)) return;
    try {
      await api.delete(`/customers/${c.id}`);
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Mga suki / customer na sinusuplayan — pangalan, contact, at lugar."
        action={<button className="btn-primary" onClick={() => setEditing({})}>+ Bagong customer</button>}
      />

      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      <div className="mb-3">
        <input className="input max-w-sm" placeholder="🔍 Hanapin (pangalan / lugar)…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : filtered.length === 0 ? (
        <EmptyState>{list.length ? 'Walang tugma sa hinanap.' : 'Wala pang customer. I-tap ang “+ Bagong customer”.'}</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="td">Pangalan</th>
                <th className="td">Cellphone</th>
                <th className="td">Address</th>
                <th className="td">Supplier</th>
                <th className="td text-right">Orders</th>
                <th className="td text-right">Amount</th>
                <th className="td text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="td">
                    <button className="text-left font-medium text-brand-700 hover:underline" onClick={() => setDetailId(c.id)}>
                      {c.name}
                    </button>
                  </td>
                  <td className="td">{c.phone || '—'}</td>
                  <td className="td text-slate-500">{c.address || '—'}</td>
                  <td className="td text-xs text-slate-400">{c.owner?.name}</td>
                  <td className="td text-right">{c.salesCount ?? 0}</td>
                  <td className="td text-right font-semibold">{peso(c.totalAmount ?? 0)}</td>
                  <td className="td text-right">
                    {mine(c) && (
                      <span className="flex justify-end gap-2">
                        <button className="btn-ghost text-xs" onClick={() => setEditing(c)}>Edit</button>
                        <button className="text-xs text-red-600 hover:underline" onClick={() => remove(c)}>Delete</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CustomerForm
          customer={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refetch(); }}
        />
      )}

      {detailId && <CustomerDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

interface CustomerDetailData {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  owner?: { name: string };
  totalAmount: number;
  sales: { id: string; number: string; total: number; createdAt: string; items: { name: string; quantity: number; lineTotal: number }[] }[];
}

function CustomerDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useFetch<CustomerDetailData>(`/customers/${id}`);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <Spinner />
        ) : error || !data ? (
          <Alert>{error || 'Not found'}</Alert>
        ) : (
          <>
            <h2 className="text-lg font-bold">{data.name}</h2>
            <p className="text-xs text-slate-500">
              {[data.phone, data.address].filter(Boolean).join(' · ') || '—'}
              {data.owner ? ` · Supplier: ${data.owner.name}` : ''}
            </p>

            <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-500">{data.sales.length} order{data.sales.length === 1 ? '' : 's'}</span>
              <span className="font-bold text-brand-600">Total: {peso(data.totalAmount)}</span>
            </div>

            <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Purchase history</div>
            {data.sales.length === 0 ? (
              <div className="mt-2 rounded-lg border border-slate-100 p-3 text-sm text-slate-400">Wala pang order.</div>
            ) : (
              <div className="mt-2 space-y-2">
                {data.sales.map((s) => (
                  <div key={s.id} className="rounded-lg border border-slate-100 p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs">{s.number}</span>
                      <span className="font-semibold">{peso(s.total)}</span>
                    </div>
                    <div className="text-xs text-slate-400">{dateTime(s.createdAt)}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {s.items.map((i) => `${i.name} ×${i.quantity}`).join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button className="btn-ghost" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function CustomerForm({
  customer,
  onClose,
  onSaved,
}: {
  customer: Partial<Customer>;
  onClose: () => void;
  onSaved: (c: Customer) => void;
}) {
  const [form, setForm] = useState({
    name: customer.name ?? '',
    phone: customer.phone ?? '',
    address: customer.address ?? '',
    note: customer.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const editingId = customer.id;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setErr('Ilagay ang pangalan.');
    setBusy(true);
    setErr(null);
    try {
      const payload = { name: form.name.trim(), phone: form.phone.trim() || undefined, address: form.address.trim() || undefined, note: form.note.trim() || undefined };
      const { data } = editingId
        ? await api.patch(`/customers/${editingId}`, payload)
        : await api.post('/customers', payload);
      onSaved(data);
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={save} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">{editingId ? 'I-edit ang customer' : 'Bagong customer'}</h2>
        {err && <div className="mb-3"><Alert>{err}</Alert></div>}
        <div className="space-y-3">
          <div>
            <label className="label">Pangalan *</label>
            <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Cellphone number</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="label">Address / Lugar</label>
            <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

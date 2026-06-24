import { useMemo, useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert } from '../components/ui';
import { peso } from '../lib/format';
import { Customer, Product } from '../types';
import { CustomerForm } from './Customers';

export default function ResellerSale() {
  const products = useFetch<{ products: Product[] }>('/products');
  const customers = useFetch<{ customers: Customer[] }>('/customers');

  const [customerId, setCustomerId] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const list = products.data?.products ?? [];
  const myCustomers = customers.data?.customers ?? [];
  const total = useMemo(
    () => Object.entries(cart).reduce((s, [pid, q]) => s + (list.find((p) => p.id === pid)?.srp ?? 0) * q, 0),
    [cart, list]
  );
  const lineCount = Object.values(cart).filter((q) => q > 0).length;

  function step(pid: string, delta: number) {
    setCart((c) => {
      const next = Math.max(0, (c[pid] ?? 0) + delta);
      return { ...c, [pid]: next };
    });
  }

  async function save() {
    setErr(null);
    if (!customerId) return setErr('Select or add a customer.');
    const items = Object.entries(cart).filter(([, q]) => q > 0).map(([productId, quantity]) => ({ productId, quantity }));
    if (items.length === 0) return setErr('Add at least one product.');
    setBusy(true);
    try {
      await api.post('/pos/sales', { distributionType: 'TRADE', discountRate: 0, customerId, items });
      const name = myCustomers.find((c) => c.id === customerId)?.name ?? 'customer';
      setDone(`Sale recorded for ${name}! 🎉`);
      setCart({});
      setCustomerId('');
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (products.loading || customers.loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Record a Sale" subtitle="Pick a customer, set what they bought, then save." />

      {done && <div className="mb-4"><Alert kind="success">{done}</Alert></div>}
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      {/* Customer */}
      <div className="card mb-4">
        <label className="label">Customer</label>
        <div className="flex gap-2">
          <select className="input flex-1" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setDone(null); }}>
            <option value="">— Select a customer —</option>
            {myCustomers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.address ? ` · ${c.address}` : ''}</option>
            ))}
          </select>
          <button className="btn-ghost whitespace-nowrap" onClick={() => setAddingCustomer(true)}>+ New</button>
        </div>
      </div>

      {/* Products with big steppers */}
      <div className="card mb-4">
        <label className="label">Items bought</label>
        <div className="space-y-2">
          {list.map((p) => {
            const qty = cart[p.id] ?? 0;
            return (
              <div key={p.id} className={`flex items-center justify-between rounded-lg border p-2 ${qty > 0 ? 'border-brand-300 bg-brand-50' : 'border-slate-100'}`}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.name}{p.size ? ` (${p.size})` : ''}</div>
                  <div className="text-xs text-slate-400">{peso(p.srp)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => step(p.id, -1)} className="h-9 w-9 rounded-lg border border-slate-300 text-lg font-bold text-slate-600 disabled:opacity-30" disabled={qty === 0}>−</button>
                  <span className="w-8 text-center text-base font-semibold">{qty}</span>
                  <button onClick={() => step(p.id, 1)} className="h-9 w-9 rounded-lg bg-brand-500 text-lg font-bold text-white">+</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Total + save */}
      <div className="card sticky bottom-2">
        <div className="mb-3 flex items-center justify-between text-lg font-bold">
          <span>Total ({lineCount} item{lineCount === 1 ? '' : 's'})</span>
          <span className="text-brand-600">{peso(total)}</span>
        </div>
        <button className="btn-primary w-full py-3 text-base" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save sale'}
        </button>
      </div>

      {addingCustomer && (
        <CustomerForm
          customer={{}}
          onClose={() => setAddingCustomer(false)}
          onSaved={(c) => { setAddingCustomer(false); customers.refetch(); setCustomerId(c.id); }}
        />
      )}
    </div>
  );
}

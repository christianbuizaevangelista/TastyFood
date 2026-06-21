import { FormEvent, useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert } from '../components/ui';
import { peso } from '../lib/format';
import { Product } from '../types';

export default function Products() {
  const { data, loading, error, refetch } = useFetch<{ products: Product[] }>('/products');
  const [form, setForm] = useState({ sku: '', name: '', category: '', srp: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await api.post('/products', {
        sku: form.sku,
        name: form.name,
        category: form.category || undefined,
        srp: Number(form.srp),
      });
      setForm({ sku: '', name: '', category: '', srp: '' });
      setMsg('Product added');
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div>
      <PageHeader title="Products" subtitle="Master catalog — SRP drives all tier pricing" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <form onSubmit={submit} className="card space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">Add product</h2>
          {err && <Alert>{err}</Alert>}
          {msg && <Alert kind="success">{msg}</Alert>}
          <div>
            <label className="label">SKU</label>
            <input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required />
          </div>
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="label">Category</label>
            <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <div>
            <label className="label">SRP (₱)</label>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.srp}
              onChange={(e) => setForm({ ...form, srp: e.target.value })}
              required
            />
          </div>
          <button className="btn-primary w-full">Add product</button>
        </form>

        <div className="card overflow-x-auto lg:col-span-2">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">SKU</th>
                <th className="th">Name</th>
                <th className="th">Category</th>
                <th className="th text-right">SRP</th>
              </tr>
            </thead>
            <tbody>
              {data?.products.map((p) => (
                <tr key={p.id} className="border-b border-slate-50">
                  <td className="td font-mono text-xs">{p.sku}</td>
                  <td className="td font-medium">{p.name}</td>
                  <td className="td text-slate-500">{p.category}</td>
                  <td className="td text-right">{peso(p.srp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

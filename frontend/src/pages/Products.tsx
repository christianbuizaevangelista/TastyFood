import { FormEvent, useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert } from '../components/ui';
import { peso } from '../lib/format';
import { Product } from '../types';

export default function Products() {
  const { data, loading, error, refetch } = useFetch<{ products: Product[] }>('/products');
  const [form, setForm] = useState({ sku: '', name: '', category: '', variants: '', sizes: '', srp: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await api.post('/products', {
        sku: form.sku,
        name: form.name,
        category: form.category || undefined,
        variants: form.variants || undefined,
        sizes: form.sizes || undefined,
        srp: Number(form.srp),
      });
      setForm({ sku: '', name: '', category: '', variants: '', sizes: '', srp: '' });
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
      <PageHeader title="Products" subtitle="Master catalog — click a product to edit. SRP drives all tier pricing." />

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
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Variants</label>
              <input className="input" placeholder="Original, Spicy" value={form.variants} onChange={(e) => setForm({ ...form, variants: e.target.value })} />
            </div>
            <div>
              <label className="label">Sizes</label>
              <input className="input" placeholder="200g, 500g" value={form.sizes} onChange={(e) => setForm({ ...form, sizes: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">SRP (₱)</label>
            <input className="input" type="number" step="0.01" value={form.srp} onChange={(e) => setForm({ ...form, srp: e.target.value })} required />
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
                <th className="th">Variants</th>
                <th className="th">Sizes</th>
                <th className="th text-right">SRP</th>
              </tr>
            </thead>
            <tbody>
              {data?.products.map((p) => (
                <tr key={p.id} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" onClick={() => setEditing(p)}>
                  <td className="td font-mono text-xs">{p.sku}</td>
                  <td className="td font-medium text-brand-600 hover:underline">{p.name}</td>
                  <td className="td text-slate-500">{p.category || '—'}</td>
                  <td className="td text-xs text-slate-500">{p.variants || '—'}</td>
                  <td className="td text-xs text-slate-500">{p.sizes || '—'}</td>
                  <td className="td text-right">{peso(p.srp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditProduct
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function EditProduct({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    sku: product.sku,
    name: product.name,
    category: product.category ?? '',
    variants: product.variants ?? '',
    sizes: product.sizes ?? '',
    srp: String(product.srp),
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api.put(`/products/${product.id}`, {
        sku: form.sku,
        name: form.name,
        category: form.category || undefined,
        variants: form.variants || undefined,
        sizes: form.sizes || undefined,
        srp: Number(form.srp),
      });
      onSaved();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">Edit product</h2>
        {err && <div className="mb-3"><Alert>{err}</Alert></div>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">SKU</label>
            <input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </div>
          <div>
            <label className="label">SRP (₱)</label>
            <input className="input" type="number" step="0.01" value={form.srp} onChange={(e) => setForm({ ...form, srp: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">Category</label>
            <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <div>
            <label className="label">Variants</label>
            <input className="input" placeholder="Original, Spicy" value={form.variants} onChange={(e) => setForm({ ...form, variants: e.target.value })} />
          </div>
          <div>
            <label className="label">Sizes</label>
            <input className="input" placeholder="200g, 500g" value={form.sizes} onChange={(e) => setForm({ ...form, sizes: e.target.value })} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !form.sku || !form.name || !form.srp} onClick={save}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

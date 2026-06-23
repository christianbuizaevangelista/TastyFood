import { FormEvent, useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert } from '../components/ui';
import { peso } from '../lib/format';
import { Product } from '../types';

export default function Products() {
  const { data, loading, error, refetch } = useFetch<{ products: Product[] }>('/products');
  const [form, setForm] = useState({ sku: '', name: '', category: '', size: '', srp: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const products = data?.products ?? [];
  const allSelected = products.length > 0 && selected.size === products.length;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));
  }
  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} selected product(s)? They will be removed from the catalog.`)) return;
    setBulkBusy(true);
    setErr(null);
    try {
      await api.post('/products/bulk-delete', { ids: [...selected] });
      setSelected(new Set());
      refetch();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBulkBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await api.post('/products', {
        sku: form.sku,
        name: form.name,
        category: form.category || undefined,
        size: form.size || undefined,
        srp: Number(form.srp),
      });
      setForm({ sku: '', name: '', category: '', size: '', srp: '' });
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
          <div>
            <label className="label">Size</label>
            <input className="input" placeholder="e.g. 200g" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} />
          </div>
          <div>
            <label className="label">SRP (₱)</label>
            <input className="input" type="number" step="0.01" value={form.srp} onChange={(e) => setForm({ ...form, srp: e.target.value })} required />
          </div>
          <button className="btn-primary w-full">Add product</button>
        </form>

        <div className="card overflow-x-auto lg:col-span-2">
          {selected.size > 0 && (
            <div className="mb-3 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm">
              <span className="text-red-700">{selected.size} selected</span>
              <div className="flex gap-2">
                <button className="btn-ghost text-xs" onClick={() => setSelected(new Set())}>Clear</button>
                <button className="btn-primary bg-red-600 text-xs hover:bg-red-700" disabled={bulkBusy} onClick={bulkDelete}>
                  {bulkBusy ? 'Deleting…' : `Delete selected (${selected.size})`}
                </button>
              </div>
            </div>
          )}
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" />
                </th>
                <th className="th">SKU</th>
                <th className="th">Name</th>
                <th className="th">Category</th>
                <th className="th">Size</th>
                <th className="th text-right">SRP</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  </td>
                  <td className="td cursor-pointer font-mono text-xs" onClick={() => setEditing(p)}>{p.sku}</td>
                  <td className="td cursor-pointer font-medium text-brand-600 hover:underline" onClick={() => setEditing(p)}>{p.name}</td>
                  <td className="td cursor-pointer text-slate-500" onClick={() => setEditing(p)}>{p.category || '—'}</td>
                  <td className="td cursor-pointer text-xs text-slate-500" onClick={() => setEditing(p)}>{p.size || '—'}</td>
                  <td className="td cursor-pointer text-right" onClick={() => setEditing(p)}>{peso(p.srp)}</td>
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
    size: product.size ?? '',
    srp: String(product.srp),
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(`Delete "${product.name}"? It will be removed from the catalog.`)) return;
    setErr(null);
    setBusy(true);
    try {
      await api.delete(`/products/${product.id}`);
      onSaved();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api.put(`/products/${product.id}`, {
        sku: form.sku,
        name: form.name,
        category: form.category || undefined,
        size: form.size || undefined,
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
          <div className="col-span-2">
            <label className="label">Size</label>
            <input className="input" placeholder="e.g. 200g" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} />
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between gap-2">
          <button className="btn-ghost text-red-600" disabled={busy} onClick={remove}>Delete</button>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy || !form.sku || !form.name || !form.srp} onClick={save}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { FormEvent, useMemo, useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert } from '../components/ui';
import { peso } from '../lib/format';
import { Product } from '../types';

interface Group {
  name: string;
  category: string;
  items: Product[];
}

export default function Products() {
  const { data, loading, error, refetch } = useFetch<{ products: Product[] }>('/products');
  // New product: a base name/category + its first size (size, SKU, SRP).
  const [form, setForm] = useState({ name: '', category: '', size: '', sku: '', srp: '', retailSrp: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Group | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const products = data?.products ?? [];
  const groups: Group[] = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of products) {
      const arr = m.get(p.name) ?? [];
      arr.push(p);
      m.set(p.name, arr);
    }
    return [...m.entries()].map(([name, items]) => ({ name, category: items[0].category ?? '', items }));
  }, [products]);

  const allSelected = groups.length > 0 && selected.size === groups.length;
  function toggle(name: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(groups.map((g) => g.name)));
  }
  async function bulkDelete() {
    if (selected.size === 0) return;
    const ids = groups.filter((g) => selected.has(g.name)).flatMap((g) => g.items.map((i) => i.id));
    if (!window.confirm(`Delete ${selected.size} product(s) (${ids.length} SKU/size variants)?`)) return;
    setBulkBusy(true);
    setErr(null);
    try {
      await api.post('/products/bulk-delete', { ids });
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
        name: form.name,
        category: form.category || undefined,
        size: form.size || undefined,
        sku: form.sku,
        srp: Number(form.srp),
        retailSrp: form.retailSrp ? Number(form.retailSrp) : undefined,
      });
      setForm({ name: '', category: '', size: '', sku: '', srp: '', retailSrp: '' });
      setMsg('Product added');
      refetch();
    } catch (e2) {
      setErr(apiError(e2));
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div>
      <PageHeader title="Products" subtitle="Each product can have multiple sizes — each size has its own SKU and SRP." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <form onSubmit={submit} className="card space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">Add product</h2>
          {err && <Alert>{err}</Alert>}
          {msg && <Alert kind="success">{msg}</Alert>}
          <div>
            <label className="label">Product name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="label">Category</label>
            <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <div className="rounded-lg border border-slate-200 p-2">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-400">First size</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Size</label>
                <input className="input" placeholder="200g" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} />
              </div>
              <div>
                <label className="label">SKU</label>
                <input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required />
              </div>
              <div>
                <label className="label">SRP</label>
                <input className="input" type="number" step="0.01" value={form.srp} onChange={(e) => setForm({ ...form, srp: e.target.value })} required />
              </div>
              <div>
                <label className="label">Retail SRP <span className="font-normal text-slate-400">(optional)</span></label>
                <input className="input" type="number" step="0.01" value={form.retailSrp} onChange={(e) => setForm({ ...form, retailSrp: e.target.value })} placeholder="= SRP if blank" />
              </div>
            </div>
          </div>
          <button className="btn-primary w-full">Add product</button>
        </form>

        <div className="card overflow-x-auto lg:col-span-2">
          {selected.size > 0 && (
            <div className="mb-3 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm">
              <span className="text-red-700">{selected.size} product(s) selected</span>
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
                <th className="th w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" /></th>
                <th className="th">Product</th>
                <th className="th">Category</th>
                <th className="th">Sizes</th>
                <th className="th text-right">SRP range</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const srps = g.items.map((i) => i.srp);
                const lo = Math.min(...srps);
                const hi = Math.max(...srps);
                return (
                  <tr key={g.name} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(g.name)} onChange={() => toggle(g.name)} />
                    </td>
                    <td className="td cursor-pointer font-medium text-brand-600 hover:underline" onClick={() => setEditing(g)}>{g.name}</td>
                    <td className="td cursor-pointer text-slate-500" onClick={() => setEditing(g)}>{g.category || '—'}</td>
                    <td className="td cursor-pointer text-xs text-slate-500" onClick={() => setEditing(g)}>{g.items.map((i) => i.size || '—').join(', ')}</td>
                    <td className="td cursor-pointer text-right" onClick={() => setEditing(g)}>{lo === hi ? peso(lo) : `${peso(lo)} – ${peso(hi)}`}</td>
                  </tr>
                );
              })}
              {!groups.length && <tr><td className="td text-slate-400" colSpan={5}>No products yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditGroup
          group={editing}
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

interface SizeRow {
  id?: string; // existing product row id; absent = new
  size: string;
  sku: string;
  srp: string;
  retailSrp: string;
}

function EditGroup({ group, onClose, onSaved }: { group: Group; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group.name);
  const [category, setCategory] = useState(group.category);
  const [rows, setRows] = useState<SizeRow[]>(
    group.items.map((i) => ({ id: i.id, size: i.size ?? '', sku: i.sku, srp: String(i.srp), retailSrp: i.retailSrp != null ? String(i.retailSrp) : '' }))
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setRow(idx: number, patch: Partial<SizeRow>) {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }
  function addRow() {
    setRows((r) => [...r, { size: '', sku: '', srp: '', retailSrp: '' }]);
  }
  function removeRow(idx: number) {
    setRows((r) => r.filter((_, i) => i !== idx));
  }

  async function save() {
    setErr(null);
    if (rows.length === 0) return setErr('Keep at least one size, or delete the product entirely.');
    for (const row of rows) {
      if (!row.sku || !row.srp) return setErr('Each size needs a SKU and SRP.');
    }
    setBusy(true);
    try {
      const keptIds = new Set(rows.filter((r) => r.id).map((r) => r.id));
      // Delete removed sizes.
      const removed = group.items.filter((i) => !keptIds.has(i.id));
      for (const r of removed) await api.delete(`/products/${r.id}`);
      // Upsert each size row (shared name/category).
      for (const row of rows) {
        const payload = {
          name,
          category: category || undefined,
          size: row.size || undefined,
          sku: row.sku,
          srp: Number(row.srp),
          retailSrp: row.retailSrp ? Number(row.retailSrp) : null,
        };
        if (row.id) await api.put(`/products/${row.id}`, payload);
        else await api.post('/products', payload);
      }
      onSaved();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">Edit product</h2>
        {err && <div className="mb-3"><Alert>{err}</Alert></div>}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Product name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Category</label>
            <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <label className="label mb-0">Sizes (each has its own SKU & SRP)</label>
            <button className="btn-ghost text-xs" onClick={addRow}>+ Add size</button>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">Size</th>
                <th className="th">SKU</th>
                <th className="th text-right">SRP</th>
                <th className="th text-right">Retail SRP</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-b border-slate-50">
                  <td className="td"><input className="input" placeholder="200g" value={row.size} onChange={(e) => setRow(idx, { size: e.target.value })} /></td>
                  <td className="td"><input className="input" value={row.sku} onChange={(e) => setRow(idx, { sku: e.target.value })} /></td>
                  <td className="td"><input className="input text-right" type="number" step="0.01" value={row.srp} onChange={(e) => setRow(idx, { srp: e.target.value })} /></td>
                  <td className="td"><input className="input text-right" type="number" step="0.01" placeholder="= SRP" value={row.retailSrp} onChange={(e) => setRow(idx, { retailSrp: e.target.value })} /></td>
                  <td className="td text-right">
                    <button className="text-xs font-semibold text-red-600 hover:underline" onClick={() => removeRow(idx)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}

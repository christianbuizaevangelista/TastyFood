import { useMemo, useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert } from '../components/ui';
import { peso, dateTime } from '../lib/format';
import { Org, Product } from '../types';

interface Receipt {
  number: string;
  seller: { name: string; type: string };
  customerName?: string;
  discountRate: number;
  subtotal: number;
  total: number;
  savings: number;
  createdAt: string;
  lines: { sku: string; name: string; quantity: number; unitSrp: number; unitPrice: number; lineTotal: number }[];
}

// Tier label + standard discount for display.
const TIER: Record<string, { label: string; discount: number }> = {
  PRINCIPAL: { label: 'Principal', discount: 0 },
  PROVINCIAL: { label: 'Provincial Distributor', discount: 0.2 },
  CITY: { label: 'City Distributor', discount: 0.15 },
  RESELLER: { label: 'Reseller', discount: 0.08 },
};

export default function POS() {
  const { data, loading, error } = useFetch<{ products: Product[] }>('/products');
  // Downstream accounts the seller can sell to (their network).
  const orgs = useFetch<{ orgs: Org[] }>('/orgs');

  const [cart, setCart] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Org | null>(null);
  const [showList, setShowList] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only active, approved downstream accounts are valid customers.
  const customers = useMemo(
    () => (orgs.data?.orgs ?? []).filter((o) => o.status === 'APPROVED' && o.isActive),
    [orgs.data]
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? customers.filter((o) => o.name.toLowerCase().includes(q)) : customers;
    return list.slice(0, 8);
  }, [customers, query]);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const products = data!.products;

  const discountRate = selected ? selected.discountRate : 0;
  const lines = Object.entries(cart).filter(([, q]) => q > 0);
  const total = lines.reduce((s, [pid, q]) => {
    const p = products.find((x) => x.id === pid)!;
    return s + p.srp * (1 - discountRate) * q;
  }, 0);

  function pick(o: Org) {
    setSelected(o);
    setQuery(o.name);
    setShowList(false);
  }
  function pickOthers() {
    setSelected(null);
    setShowList(false);
  }

  async function checkout() {
    setErr(null);
    setBusy(true);
    try {
      const { data: r } = await api.post('/pos/sales', {
        buyerOrgId: selected?.id, // backend derives the tier discount from this
        customerName: selected ? selected.name : query.trim() || 'Walk-in',
        items: lines.map(([productId, quantity]) => ({ productId, quantity })),
      });
      setReceipt(r);
      setCart({});
      setQuery('');
      setSelected(null);
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Point of Sale" subtitle="Pick a customer from your network — the tier discount applies automatically." />

      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Catalog</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {products.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-2">
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-slate-400">
                    {peso(p.srp)}
                    {discountRate > 0 && <span className="ml-1 text-brand-600">→ {peso(p.srp * (1 - discountRate))}</span>}
                  </div>
                </div>
                <input
                  type="number"
                  min={0}
                  className="input w-20 text-right"
                  value={cart[p.id] ?? ''}
                  onChange={(e) => setCart({ ...cart, [p.id]: Number(e.target.value) })}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="card h-fit">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Sale details</h2>

          <label className="label">Customer</label>
          <div className="relative mb-1">
            <input
              className="input"
              value={query}
              placeholder="Type name / surname to search…"
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
                setShowList(true);
              }}
              onFocus={() => setShowList(true)}
              onBlur={() => setTimeout(() => setShowList(false), 150)}
            />
            {showList && (
              <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {matches.map((o) => (
                  <button
                    key={o.id}
                    onMouseDown={() => pick(o)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-700">{o.name}</span>
                    <span className="text-xs text-slate-400">
                      {TIER[o.type]?.label ?? o.type} · {Math.round(o.discountRate * 100)}%
                    </span>
                  </button>
                ))}
                {matches.length === 0 && (
                  <div className="px-3 py-2 text-xs text-slate-400">No matching account in your network.</div>
                )}
                <button
                  onMouseDown={pickOthers}
                  className="flex w-full items-center justify-between border-t border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-700">Others / Walk-in</span>
                  <span className="text-xs text-slate-400">No discount (SRP)</span>
                </button>
              </div>
            )}
          </div>

          {/* Auto-detected customer type + discount */}
          <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-xs">
            {selected ? (
              <span className="text-slate-600">
                Type: <span className="font-semibold">{TIER[selected.type]?.label ?? selected.type}</span> ·{' '}
                <span className="font-semibold text-brand-600">{Math.round(selected.discountRate * 100)}% discount</span>
              </span>
            ) : (
              <span className="text-slate-500">Type: <span className="font-semibold">Others / Walk-in</span> · SRP (no discount)</span>
            )}
          </div>

          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-slate-500">{lines.length} item(s)</span>
            <span className="text-lg font-bold text-brand-600">{peso(total)}</span>
          </div>
          <button className="btn-primary w-full" disabled={busy || lines.length === 0} onClick={checkout}>
            {busy ? 'Recording…' : 'Record sale'}
          </button>
        </div>
      </div>

      {receipt && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={() => setReceipt(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-center">
              <div className="text-lg font-black text-brand-600">Juan Palaman</div>
              <div className="text-xs text-slate-400">{receipt.seller.name}</div>
              <div className="mt-1 text-xs text-slate-400">{dateTime(receipt.createdAt)}</div>
            </div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-mono">{receipt.number}</span>
              <span className="text-slate-500">{Math.round(receipt.discountRate * 100)}% disc.</span>
            </div>
            <div className="mb-3 text-xs text-slate-500">Customer: {receipt.customerName || 'Walk-in'}</div>
            <table className="w-full text-sm">
              <tbody>
                {receipt.lines.map((l, i) => (
                  <tr key={i} className="border-b border-dashed border-slate-100">
                    <td className="py-1">{l.name}<div className="text-xs text-slate-400">{l.quantity} × {peso(l.unitPrice)}</div></td>
                    <td className="py-1 text-right">{peso(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between text-slate-500"><span>Subtotal (SRP)</span><span>{peso(receipt.subtotal)}</span></div>
              <div className="flex justify-between text-slate-500"><span>Savings</span><span>-{peso(receipt.savings)}</span></div>
              <div className="flex justify-between text-lg font-bold text-brand-600"><span>Total</span><span>{peso(receipt.total)}</span></div>
            </div>
            <button className="btn-ghost mt-4 w-full" onClick={() => setReceipt(null)}>New sale</button>
          </div>
        </div>
      )}
    </div>
  );
}

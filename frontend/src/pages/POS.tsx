import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, Badge } from '../components/ui';
import { peso, dateTime } from '../lib/format';
import { DistributionType, Product } from '../types';

interface Receipt {
  number: string;
  seller: { name: string; type: string };
  distributionType: DistributionType;
  customerName?: string;
  discountRate: number;
  subtotal: number;
  total: number;
  savings: number;
  createdAt: string;
  lines: { sku: string; name: string; quantity: number; unitSrp: number; unitPrice: number; lineTotal: number }[];
}

export default function POS() {
  const { data, loading, error } = useFetch<{ products: Product[] }>('/products');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [distributionType, setDistributionType] = useState<DistributionType>('TRADE');
  const [customerName, setCustomerName] = useState('');
  const [discountPct, setDiscountPct] = useState(0);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const products = data!.products;

  const lines = Object.entries(cart).filter(([, q]) => q > 0);
  const total = lines.reduce((s, [pid, q]) => {
    const p = products.find((x) => x.id === pid)!;
    return s + p.srp * (1 - discountPct / 100) * q;
  }, 0);

  async function checkout() {
    setErr(null);
    setBusy(true);
    try {
      const { data: r } = await api.post('/pos/sales', {
        distributionType,
        customerName: customerName || undefined,
        discountRate: discountPct / 100,
        items: lines.map(([productId, quantity]) => ({ productId, quantity })),
      });
      setReceipt(r);
      setCart({});
      setCustomerName('');
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Point of Sale" subtitle="Record a direct sale. Trade deducts your stock; drop-ship does not." />

      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Catalog</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {products.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-2">
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-slate-400">{peso(p.srp)}</div>
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
          <label className="label">Distribution type</label>
          <div className="mb-3 flex gap-2">
            {(['TRADE', 'DROP_SHIP'] as DistributionType[]).map((t) => (
              <button
                key={t}
                onClick={() => setDistributionType(t)}
                className={`btn flex-1 ${distributionType === t ? 'bg-brand-500 text-white' : 'border border-slate-300 bg-white'}`}
              >
                {t.replace('_', ' ')}
              </button>
            ))}
          </div>
          <label className="label">Customer name</label>
          <input className="input mb-3" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in" />
          <label className="label">Discount %</label>
          <input
            className="input mb-4"
            type="number"
            min={0}
            max={100}
            value={discountPct}
            onChange={(e) => setDiscountPct(Number(e.target.value))}
          />
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
              <Badge value={receipt.distributionType} />
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

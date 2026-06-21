import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, Badge } from '../components/ui';
import { peso, date } from '../lib/format';
import { DistributionType, PoStatus, Product } from '../types';

interface POItem { quantity: number; unitSrp: number; unitPrice: number; lineTotal: number; product: { sku: string; name: string }; }
interface PO {
  id: string;
  number: string;
  status: PoStatus;
  distributionType: DistributionType;
  discountRate: number;
  subtotal: number;
  total: number;
  createdAt: string;
  buyerOrg: { id: string; name: string; type: string };
  sellerOrg: { id: string; name: string; type: string };
  items: POItem[];
}

// Which actions each side can take per status.
function actionsFor(po: PO, myOrgId: string): { label: string; path: string }[] {
  const isBuyer = po.buyerOrg.id === myOrgId;
  const isSeller = po.sellerOrg.id === myOrgId;
  const a: { label: string; path: string }[] = [];
  if (isBuyer && po.status === 'DRAFT') a.push({ label: 'Submit', path: 'submit' });
  if (isSeller && po.status === 'SUBMITTED') a.push({ label: 'Approve', path: 'approve' });
  if (isSeller && po.status === 'APPROVED') a.push({ label: 'Fulfill', path: 'fulfill' });
  if (isBuyer && po.status === 'FULFILLED') a.push({ label: 'Receive', path: 'receive' });
  if (isBuyer && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(po.status))
    a.push({ label: 'Cancel', path: 'cancel' });
  return a;
}

export default function PurchaseOrders() {
  const { user } = useAuth();
  const { data, loading, error, refetch } = useFetch<{ orders: PO[] }>('/purchase-orders');
  const products = useFetch<{ products: Product[] }>('/products');
  const [showCreate, setShowCreate] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  async function runAction(po: PO, path: string) {
    setActionErr(null);
    try {
      await api.post(`/purchase-orders/${po.id}/${path}`);
      refetch();
    } catch (e) {
      setActionErr(apiError(e));
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  const canCreate = user!.role !== 'PRINCIPAL';

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle="Order from your immediate supplier. Trade adjusts stock; drop-ship does not."
        action={
          canCreate ? (
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              + New PO
            </button>
          ) : (
            <span className="text-xs text-slate-400">Principal has no upstream supplier</span>
          )
        }
      />

      {actionErr && <div className="mb-4"><Alert>{actionErr}</Alert></div>}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="th">PO #</th>
              <th className="th">Buyer</th>
              <th className="th">Seller</th>
              <th className="th">Type</th>
              <th className="th">Status</th>
              <th className="th text-right">Total</th>
              <th className="th">Date</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.orders.map((po) => (
              <tr key={po.id} className="border-b border-slate-50">
                <td className="td font-mono text-xs">{po.number}</td>
                <td className="td">{po.buyerOrg.name}</td>
                <td className="td">{po.sellerOrg.name}</td>
                <td className="td"><Badge value={po.distributionType} /></td>
                <td className="td"><Badge value={po.status} /></td>
                <td className="td text-right font-semibold">{peso(po.total)}</td>
                <td className="td whitespace-nowrap text-xs text-slate-500">{date(po.createdAt)}</td>
                <td className="td text-right">
                  <div className="flex justify-end gap-1">
                    {actionsFor(po, user!.org.id).map((a) => (
                      <button
                        key={a.path}
                        onClick={() => runAction(po, a.path)}
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          a.path === 'cancel'
                            ? 'text-red-600 hover:bg-red-50'
                            : 'text-brand-600 hover:bg-brand-50'
                        }`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {!data?.orders.length && (
              <tr><td className="td text-slate-400" colSpan={8}>No purchase orders yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreatePO
          products={products.data?.products ?? []}
          discountRate={user!.org.discountRate}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function CreatePO({
  products,
  discountRate,
  onClose,
  onCreated,
}: {
  products: Product[];
  discountRate: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [distributionType, setDistributionType] = useState<DistributionType>('TRADE');
  const [lines, setLines] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items = Object.entries(lines).filter(([, q]) => q > 0);
  const estTotal = items.reduce((sum, [pid, q]) => {
    const p = products.find((x) => x.id === pid);
    return sum + (p ? p.srp * (1 - discountRate) * q : 0);
  }, 0);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      await api.post('/purchase-orders', {
        distributionType,
        items: items.map(([productId, quantity]) => ({ productId, quantity })),
      });
      onCreated();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold">New Purchase Order</h2>
        <p className="mb-4 text-xs text-slate-500">
          Priced at your tier discount of {(discountRate * 100).toFixed(0)}% off SRP. Ordered from your immediate supplier.
        </p>
        {err && <div className="mb-3"><Alert>{err}</Alert></div>}

        <div className="mb-4">
          <label className="label">Distribution type</label>
          <div className="flex gap-2">
            {(['TRADE', 'DROP_SHIP'] as DistributionType[]).map((t) => (
              <button
                key={t}
                onClick={() => setDistributionType(t)}
                className={`btn ${distributionType === t ? 'bg-brand-500 text-white' : 'border border-slate-300 bg-white'}`}
              >
                {t.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="th">Product</th>
              <th className="th text-right">SRP</th>
              <th className="th text-right">Your price</th>
              <th className="th text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-b border-slate-50">
                <td className="td">{p.name}</td>
                <td className="td text-right">{peso(p.srp)}</td>
                <td className="td text-right text-brand-600">{peso(p.srp * (1 - discountRate))}</td>
                <td className="td text-right">
                  <input
                    type="number"
                    min={0}
                    className="input w-20 text-right"
                    value={lines[p.id] ?? ''}
                    onChange={(e) => setLines({ ...lines, [p.id]: Number(e.target.value) })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm">
            Est. total: <span className="font-bold text-brand-600">{peso(estTotal)}</span>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy || items.length === 0} onClick={submit}>
              {busy ? 'Creating…' : 'Create draft PO'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

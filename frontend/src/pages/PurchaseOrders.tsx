import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, Badge } from '../components/ui';
import { peso, date } from '../lib/format';
import { DistributionType, PoStatus, Product } from '../types';
import { distLabel } from '../lib/labels';
import { exportPoPdf } from '../lib/poPdf';

interface POItem {
  id: string;
  quantity: number;
  receivedQuantity: number;
  unitSrp: number;
  unitPrice: number;
  lineTotal: number;
  product: { sku: string; name: string };
}
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
  if (isBuyer && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(po.status))
    a.push({ label: 'Cancel', path: 'cancel' });
  return a;
}

// Buyer can record receipts while the order is fulfilled but not yet complete.
function canReceive(po: PO, myOrgId: string): boolean {
  return po.buyerOrg.id === myOrgId && ['FULFILLED', 'PARTIALLY_RECEIVED'].includes(po.status);
}

export default function PurchaseOrders() {
  const { user } = useAuth();
  const { data, loading, error, refetch } = useFetch<{ orders: PO[] }>('/purchase-orders');
  const products = useFetch<{ products: Product[] }>('/products');
  const [showCreate, setShowCreate] = useState(false);
  const [receivePo, setReceivePo] = useState<PO | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'supplier' | 'customer'>(
    user!.role === 'PRINCIPAL' ? 'customer' : 'supplier'
  );

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

  const myOrgId = user!.org.id;
  const canCreate = user!.role !== 'PRINCIPAL';
  const orders = data?.orders ?? [];

  // POs I placed with my supplier (I'm the buyer, the tier above) vs POs my
  // downstream customers placed (I'm the seller, or deeper in my chain).
  const supplierPOs = orders.filter((po) => po.buyerOrg.id === myOrgId);
  const customerPOs = orders.filter((po) => po.buyerOrg.id !== myOrgId);

  const tabs = [
    { key: 'supplier' as const, label: 'To Supplier', hint: 'Orders you placed with the tier above you.', list: supplierPOs },
    { key: 'customer' as const, label: 'From Customers', hint: 'Orders your downstream (1–2 tiers below) placed with you.', list: customerPOs },
  ];

  const renderTable = (list: PO[], counterpartyHeader: string, emptyText: string) => (
    <div className="card overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="th">PO #</th>
            <th className="th">{counterpartyHeader}</th>
            <th className="th">Type</th>
            <th className="th">Status</th>
            <th className="th text-right">Total</th>
            <th className="th">Date</th>
            <th className="th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.map((po) => {
            // Show the other party: supplier view -> seller; customer view -> buyer.
            const counterparty = tab === 'supplier' ? po.sellerOrg : po.buyerOrg;
            return (
              <tr key={po.id} className="border-b border-slate-50">
                <td className="td font-mono text-xs">{po.number}</td>
                <td className="td">
                  {counterparty.name}
                  <span className="ml-1 text-xs text-slate-400">({counterparty.type})</span>
                </td>
                <td className="td"><Badge value={po.distributionType} /></td>
                <td className="td"><Badge value={po.status} /></td>
                <td className="td text-right font-semibold">{peso(po.total)}</td>
                <td className="td whitespace-nowrap text-xs text-slate-500">{date(po.createdAt)}</td>
                <td className="td text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    {actionsFor(po, myOrgId).map((a) => (
                      <button
                        key={a.path}
                        onClick={() => runAction(po, a.path)}
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          a.path === 'cancel' || a.path === 'reject'
                            ? 'text-red-600 hover:bg-red-50'
                            : 'text-brand-600 hover:bg-brand-50'
                        }`}
                      >
                        {a.label}
                      </button>
                    ))}
                    {canReceive(po, myOrgId) && (
                      <button
                        onClick={() => setReceivePo(po)}
                        className="rounded-md bg-brand-500 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-600"
                      >
                        Receive
                      </button>
                    )}
                    <button
                      onClick={() => exportPoPdf(po)}
                      className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                      title="Export PDF"
                    >
                      PDF
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {list.length === 0 && (
            <tr><td className="td text-slate-400" colSpan={7}>{emptyText}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle="Separate views: what you buy from your supplier, and what your customers order from you."
        action={
          canCreate ? (
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              + New PO to supplier
            </button>
          ) : (
            <span className="text-xs text-slate-400">Principal has no upstream supplier</span>
          )
        }
      />

      {actionErr && <div className="mb-4"><Alert>{actionErr}</Alert></div>}

      <div className="mb-1 flex gap-2 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
              tab === t.key
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t.list.length}</span>
          </button>
        ))}
      </div>
      <p className="mb-3 mt-2 text-xs text-slate-400">
        {tabs.find((t) => t.key === tab)!.hint}
      </p>

      {tab === 'supplier'
        ? renderTable(supplierPOs, 'Supplier', 'No orders to your supplier yet.')
        : renderTable(customerPOs, 'Customer', 'No orders from your customers yet.')}

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

      {receivePo && (
        <ReceivePO
          po={receivePo}
          onClose={() => setReceivePo(null)}
          onDone={() => {
            setReceivePo(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function ReceivePO({ po, onClose, onDone }: { po: PO; onClose: () => void; onDone: () => void }) {
  // Pre-fill each line with the still-outstanding quantity.
  const [recv, setRecv] = useState<Record<string, number>>(
    Object.fromEntries(po.items.map((i) => [i.id, Math.max(0, i.quantity - i.receivedQuantity)]))
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totalOrdered = po.items.reduce((s, i) => s + i.quantity, 0);
  const alreadyReceived = po.items.reduce((s, i) => s + i.receivedQuantity, 0);
  const receivingNow = po.items.reduce((s, i) => s + (recv[i.id] || 0), 0);
  const willComplete = po.items.every((i) => i.receivedQuantity + (recv[i.id] || 0) >= i.quantity);

  function setQty(item: POItem, val: number) {
    const max = item.quantity - item.receivedQuantity;
    setRecv({ ...recv, [item.id]: Math.max(0, Math.min(max, Math.floor(val || 0))) });
  }

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      await api.post(`/purchase-orders/${po.id}/receive`, {
        items: po.items.map((i) => ({ itemId: i.id, received: recv[i.id] || 0 })),
      });
      onDone();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancelPo() {
    setErr(null);
    setBusy(true);
    try {
      await api.post(`/purchase-orders/${po.id}/cancel`);
      onDone();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header: PO on the left, status on the right */}
        <div className="mb-1 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">Receive — {po.number}</h2>
            <p className="text-xs text-slate-500">
              From {po.sellerOrg.name} · {distLabel(po.distributionType)}
            </p>
          </div>
          <div className="text-right">
            <Badge value={po.status} />
            <div className="mt-1 text-xs text-slate-400">
              {alreadyReceived}/{totalOrdered} received
            </div>
          </div>
        </div>

        {err && <div className="my-3"><Alert>{err}</Alert></div>}

        <table className="mt-4 w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="th">Product</th>
              <th className="th text-right">Ordered</th>
              <th className="th text-right">Already</th>
              <th className="th text-right">Receive now</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((i) => {
              const outstanding = i.quantity - i.receivedQuantity;
              return (
                <tr key={i.id} className="border-b border-slate-50">
                  <td className="td">
                    {i.product.name}
                    <div className="font-mono text-xs text-slate-400">{i.product.sku}</div>
                  </td>
                  <td className="td text-right">{i.quantity}</td>
                  <td className="td text-right text-slate-500">{i.receivedQuantity}</td>
                  <td className="td text-right">
                    <input
                      type="number"
                      min={0}
                      max={outstanding}
                      disabled={outstanding === 0}
                      className="input w-24 text-right disabled:bg-slate-50"
                      value={recv[i.id] ?? 0}
                      onChange={(e) => setQty(i, Number(e.target.value))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            Receiving <span className="font-semibold">{receivingNow}</span> pcs
            {willComplete ? (
              <span className="ml-2 badge bg-green-100 text-green-700">Will complete order</span>
            ) : (
              <span className="ml-2 badge bg-orange-100 text-orange-700">Partial</span>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost text-red-600" disabled={busy} onClick={cancelPo} title="Cancel this purchase order">
              Cancel PO
            </button>
            <button className="btn-ghost" disabled={busy} onClick={() => exportPoPdf(po)}>
              Export PDF
            </button>
            <button className="btn-primary" disabled={busy || receivingNow === 0} onClick={submit}>
              {busy ? 'Saving…' : willComplete ? 'Receive & complete' : 'Save partial receipt'}
            </button>
          </div>
        </div>
      </div>
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
                {distLabel(t)}
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

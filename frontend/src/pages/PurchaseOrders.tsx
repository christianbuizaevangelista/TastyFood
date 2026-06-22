import { useState, useMemo, ChangeEvent } from 'react';
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
  expectedDeliveryDate?: string | null;
  recipientName?: string | null;
  recipientAddress?: string | null;
  recipientPhone?: string | null;
  landmark?: string | null;
  buyerOrg: OrgParty;
  sellerOrg: OrgParty;
  items: POItem[];
}

interface OrgParty {
  id: string;
  name: string;
  type: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
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

type DatePreset = 'all' | 'today' | 'yesterday' | '7' | '15' | '30' | 'month' | 'custom';
const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7', label: '7 days ago' },
  { key: '15', label: '15 days ago' },
  { key: '30', label: '30 days ago' },
  { key: 'month', label: 'Current Month' },
  { key: 'custom', label: 'Customize Date' },
];
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export default function PurchaseOrders() {
  const { user } = useAuth();
  const [preset, setPreset] = useState<DatePreset>('all');
  const [dateFilter, setDateFilter] = useState({ from: '', to: '' });

  function applyPreset(p: DatePreset) {
    setPreset(p);
    const now = new Date();
    const today = ymd(now);
    if (p === 'all') setDateFilter({ from: '', to: '' });
    else if (p === 'today') setDateFilter({ from: today, to: today });
    else if (p === 'yesterday') {
      const y = ymd(addDays(now, -1));
      setDateFilter({ from: y, to: y });
    } else if (p === '7') setDateFilter({ from: ymd(addDays(now, -7)), to: today });
    else if (p === '15') setDateFilter({ from: ymd(addDays(now, -15)), to: today });
    else if (p === '30') setDateFilter({ from: ymd(addDays(now, -30)), to: today });
    else if (p === 'month')
      setDateFilter({ from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today });
    // 'custom' keeps whatever is currently set and reveals the manual inputs.
  }
  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFilter.from) p.set('from', dateFilter.from);
    if (dateFilter.to) p.set('to', dateFilter.to);
    const qs = p.toString();
    return `/purchase-orders${qs ? `?${qs}` : ''}`;
  }, [dateFilter]);
  const { data, loading, error, refetch } = useFetch<{ orders: PO[] }>(url, [url]);
  const products = useFetch<{ products: Product[] }>('/products');
  const [showCreate, setShowCreate] = useState(false);
  const [receivePo, setReceivePo] = useState<PO | null>(null);
  const [detailsPo, setDetailsPo] = useState<PO | null>(null);
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
                <td className="td font-mono text-xs">
                  <button onClick={() => setDetailsPo(po)} className="font-semibold text-brand-600 hover:underline">
                    {po.number}
                  </button>
                </td>
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

      {/* Order-date range filter with quick presets */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                preset === p.key
                  ? 'bg-brand-500 text-white'
                  : 'border border-slate-200 text-slate-600 hover:border-brand-400 hover:text-brand-600'
              }`}
            >
              {p.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-slate-400">Filters by order date</span>
        </div>

        {preset === 'custom' && (
          <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
            <div>
              <label className="label">From</label>
              <input
                type="date"
                className="input"
                value={dateFilter.from}
                onChange={(e) => setDateFilter({ ...dateFilter, from: e.target.value })}
              />
            </div>
            <div>
              <label className="label">To</label>
              <input
                type="date"
                className="input"
                value={dateFilter.to}
                onChange={(e) => setDateFilter({ ...dateFilter, to: e.target.value })}
              />
            </div>
          </div>
        )}

        {preset !== 'all' && preset !== 'custom' && (dateFilter.from || dateFilter.to) && (
          <p className="mt-2 text-xs text-slate-400">
            Showing {dateFilter.from} → {dateFilter.to}
          </p>
        )}
      </div>

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

      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : tab === 'supplier' ? (
        renderTable(supplierPOs, 'Supplier', 'No orders to your supplier yet.')
      ) : (
        renderTable(customerPOs, 'Customer', 'No orders from your customers yet.')
      )}

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

      {detailsPo && <PoDetails po={detailsPo} onClose={() => setDetailsPo(null)} />}
    </div>
  );
}

function PoDetails({ po, onClose }: { po: PO; onClose: () => void }) {
  const { user } = useAuth();
  const isBuyer = po.buyerOrg.id === user!.org.id;
  const attachments = useFetch<{ attachments: Attachment[] }>(
    `/purchase-orders/${po.id}/attachments`
  );
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setErr('File too large (max 3 MB)');
      return;
    }
    setErr(null);
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.post(`/purchase-orders/${po.id}/attachments`, {
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          dataBase64: reader.result as string,
        });
        attachments.refetch();
      } catch (e2) {
        setErr(apiError(e2));
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      setErr('Could not read file');
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  async function viewAttachment(attId: string) {
    try {
      const res = await api.get(`/purchase-orders/${po.id}/attachments/${attId}/content`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e2) {
      setErr(apiError(e2));
    }
  }

  const party = (p: typeof po.buyerOrg) => (
    <div className="text-sm text-slate-600">
      <div className="font-semibold text-slate-800">{p.name}</div>
      <div className="text-xs text-slate-400">{p.type}</div>
      {p.contactName && <div>Attn: {p.contactName}</div>}
      {p.contactEmail && <div>{p.contactEmail}</div>}
      {p.contactPhone && <div>{p.contactPhone}</div>}
      {p.address && <div>{p.address}</div>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">{po.number}</h2>
            <p className="text-xs text-slate-500">
              {distLabel(po.distributionType)} · Ordered {date(po.createdAt)}
              {po.expectedDeliveryDate ? ` · Expected delivery ${date(po.expectedDeliveryDate)}` : ''}
            </p>
          </div>
          <div className="text-right"><Badge value={po.status} /></div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-4">
          <div>
            <div className="label">Supplier</div>
            {party(po.sellerOrg)}
          </div>
          <div>
            <div className="label">Customer</div>
            {party(po.buyerOrg)}
          </div>
        </div>

        {po.distributionType === 'DROP_SHIP' && (
          <div className="mb-5 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
            <div className="mb-1 font-semibold">📦 Drop-ship delivery (ship directly to recipient)</div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              <div><span className="text-violet-600">Name:</span> {po.recipientName || '—'}</div>
              <div><span className="text-violet-600">Cellphone:</span> {po.recipientPhone || '—'}</div>
              <div className="sm:col-span-2"><span className="text-violet-600">Address:</span> {po.recipientAddress || '—'}</div>
              <div className="sm:col-span-2"><span className="text-violet-600">Landmark:</span> {po.landmark || '—'}</div>
            </div>
          </div>
        )}

        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="th">Product</th>
              <th className="th text-right">Ordered</th>
              <th className="th text-right">Received</th>
              <th className="th text-right">Unit Price</th>
              <th className="th text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((i) => (
              <tr key={i.id} className="border-b border-slate-50">
                <td className="td">{i.product.name}<div className="font-mono text-xs text-slate-400">{i.product.sku}</div></td>
                <td className="td text-right">{i.quantity}</td>
                <td className="td text-right">{i.receivedQuantity}</td>
                <td className="td text-right">{peso(i.unitPrice)}</td>
                <td className="td text-right">{peso(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 text-right text-sm">
          <div className="text-slate-500">Subtotal (SRP): {peso(po.subtotal)}</div>
          <div className="text-lg font-bold text-brand-600">Total: {peso(po.total)}</div>
        </div>

        {/* Proof of payment */}
        <div className="mt-6 border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Proof of Payment</h3>
            {isBuyer && (
              <label className={`btn-ghost cursor-pointer text-xs ${uploading ? 'opacity-50' : ''}`}>
                {uploading ? 'Uploading…' : '+ Upload'}
                <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={onFile} disabled={uploading} />
              </label>
            )}
          </div>
          {err && <div className="mb-2"><Alert>{err}</Alert></div>}

          {attachments.loading ? (
            <Spinner />
          ) : attachments.data && attachments.data.attachments.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {attachments.data.attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium text-slate-700">{a.fileName}</div>
                    <div className="text-xs text-slate-400">
                      {(a.size / 1024).toFixed(0)} KB · by {a.uploadedBy.name} · {date(a.createdAt)}
                    </div>
                  </div>
                  <button onClick={() => viewAttachment(a.id)} className="text-xs font-semibold text-brand-600 hover:underline">
                    View
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">
              {isBuyer ? 'No proof of payment uploaded yet. Upload an image or PDF.' : 'The customer has not uploaded proof of payment yet.'}
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => exportPoPdf(po)}>Export PDF</button>
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadedBy: { name: string; orgId: string };
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
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [recipient, setRecipient] = useState({ name: '', address: '', phone: '', landmark: '' });
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [lines, setLines] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDropship = distributionType === 'DROP_SHIP';
  const items = Object.entries(lines).filter(([, q]) => q > 0);
  const estTotal = items.reduce((sum, [pid, q]) => {
    const p = products.find((x) => x.id === pid);
    return sum + (p ? p.srp * (1 - discountRate) * q : 0);
  }, 0);

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  async function submit() {
    setErr(null);
    if (isDropship) {
      if (!recipient.name || !recipient.address || !recipient.phone) {
        setErr('Drop-ship requires recipient name, complete address, and cellphone number.');
        return;
      }
      if (!proofFile) {
        setErr('Drop-ship requires an attached proof of payment.');
        return;
      }
      if (proofFile.size > 3 * 1024 * 1024) {
        setErr('Proof of payment is too large (max 3 MB).');
        return;
      }
    }
    setBusy(true);
    try {
      let proofOfPayment;
      if (isDropship && proofFile) {
        proofOfPayment = {
          fileName: proofFile.name,
          mimeType: proofFile.type || 'application/octet-stream',
          dataBase64: await fileToDataUrl(proofFile),
        };
      }
      await api.post('/purchase-orders', {
        distributionType,
        expectedDeliveryDate: expectedDeliveryDate || undefined,
        recipientName: isDropship ? recipient.name : undefined,
        recipientAddress: isDropship ? recipient.address : undefined,
        recipientPhone: isDropship ? recipient.phone : undefined,
        landmark: isDropship ? recipient.landmark || undefined : undefined,
        proofOfPayment,
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

        {isDropship && (
          <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 p-3">
            <div className="mb-2 text-sm font-semibold text-violet-800">
              Drop-ship delivery details
            </div>
            <p className="mb-3 text-xs text-violet-700">
              The Principal ships directly to this recipient. These details and your proof of
              payment will be attached to the order.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Complete Name *</label>
                <input className="input" value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Complete Address *</label>
                <input className="input" value={recipient.address} onChange={(e) => setRecipient({ ...recipient, address: e.target.value })} />
              </div>
              <div>
                <label className="label">Cellphone Number *</label>
                <input className="input" value={recipient.phone} onChange={(e) => setRecipient({ ...recipient, phone: e.target.value })} />
              </div>
              <div>
                <label className="label">Landmark</label>
                <input className="input" value={recipient.landmark} onChange={(e) => setRecipient({ ...recipient, landmark: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Proof of Payment (image/PDF) *</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="text-xs"
                  onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                />
                {proofFile && <span className="ml-2 text-xs text-green-600">✓ {proofFile.name}</span>}
              </div>
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className="label">Expected delivery date (optional)</label>
          <input
            type="date"
            className="input max-w-xs"
            value={expectedDeliveryDate}
            onChange={(e) => setExpectedDeliveryDate(e.target.value)}
          />
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
            <button
              className="btn-primary"
              disabled={
                busy ||
                items.length === 0 ||
                (isDropship && (!recipient.name || !recipient.address || !recipient.phone || !proofFile))
              }
              onClick={submit}
            >
              {busy ? 'Creating…' : 'Create draft PO'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

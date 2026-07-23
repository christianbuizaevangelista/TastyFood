import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState, KpiCard } from '../components/ui';
import { peso, num, dateTime } from '../lib/format';

// The Principal's view of the JuanPalaman shop orders.

type Status = 'PENDING' | 'CONFIRMED' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

interface Item { name: string; quantity: number; unitPrice: number; lineTotal: number }
interface Order {
  id: string; code: string; name: string; phone: string; email: string | null;
  address: string; landmark: string | null; customerType: string;
  paymentMethod: string; status: Status; note: string | null;
  total: number; hasProof: boolean; saleId: string | null; createdAt: string; items: Item[];
}
interface Summary {
  total: number; pending: number; confirmed: number; shipped: number;
  delivered: number; cancelled: number; revenue: number; repeatShare: number;
}

const STATUS_STYLE: Record<Status, string> = {
  PENDING: 'bg-blue-100 text-blue-700',
  CONFIRMED: 'bg-indigo-100 text-indigo-700',
  PAID: 'bg-green-100 text-green-700',
  SHIPPED: 'bg-amber-100 text-amber-700',
  DELIVERED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};
// The next steps offered for each status — a small state machine so the buttons
// only ever offer a sensible move.
const NEXT: Record<Status, Status[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PAID', 'SHIPPED', 'CANCELLED'],
  PAID: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};
const ACTION_LABEL: Record<Status, string> = {
  PENDING: 'Pending', CONFIRMED: 'Confirm', PAID: 'Mark paid',
  SHIPPED: 'Out for delivery', DELIVERED: 'Delivered', CANCELLED: 'Cancel',
};

export default function ShopOrders() {
  const [status, setStatus] = useState<'' | Status>('');
  const { data, loading, error, refetch } = useFetch<{ orders: Order[]; summary: Summary }>(
    `/shop-orders${status ? `?status=${status}` : ''}`
  );
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function move(o: Order, next: Status) {
    if (next === 'CANCELLED' && !confirm(`Cancel order ${o.code}?`)) return;
    setErr(null);
    try {
      await api.patch(`/shop-orders/${o.id}`, { status: next });
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  async function viewProof(o: Order) {
    setErr(null);
    try {
      const res = await api.get(`/shop-orders/${o.id}/proof`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setErr(apiError(e));
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  const s = data?.summary;
  const orders = data?.orders ?? [];

  return (
    <div>
      <PageHeader title="Shop Orders" subtitle="Orders from the public JuanPalaman shop" />
      {err && <Alert>{err}</Alert>}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Revenue" value={peso(s?.revenue ?? 0)} hint="excludes cancelled" accent="text-green-600" />
        <KpiCard label="To pack" value={num((s?.pending ?? 0) + (s?.confirmed ?? 0))} accent="text-blue-600" hint="pending + confirmed" />
        <KpiCard label="Out for delivery" value={num(s?.shipped ?? 0)} accent="text-amber-600" />
        <KpiCard label="Repeat buyers" value={`${s?.repeatShare ?? 0}%`} hint="of live orders" />
      </div>

      <div className="card mb-4">
        <select className="input w-56" value={status} onChange={(e) => setStatus(e.target.value as any)}>
          <option value="">All orders</option>
          <option value="PENDING">Pending</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="PAID">Paid</option>
          <option value="SHIPPED">Out for delivery</option>
          <option value="DELIVERED">Delivered</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {orders.length === 0 ? (
        <EmptyState>{status ? 'No orders with this status.' : 'No shop orders yet.'}</EmptyState>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const open = openId === o.id;
            return (
              <div key={o.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="font-mono text-sm font-semibold text-slate-800 hover:text-amber-700" onClick={() => setOpenId(open ? null : o.id)}>
                        {o.code}
                      </button>
                      <span className={`badge ${STATUS_STYLE[o.status]}`}>{o.status.toLowerCase()}</span>
                      {o.saleId && <span className="badge bg-green-50 text-green-700" title="Recorded as a sale in the DMS — inventory and finance updated">in DMS</span>}
                      {o.customerType === 'REPEAT' && <span className="badge bg-green-50 text-green-700">repeat</span>}
                      <span className="badge bg-slate-100 text-slate-600">
                        {o.paymentMethod === 'CASH_ON_DELIVERY' ? 'COD' : 'paid first'}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-800">{o.name} · {peso(o.total)}</div>
                    <div className="text-xs text-slate-500">{o.phone}{o.email ? ` · ${o.email}` : ''}</div>
                    <div className="text-xs text-slate-400">{dateTime(o.createdAt)}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {o.hasProof && (
                      <button className="btn-secondary text-xs" onClick={() => viewProof(o)}>View proof</button>
                    )}
                    {NEXT[o.status].map((n) => (
                      <button
                        key={n}
                        className={`text-xs ${n === 'CANCELLED' ? 'btn-secondary text-red-600' : 'btn-primary'}`}
                        onClick={() => move(o, n)}
                      >
                        {ACTION_LABEL[n]}
                      </button>
                    ))}
                  </div>
                </div>

                {open && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-400">Deliver to</div>
                        <div className="text-sm text-slate-700">{o.address}</div>
                        {o.landmark && <div className="text-xs text-slate-500">Landmark: {o.landmark}</div>}
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-slate-400">Order</div>
                        <ul className="text-sm text-slate-700">
                          {o.items.map((i, idx) => (
                            <li key={idx} className="flex justify-between gap-4">
                              <span>{i.quantity}× {i.name}</span>
                              <span className="tabular-nums text-slate-500">{peso(i.lineTotal)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    {o.note && <p className="mt-3 rounded bg-slate-50 px-3 py-2 text-sm italic text-slate-600">“{o.note}”</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

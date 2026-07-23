import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';

// Public order tracker for the JuanPalaman shop (no login). The code in the URL
// is what stands in for an account.

interface Order {
  code: string;
  name: string;
  status: string;
  paymentMethod: string;
  total: number;
  placedAt: string;
  items: { name: string; quantity: number; lineTotal: number }[];
}

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STEPS = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED'];
const STEP_LABEL: Record<string, string> = {
  PENDING: 'Order placed',
  CONFIRMED: 'Confirmed',
  SHIPPED: 'Out for delivery',
  DELIVERED: 'Delivered',
};

export default function ShopOrder() {
  const { code = '' } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Order>(`/public/shop/order/${code}`)
      .then(({ data }) => setOrder(data))
      .catch(() => setOrder(null))
      .finally(() => setLoading(false));
  }, [code]);

  if (loading) return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  if (!order) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-bold text-slate-800">We can't find that order</h1>
          <p className="mt-2 text-sm text-slate-500">Check the order number from your confirmation email.</p>
        </div>
      </div>
    );
  }

  const cancelled = order.status === 'CANCELLED';
  // PAID sits at the CONFIRMED step for the buyer's purposes.
  const effective = order.status === 'PAID' ? 'CONFIRMED' : order.status;
  const reached = STEPS.indexOf(effective);

  return (
    <div className="min-h-screen bg-amber-50">
      <div className="bg-gradient-to-br from-amber-500 to-orange-600 px-4 py-8 text-white">
        <div className="mx-auto max-w-lg">
          <img src="/juanpalaman-logo.png" alt="JuanPalaman"
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/tasty-food-splash.png'; }}
            className="mb-3 h-12 w-auto drop-shadow" />
          <h1 className="text-2xl font-bold">Order {order.code}</h1>
          <p className="text-sm text-amber-50">
            {order.paymentMethod === 'CASH_ON_DELIVERY' ? 'Cash on delivery' : 'Paid in advance'} · {peso(order.total)}
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-lg space-y-5 px-4 py-8">
        {cancelled ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">
            This order has been cancelled. Reply to your confirmation email if that's a surprise.
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 font-bold text-slate-800">Progress</h2>
            <ol className="relative">
              {STEPS.map((s, i) => {
                const state = i < reached ? 'done' : i === reached ? 'current' : 'pending';
                const last = i === STEPS.length - 1;
                return (
                  <li key={s} className="flex gap-3 pb-5 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                        state === 'done' ? 'border-amber-600 bg-amber-600 text-white'
                        : state === 'current' ? 'border-amber-600 bg-white text-amber-700'
                        : 'border-slate-200 bg-white text-slate-300'
                      }`}>
                        {state === 'done' ? '✓' : i + 1}
                      </span>
                      {!last && <span className={`mt-1 w-0.5 flex-1 ${i < reached ? 'bg-amber-600' : 'bg-slate-200'}`} />}
                    </div>
                    <div className={`pt-0.5 ${state === 'pending' ? 'opacity-60' : ''}`}>
                      <span className={`font-semibold ${state === 'current' ? 'text-amber-700' : 'text-slate-800'}`}>
                        {STEP_LABEL[s]}
                      </span>
                      {state === 'current' && (
                        <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">now</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold text-slate-800">Your order</h2>
          <ul className="space-y-1 text-sm">
            {order.items.map((i, idx) => (
              <li key={idx} className="flex justify-between">
                <span className="text-slate-700">{i.quantity}× {i.name}</span>
                <span className="tabular-nums text-slate-500">{peso(i.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between border-t border-slate-100 pt-3">
            <span className="text-sm text-slate-500">Total · delivery free</span>
            <span className="font-bold text-slate-800">{peso(order.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

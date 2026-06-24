import { useMemo, useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert } from '../components/ui';
import { peso, dateTime } from '../lib/format';
import { Customer, Org, Product } from '../types';

interface Receipt {
  number: string;
  seller: { name: string; type: string };
  distributionType?: string;
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
  // End-customers in the chain (the reseller customer database).
  const customersF = useFetch<{ customers: Customer[] }>('/customers');

  const [cart, setCart] = useState<Record<string, number>>({});
  const [distributionType, setDistributionType] = useState<'TRADE' | 'DROP_SHIP'>('TRADE');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Org | null>(null);
  // A saved end-customer (from the customer database) — sold to at SRP/manual disc.
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Unofficial Reseller = a walk-in buyer given the standard 8% reseller discount,
  // without being a registered account.
  const [unofficial, setUnofficial] = useState(false);
  const [showList, setShowList] = useState(false);
  const UNOFFICIAL_RATE = 0.08;
  // Manual discount for Others/Walk-in: by percentage or by peso amount.
  const [discMode, setDiscMode] = useState<'percent' | 'amount'>('percent');
  const [discValue, setDiscValue] = useState(0);
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
  // End-customers (customer database) matching the search.
  const custMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = customersF.data?.customers ?? [];
    return (q ? list.filter((c) => [c.name, c.address, c.phone].some((v) => v && v.toLowerCase().includes(q))) : list).slice(0, 6);
  }, [customersF.data, query]);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const products = data!.products;

  const lines = Object.entries(cart).filter(([, q]) => q > 0);
  const subtotalSRP = lines.reduce((s, [pid, q]) => s + (products.find((x) => x.id === pid)?.srp ?? 0) * q, 0);
  // Tier customer -> their fixed discount; Unofficial Reseller -> 8%; Others -> manual.
  const discountRate = selected
    ? selected.discountRate
    : unofficial
    ? UNOFFICIAL_RATE
    : discMode === 'percent'
    ? Math.min(Math.max(discValue, 0), 100) / 100
    : subtotalSRP > 0
    ? Math.min(Math.max(discValue, 0) / subtotalSRP, 1)
    : 0;
  const total = Math.round(subtotalSRP * (1 - discountRate) * 100) / 100;

  function pick(o: Org) {
    setSelected(o);
    setCustomer(null);
    setUnofficial(false);
    setQuery(o.name);
    setShowList(false);
  }
  function pickCustomer(c: Customer) {
    setSelected(null);
    setCustomer(c);
    setUnofficial(false);
    setQuery(c.name);
    setShowList(false);
  }
  function pickOthers() {
    setSelected(null);
    setCustomer(null);
    setUnofficial(false);
    setShowList(false);
  }
  function pickUnofficial() {
    setSelected(null);
    setCustomer(null);
    setUnofficial(true);
    setQuery('Unofficial Reseller');
    setShowList(false);
  }

  async function checkout() {
    setErr(null);
    setBusy(true);
    try {
      const { data: r } = await api.post('/pos/sales', {
        distributionType,
        buyerOrgId: selected?.id, // backend derives the tier discount from this
        customerId: customer?.id, // saved end-customer (from the customer database)
        customerName: selected ? selected.name : customer ? customer.name : unofficial ? 'Unofficial Reseller' : query.trim() || 'Walk-in',
        // For Unofficial Reseller / Customer / Others / Walk-in, send the discount rate explicitly.
        discountRate: selected ? undefined : discountRate,
        items: lines.map(([productId, quantity]) => ({ productId, quantity })),
      });
      setReceipt(r);
      setCart({});
      setQuery('');
      setSelected(null);
      setCustomer(null);
      setUnofficial(false);
      setDiscValue(0);
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
                  <div className="text-sm font-medium">{p.name}{p.size ? ` (${p.size})` : ''}</div>
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

          <label className="label">Distribution</label>
          <div className="mb-3 flex gap-2">
            {([
              { v: 'TRADE', label: 'Regular' },
              { v: 'DROP_SHIP', label: 'Dropship' },
            ] as const).map((d) => (
              <button
                key={d.v}
                onClick={() => setDistributionType(d.v)}
                className={`btn flex-1 ${distributionType === d.v ? 'bg-brand-500 text-white' : 'border border-slate-300 bg-white'}`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <p className="mb-3 text-xs text-slate-400">
            {distributionType === 'TRADE' ? 'Deducts your inventory.' : 'No stock deducted (fulfilled elsewhere).'}
          </p>

          <label className="label">Customer</label>
          <div className="relative mb-1">
            <input
              className="input"
              value={query}
              placeholder="Type name / surname to search…"
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
                setCustomer(null);
                setUnofficial(false);
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
                {custMatches.length > 0 && (
                  <>
                    <div className="border-t border-slate-100 bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Customers</div>
                    {custMatches.map((c) => (
                      <button
                        key={c.id}
                        onMouseDown={() => pickCustomer(c)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span className="font-medium text-slate-700">{c.name}</span>
                        <span className="text-xs text-slate-400">{c.address || c.owner?.name || 'Customer'}</span>
                      </button>
                    ))}
                  </>
                )}
                <button
                  onMouseDown={pickUnofficial}
                  className="flex w-full items-center justify-between border-t border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-700">Unofficial Reseller</span>
                  <span className="text-xs text-slate-400">8% discount</span>
                </button>
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
          {selected ? (
            <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Type: <span className="font-semibold">{TIER[selected.type]?.label ?? selected.type}</span> ·{' '}
              <span className="font-semibold text-brand-600">{Math.round(selected.discountRate * 100)}% discount</span>
            </div>
          ) : unofficial ? (
            <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Type: <span className="font-semibold">Unofficial Reseller</span> ·{' '}
              <span className="font-semibold text-brand-600">8% discount</span>
            </div>
          ) : (
            <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="mb-2">
                {customer ? <>Customer: <span className="font-semibold">{customer.name}</span></> : <>Type: <span className="font-semibold">Others / Walk-in</span></>} — apply a discount:
              </div>
              <div className="flex items-center gap-2">
                <div className="flex overflow-hidden rounded-md border border-slate-300">
                  {(['percent', 'amount'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => { setDiscMode(m); setDiscValue(0); }}
                      className={`px-2 py-1 text-xs font-semibold ${discMode === m ? 'bg-brand-500 text-white' : 'bg-white text-slate-600'}`}
                    >
                      {m === 'percent' ? '%' : '₱'}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={0}
                  className="input w-28 text-right"
                  value={discValue || ''}
                  placeholder={discMode === 'percent' ? '0 %' : '₱ 0'}
                  onChange={(e) => setDiscValue(Number(e.target.value))}
                />
                <span className="text-slate-500">
                  = {Math.round(discountRate * 100)}% off ({peso(subtotalSRP - total)})
                </span>
              </div>
            </div>
          )}

          <div className="mb-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
            <div className="flex justify-between text-slate-500">
              <span>Subtotal ({lines.length} item{lines.length === 1 ? '' : 's'})</span>
              <span>{peso(subtotalSRP)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Less: Discount ({Math.round(discountRate * 100)}%)</span>
              <span>- {peso(subtotalSRP - total)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-1 text-base font-bold text-brand-600">
              <span>Grand Total</span>
              <span>{peso(total)}</span>
            </div>
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
              <div className="text-lg font-black text-brand-600">{receipt.seller.name}</div>
              <div className="text-xs text-slate-400">Tasty Food Manufacturing Inc.</div>
              <div className="mt-1 text-xs text-slate-400">{dateTime(receipt.createdAt)}</div>
            </div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-mono">{receipt.number}</span>
              <span className="text-slate-500">
                {receipt.distributionType === 'DROP_SHIP' ? 'Dropship' : 'Regular'} · {Math.round(receipt.discountRate * 100)}% disc.
              </span>
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

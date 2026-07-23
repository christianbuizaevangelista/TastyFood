import { useEffect, useMemo, useState } from 'react';
import { api, apiError } from '../api/client';
import AddressPicker from '../components/AddressPicker';

// Public JuanPalaman shop (no login). Ads point here; buyers pick products and
// check out with delivery details. Free delivery, COD or pay-first, ₱1,000
// minimum.

interface Product {
  id: string;
  name: string;
  size: string | null;
  description: string | null;
  category: string | null;
  price: number;
}
interface Config {
  active: boolean;
  headline?: string;
  tagline?: string | null;
  bannerText?: string | null;
  sellingPoints?: string[];
  closedMessage?: string;
  products: Product[];
  minOrder: number;
  deliveryFee: number;
}
type Pay = 'CASH_ON_DELIVERY' | 'PAY_FIRST';

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function Shop() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [done, setDone] = useState<{ code: string; total: number; paymentMethod: Pay } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    name: '', phone: '', email: '', address: '', landmark: '',
    customerType: 'NEW' as 'NEW' | 'REPEAT',
    paymentMethod: 'CASH_ON_DELIVERY' as Pay,
    note: '', website: '',
  });
  const [proof, setProof] = useState<File | null>(null);
  const set = (k: keyof typeof f, v: unknown) => setF((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    api
      .get<Config>('/public/shop')
      .then(({ data }) => setCfg(data))
      .catch(() => setCfg(null))
      .finally(() => setLoading(false));
  }, []);

  const items = useMemo(
    () => (cfg?.products ?? []).map((p) => ({ ...p, quantity: qty[p.id] ?? 0 })).filter((p) => p.quantity > 0),
    [cfg, qty]
  );
  const subtotal = useMemo(() => items.reduce((s, i) => s + i.price * i.quantity, 0), [items]);
  const minOrder = cfg?.minOrder ?? 1000;
  const meetsMin = subtotal >= minOrder;

  function step(id: string, by: number) {
    setQty((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + by) }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (items.length === 0) return setErr('Please add at least one item to your order.');
    if (!meetsMin) return setErr(`The minimum order is ${peso(minOrder)}. Please add a little more.`);
    if (f.paymentMethod === 'PAY_FIRST' && !proof) {
      return setErr('Please attach your proof of payment, or choose Cash on Delivery.');
    }
    setSubmitting(true);
    try {
      const payload: any = {
        ...f,
        items: items.map((i) => ({ productId: i.id, quantity: i.quantity })),
      };
      if (f.paymentMethod === 'PAY_FIRST' && proof) {
        payload.proof = {
          fileName: proof.name,
          mimeType: proof.type || 'application/octet-stream',
          dataBase64: await fileToBase64(proof),
        };
      }
      const { data } = await api.post<{ code: string; total: number; paymentMethod: Pay }>(
        '/public/shop/order',
        payload
      );
      setDone(data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  // ---- Shop switched off ---------------------------------------------------
  if (cfg && cfg.active === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-amber-50 px-4">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <img src="/tasty-food-splash.png" alt="Tasty Food" className="mx-auto mb-4 h-12 w-auto" />
          <h1 className="text-xl font-bold text-slate-800">{cfg.headline || 'JuanPalaman'}</h1>
          <p className="mt-2 text-slate-500">
            {cfg.closedMessage || 'Our online shop is taking a short break. Please check back soon.'}
          </p>
        </div>
      </div>
    );
  }

  // ---- Confirmation --------------------------------------------------------
  if (done) {
    const cod = done.paymentMethod === 'CASH_ON_DELIVERY';
    return (
      <div className="min-h-screen bg-amber-50 px-4 py-12">
        <div className="mx-auto max-w-lg overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">🎉</div>
            <h1 className="text-2xl font-bold text-slate-900">Order placed!</h1>
            <p className="mt-2 text-slate-600">Thank you, {f.name.split(' ')[0]}. We've got your order.</p>
            <div className="mt-5 rounded-xl border-2 border-dashed border-amber-400 px-5 py-4">
              <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">Order number</div>
              <div className="mt-1 text-2xl font-bold tracking-widest text-amber-700">{done.code}</div>
            </div>
            <div className="mt-4 text-lg font-bold text-slate-800">{peso(done.total)}</div>
            <p className="text-sm text-slate-500">delivery free · {cod ? 'cash on delivery' : 'paid in advance'}</p>
            <p className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-slate-600">
              We'll contact you on the number you gave to arrange delivery.
              {done.paymentMethod === 'CASH_ON_DELIVERY' && ' Please have the exact amount ready.'}
            </p>
            <a href={`/shop/order/${done.code}`} className="mt-5 inline-block text-sm font-semibold text-amber-700 hover:underline">
              Track this order →
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ---- Shop ----------------------------------------------------------------
  return (
    <div className="min-h-screen bg-amber-50">
      {cfg?.bannerText && (
        <div className="bg-orange-700 px-4 py-2 text-center text-sm font-semibold text-white">{cfg.bannerText}</div>
      )}
      <header className="bg-gradient-to-br from-amber-500 to-orange-600 px-4 py-10 text-white">
        <div className="mx-auto max-w-3xl">
          <img src="/tasty-food-splash.png" alt="Tasty Food" className="mb-4 h-12 w-auto" />
          <h1 className="text-3xl font-bold">{cfg?.headline || 'JuanPalaman — order online'}</h1>
          <p className="mt-2 text-amber-50">
            {cfg?.tagline || 'Creamy, crunchy and choco spreads, delivered to your door.'} Free delivery ·
            Cash on delivery or pay first · {peso(minOrder)} minimum.
          </p>
          {(cfg?.sellingPoints ?? []).length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-amber-50">
              {cfg!.sellingPoints!.map((s, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="text-white">✓</span> {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8">
        {err && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
        )}

        {(cfg?.products ?? []).length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center text-slate-500 shadow-sm">
            Our online shop is being set up. Please check back soon.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            {/* Products */}
            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-bold text-slate-800">Choose your spreads</h2>
              <div className="space-y-2">
                {cfg!.products.map((p) => {
                  const q = qty[p.id] ?? 0;
                  return (
                    <div key={p.id} className={`flex items-center gap-3 rounded-lg border p-3 ${q > 0 ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-800">
                          {p.name}{p.size ? ` · ${p.size}` : ''}
                        </div>
                        {p.description && <div className="truncate text-xs text-slate-500">{p.description}</div>}
                        <div className="text-sm font-medium text-amber-700">{peso(p.price)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => step(p.id, -1)}
                          className="h-8 w-8 rounded-full border border-slate-300 font-bold text-slate-600 disabled:opacity-40" disabled={q === 0}>−</button>
                        <span className="w-8 text-center font-semibold tabular-nums">{q}</span>
                        <button type="button" onClick={() => step(p.id, 1)}
                          className="h-8 w-8 rounded-full bg-amber-600 font-bold text-white hover:bg-amber-700">+</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                <span className="text-sm text-slate-500">Subtotal · delivery free</span>
                <span className="text-lg font-bold text-slate-800">{peso(subtotal)}</span>
              </div>
              {items.length > 0 && !meetsMin && (
                <p className="mt-1 text-right text-xs font-medium text-amber-600">
                  Add {peso(minOrder - subtotal)} more to reach the {peso(minOrder)} minimum.
                </p>
              )}
            </section>

            {/* Delivery details */}
            <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="font-bold text-slate-800">Where should we deliver?</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Complete name *</label>
                  <input className="input-shop" value={f.name} onChange={(e) => set('name', e.target.value)} required />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Cellphone number *</label>
                  <input className="input-shop" value={f.phone} onChange={(e) => set('phone', e.target.value)} required placeholder="0917 123 4567" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Email address</label>
                <input type="email" className="input-shop" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="for your order updates" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Complete address *</label>
                <AddressPicker onChange={(a) => set('address', a)} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Landmark</label>
                <input className="input-shop" value={f.landmark} onChange={(e) => set('landmark', e.target.value)} placeholder="e.g. beside the barangay hall" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Are you a…</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['NEW', 'REPEAT'] as const).map((t) => (
                    <label key={t} className={`cursor-pointer rounded-lg border px-3 py-2.5 text-center text-sm transition ${f.customerType === t ? 'border-amber-500 bg-amber-50 font-semibold text-amber-700' : 'border-slate-200'}`}>
                      <input type="radio" name="customerType" className="sr-only" checked={f.customerType === t} onChange={() => set('customerType', t)} />
                      {t === 'NEW' ? 'New customer' : 'Repeat customer'}
                    </label>
                  ))}
                </div>
              </div>
            </section>

            {/* Payment */}
            <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="font-bold text-slate-800">How would you like to pay?</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {([['CASH_ON_DELIVERY', 'Cash on delivery', 'Pay when your order arrives'],
                   ['PAY_FIRST', 'Pay first', 'Send payment now and attach proof']] as const).map(([v, label, hint]) => (
                  <label key={v} className={`cursor-pointer rounded-lg border p-4 transition ${f.paymentMethod === v ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <input type="radio" name="pay" className="sr-only" checked={f.paymentMethod === v} onChange={() => set('paymentMethod', v)} />
                    <div className="font-semibold text-slate-800">{label}</div>
                    <div className="text-xs text-slate-500">{hint}</div>
                  </label>
                ))}
              </div>
              {f.paymentMethod === 'PAY_FIRST' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Proof of payment *</label>
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"
                    onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-600 file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:bg-amber-700" />
                  <p className="mt-1 text-xs text-slate-400">A screenshot of your GCash / bank transfer is fine.</p>
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Note for us (optional)</label>
                <textarea rows={2} className="input-shop" value={f.note} onChange={(e) => set('note', e.target.value)} />
              </div>
            </section>

            {/* Honeypot */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
              className="hidden" value={f.website} onChange={(e) => set('website', e.target.value)} />

            <div className="sticky bottom-0 -mx-4 border-t border-amber-200 bg-amber-50/95 px-4 py-3 backdrop-blur">
              <button type="submit" disabled={submitting || !meetsMin || items.length === 0}
                className="w-full rounded-xl bg-amber-600 px-6 py-3.5 font-bold text-white transition hover:bg-amber-700 disabled:opacity-50">
                {submitting ? 'Placing your order…' : `Place order · ${peso(subtotal)}`}
              </button>
              <p className="mt-1 text-center text-xs text-slate-400">Free delivery · {peso(minOrder)} minimum</p>
            </div>
          </form>
        )}
      </div>

      <style>{`.input-shop{width:100%;border:1px solid #e2e8f0;border-radius:0.5rem;padding:0.625rem 0.75rem;outline:none}.input-shop:focus{border-color:#d97706;box-shadow:0 0 0 1px #d97706}`}</style>
    </div>
  );
}

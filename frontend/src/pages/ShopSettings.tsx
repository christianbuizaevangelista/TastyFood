import { useEffect, useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert } from '../components/ui';

// Marketing-side settings for the public JuanPalaman shop: its presentation and
// order rules. The shop itself — orders and fulfilment — lives in the DMS.

interface Settings {
  active: boolean;
  headline: string;
  tagline: string | null;
  bannerText: string | null;
  sellingPoints: string[];
  minOrder: number;
  closedMessage: string | null;
}

export default function ShopSettings() {
  const { data, loading, error, refetch } = useFetch<Settings>('/marketing/shop-settings');
  const [f, setF] = useState<Settings>({
    active: true, headline: '', tagline: '', bannerText: '', sellingPoints: [], minOrder: 1000, closedMessage: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (data) setF({
      active: data.active,
      headline: data.headline ?? '',
      tagline: data.tagline ?? '',
      bannerText: data.bannerText ?? '',
      sellingPoints: data.sellingPoints ?? [],
      minOrder: data.minOrder ?? 1000,
      closedMessage: data.closedMessage ?? '',
    });
  }, [data]);

  function setPoint(i: number, v: string) {
    setF((p) => ({ ...p, sellingPoints: p.sellingPoints.map((s, j) => (j === i ? v : s)) }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setNote(null);
    if (!f.headline.trim()) return setErr('Please give the shop a headline.');
    setSaving(true);
    try {
      await api.put('/marketing/shop-settings', {
        active: f.active,
        headline: f.headline,
        tagline: f.tagline || null,
        bannerText: f.bannerText || null,
        sellingPoints: f.sellingPoints.map((s) => s.trim()).filter(Boolean),
        minOrder: Number(f.minOrder) || 0,
        closedMessage: f.closedMessage || null,
      });
      setNote('Shop settings saved.');
      refetch();
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div>
      <PageHeader
        title="JuanPalaman Shop"
        subtitle="How the public shop looks and the rules an order must meet. Orders themselves are in the DMS."
        action={
          <a href="/shop" target="_blank" rel="noreferrer" className="btn-secondary text-sm">
            View the shop ↗
          </a>
        }
      />

      {err && <Alert>{err}</Alert>}
      {note && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{note}</div>}

      <form onSubmit={save} className="max-w-2xl space-y-6">
        <section className="card space-y-4">
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="font-semibold text-slate-800">Shop is open</span>
              <span className="block text-xs text-slate-500">
                Turn off to stop taking orders — buyers see your closed message instead.
              </span>
            </span>
            <input type="checkbox" className="h-5 w-5 accent-amber-600" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
          </label>
          {!f.active && (
            <div>
              <label className="label">Closed message</label>
              <textarea className="input" rows={2} value={f.closedMessage ?? ''} onChange={(e) => set('closedMessage', e.target.value)} />
            </div>
          )}
        </section>

        <section className="card space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">Presentation</h3>
          <div>
            <label className="label">Headline</label>
            <input className="input" value={f.headline} onChange={(e) => set('headline', e.target.value)} placeholder="JuanPalaman — order online" />
          </div>
          <div>
            <label className="label">Tagline</label>
            <input className="input" value={f.tagline ?? ''} onChange={(e) => set('tagline', e.target.value)} placeholder="Creamy, crunchy and choco spreads, delivered to your door." />
          </div>
          <div>
            <label className="label">Promo banner <span className="font-normal text-slate-400">(optional)</span></label>
            <input className="input" value={f.bannerText ?? ''} onChange={(e) => set('bannerText', e.target.value)} placeholder="e.g. Free delivery this week only!" />
            <p className="mt-1 text-xs text-slate-400">Shown across the top of the shop. Leave blank for none.</p>
          </div>
        </section>

        <section className="card space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Why buy from us</h3>
            <p className="text-xs text-slate-400">Up to six short lines shown to the buyer — what they get, what's guaranteed.</p>
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <input
              key={i}
              className="input"
              value={f.sellingPoints[i] ?? ''}
              onChange={(e) => {
                const arr = [...f.sellingPoints];
                arr[i] = e.target.value;
                set('sellingPoints', arr);
              }}
              placeholder={
                ['Free nationwide delivery', 'Cash on delivery available', 'Fresh stock, sealed jars', 'Made by Tasty Food Manufacturing', 'Order tracking by SMS', '100% no-sugar-added options'][i]
              }
            />
          ))}
        </section>

        <section className="card space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">Order rules</h3>
          <div>
            <label className="label">Minimum order (₱)</label>
            <input type="number" min={0} step={50} className="input w-40" value={f.minOrder} onChange={(e) => set('minOrder', Number(e.target.value))} />
            <p className="mt-1 text-xs text-slate-400">Delivery is free, so this is what makes each drop worth dispatching.</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Which products appear in the shop, and their prices, are set per product in
            <strong> DMS › Products</strong> using the “Sell online” checkbox and the retail SRP.
          </div>
        </section>

        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save shop settings'}
        </button>
      </form>
    </div>
  );
}

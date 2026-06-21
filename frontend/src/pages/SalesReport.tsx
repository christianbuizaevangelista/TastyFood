import { useMemo, useState } from 'react';
import { api, apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, KpiCard, Badge } from '../components/ui';
import { peso, num, date } from '../lib/format';

interface Sale {
  id: string;
  number: string;
  channel: 'PO' | 'POS';
  distributionType: 'TRADE' | 'DROP_SHIP';
  total: number;
  createdAt: string;
  customerName?: string;
  sellerOrg: { id: string; name: string; type: string };
  buyerOrg?: { name: string } | null;
  items: { quantity: number }[];
}
interface SalesResponse {
  summary: {
    count: number;
    revenue: number;
    units: number;
    trade: { count: number; revenue: number };
    dropShip: { count: number; revenue: number };
  };
  sales: Sale[];
}

export default function SalesReport() {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ from: '', to: '', tier: '', distributionType: '', channel: '' });
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    return p.toString();
  }, [filters]);

  const { data, loading, error } = useFetch<SalesResponse>(`/sales?${qs}`, [qs]);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  async function exportCsv() {
    setExporting(true);
    setExportErr(null);
    try {
      const res = await api.get(`/sales/export.csv?${qs}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sales-report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportErr(apiError(e));
    } finally {
      setExporting(false);
    }
  }

  const canFilterTier = user!.role === 'PRINCIPAL' || user!.role === 'PROVINCIAL';

  return (
    <div>
      <PageHeader
        title="Sales Report"
        subtitle="Your sales plus rolled-up downstream sales"
        action={
          <button className="btn-ghost" onClick={exportCsv} disabled={exporting}>
            {exporting ? 'Exporting…' : '⬇ Export CSV'}
          </button>
        }
      />

      {exportErr && <div className="mb-4"><Alert>{exportErr}</Alert></div>}

      <div className="card mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div>
          <label className="label">From</label>
          <input type="date" className="input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        {canFilterTier && (
          <div>
            <label className="label">Tier</label>
            <select className="input" value={filters.tier} onChange={(e) => setFilters({ ...filters, tier: e.target.value })}>
              <option value="">All</option>
              <option value="PRINCIPAL">Principal</option>
              <option value="PROVINCIAL">Provincial</option>
              <option value="CITY">City</option>
              <option value="RESELLER">Reseller</option>
            </select>
          </div>
        )}
        <div>
          <label className="label">Type</label>
          <select className="input" value={filters.distributionType} onChange={(e) => setFilters({ ...filters, distributionType: e.target.value })}>
            <option value="">All</option>
            <option value="TRADE">Trade</option>
            <option value="DROP_SHIP">Drop Ship</option>
          </select>
        </div>
        <div>
          <label className="label">Channel</label>
          <select className="input" value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })}>
            <option value="">All</option>
            <option value="POS">POS</option>
            <option value="PO">Purchase Order</option>
          </select>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiCard label="Total Revenue" value={peso(data!.summary.revenue)} accent="text-brand-600" />
            <KpiCard label="Transactions" value={num(data!.summary.count)} />
            <KpiCard label="Trade Revenue" value={peso(data!.summary.trade.revenue)} hint={`${data!.summary.trade.count} sales`} />
            <KpiCard label="Drop-ship Revenue" value={peso(data!.summary.dropShip.revenue)} hint={`${data!.summary.dropShip.count} sales`} />
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">Sale #</th>
                  <th className="th">Date</th>
                  <th className="th">Seller</th>
                  <th className="th">Buyer / Customer</th>
                  <th className="th">Channel</th>
                  <th className="th">Type</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data!.sales.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50">
                    <td className="td font-mono text-xs">{s.number}</td>
                    <td className="td whitespace-nowrap text-xs text-slate-500">{date(s.createdAt)}</td>
                    <td className="td">{s.sellerOrg.name}</td>
                    <td className="td">{s.buyerOrg?.name || s.customerName || 'Walk-in'}</td>
                    <td className="td text-xs">{s.channel}</td>
                    <td className="td"><Badge value={s.distributionType} /></td>
                    <td className="td text-right font-semibold">{peso(s.total)}</td>
                  </tr>
                ))}
                {!data!.sales.length && (
                  <tr><td className="td text-slate-400" colSpan={7}>No sales match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

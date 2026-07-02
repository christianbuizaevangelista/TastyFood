import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState } from '../components/ui';
import { peso } from '../lib/format';

interface Row {
  id: string;
  name: string;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  outstanding: number;
  maxDaysOverdue: number;
}
interface Data {
  asOf: string;
  rows: Row[];
  totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; outstanding: number };
}

export default function AgingReport() {
  const { data, loading, error } = useFetch<Data>('/accounting/aging');

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const rows = data?.rows ?? [];
  const t = data?.totals;

  return (
    <div>
      <PageHeader title="A/R Aging Report" subtitle="Outstanding receivables from retail distributors, by how overdue they are" />
      {rows.length === 0 ? (
        <EmptyState>No outstanding receivables. 🎉</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="td">Distributor</th>
                <th className="td text-right">Current</th>
                <th className="td text-right">1–30 days</th>
                <th className="td text-right">31–60 days</th>
                <th className="td text-right">61–90 days</th>
                <th className="td text-right">90+ days</th>
                <th className="td text-right">Total</th>
                <th className="td text-right">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="td font-medium">{r.name}</td>
                  <td className="td text-right">{r.current ? peso(r.current) : ''}</td>
                  <td className="td text-right text-amber-600">{r.d1_30 ? peso(r.d1_30) : ''}</td>
                  <td className="td text-right text-orange-600">{r.d31_60 ? peso(r.d31_60) : ''}</td>
                  <td className="td text-right text-red-500">{r.d61_90 ? peso(r.d61_90) : ''}</td>
                  <td className="td text-right font-semibold text-red-700">{r.d90plus ? peso(r.d90plus) : ''}</td>
                  <td className="td text-right font-semibold">{peso(r.outstanding)}</td>
                  <td className="td text-right">
                    {r.maxDaysOverdue > 0
                      ? <span className={`badge ${r.maxDaysOverdue > 60 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{r.maxDaysOverdue}d</span>
                      : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
              {t && (
                <tr className="font-bold">
                  <td className="td">Total</td>
                  <td className="td text-right">{peso(t.current)}</td>
                  <td className="td text-right">{peso(t.d1_30)}</td>
                  <td className="td text-right">{peso(t.d31_60)}</td>
                  <td className="td text-right">{peso(t.d61_90)}</td>
                  <td className="td text-right">{peso(t.d90plus)}</td>
                  <td className="td text-right">{peso(t.outstanding)}</td>
                  <td className="td"></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-400">Overdue is measured from each on-account sale's due date (or its sale date if no due date was set). Payments are applied oldest-first.</p>
    </div>
  );
}

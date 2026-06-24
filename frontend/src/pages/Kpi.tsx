import { useState } from 'react';
import { useFetch } from '../lib/useFetch';
import { useAuth } from '../auth/AuthContext';
import { PageHeader, Spinner, Alert } from '../components/ui';
import { peso, num, pct } from '../lib/format';

// Tiers each role may view — only those strictly below them in the hierarchy.
const TIERS_BELOW: Record<string, { value: string; label: string }[]> = {
  PRINCIPAL: [
    { value: 'PROVINCIAL', label: 'Provincial' },
    { value: 'CITY', label: 'City' },
    { value: 'RESELLER', label: 'Reseller' },
  ],
  PROVINCIAL: [
    { value: 'CITY', label: 'City' },
    { value: 'RESELLER', label: 'Reseller' },
  ],
  CITY: [{ value: 'RESELLER', label: 'Reseller' }],
};

interface OrgKpi {
  orgId: string;
  orgName: string;
  orgType: string;
  revenue: number;
  growthPct: number;
  salesVolume: number;
  target: number;
  targetAttainmentPct: number;
  activeMembers: number;
  poFulfillmentRate: number;
  inventoryTurnover: number;
}
interface LeaderboardResponse {
  ranked: OrgKpi[];
  top: OrgKpi[];
  bottom: OrgKpi[];
}

const MEDAL = ['🥇', '🥈', '🥉'];

function rankBadge(i: number) {
  return MEDAL[i] ?? <span className="inline-block w-5 text-center text-xs text-slate-400">{i + 1}</span>;
}

// One leaderboard category card: a ranked list by a chosen metric.
function Leaderboard({
  title,
  subtitle,
  rows,
  metric,
}: {
  title: string;
  subtitle: string;
  rows: OrgKpi[];
  metric: (k: OrgKpi) => { value: string; sub?: string; className?: string };
}) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      <p className="mb-3 text-xs text-slate-400">{subtitle}</p>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-400">No data yet.</div>
      ) : (
        <ol className="space-y-1">
          {rows.map((k, i) => {
            const m = metric(k);
            return (
              <li
                key={k.orgId}
                className={`flex items-center justify-between rounded-lg px-2 py-2 ${i === 0 ? 'bg-amber-50' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{rankBadge(i)}</span>
                  <div>
                    <div className="text-sm font-medium text-slate-800">{k.orgName}</div>
                    <div className="text-xs text-slate-400">{k.orgType}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-semibold ${m.className ?? 'text-slate-900'}`}>{m.value}</div>
                  {m.sub && <div className="text-xs text-slate-400">{m.sub}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default function Kpi() {
  const { user } = useAuth();
  const tierOptions = TIERS_BELOW[user!.role] ?? [];
  const [tier, setTier] = useState('');
  const { data, loading, error } = useFetch<LeaderboardResponse>(
    `/kpi/leaderboard${tier ? `?tier=${tier}` : ''}`,
    [tier]
  );

  const bySales = [...(data?.ranked ?? [])].sort((a, b) => b.revenue - a.revenue);
  const byTarget = [...(data?.ranked ?? [])].sort((a, b) => b.targetAttainmentPct - a.targetAttainmentPct);

  const attainClass = (p: number) =>
    p >= 100 ? 'text-green-600' : p >= 60 ? 'text-amber-600' : 'text-red-600';

  return (
    <div>
      <PageHeader
        title="KPI & Leaderboards"
        subtitle="Two rankings of your downstream network this month"
        action={
          <select className="input w-48" value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="">All tiers below me</option>
            {tierOptions.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        }
      />

      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : !data || data.ranked.length === 0 ? (
        <Alert kind="info">No downstream organizations to rank yet.</Alert>
      ) : (
        <>
          {/* Two categories: Sales leader and Growth-vs-Target leader. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Leaderboard
              title="🏆 Sales Leader"
              subtitle="Ranked by total revenue this month"
              rows={bySales}
              metric={(k) => ({ value: peso(k.revenue), sub: `${num(k.salesVolume)} units`, className: 'text-brand-600' })}
            />
            <Leaderboard
              title="🎯 Growth vs Target Leader"
              subtitle="Ranked by % of monthly sales target achieved"
              rows={byTarget}
              metric={(k) => ({
                value: k.target > 0 ? pct(k.targetAttainmentPct) : 'no target',
                sub: k.target > 0 ? `${peso(k.revenue)} / ${peso(k.target)}` : undefined,
                className: k.target > 0 ? attainClass(k.targetAttainmentPct) : 'text-slate-400',
              })}
            />
          </div>

          {/* Full metric breakdown. */}
          <div className="card mt-6 overflow-x-auto">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">All metrics</h2>
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="th">Organization</th>
                  <th className="th">Tier</th>
                  <th className="th text-right">Revenue</th>
                  <th className="th text-right">Target</th>
                  <th className="th text-right">Attainment</th>
                  <th className="th text-right">Growth</th>
                  <th className="th text-right">Units</th>
                  <th className="th text-right">Active Members</th>
                  <th className="th text-right">PO Fulfillment</th>
                  <th className="th text-right">Inv. Turnover</th>
                </tr>
              </thead>
              <tbody>
                {bySales.map((k) => (
                  <tr key={k.orgId} className="border-b border-slate-50">
                    <td className="td font-medium">{k.orgName}</td>
                    <td className="td text-xs">{k.orgType}</td>
                    <td className="td text-right font-semibold">{peso(k.revenue)}</td>
                    <td className="td text-right text-slate-400">{peso(k.target)}</td>
                    <td className="td text-right">
                      <span className={k.target > 0 ? attainClass(k.targetAttainmentPct) : 'text-slate-400'}>
                        {k.target > 0 ? pct(k.targetAttainmentPct) : '—'}
                      </span>
                    </td>
                    <td className="td text-right">
                      <span className={k.growthPct >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {k.growthPct >= 0 ? '▲' : '▼'} {pct(Math.abs(k.growthPct))}
                      </span>
                    </td>
                    <td className="td text-right">{num(k.salesVolume)}</td>
                    <td className="td text-right">{num(k.activeMembers)}</td>
                    <td className="td text-right">{pct(k.poFulfillmentRate * 100)}</td>
                    <td className="td text-right">{k.inventoryTurnover.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

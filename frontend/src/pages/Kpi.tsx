import { useState } from 'react';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert } from '../components/ui';
import { peso, num, pct } from '../lib/format';

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

export default function Kpi() {
  const [tier, setTier] = useState('');
  const { data, loading, error } = useFetch<LeaderboardResponse>(
    `/kpi/leaderboard${tier ? `?tier=${tier}` : ''}`,
    [tier]
  );

  return (
    <div>
      <PageHeader
        title="KPI & Leaderboards"
        subtitle="Performance of your downstream network this month"
        action={
          <select className="input w-48" value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="">All tiers</option>
            <option value="PROVINCIAL">Provincial</option>
            <option value="CITY">City</option>
            <option value="RESELLER">Reseller</option>
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
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">#</th>
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
              {data.ranked.map((k, i) => (
                <tr key={k.orgId} className="border-b border-slate-50">
                  <td className="td">{i + 1}</td>
                  <td className="td font-medium">{k.orgName}</td>
                  <td className="td text-xs">{k.orgType}</td>
                  <td className="td text-right font-semibold">{peso(k.revenue)}</td>
                  <td className="td text-right text-slate-400">{peso(k.target)}</td>
                  <td className="td text-right">
                    <span className={k.targetAttainmentPct >= 100 ? 'text-green-600' : k.targetAttainmentPct >= 60 ? 'text-amber-600' : 'text-red-600'}>
                      {pct(k.targetAttainmentPct)}
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
      )}
    </div>
  );
}

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { useAuth } from '../auth/AuthContext';
import { useFetch } from '../lib/useFetch';
import { KpiCard, PageHeader, Spinner, Alert } from '../components/ui';
import { peso, num } from '../lib/format';
import { ROLE_LABEL } from '../lib/nav';

interface DashboardData {
  cards: {
    totalRevenue: number;
    salesUnits: number;
    inventoryValue: number;
    pendingApprovals: number;
    activeMembers: number;
    lowStockItems: number;
  };
  charts: {
    monthlyRevenue: { label: string; revenue: number }[];
    byDistributionType: { trade: number; dropShip: number };
    topPerformers: { orgId: string; name: string; type: string; revenue: number }[];
  };
}

const PIE_COLORS = ['#0ea5e9', '#8b5cf6'];

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error } = useFetch<DashboardData>('/dashboard');

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const c = data.cards;
  const pieData = [
    { name: 'Trade', value: data.charts.byDistributionType.trade },
    { name: 'Drop Ship', value: data.charts.byDistributionType.dropShip },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.name.split(' ')[0]}`}
        subtitle={`${ROLE_LABEL[user!.role]} · ${user?.org.name} · figures cover your chain, this month`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total Sales" value={peso(c.totalRevenue)} accent="text-brand-600" />
        <KpiCard label="Units Sold" value={num(c.salesUnits)} />
        <KpiCard label="Inventory Value" value={peso(c.inventoryValue)} hint="your org" />
        <KpiCard label="Active Members" value={num(c.activeMembers)} hint="downstream" />
        <KpiCard
          label="Pending Approvals"
          value={num(c.pendingApprovals)}
          accent={c.pendingApprovals ? 'text-amber-600' : 'text-slate-900'}
        />
        <KpiCard
          label="Low-stock Items"
          value={num(c.lowStockItems)}
          accent={c.lowStockItems ? 'text-red-600' : 'text-slate-900'}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Revenue — last 6 months</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.charts.monthlyRevenue}>
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={70} tickFormatter={(v) => peso(v)} />
              <Tooltip formatter={(v: number) => peso(v)} />
              <Bar dataKey="revenue" fill="#e8521d" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Trade vs Drop Ship</h2>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={90} label>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i]} />
                ))}
              </Pie>
              <Legend />
              <Tooltip formatter={(v: number) => peso(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {data.charts.topPerformers.length > 0 && (
        <div className="card mt-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Top Performers (downstream)</h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">#</th>
                <th className="th">Organization</th>
                <th className="th">Tier</th>
                <th className="th text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.charts.topPerformers.map((p, i) => (
                <tr key={p.orgId} className="border-b border-slate-50">
                  <td className="td">{i + 1}</td>
                  <td className="td font-medium">{p.name}</td>
                  <td className="td">{p.type}</td>
                  <td className="td text-right font-semibold">{peso(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

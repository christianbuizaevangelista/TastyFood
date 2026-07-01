import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, KpiCard } from '../components/ui';
import { peso } from '../lib/format';

interface Data {
  period: { from: string; to: string };
  cards: { revenue: number; expenses: number; netIncome: number; cash: number; accountsReceivable: number };
  expenseBreakdown: { name: string; amount: number }[];
  trend: { month: string; revenue: number; expenses: number }[];
}

const PIE = ['#0b9444', '#f59e0b', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6', '#a855f7', '#64748b'];

export default function FinanceDashboard() {
  const { data, loading, error } = useFetch<Data>('/accounting/dashboard');

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const c = data.cards;
  const hasExpenses = data.expenseBreakdown.length > 0;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Finance overview · this month" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Revenue" value={peso(c.revenue)} hint="this month" accent="text-green-600" />
        <KpiCard label="Expenses" value={peso(c.expenses)} hint="this month" accent="text-red-600" />
        <KpiCard
          label="Net Income"
          value={peso(c.netIncome)}
          hint="revenue − expenses"
          accent={c.netIncome >= 0 ? 'text-green-600' : 'text-red-600'}
        />
        <KpiCard label="Cash on Hand" value={peso(c.cash)} hint="current" accent="text-brand-600" />
        <KpiCard label="Accounts Receivable" value={peso(c.accountsReceivable)} hint="outstanding" accent="text-amber-600" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Revenue vs Expenses — last 6 months</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={70} tickFormatter={(v) => peso(v)} />
              <Tooltip formatter={(v: number) => peso(v)} />
              <Legend />
              <Bar dataKey="revenue" name="Revenue" fill="#0b9444" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Expense breakdown</h2>
          {hasExpenses ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={data.expenseBreakdown} dataKey="amount" nameKey="name" outerRadius={90} label={false}>
                  {data.expenseBreakdown.map((_, i) => (
                    <Cell key={i} fill={PIE[i % PIE.length]} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => peso(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[280px] items-center justify-center text-sm text-slate-400">No expenses this month.</div>
          )}
        </div>
      </div>
    </div>
  );
}

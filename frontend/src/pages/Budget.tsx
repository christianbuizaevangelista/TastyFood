import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, KpiCard } from '../components/ui';
import { peso } from '../lib/format';

interface Row {
  accountId: string;
  code: string;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  budget: number;
  actual: number;
  forecast: number;
  variance: number;
}
interface BudgetData {
  year: number;
  monthsElapsed: number;
  income: Row[];
  expenses: Row[];
  totals: {
    incomeBudget: number; incomeActual: number; incomeForecast: number;
    expenseBudget: number; expenseActual: number; expenseForecast: number;
  };
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function Budget() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const url = `/accounting/budget?year=${year}`;
  const { data, loading, error, refetch } = useFetch<BudgetData>(url, [url]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function changeYear(y: number) {
    setYear(y);
    setEdits({});
    setNote(null);
  }

  const budgetVal = (row: Row) => edits[row.accountId] ?? (row.budget ? String(row.budget) : '');

  async function save() {
    if (!data) return;
    setErr(null);
    setNote(null);
    setBusy(true);
    try {
      const items = [...data.income, ...data.expenses].map((r) => ({
        accountId: r.accountId,
        amount: Number(edits[r.accountId] ?? r.budget) || 0,
      }));
      const { data: res } = await api.put<{ saved: number }>('/accounting/budget', { year, items });
      setNote(`Saved ${res.saved} budget line${res.saved === 1 ? '' : 's'}.`);
      setEdits({});
      refetch();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const d = data!;
  const t = d.totals;
  const netBudget = r2(t.incomeBudget - t.expenseBudget);
  const netActual = r2(t.incomeActual - t.expenseActual);
  const netForecast = r2(t.incomeForecast - t.expenseForecast);

  const chartData = [
    { name: 'Income', Budget: t.incomeBudget, Actual: t.incomeActual, Forecast: t.incomeForecast },
    { name: 'Expenses', Budget: t.expenseBudget, Actual: t.expenseActual, Forecast: t.expenseForecast },
    { name: 'Net', Budget: netBudget, Actual: netActual, Forecast: netForecast },
  ];

  const years = [thisYear - 1, thisYear, thisYear + 1];

  const Section = ({ title, rows, totalKey }: { title: string; rows: Row[]; totalKey: 'income' | 'expense' }) => {
    const tb = totalKey === 'income' ? t.incomeBudget : t.expenseBudget;
    const ta = totalKey === 'income' ? t.incomeActual : t.expenseActual;
    const tf = totalKey === 'income' ? t.incomeForecast : t.expenseForecast;
    return (
      <div className="card mb-4 overflow-x-auto">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="th">Account</th>
              <th className="th text-right">Annual Budget</th>
              <th className="th text-right">Actual (YTD)</th>
              <th className="th text-right">Forecast</th>
              <th className="th text-right">Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={5}>No {title.toLowerCase()} accounts.</td></tr>}
            {rows.map((row) => (
              <tr key={row.accountId} className="border-b border-slate-50">
                <td className="td">{row.name}</td>
                <td className="td text-right">
                  <input
                    type="number" min={0} step="0.01"
                    className="input w-32 text-right"
                    value={budgetVal(row)}
                    onChange={(e) => setEdits({ ...edits, [row.accountId]: e.target.value })}
                  />
                </td>
                <td className="td text-right">{peso(row.actual)}</td>
                <td className="td text-right text-slate-600">{peso(row.forecast)}</td>
                <td className={`td text-right font-medium ${row.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{peso(row.variance)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 font-bold">
              <td className="td">Total {title}</td>
              <td className="td text-right">{peso(tb)}</td>
              <td className="td text-right">{peso(ta)}</td>
              <td className="td text-right">{peso(tf)}</td>
              <td className="td"></td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Budgeting & Forecasting"
        subtitle="Set annual budgets per account; compare against actuals and a run-rate forecast"
        action={
          <div className="flex items-center gap-2">
            <select className="input" value={year} onChange={(e) => changeYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save budgets'}</button>
          </div>
        }
      />

      {note && <div className="mb-3"><Alert kind="success">{note}</Alert></div>}
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}

      <div className="mb-2 text-xs text-slate-400">
        Actuals cover {d.monthsElapsed === 0 ? 'no months yet' : `${d.monthsElapsed} month${d.monthsElapsed === 1 ? '' : 's'}`} of {year}. Forecast annualises the run-rate.
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard label="Net Budget" value={peso(netBudget)} hint="income − expenses" accent="text-brand-600" />
        <KpiCard label="Net Actual (YTD)" value={peso(netActual)} accent={netActual >= 0 ? 'text-green-600' : 'text-red-600'} />
        <KpiCard label="Net Forecast (year)" value={peso(netForecast)} hint="annualised run-rate" accent={netForecast >= 0 ? 'text-green-600' : 'text-red-600'} />
      </div>

      <div className="card mb-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Budget vs Actual vs Forecast</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={70} tickFormatter={(v) => peso(v)} />
            <Tooltip formatter={(v: number) => peso(v)} />
            <Legend />
            <Bar dataKey="Budget" fill="#94a3b8" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Actual" fill="#e8521d" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Forecast" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <Section title="Income" rows={d.income} totalKey="income" />
      <Section title="Expenses" rows={d.expenses} totalKey="expense" />
    </div>
  );
}

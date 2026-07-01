import { useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState } from '../components/ui';
import { peso } from '../lib/format';
import { DATE_PRESETS, presetRange, DatePreset } from '../lib/datePresets';

// jsPDF's standard fonts can't render ₱, so use an ASCII money format for PDF/Excel.
const money = (n: number) => 'PHP ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const xmlEsc = (s: any) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function downloadBlob(blob: Blob, filename: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}

interface Dist {
  id: string;
  name: string;
  type: string;
  segment?: string;
  charges: number;
  payments: number;
  balance: number;
}
interface Account { id: string; code: string; name: string; type: string }

const today = () => new Date().toISOString().slice(0, 10);

export default function DistributorFinancials() {
  const { data, loading, error, refetch } = useFetch<{ distributors: Dist[] }>('/accounting/distributor-financials');
  const [selected, setSelected] = useState<Dist | null>(null);

  const distributors = data?.distributors ?? [];

  return (
    <div>
      <PageHeader title="Distributor Financials" subtitle="Per-distributor sales, expenses, payments, and A/R balance" />

      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : distributors.length === 0 ? (
        <EmptyState>No distributor financial activity yet.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">Distributor</th>
                <th className="th text-right">A/R Charges</th>
                <th className="th text-right">Payments</th>
                <th className="th text-right">Balance owed</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {distributors.map((d) => (
                <tr key={d.id} className="border-b border-slate-50">
                  <td className="td">
                    <button className="text-left font-medium text-brand-700 hover:underline" onClick={() => setSelected(d)}>{d.name}</button>
                    <div className="text-xs text-slate-400">{d.segment === 'RETAIL' ? 'Retail Distributor' : d.type}</div>
                  </td>
                  <td className="td text-right">{peso(d.charges)}</td>
                  <td className="td text-right text-green-600">{peso(d.payments)}</td>
                  <td className={`td text-right font-semibold ${d.balance > 0 ? 'text-red-600' : 'text-slate-700'}`}>{peso(d.balance)}</td>
                  <td className="td text-right"><button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setSelected(d)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <Statement dist={selected} onClose={() => { setSelected(null); refetch(); }} />}
    </div>
  );
}

interface Sale { id: string; number: string; total: number; createdAt: string; onAccount: boolean }
interface Expense { id: string; number: string; date: string; memo?: string | null; amount: number }
interface Payment { id: string; amount: number; date: string; note?: string | null }
interface StmtData {
  distributor: Dist;
  sales: Sale[];
  expenses: Expense[];
  payments: Payment[];
  salesTotal: number;
  expensesTotal: number;
  paymentsTotal: number;
  net: number;
  balance: number;
}

function Statement({ dist, onClose }: { dist: Dist; onClose: () => void }) {
  const [preset, setPreset] = useState<DatePreset>('month');
  const [range, setRange] = useState(() => presetRange('month') ?? { from: '', to: '' });
  const qs = range.from || range.to ? `?from=${range.from}&to=${range.to}` : '';
  const url = `/accounting/distributor-financials/${dist.id}${qs}`;
  const { data, loading, error, refetch } = useFetch<StmtData>(url, [url]);
  const [modal, setModal] = useState<null | 'payment' | 'expense'>(null);

  function applyPreset(p: DatePreset) {
    setPreset(p);
    const r = presetRange(p);
    if (r) setRange(r);
  }

  const rangeLabel = `${range.from || 'start'} to ${range.to || 'today'}`;
  const fileBase = `${dist.name.replace(/[^a-z0-9]+/gi, '_')}_statement`;

  function exportExcel() {
    if (!data) return;
    let h = `<table border="1"><tr><td colspan="3"><b>${xmlEsc(dist.name)} — Distributor Statement</b></td></tr>`;
    h += `<tr><td colspan="3">${rangeLabel}</td></tr><tr></tr>`;
    h += `<tr><td>Sales</td><td></td><td>${data.salesTotal}</td></tr>`;
    h += `<tr><td>Expenses</td><td></td><td>${data.expensesTotal}</td></tr>`;
    h += `<tr><td>Net</td><td></td><td>${data.net}</td></tr>`;
    h += `<tr><td>Payments</td><td></td><td>${data.paymentsTotal}</td></tr>`;
    h += `<tr><td>Outstanding A/R</td><td></td><td>${data.balance}</td></tr><tr></tr>`;
    h += `<tr><th>SALES</th><th>Date</th><th>Amount</th></tr>`;
    data.sales.forEach((s) => (h += `<tr><td>${xmlEsc(s.number)}${s.onAccount ? ' (A/R)' : ''}</td><td>${new Date(s.createdAt).toLocaleDateString()}</td><td>${s.total}</td></tr>`));
    h += `<tr><th>EXPENSES</th><th>Date</th><th>Amount</th></tr>`;
    data.expenses.forEach((x) => (h += `<tr><td>${xmlEsc(x.memo || x.number)}</td><td>${new Date(x.date).toLocaleDateString()}</td><td>${x.amount}</td></tr>`));
    h += `<tr><th>PAYMENTS</th><th>Date</th><th>Amount</th></tr>`;
    data.payments.forEach((p) => (h += `<tr><td>${xmlEsc(p.note || 'Payment')}</td><td>${new Date(p.date).toLocaleDateString()}</td><td>${p.amount}</td></tr>`));
    h += `</table>`;
    const blob = new Blob(['﻿<html><head><meta charset="utf-8"></head><body>' + h + '</body></html>'], { type: 'application/vnd.ms-excel' });
    downloadBlob(blob, `${fileBase}.xls`);
  }

  function exportPdf() {
    if (!data) return;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const M = 40;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(dist.name, M, 40);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Distributor Statement — ${rangeLabel}`, M, 56);
    doc.setTextColor(30);
    doc.setFontSize(10);
    doc.text(
      `Sales: ${money(data.salesTotal)}    Expenses: ${money(data.expensesTotal)}    Net: ${money(data.net)}    Payments: ${money(data.paymentsTotal)}    Outstanding A/R: ${money(data.balance)}`,
      M,
      74
    );
    let y = 90;
    autoTable(doc, { startY: y, head: [['Sales', 'Date', 'Amount']], body: data.sales.map((s) => [s.number + (s.onAccount ? ' (A/R)' : ''), new Date(s.createdAt).toLocaleDateString(), money(s.total)]), styles: { fontSize: 9 }, headStyles: { fillColor: [11, 148, 68] } });
    y = (doc as any).lastAutoTable.finalY + 16;
    autoTable(doc, { startY: y, head: [['Expenses', 'Date', 'Amount']], body: data.expenses.map((x) => [x.memo || x.number, new Date(x.date).toLocaleDateString(), money(x.amount)]), styles: { fontSize: 9 }, headStyles: { fillColor: [239, 68, 68] } });
    y = (doc as any).lastAutoTable.finalY + 16;
    autoTable(doc, { startY: y, head: [['Payments', 'Date', 'Amount']], body: data.payments.map((p) => [p.note || 'Payment', new Date(p.date).toLocaleDateString(), money(p.amount)]), styles: { fontSize: 9 }, headStyles: { fillColor: [14, 165, 233] } });
    doc.save(`${fileBase}.pdf`);
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">{dist.name}</h2>
          <div className="text-right">
            <div className="text-xs text-slate-400">Outstanding A/R</div>
            <div className={`text-xl font-bold ${(data?.balance ?? 0) > 0 ? 'text-red-600' : 'text-slate-800'}`}>{peso(data?.balance ?? 0)}</div>
          </div>
        </div>

        <div className="my-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="label">Date range</label>
            <select className="input text-sm" value={preset} onChange={(e) => applyPreset(e.target.value as DatePreset)}>
              {DATE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          {preset === 'custom' && (
            <>
              <input type="date" className="input text-sm" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
              <span className="pb-2 text-xs text-slate-400">to</span>
              <input type="date" className="input text-sm" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </>
          )}
          <div className="flex-1" />
          <button className="btn-ghost text-xs" disabled={!data} onClick={exportExcel}>⬇ Excel</button>
          <button className="btn-ghost text-xs" disabled={!data} onClick={exportPdf}>⬇ PDF</button>
          <button className="btn-primary text-xs" onClick={() => setModal('payment')}>+ Payment</button>
          <button className="btn-ghost text-xs" onClick={() => setModal('expense')}>+ Expense</button>
        </div>

        {loading ? (
          <Spinner />
        ) : error ? (
          <Alert>{error}</Alert>
        ) : !data ? null : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-2 text-center"><div className="text-xs text-slate-400">Sales</div><div className="font-bold text-green-600">{peso(data.salesTotal)}</div></div>
              <div className="rounded-lg bg-slate-50 p-2 text-center"><div className="text-xs text-slate-400">Expenses</div><div className="font-bold text-red-600">{peso(data.expensesTotal)}</div></div>
              <div className="rounded-lg bg-slate-50 p-2 text-center"><div className="text-xs text-slate-400">Net</div><div className={`font-bold ${data.net >= 0 ? 'text-slate-800' : 'text-red-600'}`}>{peso(data.net)}</div></div>
              <div className="rounded-lg bg-slate-50 p-2 text-center"><div className="text-xs text-slate-400">Payments</div><div className="font-bold text-brand-600">{peso(data.paymentsTotal)}</div></div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Section title="Sales">
                {data.sales.length === 0 ? <Empty /> : data.sales.map((s) => (
                  <Line key={s.id} left={<span className="font-mono text-xs">{s.number}{s.onAccount && <span className="ml-1 text-amber-600">A/R</span>}</span>} sub={new Date(s.createdAt).toLocaleDateString()} amount={s.total} />
                ))}
              </Section>
              <Section title="Expenses">
                {data.expenses.length === 0 ? <Empty /> : data.expenses.map((x) => (
                  <Line key={x.id} left={x.memo || x.number} sub={new Date(x.date).toLocaleDateString()} amount={x.amount} red />
                ))}
              </Section>
              <Section title="Payments">
                {data.payments.length === 0 ? <Empty /> : data.payments.map((p) => (
                  <Line key={p.id} left={p.note || 'Payment'} sub={new Date(p.date).toLocaleDateString()} amount={p.amount} green />
                ))}
              </Section>
            </div>
          </>
        )}

        <div className="mt-5 flex justify-end">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>

      {modal === 'payment' && <RecordPayment distId={dist.id} onClose={() => setModal(null)} onSaved={() => { setModal(null); refetch(); }} />}
      {modal === 'expense' && <RecordExpense distId={dist.id} onClose={() => setModal(null)} onSaved={() => { setModal(null); refetch(); }} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase text-slate-400">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Empty() {
  return <div className="text-sm text-slate-400">None</div>;
}
function Line({ left, sub, amount, red, green }: { left: React.ReactNode; sub: string; amount: number; red?: boolean; green?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 py-1 text-sm">
      <div className="min-w-0"><div className="truncate">{left}</div><div className="text-xs text-slate-400">{sub}</div></div>
      <span className={red ? 'text-red-600' : green ? 'text-green-600' : ''}>{peso(amount)}</span>
    </div>
  );
}

function RecordPayment({ distId, onClose, onSaved }: { distId: string; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) return setErr('Enter an amount.');
    setBusy(true);
    try {
      await api.post(`/accounting/distributor-financials/${distId}/payments`, { amount: amt, date, note: note || undefined });
      onSaved();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Record Payment" onClose={onClose}>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <label className="label">Amount (₱)</label>
      <input type="number" min={0} step="0.01" className="input mb-3" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <label className="label">Date</label>
      <input type="date" className="input mb-3" value={date} onChange={(e) => setDate(e.target.value)} />
      <label className="label">Note (optional)</label>
      <input className="input mb-4" value={note} onChange={(e) => setNote(e.target.value)} placeholder="OR / reference no." />
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

function RecordExpense({ distId, onClose, onSaved }: { distId: string; onClose: () => void; onSaved: () => void }) {
  const accounts = useFetch<{ accounts: Account[] }>('/accounting/accounts');
  const expenseAccounts = (accounts.data?.accounts ?? []).filter((a) => a.type === 'EXPENSE');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) return setErr('Enter an amount.');
    if (!accountId) return setErr('Pick an expense account.');
    setBusy(true);
    try {
      await api.post(`/accounting/distributor-financials/${distId}/expenses`, { amount: amt, date, accountId, note: note || undefined });
      onSaved();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Record Expense (for this distributor)" onClose={onClose}>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <label className="label">Expense account</label>
      <select className="input mb-3" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        <option value="">{accounts.loading ? 'Loading…' : 'Select…'}</option>
        {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
      </select>
      <label className="label">Amount (₱)</label>
      <input type="number" min={0} step="0.01" className="input mb-3" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <label className="label">Date</label>
      <input type="date" className="input mb-3" value={date} onChange={(e) => setDate(e.target.value)} />
      <label className="label">Note (optional)</label>
      <input className="input mb-4" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. delivery, commission" />
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

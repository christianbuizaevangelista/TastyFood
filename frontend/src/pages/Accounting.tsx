import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState, Badge } from '../components/ui';
import { peso } from '../lib/format';

type Tab = 'reports' | 'journal' | 'accounts';
type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  isCash: boolean;
  cashflowSection: 'OPERATING' | 'INVESTING' | 'FINANCING' | null;
  isActive: boolean;
}

const TYPE_LABEL: Record<AccountType, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expenses',
};

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10);
};

export default function Accounting() {
  const [tab, setTab] = useState<Tab>('reports');
  return (
    <div>
      <PageHeader title="Accounting" subtitle="Finance department · double-entry books (private to Tasty Food)" />
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {([
          ['reports', 'Reports'],
          ['journal', 'Journal Entries'],
          ['accounts', 'Chart of Accounts'],
        ] as [Tab, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium ${tab === k ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'reports' && <Reports />}
      {tab === 'journal' && <Journal />}
      {tab === 'accounts' && <ChartOfAccounts />}
    </div>
  );
}

// ============================ Reports =======================================
function Reports() {
  const [report, setReport] = useState<'pnl' | 'balance-sheet' | 'cash-flow' | 'trial-balance'>('pnl');
  const usesRange = report === 'pnl' || report === 'cash-flow';
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [asOf, setAsOf] = useState(today());

  const qs = usesRange ? `?from=${from}&to=${to}` : `?asOf=${asOf}`;
  const url = `/accounting/reports/${report}${qs}`;
  const { data, loading, error } = useFetch<any>(url, [url]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">Report</label>
          <select className="input" value={report} onChange={(e) => setReport(e.target.value as any)}>
            <option value="pnl">Profit &amp; Loss</option>
            <option value="balance-sheet">Balance Sheet</option>
            <option value="cash-flow">Cash Flow Statement</option>
            <option value="trial-balance">Trial Balance</option>
          </select>
        </div>
        {usesRange ? (
          <>
            <div>
              <label className="label">From</label>
              <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">To</label>
              <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        ) : (
          <div>
            <label className="label">As of</label>
            <input type="date" className="input" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
        )}
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : !data ? null : report === 'pnl' ? (
        <Pnl d={data} />
      ) : report === 'balance-sheet' ? (
        <BalanceSheet d={data} />
      ) : report === 'cash-flow' ? (
        <CashFlow d={data} />
      ) : (
        <TrialBalance d={data} />
      )}
    </div>
  );
}

function Row({ label, value, bold, indent }: { label: string; value: number; bold?: boolean; indent?: boolean }) {
  return (
    <div className={`flex justify-between py-1 ${bold ? 'font-bold' : ''} ${indent ? 'pl-3 text-slate-600' : ''}`}>
      <span>{label}</span>
      <span>{peso(value)}</span>
    </div>
  );
}

function Pnl({ d }: { d: any }) {
  return (
    <div className="card max-w-xl">
      <h3 className="mb-1 text-base font-bold">Profit &amp; Loss</h3>
      <p className="mb-3 text-xs text-slate-400">{new Date(d.from).toLocaleDateString()} – {new Date(d.to).toLocaleDateString()}</p>
      <div className="text-xs font-semibold uppercase text-slate-400">Income</div>
      {d.income.length ? d.income.map((r: any) => <Row key={r.code} label={`${r.code} ${r.name}`} value={r.amount} indent />) : <div className="py-1 pl-3 text-sm text-slate-400">None</div>}
      <Row label="Total Income" value={d.totalIncome} bold />
      <div className="mt-3 text-xs font-semibold uppercase text-slate-400">Expenses</div>
      {d.expenses.length ? d.expenses.map((r: any) => <Row key={r.code} label={`${r.code} ${r.name}`} value={r.amount} indent />) : <div className="py-1 pl-3 text-sm text-slate-400">None</div>}
      <Row label="Total Expenses" value={d.totalExpenses} bold />
      <div className="mt-2 border-t border-slate-200 pt-2">
        <div className={`flex justify-between text-lg font-bold ${d.netIncome >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          <span>Net Income</span><span>{peso(d.netIncome)}</span>
        </div>
      </div>
    </div>
  );
}

function BalanceSheet({ d }: { d: any }) {
  return (
    <div className="card max-w-xl">
      <h3 className="mb-1 text-base font-bold">Balance Sheet</h3>
      <p className="mb-3 text-xs text-slate-400">As of {new Date(d.asOf).toLocaleDateString()}</p>
      <div className="text-xs font-semibold uppercase text-slate-400">Assets</div>
      {d.assets.map((r: any) => <Row key={r.code} label={`${r.code} ${r.name}`} value={r.amount} indent />)}
      <Row label="Total Assets" value={d.totalAssets} bold />
      <div className="mt-3 text-xs font-semibold uppercase text-slate-400">Liabilities</div>
      {d.liabilities.length ? d.liabilities.map((r: any) => <Row key={r.code} label={`${r.code} ${r.name}`} value={r.amount} indent />) : <div className="py-1 pl-3 text-sm text-slate-400">None</div>}
      <Row label="Total Liabilities" value={d.totalLiabilities} bold />
      <div className="mt-3 text-xs font-semibold uppercase text-slate-400">Equity</div>
      {d.equity.map((r: any) => <Row key={r.code} label={`${r.code} ${r.name}`} value={r.amount} indent />)}
      <Row label="Current Earnings (net income to date)" value={d.currentEarnings} indent />
      <Row label="Total Equity" value={d.totalEquity} bold />
      <div className="mt-2 border-t border-slate-200 pt-2">
        <Row label="Liabilities + Equity" value={d.totalLiabilities + d.totalEquity} bold />
        {!d.balanced && <p className="mt-1 text-xs text-red-600">⚠️ Books are out of balance — check your entries.</p>}
      </div>
    </div>
  );
}

function CashFlow({ d }: { d: any }) {
  return (
    <div className="card max-w-xl">
      <h3 className="mb-1 text-base font-bold">Cash Flow Statement</h3>
      <p className="mb-3 text-xs text-slate-400">{new Date(d.from).toLocaleDateString()} – {new Date(d.to).toLocaleDateString()}</p>
      <Row label="Operating activities" value={d.operating} />
      <Row label="Investing activities" value={d.investing} />
      <Row label="Financing activities" value={d.financing} />
      <div className="mt-2 border-t border-slate-200 pt-2">
        <Row label="Net change in cash" value={d.netChange} bold />
        <Row label="Beginning cash" value={d.beginningCash} />
        <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-bold text-brand-700">
          <span>Ending cash</span><span>{peso(d.endingCash)}</span>
        </div>
      </div>
    </div>
  );
}

function TrialBalance({ d }: { d: any }) {
  return (
    <div className="card overflow-x-auto">
      <h3 className="mb-1 text-base font-bold">Trial Balance</h3>
      <p className="mb-3 text-xs text-slate-400">As of {new Date(d.asOf).toLocaleDateString()}</p>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-100 text-left text-xs text-slate-400">
          <th className="td">Code</th><th className="td">Account</th><th className="td text-right">Debit</th><th className="td text-right">Credit</th>
        </tr></thead>
        <tbody>
          {d.rows.map((r: any) => (
            <tr key={r.code} className="border-b border-slate-50">
              <td className="td font-mono text-xs">{r.code}</td>
              <td className="td">{r.name}</td>
              <td className="td text-right">{r.debit ? peso(r.debit) : ''}</td>
              <td className="td text-right">{r.credit ? peso(r.credit) : ''}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="td" colSpan={2}>Total</td>
            <td className="td text-right">{peso(d.totalDebit)}</td>
            <td className="td text-right">{peso(d.totalCredit)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ============================ Journal =======================================
function Journal() {
  const entries = useFetch<{ entries: any[] }>('/accounting/entries');
  const accounts = useFetch<{ accounts: Account[] }>('/accounting/accounts');
  const [modal, setModal] = useState<null | 'income' | 'expense' | 'entry'>(null);
  const [err, setErr] = useState<string | null>(null);

  async function del(id: string) {
    if (!confirm('Delete this journal entry?')) return;
    setErr(null);
    try {
      await api.delete(`/accounting/entries/${id}`);
      entries.refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => setModal('income')}>+ Record Income</button>
        <button className="btn-primary" onClick={() => setModal('expense')}>+ Record Expense</button>
        <button className="btn-ghost" onClick={() => setModal('entry')}>+ Journal Entry</button>
      </div>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}

      {entries.loading ? (
        <Spinner />
      ) : entries.error ? (
        <Alert>{entries.error}</Alert>
      ) : (entries.data?.entries.length ?? 0) === 0 ? (
        <EmptyState>No journal entries yet.</EmptyState>
      ) : (
        <div className="space-y-2">
          {entries.data!.entries.map((e) => {
            const total = e.lines.reduce((s: number, l: any) => s + l.debit, 0);
            return (
              <div key={e.id} className="card py-3">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-mono text-xs text-slate-500">{e.number}</span>
                    <span className="ml-2 text-xs text-slate-400">{new Date(e.date).toLocaleDateString()}</span>
                    {e.memo && <div className="text-sm text-slate-700">{e.memo}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{peso(total)}</span>
                    <button className="text-xs text-red-600 hover:underline" onClick={() => del(e.id)}>Delete</button>
                  </div>
                </div>
                <table className="mt-2 w-full text-xs">
                  <tbody>
                    {e.lines.map((l: any) => (
                      <tr key={l.id} className="text-slate-600">
                        <td className="py-0.5">{l.account.code} {l.account.name}</td>
                        <td className="py-0.5 text-right">{l.debit ? peso(l.debit) : ''}</td>
                        <td className="py-0.5 text-right">{l.credit ? peso(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {modal === 'income' && (
        <QuickEntry kind="income" accounts={accounts.data?.accounts ?? []} onClose={() => setModal(null)} onSaved={() => { setModal(null); entries.refetch(); }} />
      )}
      {modal === 'expense' && (
        <QuickEntry kind="expense" accounts={accounts.data?.accounts ?? []} onClose={() => setModal(null)} onSaved={() => { setModal(null); entries.refetch(); }} />
      )}
      {modal === 'entry' && (
        <ManualEntry accounts={accounts.data?.accounts ?? []} onClose={() => setModal(null)} onSaved={() => { setModal(null); entries.refetch(); }} />
      )}
    </div>
  );
}

// Quick income/expense: one cash account + one income/expense account.
function QuickEntry({ kind, accounts, onClose, onSaved }: { kind: 'income' | 'expense'; accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const cashAccounts = accounts.filter((a) => a.isCash && a.isActive);
  const catAccounts = accounts.filter((a) => a.type === (kind === 'income' ? 'INCOME' : 'EXPENSE') && a.isActive);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [cashId, setCashId] = useState(cashAccounts[0]?.id ?? '');
  const [catId, setCatId] = useState(catAccounts[0]?.id ?? '');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) return setErr('Enter an amount.');
    if (!cashId || !catId) return setErr('Pick the accounts.');
    setBusy(true);
    try {
      // Income: Dr Cash, Cr Income. Expense: Dr Expense, Cr Cash.
      const lines =
        kind === 'income'
          ? [{ accountId: cashId, debit: amt }, { accountId: catId, credit: amt }]
          : [{ accountId: catId, debit: amt }, { accountId: cashId, credit: amt }];
      await api.post('/accounting/entries', { date, memo: memo || undefined, lines });
      onSaved();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={kind === 'income' ? 'Record Income' : 'Record Expense'} onClose={onClose}>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <label className="label">Date</label>
      <input type="date" className="input mb-3" value={date} onChange={(e) => setDate(e.target.value)} />
      <label className="label">{kind === 'income' ? 'Income account' : 'Expense account'}</label>
      <select className="input mb-3" value={catId} onChange={(e) => setCatId(e.target.value)}>
        {catAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
      </select>
      <label className="label">{kind === 'income' ? 'Deposit to' : 'Paid from'} (cash/bank)</label>
      <select className="input mb-3" value={cashId} onChange={(e) => setCashId(e.target.value)}>
        {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
      </select>
      <label className="label">Amount (₱)</label>
      <input type="number" min={0} step="0.01" className="input mb-3" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <label className="label">Memo (optional)</label>
      <input className="input mb-4" value={memo} onChange={(e) => setMemo(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

// Manual multi-line balanced journal entry.
function ManualEntry({ accounts, onClose, onSaved }: { accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const active = accounts.filter((a) => a.isActive);
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState([
    { accountId: '', debit: '', credit: '' },
    { accountId: '', debit: '', credit: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const setLine = (i: number, k: 'accountId' | 'debit' | 'credit', v: string) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function save() {
    setErr(null);
    if (!balanced) return setErr('Debits must equal credits (and be greater than zero).');
    if (lines.some((l) => !l.accountId)) return setErr('Pick an account on every line.');
    setBusy(true);
    try {
      await api.post('/accounting/entries', {
        date,
        memo: memo || undefined,
        lines: lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
      });
      onSaved();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="New Journal Entry" onClose={onClose} wide>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <div className="mb-3 flex gap-2">
        <div className="flex-1">
          <label className="label">Date</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex-[2]">
          <label className="label">Memo</label>
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-400">
          <th className="pb-1">Account</th><th className="pb-1 text-right">Debit</th><th className="pb-1 text-right">Credit</th><th></th>
        </tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <select className="input" value={l.accountId} onChange={(e) => setLine(i, 'accountId', e.target.value)}>
                  <option value="">Select…</option>
                  {active.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                </select>
              </td>
              <td className="py-1"><input type="number" min={0} step="0.01" className="input text-right" value={l.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} /></td>
              <td className="py-1 pl-2"><input type="number" min={0} step="0.01" className="input text-right" value={l.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} /></td>
              <td className="pl-2">
                {lines.length > 2 && <button className="text-xs text-red-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="mt-2 text-xs font-semibold text-brand-700 hover:underline" onClick={() => setLines([...lines, { accountId: '', debit: '', credit: '' }])}>+ Add line</button>
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <span>Debits: <strong>{peso(totalDebit)}</strong></span>
        <span>Credits: <strong>{peso(totalCredit)}</strong></span>
        <span className={balanced ? 'text-green-600' : 'text-red-600'}>{balanced ? '✓ Balanced' : 'Out of balance'}</span>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !balanced} onClick={save}>{busy ? 'Saving…' : 'Post entry'}</button>
      </div>
    </Modal>
  );
}

// ======================= Chart of Accounts ==================================
function ChartOfAccounts() {
  const { data, loading, error, refetch } = useFetch<{ accounts: Account[] }>('/accounting/accounts');
  const [showAdd, setShowAdd] = useState(false);

  const accounts = data?.accounts ?? [];
  const byType = (t: AccountType) => accounts.filter((a) => a.type === t);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add account</button>
      </div>
      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : (
        <div className="space-y-4">
          {(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as AccountType[]).map((t) => (
            <div key={t} className="card">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">{TYPE_LABEL[t]}</h3>
              <div className="space-y-1">
                {byType(t).map((a) => (
                  <div key={a.id} className="flex items-center justify-between border-b border-slate-50 py-1 text-sm">
                    <span><span className="font-mono text-xs text-slate-400">{a.code}</span> {a.name}</span>
                    <span className="flex items-center gap-2 text-xs">
                      {a.isCash && <Badge value="CASH" />}
                      {a.cashflowSection && <span className="text-slate-400">{a.cashflowSection}</span>}
                      {!a.isActive && <span className="text-red-400">inactive</span>}
                    </span>
                  </div>
                ))}
                {byType(t).length === 0 && <div className="text-xs text-slate-400">None</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {showAdd && <AddAccount onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); refetch(); }} />}
    </div>
  );
}

function AddAccount({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: '', name: '', type: 'EXPENSE' as AccountType, isCash: false, cashflowSection: 'OPERATING' as string });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!form.code.trim() || !form.name.trim()) return setErr('Code and name are required.');
    setBusy(true);
    try {
      await api.post('/accounting/accounts', {
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        isCash: form.isCash,
        cashflowSection: form.isCash ? null : (form.cashflowSection as any),
      });
      onSaved();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Add account" onClose={onClose}>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Code</label>
          <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. 5700" />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}>
            {(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as AccountType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        {form.type === 'ASSET' && (
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isCash} onChange={(e) => setForm({ ...form, isCash: e.target.checked })} />
            This is a cash / bank account (counts as cash on the cash-flow statement)
          </label>
        )}
        {!form.isCash && (
          <div className="col-span-2">
            <label className="label">Cash-flow section</label>
            <select className="input" value={form.cashflowSection} onChange={(e) => setForm({ ...form, cashflowSection: e.target.value })}>
              <option value="OPERATING">Operating</option>
              <option value="INVESTING">Investing</option>
              <option value="FINANCING">Financing</option>
            </select>
            <p className="mt-1 text-xs text-slate-400">How cash movements against this account are classified.</p>
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add'}</button>
      </div>
    </Modal>
  );
}

// ============================ shared modal ==================================
function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className={`max-h-[90vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto rounded-xl bg-white p-6 shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

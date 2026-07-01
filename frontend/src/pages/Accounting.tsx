import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState, Badge } from '../components/ui';
import { peso } from '../lib/format';
import { DATE_PRESETS, presetRange, DatePreset } from '../lib/datePresets';

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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

async function viewAttachment(entryId: string, attId: string) {
  const res = await api.get(`/accounting/entries/${entryId}/attachments/${attId}`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10);
};

// Builds a report's rows for CSV export (respecting the selected date).
function reportToCsv(report: string, d: any): (string | number)[][] {
  const rows: (string | number)[][] = [];
  if (report === 'pnl') {
    rows.push(['Profit & Loss'], ['From', new Date(d.from).toLocaleDateString(), 'To', new Date(d.to).toLocaleDateString()], []);
    rows.push(['Income']);
    (d.income ?? []).forEach((r: any) => rows.push([`${r.code} ${r.name}`, r.amount]));
    rows.push(['Total Income', d.totalIncome], [], ['Expenses']);
    (d.expenses ?? []).forEach((r: any) => rows.push([`${r.code} ${r.name}`, r.amount]));
    rows.push(['Total Expenses', d.totalExpenses], [], ['Net Income', d.netIncome]);
  } else if (report === 'balance-sheet') {
    rows.push(['Balance Sheet'], ['As of', new Date(d.asOf).toLocaleDateString()], [], ['Assets']);
    (d.assets ?? []).forEach((r: any) => rows.push([`${r.code} ${r.name}`, r.amount]));
    rows.push(['Total Assets', d.totalAssets], [], ['Liabilities']);
    (d.liabilities ?? []).forEach((r: any) => rows.push([`${r.code} ${r.name}`, r.amount]));
    rows.push(['Total Liabilities', d.totalLiabilities], [], ['Equity']);
    (d.equity ?? []).forEach((r: any) => rows.push([`${r.code} ${r.name}`, r.amount]));
    rows.push(['Current Earnings', d.currentEarnings], ['Total Equity', d.totalEquity], [], ['Liabilities + Equity', d.totalLiabilities + d.totalEquity]);
  } else if (report === 'cash-flow') {
    rows.push(['Cash Flow Statement'], ['From', new Date(d.from).toLocaleDateString(), 'To', new Date(d.to).toLocaleDateString()], []);
    rows.push(['Operating', d.operating], ['Investing', d.investing], ['Financing', d.financing], ['Net change', d.netChange], ['Beginning cash', d.beginningCash], ['Ending cash', d.endingCash]);
  } else {
    rows.push(['Trial Balance'], ['As of', new Date(d.asOf).toLocaleDateString()], [], ['Code', 'Account', 'Type', 'Debit', 'Credit']);
    (d.rows ?? []).forEach((r: any) => rows.push([r.code, r.name, r.type, r.debit, r.credit]));
    rows.push(['', 'Total', '', d.totalDebit, d.totalCredit]);
  }
  return rows;
}

// ============================ Reports =======================================
export function Reports() {
  const [report, setReport] = useState<'pnl' | 'balance-sheet' | 'cash-flow' | 'trial-balance'>('pnl');
  const usesRange = report === 'pnl' || report === 'cash-flow';
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [asOf, setAsOf] = useState(today());
  const [preset, setPreset] = useState<DatePreset>('month');

  function applyPreset(p: DatePreset) {
    setPreset(p);
    const r = presetRange(p); // null for 'custom'
    if (r) {
      setFrom(r.from);
      setTo(r.to);
      setAsOf(r.to || today()); // as-of reports use the range's end date
    }
  }

  const qs = usesRange ? `?from=${from}&to=${to}` : `?asOf=${asOf}`;
  const url = `/accounting/reports/${report}${qs}`;
  const { data, loading, error, refetch } = useFetch<any>(url, [url]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const tag = usesRange ? `${from}_to_${to}` : `asof_${asOf}`;
  function exportCsv() {
    if (!data) return;
    const rows = reportToCsv(report, data);
    const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = `${report}_${tag}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }
  async function importCsv(file: File) {
    setNote(null);
    setBusy(true);
    try {
      const text = await file.text();
      const { data: r } = await api.post('/accounting/entries/import', { csv: text });
      setNote(`Imported ${r.imported} entr${r.imported === 1 ? 'y' : 'ies'}.${r.errors?.length ? ` (${r.errors.length} skipped)` : ''}`);
      refetch();
    } catch (e) {
      setNote(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Reports" subtitle="Profit & Loss · Balance Sheet · Cash Flow · Trial Balance" />
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
        <div>
          <label className="label">Date</label>
          <select className="input" value={preset} onChange={(e) => applyPreset(e.target.value as DatePreset)}>
            {DATE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
        {preset === 'custom' && (usesRange ? (
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
        ))}
        <button className="btn-ghost text-xs" disabled={!data} onClick={exportCsv}>⬇ Export CSV</button>
        <label className="btn-ghost cursor-pointer text-xs">
          {busy ? 'Importing…' : '⬆ Import entries'}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ''; }} />
        </label>
      </div>
      {note && <div className="mb-3"><Alert kind="success">{note}</Alert></div>}
      <p className="mb-3 text-xs text-slate-400">Import format (one entry per row): <span className="font-mono">Date, DebitAccountCode, CreditAccountCode, Amount, Memo</span></p>

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
      {(d.income ?? []).length ? (d.income ?? []).map((r: any) => <Row key={r.code} label={`${r.code} ${r.name}`} value={r.amount} indent />) : <div className="py-1 pl-3 text-sm text-slate-400">None</div>}
      <Row label="Total Income" value={d.totalIncome} bold />
      <div className="mt-3 text-xs font-semibold uppercase text-slate-400">Expenses</div>
      {(d.expenses ?? []).length ? (d.expenses ?? []).map((r: any) => <Row key={r.code} label={`${r.code} ${r.name}`} value={r.amount} indent />) : <div className="py-1 pl-3 text-sm text-slate-400">None</div>}
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
      {(d.assets ?? []).map((r: any) => <Row key={r.code} label={`${r.code} ${r.name}`} value={r.amount} indent />)}
      <Row label="Total Assets" value={d.totalAssets} bold />
      <div className="mt-3 text-xs font-semibold uppercase text-slate-400">Liabilities</div>
      {(d.liabilities ?? []).length ? (d.liabilities ?? []).map((r: any) => <Row key={r.code} label={`${r.code} ${r.name}`} value={r.amount} indent />) : <div className="py-1 pl-3 text-sm text-slate-400">None</div>}
      <Row label="Total Liabilities" value={d.totalLiabilities} bold />
      <div className="mt-3 text-xs font-semibold uppercase text-slate-400">Equity</div>
      {(d.equity ?? []).map((r: any) => <Row key={r.code} label={`${r.code} ${r.name}`} value={r.amount} indent />)}
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
          {(d.rows ?? []).map((r: any) => (
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
export function Journal() {
  const entries = useFetch<{ entries: any[] }>('/accounting/entries');
  const accounts = useFetch<{ accounts: Account[] }>('/accounting/accounts');
  const [modal, setModal] = useState<null | 'income' | 'expense' | 'entry' | 'delivery'>(null);
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
      <PageHeader title="Journal Entries" subtitle="Record income, expenses, and manual double-entry journals" />
      <div className="mb-4 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => setModal('income')}>+ Record Income</button>
        <button className="btn-primary" onClick={() => setModal('expense')}>+ Record Expense</button>
        <button className="btn-primary" onClick={() => setModal('delivery')}>+ Distributor Delivery</button>
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
                    {e.distributorOrg && (
                      <div className="text-sm font-medium text-slate-700">
                        🚚 {e.distributorOrg.name}
                        {e.deliveryReceiptNo && <span className="ml-2 text-xs font-normal text-slate-400">DR #{e.deliveryReceiptNo}</span>}
                      </div>
                    )}
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
                {e.items?.length > 0 && (
                  <table className="mt-2 w-full text-xs">
                    <thead><tr className="text-left text-slate-400">
                      <th className="font-normal">SKU</th><th className="font-normal">Item</th>
                      <th className="font-normal text-right">Qty</th><th className="font-normal text-right">Unit</th><th className="font-normal text-right">Amount</th>
                    </tr></thead>
                    <tbody>
                      {e.items.map((it: any) => (
                        <tr key={it.id} className="text-slate-600">
                          <td className="py-0.5 font-mono">{it.sku}</td>
                          <td className="py-0.5">{it.name}</td>
                          <td className="py-0.5 text-right">{it.quantity}</td>
                          <td className="py-0.5 text-right">{peso(it.unitPrice)}</td>
                          <td className="py-0.5 text-right">{peso(it.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {e.attachments?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-50 pt-2">
                    {e.attachments.map((a: any) => (
                      <button
                        key={a.id}
                        className="rounded border border-slate-200 px-2 py-0.5 text-xs text-brand-700 hover:bg-slate-50"
                        onClick={() => viewAttachment(e.id, a.id)}
                      >
                        📎 {a.fileName}
                      </button>
                    ))}
                  </div>
                )}
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
      {modal === 'delivery' && (
        <DeliveryEntry accounts={accounts.data?.accounts ?? []} onClose={() => setModal(null)} onSaved={() => { setModal(null); entries.refetch(); }} />
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
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) return setErr('Enter an amount.');
    if (!cashId || !catId) return setErr('Pick the accounts.');
    if (file && file.size > 4 * 1024 * 1024) return setErr('Receipt too large (max 4 MB).');
    setBusy(true);
    try {
      // Income: Dr Cash, Cr Income. Expense: Dr Expense, Cr Cash.
      const lines =
        kind === 'income'
          ? [{ accountId: cashId, debit: amt }, { accountId: catId, credit: amt }]
          : [{ accountId: catId, debit: amt }, { accountId: cashId, credit: amt }];
      const attachments = file
        ? [{ fileName: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: await fileToDataUrl(file) }]
        : undefined;
      await api.post('/accounting/entries', { date, memo: memo || undefined, lines, attachments });
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
      <input className="input mb-3" value={memo} onChange={(e) => setMemo(e.target.value)} />
      <label className="label">{kind === 'expense' ? 'Receipt' : 'Attachment'} (optional, max 4 MB)</label>
      <input type="file" className="mb-1 text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      {file && <div className="mb-3 text-xs text-green-600">📎 {file.name}</div>}
      <div className="mt-3 flex justify-end gap-2">
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
  const [file, setFile] = useState<File | null>(null);
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
    if (file && file.size > 4 * 1024 * 1024) return setErr('Receipt too large (max 4 MB).');
    setBusy(true);
    try {
      const attachments = file
        ? [{ fileName: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: await fileToDataUrl(file) }]
        : undefined;
      await api.post('/accounting/entries', {
        date,
        memo: memo || undefined,
        lines: lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
        attachments,
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
      <div className="mt-3">
        <label className="label">Receipt / attachment (optional, max 4 MB)</label>
        <input type="file" className="text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file && <span className="ml-2 text-xs text-green-600">📎 {file.name}</span>}
      </div>
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

// Distributor delivery on account: Dr Accounts Receivable, Cr Sales Revenue,
// with a Delivery Receipt number and per-SKU items.
function DeliveryEntry({ accounts, onClose, onSaved }: { accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const distributors = useFetch<{ distributors: { id: string; name: string; type: string }[] }>('/accounting/distributors');
  const products = useFetch<{ products: { id: string; sku: string; name: string; srp: number }[] }>('/accounting/products');
  const active = accounts.filter((a) => a.isActive);
  const arAccounts = active.filter((a) => a.type === 'ASSET');
  const revAccounts = active.filter((a) => a.type === 'INCOME');
  const arDefault = arAccounts.find((a) => a.code === '1100' || /receivable/i.test(a.name))?.id ?? arAccounts[0]?.id ?? '';
  const revDefault = revAccounts.find((a) => a.code === '4000' || /sales/i.test(a.name))?.id ?? revAccounts[0]?.id ?? '';

  const [date, setDate] = useState(today());
  const [distributorId, setDistributorId] = useState('');
  const [drNo, setDrNo] = useState('');
  const [arId, setArId] = useState('');
  const [revId, setRevId] = useState('');
  const [memo, setMemo] = useState('');
  const [items, setItems] = useState([{ productId: '', sku: '', name: '', quantity: '1', unitPrice: '' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Defaults populate once the data is loaded.
  if (!arId && arDefault) setArId(arDefault);
  if (!revId && revDefault) setRevId(revDefault);

  function pickProduct(i: number, productId: string) {
    const p = products.data?.products.find((x) => x.id === productId);
    setItems(items.map((it, j) => (j === i ? { ...it, productId, sku: p?.sku ?? '', name: p?.name ?? '', unitPrice: it.unitPrice || String(p?.srp ?? '') } : it)));
  }
  const setItem = (i: number, k: 'quantity' | 'unitPrice', v: string) =>
    setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const lineAmount = (it: typeof items[number]) => (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
  const total = items.reduce((s, it) => s + lineAmount(it), 0);

  async function save() {
    setErr(null);
    if (!distributorId) return setErr('Select a distributor.');
    if (!arId || !revId) return setErr('Pick the Accounts Receivable and Revenue accounts.');
    const valid = items.filter((it) => it.productId && Number(it.quantity) > 0);
    if (!valid.length) return setErr('Add at least one item with a quantity.');
    if (total <= 0) return setErr('Total must be greater than zero.');
    setBusy(true);
    try {
      const distName = distributors.data?.distributors.find((d) => d.id === distributorId)?.name ?? '';
      await api.post('/accounting/entries', {
        date,
        memo: memo || `Delivery to ${distName}${drNo ? ` · DR #${drNo}` : ''}`,
        reference: drNo || undefined,
        distributorOrgId: distributorId,
        deliveryReceiptNo: drNo || undefined,
        lines: [
          { accountId: arId, debit: total },
          { accountId: revId, credit: total },
        ],
        items: valid.map((it) => ({
          productId: it.productId,
          sku: it.sku,
          name: it.name,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice) || 0,
          amount: lineAmount(it),
        })),
      });
      onSaved();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Distributor Delivery (Accounts Receivable)" onClose={onClose} wide>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Delivery Receipt No.</label>
          <input className="input" value={drNo} onChange={(e) => setDrNo(e.target.value)} placeholder="DR-0001" />
        </div>
        <div className="col-span-2">
          <label className="label">Distributor</label>
          <select className="input" value={distributorId} onChange={(e) => setDistributorId(e.target.value)}>
            <option value="">{distributors.loading ? 'Loading…' : 'Select a distributor…'}</option>
            {(distributors.data?.distributors ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.type})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Debit — Accounts Receivable</label>
          <select className="input" value={arId} onChange={(e) => setArId(e.target.value)}>
            {arAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Credit — Revenue</label>
          <select className="input" value={revId} onChange={(e) => setRevId(e.target.value)}>
            {revAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select>
        </div>
      </div>

      <label className="label">Items (per SKU)</label>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-400">
          <th className="pb-1">Product</th><th className="pb-1 text-right">Qty</th><th className="pb-1 text-right">Unit price</th><th className="pb-1 text-right">Amount</th><th></th>
        </tr></thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <select className="input" value={it.productId} onChange={(e) => pickProduct(i, e.target.value)}>
                  <option value="">{products.loading ? 'Loading…' : 'Select SKU…'}</option>
                  {(products.data?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                </select>
              </td>
              <td className="py-1 w-20"><input type="number" min={1} className="input text-right" value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} /></td>
              <td className="py-1 w-28 pl-2"><input type="number" min={0} step="0.01" className="input text-right" value={it.unitPrice} onChange={(e) => setItem(i, 'unitPrice', e.target.value)} /></td>
              <td className="py-1 pl-2 text-right">{peso(lineAmount(it))}</td>
              <td className="pl-2">{items.length > 1 && <button className="text-xs text-red-600" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="mt-2 text-xs font-semibold text-brand-700 hover:underline" onClick={() => setItems([...items, { productId: '', sku: '', name: '', quantity: '1', unitPrice: '' }])}>+ Add item</button>

      <div className="mt-3">
        <label className="label">Memo (optional)</label>
        <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </div>
      <div className="mt-3 flex items-center justify-end gap-4 text-sm">
        <span>Total (Accounts Receivable): <strong>{peso(total)}</strong></span>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Post delivery'}</button>
      </div>
    </Modal>
  );
}

// ======================= Chart of Accounts ==================================
export function ChartOfAccounts() {
  const { data, loading, error, refetch } = useFetch<{ accounts: Account[] }>('/accounting/accounts');
  const [showAdd, setShowAdd] = useState(false);

  const accounts = data?.accounts ?? [];
  const byType = (t: AccountType) => accounts.filter((a) => a.type === t);

  return (
    <div>
      <PageHeader title="Chart of Accounts" subtitle="Your accounts, grouped by type" />
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

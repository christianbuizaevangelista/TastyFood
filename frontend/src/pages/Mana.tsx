import { ChangeEvent, useState } from 'react';
import { api, apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, KpiCard, Badge } from '../components/ui';
import { peso, num, dateTime } from '../lib/format';

interface Wallet {
  balance: number;
  transactions: { id: string; change: number; balance: number; reason: string; createdAt: string }[];
}
interface Purchase {
  id: string;
  amount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  fileName: string;
  size: number;
  createdAt: string;
  org: { id: string; name: string; type: string };
}

export default function Mana() {
  const { user } = useAuth();
  const isPrincipal = user!.role === 'PRINCIPAL';
  // Only Provincial and City distributors may buy Mana.
  const canBuy = user!.role === 'PROVINCIAL' || user!.role === 'CITY';
  const wallet = useFetch<Wallet>('/mana/wallet');
  const purchases = useFetch<{ purchases: Purchase[] }>('/mana/purchases');

  const [amount, setAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  async function buy() {
    setErr(null);
    setMsg(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) return setErr('Enter the amount of Mana to buy.');
    if (!file) return setErr('Attach your proof of payment.');
    if (file.size > 3 * 1024 * 1024) return setErr('Proof file too large (max 3 MB).');
    setBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.post('/mana/purchases', {
          amount: amt,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          dataBase64: reader.result as string,
        });
        setMsg('Request submitted — waiting for Principal approval.');
        setAmount('');
        setFile(null);
        purchases.refetch();
      } catch (e) {
        setErr(apiError(e));
      } finally {
        setBusy(false);
      }
    };
    reader.onerror = () => { setErr('Could not read file'); setBusy(false); };
    reader.readAsDataURL(file);
  }

  async function decide(id: string, status: 'APPROVED' | 'REJECTED') {
    setErr(null);
    try {
      await api.post(`/mana/purchases/${id}/decide`, { status });
      purchases.refetch();
      wallet.refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }
  async function viewProof(id: string) {
    try {
      const res = await api.get(`/mana/purchases/${id}/proof`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setErr(apiError(e));
    }
  }

  if (wallet.loading) return <Spinner />;

  const list = purchases.data?.purchases ?? [];
  const pending = list.filter((p) => p.status === 'PENDING');

  return (
    <div>
      <PageHeader title="Mana Wallet" subtitle="1 Peso = 1 Mana. Buy Mana to pre-pay purchase orders." />
      {(err || wallet.error) && <div className="mb-4"><Alert>{err || wallet.error}</Alert></div>}
      {msg && <div className="mb-4"><Alert kind="success">{msg}</Alert></div>}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Mana Balance" value={`${num(wallet.data?.balance ?? 0)} ✨`} accent="text-brand-600" hint={peso(wallet.data?.balance ?? 0)} />
        <KpiCard label="Pending Requests" value={num(isPrincipal ? pending.length : list.filter((p) => p.status === 'PENDING').length)} />
        <KpiCard label="Approved" value={num(list.filter((p) => p.status === 'APPROVED').length)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Buy Mana — Provincial & City only */}
        {canBuy && (
          <div className="card">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Buy Mana</h2>
            <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50 p-3 text-xs">
              <div className="mb-1 font-semibold text-brand-700">Transfer your payment to:</div>
              <div className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-slate-700">
                <span className="text-slate-400">Bank</span><span className="font-medium">Rizal Commercial Banking Corporation (RCBC)</span>
                <span className="text-slate-400">Account Name</span><span className="font-medium">Tasty Food Manufacturing Inc.</span>
                <span className="text-slate-400">Account No.</span><span className="font-mono font-semibold">7590681790</span>
              </div>
              <div className="mt-2 text-slate-400">Then upload your proof of payment below.</div>
            </div>
            <label className="label">Amount (₱ = Mana)</label>
            <input className="input mb-1" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 10000" />
            <p className="mb-3 text-xs text-green-600">
              {Number(amount) > 0
                ? `You'll receive ${num(Math.round(Number(amount) * 1.005 * 100) / 100)} ✨ (includes +0.5% bonus)`
                : 'Get a +0.5% bonus on every Mana purchase.'}
            </p>
            <label className="label">Proof of payment (image/PDF)</label>
            <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="mb-3 text-xs" onChange={onFile} />
            <button className="btn-primary w-full" disabled={busy} onClick={buy}>{busy ? 'Submitting…' : 'Submit request'}</button>
            <p className="mt-2 text-xs text-slate-400">The Principal approves your payment, then your Mana (plus 0.5% bonus) is credited.</p>
          </div>
        )}

        {/* Transactions */}
        <div className={`card overflow-x-auto ${canBuy ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Transactions</h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">Date</th>
                <th className="th">Reason</th>
                <th className="th text-right">Change</th>
                <th className="th text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {wallet.data?.transactions.map((t) => (
                <tr key={t.id} className="border-b border-slate-50">
                  <td className="td whitespace-nowrap text-xs text-slate-500">{dateTime(t.createdAt)}</td>
                  <td className="td text-xs">{t.reason.replace(/_/g, ' ')}</td>
                  <td className={`td text-right font-semibold ${t.change < 0 ? 'text-red-600' : 'text-green-600'}`}>{t.change > 0 ? `+${num(t.change)}` : num(t.change)}</td>
                  <td className="td text-right">{num(t.balance)}</td>
                </tr>
              ))}
              {!wallet.data?.transactions.length && <tr><td className="td text-slate-400" colSpan={4}>No transactions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Requests / Approvals */}
      <div className="card mt-6 overflow-x-auto">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{isPrincipal ? 'Mana Purchase Requests (approve)' : 'My Requests'}</h2>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              {isPrincipal && <th className="th">Organization</th>}
              <th className="th text-right">Amount</th>
              <th className="th">Proof</th>
              <th className="th">Status</th>
              <th className="th">Date</th>
              {isPrincipal && <th className="th text-right">Action</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="border-b border-slate-50">
                {isPrincipal && <td className="td">{p.org.name} <span className="text-xs text-slate-400">({p.org.type})</span></td>}
                <td className="td text-right font-semibold">{num(p.amount)} ✨</td>
                <td className="td"><button onClick={() => viewProof(p.id)} className="text-xs font-semibold text-brand-600 hover:underline">View</button></td>
                <td className="td"><Badge value={p.status} /></td>
                <td className="td whitespace-nowrap text-xs text-slate-500">{dateTime(p.createdAt)}</td>
                {isPrincipal && (
                  <td className="td text-right">
                    {p.status === 'PENDING' ? (
                      <span className="flex justify-end gap-1">
                        <button onClick={() => decide(p.id, 'REJECTED')} className="rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">Reject</button>
                        <button onClick={() => decide(p.id, 'APPROVED')} className="rounded bg-brand-500 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-600">Approve</button>
                      </span>
                    ) : <span className="text-xs text-slate-400">—</span>}
                  </td>
                )}
              </tr>
            ))}
            {!list.length && <tr><td className="td text-slate-400" colSpan={isPrincipal ? 6 : 4}>No requests yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

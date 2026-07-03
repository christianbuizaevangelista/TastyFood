import { ReactNode, useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState, KpiCard } from '../components/ui';
import { peso, num, pct, date } from '../lib/format';

type Objective = 'AWARENESS' | 'TRAFFIC' | 'ENGAGEMENT' | 'LEADS' | 'SALES';
type Status = 'ACTIVE' | 'PAUSED' | 'COMPLETED';

interface Campaign {
  id: string;
  name: string;
  objective: Objective;
  status: Status;
  budget: number;
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  leads: number;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
}
interface Summary {
  count: number; active: number; budget: number; spend: number;
  reach: number; impressions: number; clicks: number; leads: number;
  ctr: number; cpl: number; cpc: number;
}

const OBJECTIVES: Objective[] = ['AWARENESS', 'TRAFFIC', 'ENGAGEMENT', 'LEADS', 'SALES'];
const STATUSES: Status[] = ['ACTIVE', 'PAUSED', 'COMPLETED'];
const STATUS_STYLE: Record<Status, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-slate-100 text-slate-500',
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default function FacebookAds() {
  const { data, loading, error, refetch } = useFetch<{ campaigns: Campaign[]; summary: Summary }>('/marketing/fb-ads');
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del(c: Campaign) {
    if (!confirm(`Delete campaign "${c.name}"?`)) return;
    setErr(null);
    try {
      await api.delete(`/marketing/fb-ads/${c.id}`);
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const s = data!.summary;

  return (
    <div>
      <PageHeader
        title="Facebook Ads Management"
        subtitle="Track your Facebook ad campaigns, spend, and results"
        action={<button className="btn-primary" onClick={() => setCreating(true)}>+ New Campaign</button>}
      />

      {err && <div className="mb-3"><Alert>{err}</Alert></div>}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total Spend" value={peso(s.spend)} hint={`of ${peso(s.budget)} budget`} accent="text-brand-600" />
        <KpiCard label="Active Campaigns" value={num(s.active)} hint={`${s.count} total`} />
        <KpiCard label="Total Reach" value={num(s.reach)} hint={`${num(s.impressions)} impressions`} />
        <KpiCard label="Leads / Results" value={num(s.leads)} hint={s.cpl > 0 ? `${peso(s.cpl)} / lead` : '—'} accent="text-green-600" />
        <KpiCard label="Clicks" value={num(s.clicks)} hint={s.cpc > 0 ? `${peso(s.cpc)} / click` : '—'} />
        <KpiCard label="Click-through rate" value={pct(s.ctr)} hint="clicks ÷ impressions" />
      </div>

      {data!.campaigns.length === 0 ? (
        <EmptyState>No campaigns yet. Click “New Campaign” to add one.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="th">Campaign</th>
                <th className="th">Objective</th>
                <th className="th">Status</th>
                <th className="th text-right">Budget</th>
                <th className="th text-right">Spend</th>
                <th className="th text-right">Reach</th>
                <th className="th text-right">Clicks</th>
                <th className="th text-right">Leads</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {data!.campaigns.map((c) => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="td">
                    <div className="font-medium text-slate-800">{c.name}</div>
                    <div className="text-xs text-slate-400">
                      {c.startDate ? date(c.startDate) : '—'}{c.endDate ? ` → ${date(c.endDate)}` : ''}
                    </div>
                  </td>
                  <td className="td text-xs">{c.objective}</td>
                  <td className="td"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[c.status]}`}>{c.status}</span></td>
                  <td className="td text-right">{peso(c.budget)}</td>
                  <td className="td text-right font-semibold">{peso(c.spend)}</td>
                  <td className="td text-right">{num(c.reach)}</td>
                  <td className="td text-right">{num(c.clicks)}</td>
                  <td className="td text-right font-semibold text-green-600">{num(c.leads)}</td>
                  <td className="td whitespace-nowrap text-right text-xs">
                    <button className="text-brand-600 hover:underline" onClick={() => setEditing(c)}>Edit</button>
                    <button className="ml-3 text-red-600 hover:underline" onClick={() => del(c)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <CampaignForm
          campaign={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); refetch(); }}
        />
      )}
    </div>
  );
}

function CampaignForm({ campaign, onClose, onSaved }: { campaign: Campaign | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!campaign;
  const [f, setF] = useState({
    name: campaign?.name ?? '',
    objective: (campaign?.objective ?? 'AWARENESS') as Objective,
    status: (campaign?.status ?? 'ACTIVE') as Status,
    budget: String(campaign?.budget ?? ''),
    spend: String(campaign?.spend ?? ''),
    reach: String(campaign?.reach ?? ''),
    impressions: String(campaign?.impressions ?? ''),
    clicks: String(campaign?.clicks ?? ''),
    leads: String(campaign?.leads ?? ''),
    startDate: campaign?.startDate ? String(campaign.startDate).slice(0, 10) : '',
    endDate: campaign?.endDate ? String(campaign.endDate).slice(0, 10) : '',
    notes: campaign?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  async function save() {
    setErr(null);
    if (!f.name.trim()) return setErr('Enter a campaign name.');
    setBusy(true);
    try {
      const payload = {
        name: f.name.trim(),
        objective: f.objective,
        status: f.status,
        budget: Number(f.budget) || 0,
        spend: Number(f.spend) || 0,
        reach: Number(f.reach) || 0,
        impressions: Number(f.impressions) || 0,
        clicks: Number(f.clicks) || 0,
        leads: Number(f.leads) || 0,
        startDate: f.startDate || null,
        endDate: f.endDate || null,
        notes: f.notes.trim() || null,
      };
      if (isEdit) await api.put(`/marketing/fb-ads/${campaign!.id}`, payload);
      else await api.post('/marketing/fb-ads', payload);
      onSaved();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  const Num = ({ k, label }: { k: keyof typeof f; label: string }) => (
    <div>
      <label className="label">{label}</label>
      <input type="number" min={0} step="0.01" className="input" value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <Modal title={isEdit ? 'Edit Campaign' : 'New Campaign'} onClose={onClose}>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <div className="space-y-3">
        <div>
          <label className="label">Campaign name</label>
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. June Product Launch" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Objective</label>
            <select className="input" value={f.objective} onChange={(e) => set('objective', e.target.value)}>
              {OBJECTIVES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>
              {STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <Num k="budget" label="Budget (₱)" />
          <Num k="spend" label="Amount spent (₱)" />
          <Num k="reach" label="Reach" />
          <Num k="impressions" label="Impressions" />
          <Num k="clicks" label="Clicks" />
          <Num k="leads" label="Leads / Results" />
          <div>
            <label className="label">Start date</label>
            <input type="date" className="input" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </div>
          <div>
            <label className="label">End date</label>
            <input type="date" className="input" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Notes (optional)</label>
          <textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create campaign'}</button>
      </div>
    </Modal>
  );
}

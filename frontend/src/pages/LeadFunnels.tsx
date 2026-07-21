import { ReactNode, useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState, KpiCard } from '../components/ui';
import { peso, num, pct, date } from '../lib/format';

type Source = 'FACEBOOK_ADS' | 'WALK_IN' | 'REFERRAL' | 'WEBSITE' | 'MANUAL';
type Status = 'OPEN' | 'WON' | 'LOST';
type Interest = 'PROVINCIAL' | 'CITY' | 'RESELLER' | 'RETAIL' | 'UNSURE';

const SOURCES: Source[] = ['FACEBOOK_ADS', 'WALK_IN', 'REFERRAL', 'WEBSITE', 'MANUAL'];
const SOURCE_LABEL: Record<Source, string> = {
  FACEBOOK_ADS: 'Facebook Ads',
  WALK_IN: 'Walk-in',
  REFERRAL: 'Referral',
  WEBSITE: 'Website',
  MANUAL: 'Manual',
};
const STATUS_STYLE: Record<Status, string> = {
  OPEN: 'bg-blue-100 text-blue-700',
  WON: 'bg-green-100 text-green-700',
  LOST: 'bg-slate-100 text-slate-500',
};
const INTERESTS: Interest[] = ['PROVINCIAL', 'CITY', 'RESELLER', 'RETAIL', 'UNSURE'];
const INTEREST_LABEL: Record<Interest, string> = {
  PROVINCIAL: 'Provincial Distributor',
  CITY: 'City Distributor',
  RESELLER: 'Reseller',
  RETAIL: 'Retail Distributor',
  UNSURE: 'Not sure yet',
};
const DEFAULT_STAGES = ['New', 'Contacted', 'Qualified', 'Negotiation'];

interface StageStat {
  stage: string;
  index: number;
  current: number;
  currentValue: number;
  reached: number;
  conversionPct: number;
}
interface Summary {
  total: number; open: number; won: number; lost: number;
  openValue: number; wonValue: number; winRatePct: number; conversionPct: number;
}
interface Funnel {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  stages: string[];
  stageStats: StageStat[];
  summary: Summary;
}
interface Lead {
  id: string;
  funnelId: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  interest: Interest | null;
  source: Source;
  campaignId: string | null;
  campaign?: { id: string; name: string } | null;
  stageIndex: number;
  status: Status;
  value: number;
  note: string | null;
  lostReason: string | null;
  closedAt: string | null;
  createdAt: string;
}
interface FunnelDetail extends Funnel {
  leads: Lead[];
}
interface Campaign { id: string; name: string }

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

// Horizontal funnel: each stage's bar is scaled against the widest stage, so the
// narrowing shape shows where leads drop off.
function FunnelChart({ stats }: { stats: StageStat[] }) {
  const max = Math.max(1, ...stats.map((s) => s.reached));
  return (
    <div className="space-y-2">
      {stats.map((s, i) => {
        const width = Math.max(4, (s.reached / max) * 100);
        const dropped = i > 0 ? stats[i - 1].reached - s.reached : 0;
        return (
          <div key={s.index}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-medium text-slate-700">{s.stage}</span>
              <span className="text-slate-400">
                {num(s.reached)} reached
                {i > 0 && (
                  <>
                    {' · '}
                    <span className={s.conversionPct >= 50 ? 'text-green-600' : 'text-amber-600'}>
                      {pct(s.conversionPct)}
                    </span>
                    {dropped > 0 && <span className="text-red-500"> (−{num(dropped)})</span>}
                  </>
                )}
              </span>
            </div>
            <div className="h-7 w-full rounded bg-slate-100">
              <div
                className="flex h-7 items-center rounded bg-indigo-500 px-2 text-xs font-semibold text-white transition-all"
                style={{ width: `${width}%` }}
              >
                {s.current > 0 && <span>{num(s.current)} here</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function LeadFunnels() {
  const { data, loading, error, refetch } = useFetch<{ funnels: Funnel[] }>('/marketing/funnels');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingFunnel, setEditingFunnel] = useState<Funnel | null>(null);
  const [creatingFunnel, setCreatingFunnel] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const funnels = data?.funnels ?? [];
  // Default to the first funnel once loaded.
  const activeId = selectedId ?? funnels[0]?.id ?? null;

  async function delFunnel(f: Funnel) {
    if (!confirm(`Delete funnel "${f.name}" and all of its leads?`)) return;
    setErr(null);
    try {
      await api.delete(`/marketing/funnels/${f.id}`);
      if (activeId === f.id) setSelectedId(null);
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div>
      <PageHeader
        title="Lead Funnels"
        subtitle="Track leads through your pipeline and see where they drop off"
        action={
          <button className="btn-primary" onClick={() => setCreatingFunnel(true)}>
            + New funnel
          </button>
        }
      />

      {err && <Alert>{err}</Alert>}

      {funnels.length === 0 ? (
        <EmptyState>
          No funnels yet — create one (e.g. “Distributor Recruitment”) to start tracking leads through your stages.
        </EmptyState>
      ) : (
        <>
          {/* Funnel selector */}
          <div className="mb-6 flex flex-wrap gap-2">
            {funnels.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                className={`rounded-lg border px-3 py-2 text-sm transition ${
                  activeId === f.id
                    ? 'border-indigo-500 bg-indigo-50 font-semibold text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                {f.name}
                <span className="ml-2 text-xs text-slate-400">{num(f.summary.total)}</span>
                {!f.isActive && <span className="ml-2 badge bg-slate-100 text-slate-500">inactive</span>}
              </button>
            ))}
          </div>

          {activeId && (
            <FunnelDetailView
              funnelId={activeId}
              onEdit={(f) => setEditingFunnel(f)}
              onDelete={delFunnel}
              onChanged={refetch}
            />
          )}
        </>
      )}

      {(creatingFunnel || editingFunnel) && (
        <FunnelForm
          funnel={editingFunnel}
          onClose={() => {
            setCreatingFunnel(false);
            setEditingFunnel(null);
          }}
          onSaved={(id) => {
            setCreatingFunnel(false);
            setEditingFunnel(null);
            setSelectedId(id);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function FunnelDetailView({
  funnelId,
  onEdit,
  onDelete,
  onChanged,
}: {
  funnelId: string;
  onEdit: (f: Funnel) => void;
  onDelete: (f: Funnel) => void;
  onChanged: () => void;
}) {
  const { data, loading, error, refetch } = useFetch<FunnelDetail>(`/marketing/funnels/${funnelId}`, [funnelId]);
  const [addingLead, setAddingLead] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | Status>('ALL');
  const [interestFilter, setInterestFilter] = useState<'ALL' | Interest>('ALL');
  const [areaFilter, setAreaFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');

  function reload() {
    refetch();
    onChanged(); // refresh the funnel list's headline numbers too
  }

  async function move(lead: Lead, body: Record<string, unknown>) {
    setErr(null);
    try {
      await api.patch(`/marketing/leads/${lead.id}/stage`, body);
      reload();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  async function delLead(lead: Lead) {
    if (!confirm(`Delete lead "${lead.name}"?`)) return;
    setErr(null);
    try {
      await api.delete(`/marketing/leads/${lead.id}`);
      reload();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const s = data.summary;
  // Filters stack: a lead has to satisfy every one that is set. Area matches
  // city, province or the free-text address, so it works whether the lead came
  // from the landing page (structured) or was typed in by hand.
  const areaQ = areaFilter.trim().toLowerCase();
  const leads = data.leads.filter((l) => {
    if (statusFilter !== 'ALL' && l.status !== statusFilter) return false;
    if (interestFilter !== 'ALL' && l.interest !== interestFilter) return false;
    if (areaQ && ![l.city, l.province, l.address].some((v) => v?.toLowerCase().includes(areaQ))) return false;
    if (fromFilter && l.createdAt.slice(0, 10) < fromFilter) return false;
    if (toFilter && l.createdAt.slice(0, 10) > toFilter) return false;
    return true;
  });
  const filtersOn =
    statusFilter !== 'ALL' || interestFilter !== 'ALL' || !!areaQ || !!fromFilter || !!toFilter;
  const clearFilters = () => {
    setStatusFilter('ALL');
    setInterestFilter('ALL');
    setAreaFilter('');
    setFromFilter('');
    setToFilter('');
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-800">{data.name}</h2>
          {data.description && <p className="text-sm text-slate-500">{data.description}</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => onEdit(data)}>Edit funnel</button>
          <button className="btn-secondary text-red-600" onClick={() => onDelete(data)}>Delete</button>
          <button className="btn-primary" onClick={() => setAddingLead(true)}>+ Add lead</button>
        </div>
      </div>

      {err && <Alert>{err}</Alert>}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total Leads" value={num(s.total)} hint={`${num(s.open)} still open`} accent="text-brand-600" />
        <KpiCard label="Pipeline Value" value={peso(s.openValue)} hint="open leads" />
        <KpiCard label="Won" value={`${num(s.won)}`} hint={peso(s.wonValue)} accent="text-green-600" />
        <KpiCard
          label="Win Rate"
          value={s.won + s.lost > 0 ? pct(s.winRatePct) : '—'}
          hint={s.won + s.lost > 0 ? `${num(s.won)} of ${num(s.won + s.lost)} closed` : 'nothing closed yet'}
          accent={s.winRatePct >= 50 ? 'text-green-600' : 'text-amber-600'}
        />
      </div>

      <div className="card mb-6">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">Funnel</h3>
        <p className="mb-4 text-xs text-slate-400">
          Bar width = leads that reached the stage · % = conversion from the previous stage
        </p>
        <FunnelChart stats={data.stageStats} />
      </div>

      <div className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">
            Leads
            {filtersOn && (
              <span className="ml-2 text-xs font-normal text-slate-400">
                showing {leads.length} of {data.leads.length}
              </span>
            )}
          </h3>
          {filtersOn && (
            <button className="text-xs text-brand-600 hover:underline" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="ALL">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="WON">Won</option>
            <option value="LOST">Lost</option>
          </select>
          <select className="input" value={interestFilter} onChange={(e) => setInterestFilter(e.target.value as any)}>
            <option value="ALL">Applying for anything</option>
            {INTERESTS.map((i) => (
              <option key={i} value={i}>{INTEREST_LABEL[i]}</option>
            ))}
          </select>
          <input
            className="input" placeholder="Area — city or province"
            value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}
          />
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <span className="shrink-0">From</span>
            <input type="date" className="input" value={fromFilter} onChange={(e) => setFromFilter(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <span className="shrink-0">To</span>
            <input type="date" className="input" value={toFilter} onChange={(e) => setToFilter(e.target.value)} />
          </label>
        </div>

        {leads.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">No leads here yet.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="th">Lead</th>
                <th className="th">Source</th>
                <th className="th">Stage</th>
                <th className="th text-right">Value</th>
                <th className="th">Status</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-slate-50">
                  <td className="td">
                    <button className="font-medium text-slate-800 hover:text-indigo-600" onClick={() => setEditingLead(l)}>
                      {l.name}
                    </button>
                    <div className="text-xs text-slate-400">
                      {[l.company, l.phone].filter(Boolean).join(' · ') || date(l.createdAt)}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                      {l.interest && (
                        <span className="badge bg-brand-50 text-brand-700">{INTEREST_LABEL[l.interest]}</span>
                      )}
                      {(l.city || l.province || l.address) && (
                        <span className="text-slate-400">
                          {[l.city, l.province].filter(Boolean).join(', ') || l.address}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="td text-xs">
                    {SOURCE_LABEL[l.source]}
                    {l.campaign && <div className="text-slate-400">{l.campaign.name}</div>}
                  </td>
                  <td className="td">
                    {l.status === 'OPEN' ? (
                      <select
                        className="input w-36 text-xs"
                        value={l.stageIndex}
                        onChange={(e) => move(l, { stageIndex: Number(e.target.value) })}
                      >
                        {data.stages.map((st, i) => (
                          <option key={i} value={i}>{st}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-400">{data.stages[l.stageIndex] ?? '—'}</span>
                    )}
                  </td>
                  <td className="td text-right font-semibold">{peso(l.value)}</td>
                  <td className="td">
                    <span className={`badge ${STATUS_STYLE[l.status]}`}>{l.status}</span>
                    {l.status === 'LOST' && l.lostReason && (
                      <div className="mt-0.5 text-xs text-slate-400">{l.lostReason}</div>
                    )}
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      {l.status === 'OPEN' ? (
                        <>
                          <button
                            className="btn-secondary px-2 py-1 text-xs text-green-700"
                            onClick={() => move(l, { status: 'WON' })}
                          >
                            Won
                          </button>
                          <button
                            className="btn-secondary px-2 py-1 text-xs"
                            onClick={() => {
                              const reason = prompt('Reason for losing this lead? (optional)') ?? '';
                              move(l, { status: 'LOST', lostReason: reason || null });
                            }}
                          >
                            Lost
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn-secondary px-2 py-1 text-xs"
                          onClick={() => move(l, { status: 'OPEN' })}
                        >
                          Reopen
                        </button>
                      )}
                      <button className="btn-secondary px-2 py-1 text-xs text-red-600" onClick={() => delLead(l)}>
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(addingLead || editingLead) && (
        <LeadForm
          funnel={data}
          lead={editingLead}
          onClose={() => {
            setAddingLead(false);
            setEditingLead(null);
          }}
          onSaved={() => {
            setAddingLead(false);
            setEditingLead(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function FunnelForm({
  funnel,
  onClose,
  onSaved,
}: {
  funnel: Funnel | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(funnel?.name ?? '');
  const [description, setDescription] = useState(funnel?.description ?? '');
  const [isActive, setIsActive] = useState(funnel?.isActive ?? true);
  const [stages, setStages] = useState<string[]>(funnel?.stages ?? DEFAULT_STAGES);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function setStage(i: number, v: string) {
    setStages((prev) => prev.map((s, idx) => (idx === i ? v : s)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const cleaned = stages.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length < 2) {
      setErr('A funnel needs at least 2 stages.');
      return;
    }
    setSaving(true);
    try {
      const body = { name, description: description || null, isActive, stages: cleaned };
      const { data } = funnel
        ? await api.put(`/marketing/funnels/${funnel.id}`, body)
        : await api.post('/marketing/funnels', body);
      onSaved(data.id);
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={funnel ? 'Edit funnel' : 'New funnel'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required
            placeholder="Distributor Recruitment" />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="What this funnel is for" />
        </div>

        <div>
          <label className="label">Stages (in order)</label>
          <div className="space-y-2">
            {stages.map((s, i) => (
              <div key={i} className="flex gap-2">
                <span className="flex h-9 w-6 items-center justify-center text-xs text-slate-400">{i + 1}</span>
                <input className="input flex-1" value={s} onChange={(e) => setStage(i, e.target.value)} />
                {stages.length > 2 && (
                  <button type="button" className="btn-secondary px-2 text-red-600"
                    onClick={() => setStages((prev) => prev.filter((_, idx) => idx !== i))}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          {stages.length < 8 && (
            <button type="button" className="btn-secondary mt-2 text-xs"
              onClick={() => setStages((prev) => [...prev, ''])}>
              + Add stage
            </button>
          )}
          {funnel && (
            <p className="mt-2 text-xs text-slate-400">
              Removing a stage moves any lead sitting past it back to the last remaining stage.
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LeadForm({
  funnel,
  lead,
  onClose,
  onSaved,
}: {
  funnel: FunnelDetail;
  lead: Lead | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const campaigns = useFetch<{ campaigns: Campaign[] }>('/marketing/fb-ads');
  const [f, setF] = useState({
    name: lead?.name ?? '',
    company: lead?.company ?? '',
    phone: lead?.phone ?? '',
    email: lead?.email ?? '',
    address: lead?.address ?? '',
    city: lead?.city ?? '',
    province: lead?.province ?? '',
    interest: (lead?.interest ?? '') as '' | Interest,
    source: (lead?.source ?? 'MANUAL') as Source,
    campaignId: lead?.campaignId ?? '',
    stageIndex: lead?.stageIndex ?? 0,
    value: lead?.value ?? 0,
    note: lead?.note ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: unknown) => setF((prev) => ({ ...prev, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const body = {
        funnelId: funnel.id,
        name: f.name,
        company: f.company || null,
        phone: f.phone || null,
        email: f.email || null,
        address: f.address || null,
        city: f.city || null,
        province: f.province || null,
        interest: f.interest || null,
        source: f.source,
        // Only Facebook-sourced leads carry a campaign.
        campaignId: f.source === 'FACEBOOK_ADS' ? f.campaignId || null : null,
        stageIndex: Number(f.stageIndex),
        value: Number(f.value),
        note: f.note || null,
      };
      if (lead) await api.put(`/marketing/leads/${lead.id}`, body);
      else await api.post('/marketing/leads', body);
      onSaved();
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={lead ? 'Edit lead' : 'Add lead'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <div>
          <label className="label">Name</label>
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Company / store</label>
            <input className="input" value={f.company} onChange={(e) => set('company', e.target.value)} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </div>
        <div>
          <label className="label">Address</label>
          <input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">City / municipality</label>
            <input className="input" value={f.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div>
            <label className="label">Province</label>
            <input className="input" value={f.province} onChange={(e) => set('province', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Applying for</label>
          <select className="input" value={f.interest} onChange={(e) => set('interest', e.target.value)}>
            <option value="">— not stated —</option>
            {INTERESTS.map((i) => (
              <option key={i} value={i}>{INTEREST_LABEL[i]}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Source</label>
            <select className="input" value={f.source} onChange={(e) => set('source', e.target.value)}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Stage</label>
            <select className="input" value={f.stageIndex} onChange={(e) => set('stageIndex', Number(e.target.value))}>
              {funnel.stages.map((s, i) => (
                <option key={i} value={i}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {f.source === 'FACEBOOK_ADS' && (
          <div>
            <label className="label">Campaign (optional)</label>
            <select className="input" value={f.campaignId} onChange={(e) => set('campaignId', e.target.value)}>
              <option value="">— none —</option>
              {(campaigns.data?.campaigns ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">Attributes this lead back to a Facebook Ads campaign.</p>
          </div>
        )}

        <div>
          <label className="label">Estimated value (₱)</label>
          <input className="input" type="number" min={0} step="0.01" value={f.value}
            onChange={(e) => set('value', e.target.value)} />
        </div>
        <div>
          <label className="label">Note</label>
          <textarea className="input" rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
